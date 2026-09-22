import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Compass,
  Filter,
  Flag,
  GraduationCap,
  Heart,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Menu,
  Plus,
  RotateCcw,
  Scale,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { AdminView, AssessmentView, ProfileView } from "./Flows";
import { SchoolDetail } from "./SchoolDetail";
import { schools } from "./data";
import { initialProfile } from "./types";
import type {
  AssessmentResult,
  FlowProps,
  Page,
  Profile,
  School,
  Tier,
} from "./types";

interface DemoState {
  profile: Profile;
  saved: string[];
  excluded: string[];
  target: string | null;
  tasks: string[];
  assessment: AssessmentResult | null;
}
const storageKey = "yantu-demo-v1";
const defaultState: DemoState = {
  profile: initialProfile,
  saved: ["hdu"],
  excluded: [],
  target: "hdu",
  tasks: [],
  assessment: null,
};
function readState(): DemoState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      !parsed ||
      !parsed.profile ||
      !Array.isArray(parsed.saved) ||
      !Array.isArray(parsed.excluded) ||
      !Array.isArray(parsed.tasks)
    )
      return defaultState;
    return {
      ...defaultState,
      ...parsed,
      profile: {
        ...initialProfile,
        ...parsed.profile,
        priorities: {
          ...initialProfile.priorities,
          ...parsed.profile.priorities,
        },
      },
    };
  } catch {
    return defaultState;
  }
}
const navigation = [
  { id: "explore", name: "择校探索", icon: Compass },
  { id: "profile", name: "个人画像", icon: UserRound },
  { id: "assessment", name: "基础测评", icon: ClipboardCheck },
  { id: "favorites", name: "我的收藏", icon: Heart },
  { id: "plan", name: "目标与规划", icon: Flag },
] as const;
function currentPage(): Page {
  const hash = location.hash.slice(1);
  return [
    "explore",
    "profile",
    "assessment",
    "favorites",
    "plan",
    "admin",
  ].includes(hash)
    ? (hash as Page)
    : "explore";
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function JourneyArt() {
  return (
    <svg
      className="journey-art"
      viewBox="0 0 380 240"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="221"
        cy="117"
        r="95"
        stroke="#85a591"
        strokeOpacity=".2"
        strokeDasharray="3 7"
      />
      <circle cx="221" cy="117" r="68" stroke="#85a591" strokeOpacity=".16" />
      <path
        d="M53 192C134 186 111 127 183 155s61-100 132-90"
        stroke="#c3d6a4"
        strokeWidth="1.5"
        strokeDasharray="5 6"
      />
      <path d="M125 151l91-28 89 32-91 35z" fill="#133b31" stroke="#699280" />
      <path d="M125 140l91-28 89 32-91 35z" fill="#dae7cd" stroke="#a0bea9" />
      <path d="M125 140v11l89 31v-3m91-35v11l-91 27" fill="#93b39c" />
      <path d="M144 125l73-24 69 25-71 24z" fill="#e9eed8" stroke="#b2c5a2" />
      <path d="M144 125v10l71 25 71-25v-9l-71 24z" fill="#a9bd9e" />
      <path
        d="M161 79l57-17 57 19-57 20z"
        fill="#adc99c"
        stroke="#cfe0b8"
        strokeWidth="1.5"
      />
      <path d="M177 85v22c26 15 52 13 80 0V87" fill="#8aaa83" />
      <path d="M161 79l57-17 57 19-57 20z" fill="#d5e5b2" stroke="#e4efca" />
      <path d="M218 81l36 14v31" stroke="#f1d69a" strokeWidth="2" />
      <path d="M250 136l4-11 4 11" fill="#f1d69a" />
      <path d="M303 59v27" stroke="#b9d1a5" strokeWidth="1.7" />
      <path d="M303 59l22 4-22 10" fill="#d5e5b2" />
      <circle cx="105" cy="78" r="16" fill="#3b6655" stroke="#6e937b" />
      <path d="M105 70v16m-8-8h16" stroke="#d5e5b2" />
      <path d="M288 185l5-11 5 11-5 11zM145 46l3-7 3 7-3 7z" fill="#d5e5b2" />
      <circle cx="84" cy="159" r="3" fill="#9cb48b" />
      <circle cx="274" cy="39" r="2" fill="#9cb48b" />
      <path d="M200 204h77" stroke="#78967e" strokeOpacity=".4" />
      <path d="M215 213h48" stroke="#78967e" strokeOpacity=".2" />
    </svg>
  );
}

function SchoolCard({
  school,
  saved,
  comparing,
  onSave,
  onCompare,
  onDetail,
  onExclude,
}: {
  school: School;
  saved: boolean;
  comparing: boolean;
  onSave: () => void;
  onCompare: () => void;
  onDetail: () => void;
  onExclude: () => void;
}) {
  return (
    <article className="school-card">
      <div className="school-top">
        <div
          className="school-seal"
          style={{ "--seal-color": school.color } as React.CSSProperties}
        >
          <GraduationCap size={24} strokeWidth={1.4} />
          <span>{school.shortName}</span>
        </div>
        <div className="school-identity">
          <button className="school-name" onClick={onDetail}>
            {school.name}
            <ChevronRight size={15} />
          </button>
          <div className="school-meta">
            <span>
              <MapPin size={12} />
              {school.city}
            </span>
            {school.tags.map((tag) => (
              <span key={tag} className="tiny-tag">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <button
          className={`icon-button save-button ${saved ? "is-saved" : ""}`}
          aria-label={`${saved ? "取消收藏" : "收藏"}${school.name}`}
          aria-pressed={saved}
          onClick={onSave}
        >
          <Heart size={19} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="project-title">
        <h3>
          {school.major}
          <span>{school.code}</span>
        </h3>
        <p>
          {school.college} · {school.degree} · {school.mode} · {school.year}
        </p>
      </div>
      <div className="school-stats">
        <div>
          <span>
            建议备考目标 <span className="micro-demo">模拟</span>
          </span>
          <strong>
            {school.score}
            <small> 分</small>
          </strong>
        </div>
        <div>
          <span>
            计划招生 <span className="micro-demo">模拟</span>
          </span>
          <strong>
            {school.seats}
            <small> 人</small>
          </strong>
        </div>
        <div className="tier-stat">
          <span className={`tier tier-${school.tier}`}>{school.tier}</span>
          <small>偏好适配 {school.match}%</small>
        </div>
      </div>
      <div className="match-reason">
        <Sparkles size={14} />
        <span>{school.reason}</span>
      </div>
      <div className="card-bottom">
        <label className="compare-check">
          <input type="checkbox" checked={comparing} onChange={onCompare} />
          加入对比
        </label>
        <div>
          <button
            className="text-button exclude-button"
            onClick={onExclude}
            aria-label={`暂不考虑${school.name}`}
          >
            暂不考虑
          </button>
          <button className="detail-link" onClick={onDetail}>
            查看详情
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function ScoreChart({ school }: { school: School }) {
  const low =
    Math.floor(
      (Math.min(...school.history.map((item) => item.cutoff)) - 10) / 10,
    ) * 10;
  const high = Math.ceil((school.score + 10) / 10) * 10;
  const y = (value: number) => 95 - ((value - low) / (high - low)) * 80;
  const points = school.history.map((item, index) => [
    18 + index * 116,
    y(item.cutoff),
  ]);
  const line = points
    .map(([x, yy], index) => `${index ? "L" : "M"}${x} ${yy}`)
    .join(" ");
  return (
    <div className="score-chart">
      <div className="chart-y">
        <span>{high}</span>
        <span>{(high + low) / 2}</span>
        <span>{low}</span>
      </div>
      <svg
        viewBox="0 0 270 106"
        role="img"
        aria-label={`${school.name}近三年模拟复试线走势：${school.history.map((item) => `${item.year}年${item.cutoff}分`).join("、")}`}
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#86b7a0" stopOpacity=".22" />
            <stop offset="1" stopColor="#86b7a0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M6 15h258M6 55h258M6 95h258"
          stroke="#e9ece5"
          strokeDasharray="3 4"
        />
        <path d={`${line} L250 105H18z`} fill="url(#chartFill)" />
        <path d={line} stroke="#69927b" strokeWidth="2.5" fill="none" />
        {points.map(([cx, cy]) => (
          <circle
            key={cx}
            cx={cx}
            cy={cy}
            r="4"
            fill="#fff"
            stroke="#69927b"
            strokeWidth="2"
          />
        ))}
        <path
          d={`M6 ${y(school.score)}h258`}
          stroke="#c5a367"
          strokeDasharray="4 4"
        />
      </svg>
      <div className="chart-x">
        {school.history.map((item) => (
          <span key={item.year}>{item.year}</span>
        ))}
      </div>
      <span className="chart-target">目标 {school.score}</span>
    </div>
  );
}

const taskItems = [
  {
    id: "profile",
    name: "完善你的个人画像",
    desc: "让每一条推荐更贴近你",
    page: "profile" as Page,
  },
  {
    id: "assessment",
    name: "完成一次基础测评",
    desc: "从了解自己的起点开始",
    page: "assessment" as Page,
  },
  {
    id: "compare",
    name: "对比 2–3 个心仪项目",
    desc: "找到最适合的选择",
    page: "explore" as Page,
  },
];

export default function App() {
  const [state, setState] = useState<DemoState>(readState);
  const [page, setPage] = useState<Page>(currentPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("全部城市");
  const [tier, setTier] = useState("全部梯度");
  const [tab, setTab] = useState("院校推荐");
  const [sort, setSort] = useState("综合适配");
  const [compare, setCompare] = useState<string[]>([]);
  const [modal, setModal] = useState<
    "compare" | "excluded" | "report" | "help" | "notifications" | null
  >(null);
  const [detail, setDetail] = useState<School | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [degree, setDegree] = useState("全部类型");
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [state]);
  useEffect(() => {
    const handle = () => {
      setPage(currentPage());
      setMenuOpen(false);
    };
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (message: string) => setToast(message);
  const navigate = (next: Page) => {
    location.hash = next;
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleSave = (id: string) => {
    const saved = state.saved.includes(id);
    setState((s) => ({
      ...s,
      saved: saved ? s.saved.filter((x) => x !== id) : [...s.saved, id],
    }));
    notify(saved ? "已取消收藏" : "已收藏，可在「我的收藏」中查看");
  };
  const toggleCompare = (id: string) => {
    if (compare.includes(id)) setCompare(compare.filter((x) => x !== id));
    else if (compare.length >= 3) notify("最多同时对比 3 个项目，请先移除一个");
    else setCompare([...compare, id]);
  };
  const setTarget = (school: School) => {
    setState((s) => ({
      ...s,
      target: school.id,
      saved: s.saved.includes(school.id) ? s.saved : [...s.saved, school.id],
    }));
    setDetail(null);
    setModal(null);
    navigate("plan");
    notify(`已将${school.name}设为目标`);
  };
  const clearFilters = () => {
    setSearch("");
    setCity("全部城市");
    setTier("全部梯度");
    setDegree("全部类型");
  };
  const targetSchool = schools.find((s) => s.id === state.target);
  const activeFilters =
    city !== "全部城市" ||
    tier !== "全部梯度" ||
    degree !== "全部类型" ||
    !!search;
  const isSavedPage = page === "favorites";
  const shown = schools
    .filter(
      (s) =>
        !state.excluded.includes(s.id) &&
        (!isSavedPage || state.saved.includes(s.id)) &&
        (city === "全部城市" || s.city === city) &&
        (tier === "全部梯度" || s.tier === tier) &&
        (degree === "全部类型" || s.degree === degree) &&
        `${s.name}${s.major}${s.city}${s.college}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "目标分数从低到高"
        ? a.score - b.score
        : sort === "招生人数从多到少"
          ? b.seats - a.seats
          : b.match - a.match,
    );
  const flowProps: FlowProps = {
    profile: state.profile,
    assessment: state.assessment,
    onSaveProfile: (profile) => {
      setState((s) => ({ ...s, profile }));
      notify("个人画像已保存在此浏览器");
    },
    onNavigate: navigate,
    notify,
    onAssessment: (assessment) => setState((s) => ({ ...s, assessment })),
    onDeleteProfile: () => {
      try {
        localStorage.removeItem("yantu-demo-assessment-attempt");
      } catch {
        /* Session state is still cleared below. */
      }
      setState((s) => ({
        ...s,
        profile: {
          ...initialProfile,
          university: "",
          major: "",
          english: "不确定",
          math: "不确定",
          cities: [],
          name: "同学",
          graduation: "不确定",
          year: "2027",
          hours: "不确定",
          budget: "不确定",
          crossMajor: "不确定",
          priorities: Object.fromEntries(
            Object.keys(initialProfile.priorities).map((key) => [key, 50]),
          ),
        },
        assessment: null,
      }));
      notify("个人资料和测评记录已删除");
    },
  };
  const buildReport = () => {
    const rows = schools.filter(
      (s) => state.saved.includes(s.id) && !state.excluded.includes(s.id),
    );
    return `# 研途 · 我的择校与备考报告\n\n生成日期：${new Date().toLocaleDateString("zh-CN")}\n\n> 交互演示：所有推荐、招生分数、名额和趋势均为模拟数据，不作为报考依据。无 API 或推荐算法。\n\n## 个人画像\n本科院校：${state.profile.university || "未填写"}\n本科专业：${state.profile.major || "未填写"}\n报考年份：${state.profile.year}\n偏好城市：${state.profile.cities.join("、") || "不限"}\n\n## 测评状态\n${state.assessment?.completed ? "已完成示例测评，仅用于体验诊断流程，不能推断考研成绩。" : "尚未完成测评，能力评估依据不足，当前水平待评估。"}\n\n## 收藏项目\n${rows.length ? rows.map((s) => `- ${s.name} / ${s.college} / ${s.major}（${s.code}）/ ${s.degree} / ${s.mode} / ${s.year}\n  梯度：${s.tier}；模拟备考目标：${s.score}分\n  适配说明：${s.reason}\n  主要风险：${s.risk}\n  考试科目（模拟）：${s.subjects.join("、")}`).join("\n\n") : "暂未收藏项目。"}\n\n## 当前目标\n${targetSchool ? `${targetSchool.name} · ${targetSchool.major}，模拟备考目标 ${targetSchool.score} 分。` : "尚未设定目标。"}\n\n## 下一步\n1. 核对目标年份官方招生目录与报考条件。\n2. 完成系统测评，校准各科基础。\n3. 比较考试科目与跨专业准备成本。\n\n来源状态：官方招生、就业与评价材料尚未接入；不存在经核实的院校负面结论。\n`;
  };
  const downloadReport = () => {
    const blob = new Blob([buildReport()], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "研途-择校与备考报告-demo.md";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("报告已导出为 Markdown 文件");
  };

  return (
    <div className="app-shell">
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="收起导航"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("explore")}
          aria-label="研途首页"
        >
          <span className="brand-mark">
            <BookOpen size={23} strokeWidth={1.7} />
          </span>
          <span>
            研途<small>YANTU</small>
          </span>
        </button>
        <div className="workspace-label">
          我的升学工作台<span>{state.profile.year}</span>
        </div>
        <nav aria-label="主导航">
          {navigation.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => {
                navigate(id);
                if (id === "favorites") {
                  clearFilters();
                  setTab("院校推荐");
                }
              }}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{name}</span>
              {id === "favorites" && state.saved.length > 0 && (
                <span className="nav-count">{state.saved.length}</span>
              )}
              {id === "explore" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-journey">
          <div className="little-spark">
            <Sparkles size={18} />
          </div>
          <strong>每一份努力，都有方向</strong>
          <p>
            从了解自己开始，
            <br />
            一步步走向理想的研究生生活。
          </p>
          <button onClick={() => navigate("assessment")}>
            探索我的可能
            <ArrowUpRightIcon />
          </button>
          <div className="journey-dots">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === "admin" ? "active" : ""}`}
            onClick={() => navigate("admin")}
          >
            <Settings2 size={18} />
            <span>数据管理</span>
            <span className="tiny-tag">Demo</span>
          </button>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={18} />
            <span>使用指南</span>
          </button>
          <div className="sidebar-user">
            <div className="avatar">同</div>
            <div>
              <strong>{state.profile.name || "同学"}，你好</strong>
              <span>{state.profile.year} 考研 · 探索进行中</span>
            </div>
            <button
              className="icon-button"
              aria-label="编辑个人资料"
              onClick={() => navigate("profile")}
            >
              <SlidersHorizontal size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="展开导航"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>我的工作台</span>
            <ChevronRight size={14} />
            <strong>
              {navigation.find((n) => n.id === page)?.name || "数据管理"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-pill">
              <i />
              交互演示版
            </span>
            <button
              className="icon-button notification-button"
              aria-label="查看消息"
              onClick={() => setModal("notifications")}
            >
              <Bell size={18} />
              <i />
            </button>
            <button
              className="top-avatar"
              aria-label="前往个人画像"
              onClick={() => navigate("profile")}
            >
              同
            </button>
          </div>
        </header>
        <main>
          {storageError && (
            <div role="alert" className="notice">
              浏览器存储不可用，当前操作仅保留到页面关闭。你仍然可以导出报告。
            </div>
          )}
          {(page === "explore" || page === "favorites") && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR NEXT CHAPTER</div>
                  <h1>
                    {isSavedPage
                      ? "收藏心动，也收藏可能。"
                      : "找到属于你的下一站。"}
                    <span className="heading-dot" />
                  </h1>
                  <p>
                    {isSavedPage
                      ? "把值得认真考虑的选择放在一起，慢慢靠近你的答案。"
                      : "从认识自己，到选择未来。让每一个考研决定，都更有依据。"}
                  </p>
                </div>
                <button
                  className="button secondary report-button"
                  onClick={() => setModal("report")}
                >
                  <ArrowDownToLine size={15} />
                  我的择校报告
                </button>
              </div>
              {!isSavedPage && (
                <section className="hero">
                  <div className="hero-copy">
                    <span className="hero-label">
                      <span />
                      让选择，比努力早一步
                    </span>
                    <h2>
                      不止看排名，
                      <br />
                      更要找到适合你的方向。
                    </h2>
                    <p>结合你的背景、兴趣与期待，探索值得奔赴的院校和专业。</p>
                    <button onClick={() => navigate("profile")}>
                      完善我的画像
                      <ArrowRight size={16} />
                    </button>
                    <span className="hero-footnote">
                      大约 3 分钟 · 随时可以调整
                    </span>
                  </div>
                  <JourneyArt />
                  <div className="hero-art-caption">
                    A LITTLE CLARITY. A NEW POSSIBILITY.
                  </div>
                </section>
              )}
              {!isSavedPage && (
                <div className="journey-steps" aria-label="择校流程">
                  {[
                    {
                      n: "01",
                      title: "认识自己",
                      sub: "个人背景与偏好",
                      icon: UserRound,
                      p: "profile" as Page,
                      complete: !!state.profile.university,
                    },
                    {
                      n: "02",
                      title: "了解起点",
                      sub: "基础测评与诊断",
                      icon: ClipboardCheck,
                      p: "assessment" as Page,
                      complete: !!state.assessment?.completed,
                    },
                    {
                      n: "03",
                      title: "探索方向",
                      sub: "院校与专业推荐",
                      icon: Compass,
                      p: "explore" as Page,
                      complete: false,
                    },
                    {
                      n: "04",
                      title: "奔赴目标",
                      sub: "分数目标与规划",
                      icon: Flag,
                      p: "plan" as Page,
                      complete: false,
                    },
                  ].map((s, i) => (
                    <button
                      key={s.n}
                      className={`journey-step ${i === 2 ? "current" : ""}`}
                      onClick={() => navigate(s.p)}
                    >
                      <span className="step-icon">
                        {s.complete ? (
                          <Check size={17} />
                        ) : (
                          <s.icon size={18} />
                        )}
                      </span>
                      <span>
                        <strong>{s.title}</strong>
                        <small>{s.sub}</small>
                      </span>
                      <span className="step-number">{s.n}</span>
                      {i < 3 && (
                        <ChevronRight className="step-arrow" size={16} />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="explore-layout">
                <section className="results-area">
                  <div className="results-tabs">
                    <div className="tab-buttons">
                      {(isSavedPage
                        ? ["已收藏项目"]
                        : ["院校推荐", "专业方向"]
                      ).map((t) => (
                        <button
                          className={isSavedPage || tab === t ? "active" : ""}
                          onClick={() => setTab(t)}
                          key={t}
                        >
                          {t}
                          {t === "院校推荐" && (
                            <span>
                              {schools.length - state.excluded.length}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <button
                      className="text-button preference-button"
                      onClick={() => navigate("profile")}
                    >
                      <SlidersHorizontal size={14} />
                      调整偏好
                    </button>
                  </div>
                  {tab === "专业方向" && !isSavedPage ? (
                    <div className="major-grid">
                      {[
                        {
                          title: "计算机技术",
                          code: "085404",
                          desc: "把技术变成解决问题的能力",
                          icon: LayoutDashboard,
                          jobs: "软件开发 / 人工智能 / 数据工程",
                          cost: "与现有专业衔接较好；需强化算法与系统基础",
                          tone: "green",
                        },
                        {
                          title: "电子信息",
                          code: "085400",
                          desc: "连接数字世界与真实生活",
                          icon: Sparkles,
                          jobs: "嵌入式开发 / 通信工程 / 智能硬件",
                          cost: "需补充信号、电路等课程，关注项目具体方向",
                          tone: "orange",
                        },
                      ].map((m) => (
                        <article
                          className={`panel major-card ${m.tone}`}
                          key={m.code}
                        >
                          <span className="major-icon">
                            <m.icon size={25} />
                          </span>
                          <span className="badge">方向示例</span>
                          <h2>
                            {m.title}
                            <small>{m.code}</small>
                          </h2>
                          <p>{m.desc}</p>
                          <div className="major-info">
                            <strong>未来可以做什么</strong>
                            <p>{m.jobs}</p>
                            <strong>需要补充的能力</strong>
                            <p>{m.cost}</p>
                          </div>
                          <button
                            className="button secondary"
                            onClick={() => {
                              setTab("院校推荐");
                              setSearch(m.title);
                            }}
                          >
                            探索相关院校
                            <ArrowRight size={15} />
                          </button>
                        </article>
                      ))}
                      <div className="notice">
                        专业适配与就业方向为交互示例。具体岗位门槛、项目就业数据与政策依据尚未接入。
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="filter-bar">
                        <label className="search-field">
                          <Search size={16} />
                          <input
                            aria-label="搜索院校或专业"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="搜索院校、专业或城市"
                          />
                          {search && (
                            <button
                              aria-label="清除搜索"
                              onClick={() => setSearch("")}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </label>
                        <label className="filter-select">
                          <MapPin size={14} />
                          <select
                            aria-label="城市筛选"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                          >
                            {["全部城市", "南京", "杭州", "苏州", "上海"].map(
                              (x) => (
                                <option key={x}>{x}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label className="filter-select">
                          <Filter size={14} />
                          <select
                            aria-label="梯度筛选"
                            value={tier}
                            onChange={(e) => setTier(e.target.value)}
                          >
                            {["全部梯度", "冲刺", "匹配", "相对稳妥"].map(
                              (x) => (
                                <option key={x}>{x}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <button
                          className={`icon-button more-filter ${showFilters ? "selected" : ""}`}
                          aria-label="更多筛选"
                          aria-expanded={showFilters}
                          onClick={() => setShowFilters(!showFilters)}
                        >
                          <SlidersHorizontal size={17} />
                        </button>
                      </div>
                      {showFilters && (
                        <div className="extra-filters">
                          <span>学位类型</span>
                          <select
                            aria-label="学位类型筛选"
                            value={degree}
                            onChange={(e) => setDegree(e.target.value)}
                          >
                            {["全部类型", "专业学位", "学术学位"].map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                          <span className="muted">
                            全日制 · {state.profile.year} 目标年，目录待核验
                          </span>
                        </div>
                      )}
                      <div className="results-meta">
                        <span>
                          为你找到 <strong>{shown.length}</strong> 个
                          {isSavedPage ? "收藏" : "值得了解的"}项目
                          {activeFilters && (
                            <button
                              className="text-button reset-filters"
                              onClick={clearFilters}
                            >
                              <RotateCcw size={12} />
                              清空筛选
                            </button>
                          )}
                        </span>
                        <select
                          aria-label="推荐排序"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          {[
                            "综合适配",
                            "目标分数从低到高",
                            "招生人数从多到少",
                          ].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </div>
                      {shown.length ? (
                        <div className="school-grid">
                          {shown.map((s) => (
                            <SchoolCard
                              key={s.id}
                              school={s}
                              saved={state.saved.includes(s.id)}
                              comparing={compare.includes(s.id)}
                              onSave={() => toggleSave(s.id)}
                              onCompare={() => toggleCompare(s.id)}
                              onDetail={() => setDetail(s)}
                              onExclude={() => {
                                setState((prev) => ({
                                  ...prev,
                                  excluded: [...prev.excluded, s.id],
                                }));
                                setCompare((prev) =>
                                  prev.filter((x) => x !== s.id),
                                );
                                notify(
                                  `已暂不考虑${s.name}，可在已排除项目中恢复`,
                                );
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state panel">
                          <Search size={34} />
                          <h3>
                            {isSavedPage && !activeFilters
                              ? "还没有心仪的项目"
                              : "暂时没有符合条件的项目"}
                          </h3>
                          <p>试着放宽条件，给更多可能留一点空间。</p>
                          <button
                            className="button secondary"
                            onClick={() => {
                              clearFilters();
                              if (isSavedPage) navigate("explore");
                            }}
                          >
                            {isSavedPage ? "去探索院校" : "清空筛选"}
                          </button>
                        </div>
                      )}
                      <div className="result-footer">
                        <span>
                          <ShieldCheck size={14} />
                          推荐梯度用于比较，不代表录取保证
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setModal("excluded")}
                        >
                          已排除项目 ({state.excluded.length})
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </section>
                <aside className="right-rail">
                  <section className="panel profile-summary">
                    <div className="section-heading">
                      <h3>我的探索画像</h3>
                      <button
                        className="text-button"
                        onClick={() => navigate("profile")}
                      >
                        编辑
                        <ChevronRight size={13} />
                      </button>
                    </div>
                    <div className="profile-summary-main">
                      <div className="profile-icon">
                        <UserRound size={23} strokeWidth={1.5} />
                      </div>
                      <div>
                        <strong>
                          {state.profile.major || "待填写本科专业"}
                        </strong>
                        <span>
                          {state.profile.university || "待填写本科院校"} ·{" "}
                          {state.profile.year} 考研
                        </span>
                      </div>
                    </div>
                    <div className="profile-chips">
                      {state.profile.cities.length ? (
                        state.profile.cities.map((c) => (
                          <span key={c}>{c}</span>
                        ))
                      ) : (
                        <span>城市不限</span>
                      )}
                      <span>{state.profile.crossMajor}</span>
                    </div>
                    <div className="profile-separator" />
                    <div className="priority-label">
                      <span>你更看重</span>
                      <span>偏好设置</span>
                    </div>
                    {Object.entries(state.profile.priorities)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([name, value]) => (
                        <div className="priority-row" key={name}>
                          <span>{name}</span>
                          <div>
                            <i style={{ width: `${value}%` }} />
                          </div>
                          <span>
                            {value >= 80
                              ? "很重要"
                              : value >= 50
                                ? "较重要"
                                : "一般"}
                          </span>
                        </div>
                      ))}
                    <button
                      className="profile-assessment"
                      onClick={() => navigate("assessment")}
                    >
                      <span className="assessment-dot" />
                      <span>
                        {state.assessment?.completed
                          ? "已完成示例测评"
                          : "能力画像待完善"}
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  </section>
                  <section className="panel score-preview">
                    <div className="section-heading">
                      <h3>离目标，更近一步</h3>
                      <TrendingUp size={17} />
                    </div>
                    <p>给努力一个清晰的刻度</p>
                    {targetSchool ? (
                      <>
                        <div className="score-preview-title">
                          <span>
                            {targetSchool.name} · {targetSchool.major}
                          </span>
                          <span className="micro-demo">模拟</span>
                        </div>
                        <div className="score-target">
                          <strong>{targetSchool.score}</strong>
                          <span>
                            建议备考目标<small>总分 500 分制</small>
                          </span>
                        </div>
                        <ScoreChart school={targetSchool} />
                        <div className="chart-legend">
                          <span>
                            <i />
                            历史复试线（模拟）
                          </span>
                          <span>
                            <i />
                            备考目标
                          </span>
                        </div>
                        <button
                          className="rail-link"
                          onClick={() => navigate("plan")}
                        >
                          查看我的分数规划
                          <ArrowRight size={14} />
                        </button>
                      </>
                    ) : (
                      <div className="empty-state">
                        <Target size={25} />
                        <p>选择一个心仪项目，开启目标规划。</p>
                      </div>
                    )}
                  </section>
                  <section className="next-steps">
                    <div className="section-heading">
                      <h3>下一步，可以做这些</h3>
                      <span className="tiny-tag">慢慢来，也没关系</span>
                    </div>
                    {taskItems.map((task, i) => (
                      <button key={task.id} onClick={() => navigate(task.page)}>
                        <span
                          className={`task-number ${(task.id === "profile" && state.profile.university) || (task.id === "assessment" && state.assessment?.completed) ? "done" : ""}`}
                        >
                          {(task.id === "profile" &&
                            state.profile.university) ||
                          (task.id === "assessment" &&
                            state.assessment?.completed) ? (
                            <Check size={13} />
                          ) : (
                            i + 1
                          )}
                        </span>
                        <span>
                          <strong>{task.name}</strong>
                          <small>{task.desc}</small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </section>
                </aside>
              </div>
            </>
          )}
          {page === "profile" && <ProfileView {...flowProps} />}
          {page === "assessment" && <AssessmentView {...flowProps} />}
          {page === "admin" && <AdminView notify={notify} />}
          {page === "plan" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ONE STEP CLOSER</div>
                  <h1>把心之所向，变成下一步。</h1>
                  <p>明确目标，看见差距，把努力放在值得的地方。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setModal("report")}
                >
                  <ArrowDownToLine size={15} />
                  导出规划
                </button>
              </div>
              {targetSchool ? (
                <div className="plan-layout">
                  <section className="panel target-panel">
                    <div className="section-heading">
                      <span className="badge">
                        <Flag size={13} />
                        当前目标
                      </span>
                      <button
                        className="text-button"
                        onClick={() => navigate("explore")}
                      >
                        更换目标
                        <ArrowRight size={14} />
                      </button>
                    </div>
                    <h2>{targetSchool.name}</h2>
                    <p>
                      {targetSchool.college} · {targetSchool.major}（
                      {targetSchool.code}）
                    </p>
                    <div className="profile-chips">
                      <span>{targetSchool.degree}</span>
                      <span>{targetSchool.mode}</span>
                      <span>{targetSchool.year} 招生示例</span>
                    </div>
                    <div className="plan-stats">
                      <div>
                        <span>建议备考目标 · 模拟</span>
                        <strong>
                          {targetSchool.score}
                          <small> 分</small>
                        </strong>
                      </div>
                      <div>
                        <span>当前能力</span>
                        <strong className="unassessed">待评估</strong>
                      </div>
                      <div>
                        <span>目标差距</span>
                        <strong className="unassessed">待校准</strong>
                      </div>
                    </div>
                    <div className="notice">
                      {state.assessment?.completed
                        ? "示例测评仅展示诊断交互，题量不足以换算考研成绩。"
                        : "尚未完成基础测评，能力评估依据不足。"}
                      建议目标和历史门槛均为模拟，单科线及复试要求待官方资料核验。
                    </div>
                    <div className="section-heading plan-subheading">
                      <h3>各科备考分配</h3>
                      <span className="micro-demo">示例方案 · 非预测成绩</span>
                    </div>
                    {targetSchool.subjects.map((subject, index) => {
                      const values = [65, 70, 105, targetSchool.score - 240];
                      return (
                        <div className="subject-score" key={subject}>
                          <span>{subject}</span>
                          <div>
                            <i
                              style={{
                                width: `${(values[index] / (index < 2 ? 100 : 150)) * 100}%`,
                              }}
                            />
                          </div>
                          <strong>
                            {values[index]}
                            <small> / {index < 2 ? 100 : 150}</small>
                          </strong>
                        </div>
                      );
                    })}
                    <p className="small-text muted">
                      分项合计 {targetSchool.score}{" "}
                      分。需同时满足总分、单科与复试要求；演示方案未进行资格或分数校验。
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => setDetail(targetSchool)}
                    >
                      查看项目与历史数据
                      <ArrowRight size={15} />
                    </button>
                  </section>
                  <section className="panel plan-tasks">
                    <div className="section-heading">
                      <h3>我的阶段任务</h3>
                      <ListChecks size={19} />
                    </div>
                    <p className="muted">不必一口气完成，每一步都算数。</p>
                    {[
                      "核对目标年份招生目录与报考条件",
                      "了解考试科目与专业课参考范围",
                      "完成数学、英语基础测评",
                      "整理近三年复试与成绩信息",
                      "制定第一阶段复习安排",
                    ].map((name, i) => (
                      <label
                        className={`plan-task ${state.tasks.includes(String(i)) ? "complete" : ""}`}
                        key={name}
                      >
                        <input
                          type="checkbox"
                          checked={state.tasks.includes(String(i))}
                          onChange={() =>
                            setState((s) => ({
                              ...s,
                              tasks: s.tasks.includes(String(i))
                                ? s.tasks.filter((x) => x !== String(i))
                                : [...s.tasks, String(i)],
                            }))
                          }
                        />
                        <span>
                          <strong>{name}</strong>
                          <small>
                            {
                              [
                                "择校确认",
                                "准备起点",
                                "基础诊断",
                                "信息整理",
                                "行动规划",
                              ][i]
                            }
                          </small>
                        </span>
                      </label>
                    ))}
                    <div className="task-progress">
                      <span>已完成 {state.tasks.length} / 5 项</span>
                      <div>
                        <i style={{ width: `${state.tasks.length * 20}%` }} />
                      </div>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => navigate("assessment")}
                    >
                      去了解我的基础
                      <ArrowRight size={15} />
                    </button>
                  </section>
                </div>
              ) : (
                <div className="empty-state panel">
                  <Flag size={36} />
                  <h2>你的下一站，等你来定</h2>
                  <p>在院校详情中点击「设为目标」，即可开始规划。</p>
                  <button
                    className="button primary"
                    onClick={() => navigate("explore")}
                  >
                    探索院校
                  </button>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <BookOpen size={14} />
              研途 · 让每一次选择，都更靠近自己
            </span>
            <span>DEMO · 所有招生与评估数据均为模拟</span>
          </footer>
        </main>
      </div>
      {compare.length > 0 && (
        <div className="compare-bar">
          <div className="compare-bar-label">
            <Scale size={20} />
            <strong>项目对比</strong>
            <span>{compare.length} / 3</span>
          </div>
          <div className="compare-selections">
            {compare.map((id) => (
              <span key={id}>
                {schools.find((s) => s.id === id)?.name}
                <button
                  aria-label={`移除对比${schools.find((s) => s.id === id)?.name}`}
                  onClick={() => toggleCompare(id)}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
          <button className="text-button" onClick={() => setCompare([])}>
            清空
          </button>
          <button
            className="button primary"
            disabled={compare.length < 2}
            onClick={() => setModal("compare")}
          >
            开始对比
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      {detail && (
        <SchoolDetail
          school={detail}
          onClose={() => setDetail(null)}
          isSaved={state.saved.includes(detail.id)}
          onToggleSave={() => toggleSave(detail.id)}
          onTarget={() => setTarget(detail)}
        />
      )}
      {modal === "compare" && (
        <Modal title="并排看，让选择更清晰" wide onClose={() => setModal(null)}>
          <p className="muted">
            比较完整招生项目；以下分数与招生条件均为演示。
          </p>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>比较维度</th>
                  {compare.map((id) => (
                    <th key={id}>{schools.find((s) => s.id === id)?.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["学院", "college"],
                  ["专业 / 方向", "major"],
                  ["专业代码", "code"],
                  ["学位类型", "degree"],
                  ["学习方式", "mode"],
                  ["招生年份", "year"],
                  ["城市", "city"],
                  ["推荐梯度", "tier"],
                  ["建议备考目标（模拟）", "score"],
                  ["招生人数（模拟）", "seats"],
                  ["考试科目（模拟）", "subjects"],
                  ["准备成本", "cost"],
                  ["适配理由", "reason"],
                  ["主要风险", "risk"],
                ].map(([label, key]) => (
                  <tr key={key}>
                    <th>{label}</th>
                    {compare.map((id) => {
                      const s = schools.find((s) => s.id === id)!;
                      const value = s[key as keyof School];
                      return (
                        <td key={id}>
                          {Array.isArray(value)
                            ? value.join(" / ")
                            : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th>下一步</th>
                  {compare.map((id) => (
                    <td key={id}>
                      <button
                        className="button primary"
                        onClick={() =>
                          setTarget(schools.find((s) => s.id === id)!)
                        }
                      >
                        设为目标
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Modal>
      )}
      {modal === "excluded" && (
        <Modal title="已排除的项目" onClose={() => setModal(null)}>
          <p className="muted">
            你的偏好可以变化。恢复后，项目将重新出现在推荐中。
          </p>
          {state.excluded.length ? (
            state.excluded.map((id) => {
              const s = schools.find((s) => s.id === id);
              return s ? (
                <div className="excluded-row" key={id}>
                  <div>
                    <strong>{s.name}</strong>
                    <p>{s.major} · 由你主动排除</p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setState((prev) => ({
                        ...prev,
                        excluded: prev.excluded.filter((x) => x !== id),
                      }));
                      notify("项目已恢复");
                    }}
                  >
                    恢复推荐
                  </button>
                </div>
              ) : null;
            })
          ) : (
            <div className="empty-state">
              <CheckCheck size={34} />
              <h3>还没有排除任何项目</h3>
              <p>可以通过院校卡片中的「暂不考虑」管理清单。</p>
            </div>
          )}
        </Modal>
      )}
      {modal === "report" && (
        <Modal title="我的择校与备考报告" wide onClose={() => setModal(null)}>
          <div className="report-preview">
            <div className="eyebrow">YANTU · PERSONAL EXPLORATION</div>
            <h2>每个选择，都有自己的理由。</h2>
            <p>
              {state.profile.year} 考研 ·{" "}
              {state.profile.major || "本科专业待填写"} ·{" "}
              {state.profile.cities.join(" / ") || "城市不限"}
            </p>
            <div className="report-summary">
              <div>
                <strong>
                  {
                    state.saved.filter((id) => !state.excluded.includes(id))
                      .length
                  }
                </strong>
                <span>收藏项目</span>
              </div>
              <div>
                <strong>{targetSchool?.name || "尚未设定"}</strong>
                <span>当前目标</span>
              </div>
              <div>
                <strong>
                  {state.assessment?.completed ? "已体验" : "待完成"}
                </strong>
                <span>基础测评</span>
              </div>
            </div>
            <h3>你的候选清单</h3>
            {schools
              .filter(
                (s) =>
                  state.saved.includes(s.id) && !state.excluded.includes(s.id),
              )
              .map((s) => (
                <div className="report-school" key={s.id}>
                  <strong>
                    {s.name} · {s.major}
                  </strong>
                  <span>
                    {s.tier} / 模拟备考目标 {s.score} 分
                  </span>
                  <p>{s.reason}</p>
                </div>
              ))}
            <div className="notice">
              这是基于当前浏览器中资料生成的演示报告。招生数据与分析结论均为模拟；官方资料与真实评估尚未接入。
            </div>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              继续探索
            </button>
            <button className="button primary" onClick={downloadReport}>
              <ArrowDownToLine size={16} />
              下载报告 .md
            </button>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="欢迎来到研途" onClose={() => setModal(null)}>
          <p className="muted">
            这里可以提前体验从认识自己到确定目标的完整过程。
          </p>
          <ol className="help-list">
            <li>
              <strong>完善个人画像</strong>
              <p>填写背景、选择城市，调整你看重的因素。不确定也没有关系。</p>
            </li>
            <li>
              <strong>体验基础测评</strong>
              <p>回答示例题，查看诊断；也可以跳过测评，先探索院校。</p>
            </li>
            <li>
              <strong>探索、收藏和对比</strong>
              <p>筛选项目、打开详情，选择 2–3 个候选项目并排比较。</p>
            </li>
            <li>
              <strong>设定目标，保存报告</strong>
              <p>查看分数方案与阶段任务，下载 Markdown 报告。</p>
            </li>
          </ol>
          <div className="notice">
            本 Demo 无
            API、真实推荐算法或真实招生数据。个人设置只保存在当前浏览器；可在个人画像页删除。
          </div>
          <button
            className="button primary"
            onClick={() => {
              setModal(null);
              navigate("profile");
            }}
          >
            开始探索
            <ArrowRight size={15} />
          </button>
        </Modal>
      )}
      {modal === "notifications" && (
        <Modal title="探索动态" onClose={() => setModal(null)}>
          <div className="notification-card">
            <span className="little-spark">
              <Sparkles size={20} />
            </span>
            <div>
              <strong>你的探索工作台已准备好</strong>
              <p>完善个人画像，开启属于你的考研旅程。</p>
              <small className="muted">演示消息</small>
            </div>
          </div>
          <div className="notice">真实招生变化提醒将在接入数据后提供。</div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M7 17L17 7M7 7h10v10" />
    </svg>
  );
}
