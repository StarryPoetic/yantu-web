import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileText,
  Flag,
  GraduationCap,
  Info,
  MapPin,
  ShieldCheck,
  X,
} from "lucide-react";
import type { School } from "./types";
import "./detail.css";

interface SchoolDetailProps {
  school: School;
  onClose: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  onTarget: () => void;
}

const tabs = ["项目概览", "分数参考", "就业方向", "评价与依据"] as const;

export function SchoolDetail({
  school,
  onClose,
  isSaved,
  onToggleSave,
  onTarget,
}: SchoolDetailProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionType, setCorrectionType] = useState("招生信息");
  const [correction, setCorrection] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandler.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !drawerRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !drawerRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    setActiveTab(0);
    setCorrectionOpen(false);
    setCorrectionType("招生信息");
    setCorrection("");
    setDraftStatus("");
    try {
      const saved = localStorage.getItem(`yantu-correction-${school.id}`);
      if (!saved) return;
      const draft: unknown = JSON.parse(saved);
      if (!draft || typeof draft !== "object") return;
      const stored = draft as Record<string, unknown>;
      if (typeof stored.content === "string")
        setCorrection(stored.content.slice(0, 2000));
      if (
        typeof stored.type === "string" &&
        ["招生信息", "分数口径", "培养与就业", "评价与证据"].includes(
          stored.type,
        )
      ) {
        setCorrectionType(stored.type);
      }
    } catch {
      // An unavailable or invalid browser draft should not prevent the dialog opening.
    }
  }, [school.id]);

  const axisValues = [300, 320, 340, 360, 380];
  const chartY = (value: number) => 188 - (value - 290) * 1.65;
  const chartX = (index: number) => 100 + index * 158;

  return (
    <div
      className="detail-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={drawerRef}
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="school-detail-title"
        aria-describedby="school-detail-description"
      >
        <div className="detail-topbar">
          <span className="eyebrow">
            项目档案 <span className="muted">/ PROGRAM PROFILE</span>
          </span>
          <button
            ref={closeRef}
            className="icon-button"
            aria-label="关闭项目详情"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>

        <div className="detail-heading">
          <div
            className="detail-school-mark"
            style={{ background: school.color }}
            aria-hidden="true"
          >
            <GraduationCap size={30} />
          </div>
          <div>
            <div className="detail-heading-title">
              <h2 id="school-detail-title">{school.name}</h2>
              <span
                className={`badge tier-${school.tier === "冲刺" ? "reach" : school.tier === "匹配" ? "match" : "safe"}`}
              >
                {school.tier} · 示例
              </span>
            </div>
            <p className="muted detail-meta">
              <MapPin size={13} /> {school.city}
              <span>·</span>
              {school.degree}
              <span>·</span>
              {school.mode}
            </p>
          </div>
        </div>
        <p id="school-detail-description" className="detail-project-name">
          {school.college}
          <br />
          <strong>{school.major}</strong>{" "}
          <span className="muted">
            （{school.code}） · {school.year} 年
          </span>
        </p>
        <div className="notice detail-disclaimer">
          <Info size={16} />
          <span>
            学校名称用于展示。项目组合、科目、分数、名额和适配指标均为模拟，官方招生资料尚未接入。
          </span>
        </div>

        <div className="detail-tabs" role="tablist" aria-label="项目详情分类">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`detail-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={activeTab === index}
              aria-controls={`detail-panel-${index}`}
              tabIndex={activeTab === index ? 0 : -1}
              className={activeTab === index ? "active" : ""}
              onClick={() => setActiveTab(index)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % tabs.length;
                else if (event.key === "ArrowLeft")
                  next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tabs.length - 1;
                else return;
                event.preventDefault();
                setActiveTab(next);
                tabRefs.current[next]?.focus();
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div
          className="detail-body"
          role="tabpanel"
          id={`detail-panel-${activeTab}`}
          aria-labelledby={`detail-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === 0 && (
            <>
              <div className="detail-stats">
                <div>
                  <span className="muted">适配指数 · 模拟</span>
                  <strong>
                    {school.match}
                    <small>/100</small>
                  </strong>
                </div>
                <div>
                  <span className="muted">建议目标 · 模拟</span>
                  <strong>
                    {school.score}
                    <small>分</small>
                  </strong>
                </div>
                <div>
                  <span className="muted">统考名额 · 模拟</span>
                  <strong>
                    {school.seats}
                    <small>人</small>
                  </strong>
                </div>
              </div>
              <p className="detail-caption muted">
                适配指数用于演示条件比较，不是录取概率；当前报考资格待核验。
              </p>
              <section className="detail-section">
                <h3>
                  <CheckCircle2 size={18} /> 为什么出现在你的清单
                </h3>
                <p>{school.reason}</p>
                <ul className="detail-reason-list">
                  <li>
                    <Check size={15} />
                    专业衔接：计算机基础可用于这一示例方向的准备。
                  </li>
                  <li>
                    <Check size={15} />
                    偏好参考：结合城市、专业兴趣与就业方向展示解释。
                  </li>
                  <li>
                    <CircleHelp size={15} />
                    能力依据：完整测评与报考条件未接入，尚不能判定实际差距。
                  </li>
                </ul>
              </section>
              <section className="detail-section">
                <h3>
                  <FileText size={18} /> 项目考试科目{" "}
                  <span className="badge">模拟组合</span>
                </h3>
                <div className="detail-subjects">
                  {school.subjects.map((subject, index) => (
                    <div key={subject}>
                      <span className="muted">0{index + 1}</span>
                      <strong>{subject}</strong>
                    </div>
                  ))}
                </div>
                <p className="detail-caption muted">
                  数学与英语由目标招生项目决定；切换项目时需重新确认科目，不能由测评自由选择。
                </p>
              </section>
              <section className="detail-section">
                <h3>
                  <GraduationCap size={18} /> 准备成本
                </h3>
                <p>{school.cost}</p>
                <p className="detail-caption muted">
                  学费、学制与生活成本资料暂缺，预算适配待核验。
                </p>
              </section>
              <div className="detail-risk">
                <Flag size={18} />
                <div>
                  <strong>需要留意</strong>
                  <p>{school.risk}</p>
                  <p className="detail-caption">
                    分组只用于比较方案，不构成录取保证。
                  </p>
                </div>
              </div>
            </>
          )}

          {activeTab === 1 && (
            <>
              <div className="detail-section-heading">
                <div>
                  <h3>近三年分数参考</h3>
                  <p className="muted">
                    同一示例口径：全日制统考，不含推免与专项。
                  </p>
                </div>
                <span className="badge">全部模拟</span>
              </div>
              <div className="detail-chart">
                <svg
                  viewBox="0 0 510 225"
                  role="img"
                  aria-labelledby="score-chart-title score-chart-desc"
                >
                  <title id="score-chart-title">
                    {school.name}近三年模拟分数趋势
                  </title>
                  <desc id="score-chart-desc">
                    历史门槛和录取平均分为模拟数据，建议目标为 {school.score}{" "}
                    分，不代表安全线。详细数值见下表。
                  </desc>
                  {axisValues.map((score) => (
                    <g key={score}>
                      <line
                        x1="53"
                        y1={chartY(score)}
                        x2="465"
                        y2={chartY(score)}
                        stroke="#e9ece7"
                      />
                      <text
                        x="35"
                        y={chartY(score) + 4}
                        textAnchor="end"
                        fill="#8a938c"
                        fontSize="11"
                      >
                        {score}
                      </text>
                    </g>
                  ))}
                  <line
                    x1="53"
                    y1={chartY(school.score)}
                    x2="465"
                    y2={chartY(school.score)}
                    stroke="#b79254"
                    strokeDasharray="5 5"
                  />
                  <polyline
                    fill="none"
                    stroke="#c0c8c0"
                    strokeWidth="2.5"
                    points={school.history
                      .map(
                        (item, index) =>
                          `${chartX(index)},${chartY(item.cutoff)}`,
                      )
                      .join(" ")}
                  />
                  <polyline
                    fill="none"
                    stroke="#597b62"
                    strokeWidth="3"
                    points={school.history
                      .map(
                        (item, index) =>
                          `${chartX(index)},${chartY(item.average)}`,
                      )
                      .join(" ")}
                  />
                  {school.history.map((item, index) => (
                    <g key={item.year}>
                      <circle
                        cx={chartX(index)}
                        cy={chartY(item.cutoff)}
                        r="4"
                        fill="#c0c8c0"
                      />
                      <circle
                        cx={chartX(index)}
                        cy={chartY(item.average)}
                        r="5"
                        fill="#fff"
                        stroke="#597b62"
                        strokeWidth="3"
                      />
                      <text
                        x={chartX(index)}
                        y={chartY(item.average) - 13}
                        textAnchor="middle"
                        fill="#43634a"
                        fontSize="12"
                      >
                        {item.average}
                      </text>
                      <text
                        x={chartX(index)}
                        y="212"
                        textAnchor="middle"
                        fill="#8a938c"
                        fontSize="12"
                      >
                        {item.year}
                      </text>
                    </g>
                  ))}
                </svg>
                <div className="detail-chart-legend">
                  <span>
                    <i style={{ background: "#c0c8c0" }} />
                    历史门槛
                  </span>
                  <span>
                    <i style={{ background: "#597b62" }} />
                    录取均分
                  </span>
                  <span>
                    <i style={{ background: "#b79254" }} />
                    建议目标 {school.score}
                  </span>
                </div>
              </div>
              <div
                className="detail-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="近三年模拟分数数据，可横向滚动"
              >
                <table className="detail-table">
                  <caption className="sr-only">近三年模拟分数数据</caption>
                  <thead>
                    <tr>
                      <th scope="col">招生年份</th>
                      <th scope="col">历史门槛</th>
                      <th scope="col">录取平均分</th>
                      <th scope="col">数据状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {school.history.map((item) => (
                      <tr key={item.year}>
                        <th scope="row">{item.year}</th>
                        <td>{item.cutoff}</td>
                        <td>{item.average}</td>
                        <td className="muted">模拟 · 未核验</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="detail-goal-grid">
                <div className="panel">
                  <span className="muted">建议备考目标 · 示例</span>
                  <strong>
                    {school.score}
                    <small> / 500 分</small>
                  </strong>
                  <p>用于体验规划，不是安全线</p>
                </div>
                <div className="panel">
                  <span className="muted">当前能力与分数差距</span>
                  <strong>待评估</strong>
                  <p>少量示例题不足以估分</p>
                </div>
              </div>
              <section className="detail-section">
                <h3>总分之外，也要关注单科</h3>
                <div className="detail-subjects">
                  {school.subjects.map((subject, index) => (
                    <div key={subject}>
                      <span>{subject}</span>
                      <strong>
                        {[65, 70, 105, school.score - 240][index]} 分
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="detail-caption muted">
                  以上为模拟目标分配，总分 {school.score}
                  。真实单科线、复试要求与科目变更均待核验；历史最低分不能视作安全线。
                </p>
              </section>
            </>
          )}

          {activeTab === 2 && (
            <>
              <div className="detail-section-heading">
                <div>
                  <h3>这个方向，可以走向哪里</h3>
                  <p className="muted">计算机与电子信息的通用职业探索示例。</p>
                </div>
                <span className="badge">方向参考</span>
              </div>
              <div className="detail-jobs">
                {school.jobs.map((job, index) => (
                  <article className="panel" key={job}>
                    <span className="detail-job-index">0{index + 1}</span>
                    <div>
                      <h4>{job}</h4>
                      <p className="muted">
                        {index === 0
                          ? "关注编程基础、项目实践与技术沟通。"
                          : index === 1
                            ? "关注方向知识、问题分析与可展示的作品。"
                            : "关注工程基础、持续学习与跨团队协作。"}
                      </p>
                    </div>
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </article>
                ))}
              </div>
              <section className="detail-section">
                <h3>从考上，到具备岗位能力</h3>
                <ul className="detail-reason-list">
                  <li>
                    <ChevronRight size={15} />
                    补充能力：项目开发、数据结构与技术表达。
                  </li>
                  <li>
                    <ChevronRight size={15} />
                    进入门槛：具体岗位可能要求实习、作品或研究经历。
                  </li>
                  <li>
                    <ChevronRight size={15} />
                    判断时点：应结合预计毕业年份的岗位需求再评估。
                  </li>
                </ul>
              </section>
              <div className="detail-evidence-card">
                <ShieldCheck size={20} />
                <div>
                  <h4>就业、前景与政策，分别看依据</h4>
                  <p>
                    本项目的硕士就业率、薪酬、升学去向及政策材料均未接入，暂不提供数值或排名。通用岗位方向不代表该项目的实际毕业去向，政策支持也不等于就业保证。
                  </p>
                </div>
              </div>
            </>
          )}

          {activeTab === 3 && (
            <>
              <div className="detail-section-heading">
                <div>
                  <h3>让判断有据可查</h3>
                  <p className="muted">评价应落在具体学院、专业与年份。</p>
                </div>
                <span className="badge">演示环境</span>
              </div>
              <div className="detail-evidence-card">
                <ShieldCheck size={23} />
                <div>
                  <h4>官方资料与评价证据尚未接入</h4>
                  <p>
                    当前没有已核验评价，不能据此判断招生是否公平或透明。未使用匿名传闻给学校贴标签，也未据此调整排序。
                  </p>
                </div>
              </div>
              <div className="detail-evidence-list">
                {[
                  "招生目录与报考资格",
                  "复试细则与录取数据",
                  "项目培养与就业去向",
                  "考生经历与处理进展",
                ].map((item) => (
                  <div key={item}>
                    <span>
                      <FileText size={16} />
                      {item}
                    </span>
                    <span className="muted">待接入 / 未核验</span>
                  </div>
                ))}
              </div>
              <p className="detail-caption muted">
                适用范围：{school.college} · {school.major} · {school.year}
                。来源链接、年份、更新时间、复核与整改状态将在真实数据接入后展示。
              </p>
              <section className="detail-section">
                <h3>发现信息需要补充</h3>
                <p className="muted">
                  可以体验纠错流程，草稿仅保存在当前浏览器。
                </p>
                <button
                  className="button secondary"
                  aria-expanded={correctionOpen}
                  aria-controls="correction-form"
                  onClick={() => {
                    setCorrectionOpen(!correctionOpen);
                    setDraftStatus("");
                  }}
                >
                  <FileText size={15} />
                  {correctionOpen ? "收起纠错表单" : "填写纠错草稿"}
                </button>
                {correctionOpen && (
                  <form
                    className="detail-correction"
                    id="correction-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!correction.trim()) {
                        setDraftStatus("请填写需要补充或纠正的内容。");
                        return;
                      }
                      try {
                        localStorage.setItem(
                          `yantu-correction-${school.id}`,
                          JSON.stringify({
                            schoolId: school.id,
                            type: correctionType,
                            content: correction.trim(),
                            savedAt: new Date().toISOString(),
                          }),
                        );
                        setDraftStatus(
                          "纠错草稿已保存在此浏览器，未发送给学校或管理员。",
                        );
                      } catch {
                        setDraftStatus(
                          "浏览器存储不可用，草稿暂保留在此表单中。",
                        );
                      }
                    }}
                  >
                    <label htmlFor="correction-type">信息类型</label>
                    <select
                      id="correction-type"
                      value={correctionType}
                      onChange={(event) =>
                        setCorrectionType(event.target.value)
                      }
                    >
                      <option>招生信息</option>
                      <option>分数口径</option>
                      <option>培养与就业</option>
                      <option>评价与证据</option>
                    </select>
                    <label htmlFor="correction-content">补充说明与依据</label>
                    <textarea
                      id="correction-content"
                      placeholder="描述需要核验的内容，可补充资料名称、年份或官方链接。"
                      value={correction}
                      onChange={(event) => setCorrection(event.target.value)}
                      rows={4}
                      required
                      maxLength={2000}
                    />
                    <button className="button primary" type="submit">
                      保存纠错草稿
                    </button>
                    <p className="detail-caption muted" role="status">
                      {draftStatus}
                    </p>
                  </form>
                )}
              </section>
            </>
          )}
        </div>
        <footer className="detail-footer">
          <button
            className={`button secondary ${isSaved ? "is-saved" : ""}`}
            aria-pressed={isSaved}
            onClick={onToggleSave}
          >
            <Bookmark size={17} fill={isSaved ? "currentColor" : "none"} />
            {isSaved ? "已收藏" : "收藏项目"}
          </button>
          <button className="button primary" onClick={onTarget}>
            <Flag size={17} />
            设为备考目标
          </button>
        </footer>
      </section>
    </div>
  );
}
