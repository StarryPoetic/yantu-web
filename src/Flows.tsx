import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { initialProfile, type FlowProps, type Profile } from "./types";
import "./flows.css";
import { CityPicker } from "./CityPicker";
import { DegreeExplanation } from "./MajorDiscovery";

type ProfileDraft = Profile & {
  preparation?: string;
  courses?: string;
  notes?: string;
};
const priorityDescriptions: Record<string, string> = {
  专业兴趣: "愿意长期学习和投入的方向",
  就业机会: "目标城市的岗位与专业匹配",
  发展前景: "毕业时的行业与能力发展空间",
  政策支持: "相关政策的方向与适用范围",
  学校与城市: "院校环境、城市与生活偏好",
  招生透明度: "招生信息和复试过程的公开程度",
  风险接受度: "愿意为更高目标承担多少不确定性",
};

function FlowDialog({
  labelId,
  children,
  onClose,
  className = "",
}: {
  labelId: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
      );
      if (!focusable?.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKey);
      priorFocus?.focus();
    };
  }, []);
  return (
    <div className="flow-dialog-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`flow-dialog panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <FlowDialog labelId="confirm-title" onClose={onClose}>
      <button
        className="flow-icon-button flow-dialog-close"
        aria-label="关闭确认窗口"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="flow-symbol">
        <Info size={24} />
      </div>
      <h2 id="confirm-title">{title}</h2>
      <p className="muted">{children}</p>
      <div className="flow-dialog-actions">
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button className="button primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </FlowDialog>
  );
}

export function ProfileView({
  profile,
  onSaveProfile,
  onNavigate,
  notify,
  onDeleteProfile,
}: FlowProps) {
  const [draft, setDraft] = useState<ProfileDraft>({
    ...profile,
    cities: [...profile.cities],
    priorities: { ...initialProfile.priorities, ...profile.priorities },
  });
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [degreeHelp, setDegreeHelp] = useState(false);
  useEffect(() => {
    setDraft({
      ...profile,
      cities: [...profile.cities],
      priorities: { ...initialProfile.priorities, ...profile.priorities },
    });
  }, [profile]);
  function update<K extends keyof ProfileDraft>(
    key: K,
    value: ProfileDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function save(recommend: boolean) {
    onSaveProfile({
      ...draft,
      cities: draft.cities.length ? draft.cities : ["不确定"],
    });
    notify(
      recommend ? "个人画像已保存，继续查看演示推荐" : "草稿已保存在当前浏览器",
    );
    if (recommend) onNavigate("explore");
  }
  const select = (
    label: string,
    key: keyof ProfileDraft,
    options: string[],
  ) => (
    <label className="field">
      <span>{label}</span>
      <select
        value={String(draft[key] ?? "不确定")}
        onChange={(event) => update(key, event.target.value as never)}
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="flow-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">YOUR STARTING POINT</p>
          <h1>你的选择，从了解自己开始</h1>
          <p className="muted">
            没有标准答案。填入当下的想法，之后随时都能调整。
          </p>
        </div>
        <span className="badge">
          <ShieldCheck size={14} /> 资料仅保存在本机
        </span>
      </header>
      <div className="profile-layout">
        <div className="flow-stack">
          <section className="panel flow-section">
            <div className="section-heading">
              <h2>
                <GraduationCap size={20} /> 基本情况
              </h2>
              <span className="muted">01 / 03</span>
            </div>
            <p className="muted flow-section-intro">
              让推荐从你的真实起点出发。所有字段都可以填写“不确定”。
            </p>
            <div className="form-grid">
              <label className="field">
                <span>怎么称呼你</span>
                <input
                  value={draft.name}
                  placeholder="同学 / 不确定"
                  onChange={(event) => update("name", event.target.value)}
                />
              </label>
              <label className="field">
                <span>本科院校</span>
                <input
                  value={draft.university}
                  placeholder="输入院校，或填写不确定"
                  onChange={(event) => update("university", event.target.value)}
                />
              </label>
              <label className="field">
                <span>本科专业</span>
                <input
                  value={draft.major}
                  placeholder="如计算机科学与技术"
                  onChange={(event) => update("major", event.target.value)}
                />
              </label>
              {select("毕业年份", "graduation", [
                "2024 及以前",
                "2025",
                "2026",
                "2027",
                "2028",
                "2029",
                "不确定",
              ])}
              {select("报考年份", "year", ["2027", "2028", "2029", "不确定"])}
              {select("跨专业意愿", "crossMajor", [
                "接受相近专业",
                "愿意尝试跨专业",
                "暂不考虑跨专业",
                "不确定",
              ])}
              {select("读研的主要目标", "studyGoal", [
                "科研与继续深造",
                "就业与专业实践",
                "两者兼顾",
                "不确定",
              ])}
              <div className="degree-field">
                {select("学位类型偏好", "degreePreference", [
                  "不确定",
                  "学术学位",
                  "专业学位",
                ])}
                <button
                  className="text-button degree-help-button"
                  onClick={() => setDegreeHelp(true)}
                  type="button"
                >
                  <Info size={15} />
                  学硕和专硕有什么区别？
                </button>
              </div>
              <label className="field full-width">
                <span>
                  已确认的目标专业 <small>（可暂不确定，不影响推荐）</small>
                </span>
                <select
                  aria-label="已确认的目标专业"
                  value={draft.targetMajor || ""}
                  onChange={(event) =>
                    update("targetMajor", event.target.value)
                  }
                >
                  <option value="">尚未确定</option>
                  <option>计算机科学与技术</option>
                  <option>计算机技术</option>
                </select>
                <small>
                  确认后可选做该方向专业课测评；更换方向后，旧专业测评不直接沿用。
                </small>
              </label>
            </div>
          </section>
          <section className="panel flow-section">
            <div className="section-heading">
              <h2>
                <BookOpen size={20} /> 基础与备考安排
              </h2>
              <span className="muted">02 / 03</span>
            </div>
            <div className="form-grid">
              {select("数学基础", "math", [
                "基础较薄弱",
                "有一定基础",
                "基础比较扎实",
                "不确定",
              ])}
              {select("英语经历", "english", [
                "CET-4",
                "CET-6",
                "雅思 / 托福",
                "尚未通过等级考试",
                "不确定",
              ])}
              {select("当前备考进度", "preparation", [
                "尚未开始",
                "正在打基础",
                "强化复习中",
                "已进入冲刺",
                "不确定",
              ])}
              {select("每天可投入时间", "hours", [
                "2 小时以内",
                "2–4 小时",
                "4–6 小时",
                "6 小时以上",
                "不确定",
              ])}
              {select("每年学费预算", "budget", [
                "1 万元以内 / 年",
                "1–2 万元 / 年",
                "2–4 万元 / 年",
                "不限",
                "不确定",
              ])}
              <label className="field">
                <span>相关专业课程基础</span>
                <input
                  value={draft.courses ?? ""}
                  placeholder="如数据结构已学过，或不确定"
                  onChange={(event) => update("courses", event.target.value)}
                />
              </label>
            </div>
            <label className="field flow-field-space">
              <span>
                还有什么想告诉我们 <small className="muted">（选填）</small>
              </span>
              <textarea
                rows={3}
                value={draft.notes ?? ""}
                placeholder="例如希望毕业后留在长三角，或还没确定研究方向。"
                onChange={(event) => update("notes", event.target.value)}
              />
            </label>
          </section>
          <section className="panel flow-section">
            <div className="section-heading">
              <h2>
                <SlidersHorizontal size={20} /> 城市与选择偏好
              </h2>
              <span className="muted">03 / 03</span>
            </div>
            <CityPicker
              value={draft.cities}
              onChange={(cities) => update("cities", cities)}
            />
            <div className="priority-list">
              {Object.entries(priorityDescriptions).map(
                ([priority, description]) => (
                  <label className="priority-row" key={priority}>
                    <span className="priority-label">
                      <strong>{priority}</strong>
                      <small className="muted">{description}</small>
                    </span>
                    <span className="priority-control">
                      <input
                        aria-label={`${priority}重要性`}
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={draft.priorities[priority] ?? 50}
                        onChange={(event) =>
                          update("priorities", {
                            ...draft.priorities,
                            [priority]: Number(event.target.value),
                          })
                        }
                      />
                      <output>{draft.priorities[priority] ?? 50}</output>
                    </span>
                  </label>
                ),
              )}
            </div>
            <p className="muted flow-small">
              数值越高，表示你越看重这一项；风险接受度越高，表示越愿意考虑挑战性目标。
            </p>
          </section>
          <div className="profile-actions">
            <button className="button secondary" onClick={() => save(false)}>
              <Save size={16} />
              保存草稿
            </button>
            <button className="button primary" onClick={() => save(true)}>
              保存并查看推荐
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
        <aside className="profile-aside">
          <section className="panel profile-summary">
            <div className="flow-symbol">
              <Sparkles size={23} />
            </div>
            <p className="eyebrow">A LITTLE MORE ABOUT YOU</p>
            <h2>
              每一个偏好，
              <br />
              都让方向更清晰。
            </h2>
            <p className="muted">
              这里不需要一个“完美的你”，只需要一个真实的起点。
            </p>
            <div className="profile-summary-row">
              <span>当前方向</span>
              <strong>{draft.major || "等待探索"}</strong>
            </div>
            <div className="profile-summary-row">
              <span>目标年份</span>
              <strong>{draft.year}</strong>
            </div>
            <div className="profile-summary-row">
              <span>意向城市</span>
              <strong>{draft.cities.join(" · ") || "不确定"}</strong>
            </div>
            <div className="notice">
              <Info size={17} />
              <span>
                推荐、分数与院校均为演示数据，仅用于体验页面效果与交互。
              </span>
            </div>
          </section>
          <section className="flow-privacy">
            <ShieldCheck size={18} />
            <div>
              <strong>由你掌握自己的资料</strong>
              <p className="muted">
                暂不上传服务器。你可以随时修改，也可以删除当前浏览器中保存的画像。
              </p>
              <div className="flow-inline-actions">
                <button onClick={() => setConfirm("reset")}>
                  <RotateCcw size={13} />
                  重置表单
                </button>
                <button onClick={() => setConfirm("delete")}>
                  <Trash2 size={13} />
                  删除资料
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
      {degreeHelp && (
        <FlowDialog
          labelId="degree-help-title"
          onClose={() => setDegreeHelp(false)}
          className="degree-help-dialog degree-dialog"
        >
          <div className="degree-dialog-heading">
            <h2 id="degree-help-title">学硕和专硕有什么区别？</h2>
            <button
              className="flow-icon-button"
              aria-label="关闭学位说明"
              onClick={() => setDegreeHelp(false)}
            >
              <X size={20} />
            </button>
          </div>
          <div
            className="degree-dialog-body"
            tabIndex={0}
            role="region"
            aria-label="学位类型说明内容"
          >
            <DegreeExplanation />
          </div>
        </FlowDialog>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === "reset" ? "恢复示例画像？" : "删除个人资料？"}
          confirmLabel={confirm === "reset" ? "确认重置" : "确认删除"}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "reset") {
              setDraft({
                ...initialProfile,
                cities: [...initialProfile.cities],
                priorities: { ...initialProfile.priorities },
              });
              notify("表单已恢复示例内容，保存后生效");
            } else {
              onDeleteProfile();
              notify("已删除当前浏览器中的个人资料");
            }
            setConfirm(null);
          }}
        >
          {confirm === "reset"
            ? "当前未保存的修改会被替换为初始示例内容。已保存的资料不会立即改变。"
            : "删除当前浏览器中保存的个人画像。此操作完成后，你可以重新填写资料。"}
        </ConfirmDialog>
      )}
    </div>
  );
}

type RecordCategory = "招生资料" | "题库" | "评价证据";
type AdminRecord = {
  id: string;
  category: RecordCategory;
  title: string;
  institution: string;
  year: string;
  source: string;
  status: "待复核" | "已复核" | "需修订";
  notes: string;
  updated: string;
};
const adminSeed: AdminRecord[] = [
  {
    id: "a1",
    category: "招生资料",
    title: "计算机技术 · 专业目录",
    institution: "示例大学 / 计算机学院",
    year: "2027",
    source: "演示：研究生招生专业目录",
    status: "已复核",
    notes: "虚拟招生项目，演示专业代码、考试科目与来源管理。",
    updated: "2026-09-22",
  },
  {
    id: "a2",
    category: "招生资料",
    title: "电子信息 · 复试细则",
    institution: "示例理工大学 / 信息学院",
    year: "2026",
    source: "演示：学院复试实施细则",
    status: "待复核",
    notes: "下一招生年份细则待补充，不能直接沿用。",
    updated: "2026-09-21",
  },
  {
    id: "a3",
    category: "招生资料",
    title: "软件工程 · 历年录取信息",
    institution: "示例工业大学 / 软件学院",
    year: "2026",
    source: "演示：统考公开录取信息",
    status: "需修订",
    notes: "需核对是否混入推免与专项计划数据。",
    updated: "2026-09-20",
  },
  {
    id: "q1",
    category: "题库",
    title: "导数的基本运算",
    institution: "数学 / 基础",
    year: "2027",
    source: "高等数学：导数基本运算法则",
    status: "已复核",
    notes: "示例题：f(x)=x²+3x，f′(2)=7。评分标准：答案 7 正确。",
    updated: "2026-09-22",
  },
  {
    id: "q2",
    category: "题库",
    title: "二分查找的复杂度",
    institution: "计算机 / 数据结构",
    year: "2027",
    source: "数据结构：二分查找复杂度分析",
    status: "待复核",
    notes: "评分标准：最坏时间复杂度 O(log n)。需确认题干含有序数组前提。",
    updated: "2026-09-21",
  },
  {
    id: "q3",
    category: "题库",
    title: "让步状语从句理解",
    institution: "英语 / 阅读理解",
    year: "2027",
    source: "英语语法：Although 让步状语从句",
    status: "已复核",
    notes: "根据完整句义判分，不凭单一答案归因为粗心。",
    updated: "2026-09-20",
  },
  {
    id: "e1",
    category: "评价证据",
    title: "复试流程公开程度反馈",
    institution: "示例大学 / 计算机学院",
    year: "2026",
    source: "演示：已脱敏反馈材料 A",
    status: "待复核",
    notes: "仅为虚拟线索。未完成交叉核验，不影响排序。",
    updated: "2026-09-22",
  },
  {
    id: "e2",
    category: "评价证据",
    title: "录取名单公示记录",
    institution: "示例理工大学 / 信息学院",
    year: "2026",
    source: "演示：学院公示记录",
    status: "已复核",
    notes: "示例官方事实记录，仅适用于该学院与年份，不推及整校。",
    updated: "2026-09-21",
  },
];
const adminKey = "yantu-demo-admin-records";
function readAdminRecords(): AdminRecord[] {
  try {
    const records = JSON.parse(localStorage.getItem(adminKey) || "null");
    return Array.isArray(records) &&
      records.every(
        (record) =>
          record.id &&
          record.category &&
          record.title &&
          record.institution &&
          record.status,
      )
      ? records
      : adminSeed;
  } catch {
    return adminSeed;
  }
}

export function AdminView({ notify }: { notify: (message: string) => void }) {
  const [category, setCategory] = useState<RecordCategory>("招生资料");
  const [records, setRecords] = useState<AdminRecord[]>(readAdminRecords);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<AdminRecord | null>(null);
  const [editingMode, setEditingMode] = useState<"add" | "edit" | "review">(
    "add",
  );
  useEffect(() => {
    try {
      localStorage.setItem(adminKey, JSON.stringify(records));
    } catch {
      /* Records remain usable in memory. */
    }
  }, [records]);
  const filtered = records.filter(
    (record) =>
      record.category === category &&
      `${record.title} ${record.institution} ${record.year} ${record.status} ${record.source}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  function startAdd() {
    setEditingMode("add");
    setEditor({
      id: `local-${Date.now()}`,
      category,
      title: "",
      institution: "",
      year: "2027",
      source: "",
      status: "待复核",
      notes: "",
      updated: new Date().toISOString().slice(0, 10),
    });
  }
  function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (!editor || !editor.title.trim() || !editor.institution.trim()) return;
    const saved = {
      ...editor,
      title: editor.title.trim(),
      institution: editor.institution.trim(),
      source: editor.source.trim() || "未补充 · 待核实",
      updated: new Date().toISOString().slice(0, 10),
    };
    setRecords((current) =>
      editingMode === "add"
        ? [saved, ...current]
        : current.map((record) => (record.id === saved.id ? saved : record)),
    );
    setEditor(null);
    notify(
      editingMode === "review"
        ? "复核状态已更新，仅保存于当前浏览器"
        : "演示记录已保存，仅保存于当前浏览器",
    );
  }
  return (
    <div className="flow-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">DATA & TRUST</p>
          <h1>每一个判断，都有迹可循</h1>
          <p className="muted">维护资料、核对依据，让推荐过程更透明。</p>
        </div>
        <span className="badge">
          <ShieldCheck size={14} />
          管理演示
        </span>
      </header>
      <div className="notice">
        <Info size={19} />
        <span>
          此后台仅为本地模拟，所有资料和院校为演示内容。新增、编辑与复核只影响当前浏览器，不会修改真实数据或推荐结果。
        </span>
      </div>
      <div className="admin-metrics">
        {[
          {
            title: "本地资料总数",
            value: records.length,
            detail: "招生 · 题库 · 证据",
            icon: FileText,
          },
          {
            title: "等待人工复核",
            value: records.filter((record) => record.status === "待复核")
              .length,
            detail: "未经复核不作确定结论",
            icon: ClipboardCheck,
          },
          {
            title: "已完成复核",
            value: records.filter((record) => record.status === "已复核")
              .length,
            detail: "保留适用范围与来源",
            icon: ShieldCheck,
          },
        ].map((item) => (
          <section className="panel admin-metric" key={item.title}>
            <div>
              <span className="muted">{item.title}</span>
              <strong>{item.value}</strong>
              <small className="muted">{item.detail}</small>
            </div>
            <item.icon size={24} />
          </section>
        ))}
      </div>
      <section className="panel admin-records">
        <div className="admin-toolbar">
          <div className="segmented" role="tablist" aria-label="资料类别">
            {(["招生资料", "题库", "评价证据"] as RecordCategory[]).map(
              (tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={category === tab}
                  className={category === tab ? "active" : ""}
                  onClick={() => {
                    setCategory(tab);
                    setQuery("");
                  }}
                >
                  {tab}
                </button>
              ),
            )}
          </div>
          <button className="button primary" onClick={startAdd}>
            <Plus size={17} />
            添加记录
          </button>
        </div>
        <div className="admin-search-row">
          <label className="admin-search">
            <Search size={17} />
            <input
              aria-label="搜索管理记录"
              placeholder={`搜索${category}、院校或年份…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="muted flow-small">共 {filtered.length} 条记录</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>资料名称 / 范围</th>
                <th>年份</th>
                <th>来源</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.title}</strong>
                    <small className="muted">{record.institution}</small>
                  </td>
                  <td>{record.year}</td>
                  <td>
                    <span className="admin-source">{record.source}</span>
                  </td>
                  <td>
                    <span
                      className={`badge status-${record.status === "已复核" ? "verified" : record.status === "需修订" ? "revision" : "pending"}`}
                    >
                      {record.status}
                    </span>
                  </td>
                  <td>{record.updated}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        aria-label={`编辑${record.title}`}
                        onClick={() => {
                          setEditingMode("edit");
                          setEditor({ ...record });
                        }}
                      >
                        <Pencil size={14} />
                        编辑
                      </button>
                      <button
                        aria-label={`复核${record.title}`}
                        onClick={() => {
                          setEditingMode("review");
                          setEditor({ ...record });
                        }}
                      >
                        <ClipboardCheck size={14} />
                        复核
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="empty-state">
            <Search size={30} />
            <h3>没有找到匹配的资料</h3>
            <p className="muted">试试其他关键词，或添加一条本地演示记录。</p>
            <button className="button secondary" onClick={() => setQuery("")}>
              清除搜索
            </button>
          </div>
        )}
        <div className="admin-footnote">
          <ShieldCheck size={16} />
          <span>
            评价按学院、专业与年份记录。待核实线索不直接影响排序，重复转载不作为独立证据。
          </span>
        </div>
      </section>
      {editor && (
        <FlowDialog
          labelId="admin-editor-title"
          className="admin-editor"
          onClose={() => setEditor(null)}
        >
          <button
            className="flow-icon-button flow-dialog-close"
            aria-label="关闭编辑窗口"
            onClick={() => setEditor(null)}
          >
            <X size={20} />
          </button>
          <p className="eyebrow">LOCAL DEMO RECORD</p>
          <h2 id="admin-editor-title">
            {editingMode === "add"
              ? "添加"
              : editingMode === "review"
                ? "人工复核"
                : "编辑"}
            {editor.category}
          </h2>
          <p className="muted flow-small">
            仅在当前浏览器中保存，不提交到服务器。
          </p>
          <form onSubmit={saveRecord}>
            <div className="form-grid">
              <label className="field">
                <span>资料名称</span>
                <input
                  required
                  value={editor.title}
                  placeholder="输入资料标题"
                  onChange={(event) =>
                    setEditor({ ...editor, title: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>适用院校 / 学院 / 专业</span>
                <input
                  required
                  value={editor.institution}
                  placeholder="明确资料适用范围"
                  onChange={(event) =>
                    setEditor({ ...editor, institution: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>适用年份</span>
                <select
                  value={editor.year}
                  onChange={(event) =>
                    setEditor({ ...editor, year: event.target.value })
                  }
                >
                  {["2025", "2026", "2027", "2028", "待核实"].map((year) => (
                    <option key={year}>{year}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>复核状态</span>
                <select
                  value={editor.status}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      status: event.target.value as AdminRecord["status"],
                    })
                  }
                >
                  {["待复核", "已复核", "需修订"].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field flow-field-space">
              <span>来源或依据</span>
              <input
                value={editor.source}
                placeholder="资料名称、链接或待核实说明"
                onChange={(event) =>
                  setEditor({ ...editor, source: event.target.value })
                }
              />
            </label>
            <label className="field flow-field-space">
              <span>
                {editor.category === "题库"
                  ? "评分标准与复核说明"
                  : "内容与复核说明"}
              </span>
              <textarea
                rows={4}
                value={editor.notes}
                placeholder="填写核对结论、适用范围、缺失信息或处理进展"
                onChange={(event) =>
                  setEditor({ ...editor, notes: event.target.value })
                }
              />
            </label>
            <div className="flow-dialog-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setEditor(null)}
              >
                取消
              </button>
              <button className="button primary" type="submit">
                <Save size={16} />
                {editingMode === "review" ? "保存复核结果" : "保存记录"}
              </button>
            </div>
          </form>
        </FlowDialog>
      )}
    </div>
  );
}
