import { useResearch } from "./ResearchContext";
import { ResearchInterestsPanel } from "./ResearchInterests";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Heart,
  MapPin,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { request } from "./api";
import { DisciplineExplorer } from "./DisciplineExplorer";
import { programMatchesDiscipline } from "../../shared/discipline-matching";
import type {
  Catalog,
  Program,
  ProfileResource,
  Recommendation,
  Selections,
  Source,
} from "./contracts";
import { DegreeInfo, Dialog, Empty, ErrorNotice, explain, safeUrl } from "./ui";
import type { PublicAttempt } from "../../server/assessment/types";

interface Props {
  catalog: Catalog;
  profile: ProfileResource;
  selections: Selections;
  onSelection: (change: Partial<Selections>) => Promise<void>;
  onPlan: (program: Program) => Promise<void>;
  recommendation: Recommendation | null;
  onRecommend: (recommendation: Recommendation) => void;
  favorites?: boolean;
}
const directionDescriptions: Record<string, string> = {
  research: "关注理论基础、研究方法和科研训练",
  practice: "关注专业能力、行业问题和实践项目",
};
const degreeNames: Record<Program["identity"]["degreeType"], string> = {
  academic: "学术学位",
  professional: "专业学位",
};
export function CatalogPanel({
  catalog,
  profile,
  selections,
  onSelection,
  onPlan,
  recommendation,
  onRecommend,
  favorites = false,
}: Props) {
  const { locked } = useResearch();
  const [diagnoses, setDiagnoses] = useState<PublicAttempt[]>([]),
    [assessmentIds, setAssessmentIds] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ items: PublicAttempt[] }>("/assessment-attempts", {
      signal: controller.signal,
    })
      .then((result) =>
        setDiagnoses(
          result.data.items.filter(
            (attempt) => attempt.status === "submitted" && attempt.diagnosis,
          ),
        ),
      )
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      });
    return () => controller.abort();
  }, []);
  const [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [direction, setDirection] = useState(""),
    [disciplineCode, setDisciplineCode] = useState(""),
    [showExamples, setShowExamples] = useState(false),
    [school, setSchool] = useState(""),
    [admissionYear, setAdmissionYear] = useState(""),
    [degreeType, setDegreeType] = useState(""),
    [degree, setDegree] = useState(false),
    [detail, setDetail] = useState<Program | null>(null),
    [sources, setSources] = useState<Source[]>([]),
    [comparison, setComparison] = useState<string[]>([]),
    [compareOpen, setCompareOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [correction, setCorrection] = useState(""),
    [corrected, setCorrected] = useState(false);
  const all = (catalog.items ?? catalog.programs ?? []).filter(
    (program) => showExamples || !program.isExample,
  );
  const directions = useMemo(() => {
    const grouped = new Map<string, Program[]>();
    for (const program of all) {
      for (const id of program.majorDirectionIds) {
        const projects = grouped.get(id) ?? [];
        projects.push(program);
        grouped.set(id, projects);
      }
    }
    return [...grouped].map(([id, programs], index) => ({
      id,
      name:
        programs[0].display.majorName ||
        programs[0].display.directionName ||
        id,
      body:
        directionDescriptions[id] ??
        `当前目录包含 ${programs.length} 个项目。培养内容、职业方向与准备要求请查看各项目资料。`,
      color: index % 2 === 0 ? "sage" : "peach",
    }));
  }, [all]);
  const admissionYears = [
    ...new Set(all.map((program) => program.identity.targetAdmissionYear)),
  ].sort((a, b) => b - a);
  const degreeTypes = [
    ...new Set(all.map((program) => program.identity.degreeType)),
  ];
  const exclusions = new Set(
    selections.exclusions
      .filter((item) => item.scope === "program")
      .map((item) => item.objectId),
  );
  const visible = useMemo(
    () =>
      all.filter(
        (program) =>
          (!favorites ||
            selections.savedProgramIds.includes(program.programId)) &&
          (!query ||
            `${program.display.institutionName}${program.display.majorName}${program.display.directionName}`.includes(
              query,
            )) &&
          (!city || program.display.city === city) &&
          (!direction || program.majorDirectionIds.includes(direction)) &&
          (!disciplineCode ||
            programMatchesDiscipline(program, disciplineCode)) &&
          (!school || program.display.institutionName === school) &&
          (!admissionYear ||
            String(program.identity.targetAdmissionYear) === admissionYear) &&
          (!degreeType || program.identity.degreeType === degreeType),
      ),
    [
      all,
      query,
      city,
      direction,
      disciplineCode,
      school,
      admissionYear,
      degreeType,
      favorites,
      selections.savedProgramIds,
    ],
  );
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function recommend() {
    await act(async () => {
      const result = await request<Recommendation>("/recommendations", {
        method: "POST",
        body: {
          profileVersion: profile.profileVersion,
          selectionVersion: selections.selectionVersion,
          targetAdmissionYear:
            Number(admissionYear) ||
            Number(profile.profile.year) ||
            catalog.coverage.years?.[0] ||
            new Date().getFullYear() + 1,
          filters: {
            includeExamples: showExamples,
            cities: city ? [city] : undefined,
            majorDirectionIds: direction ? [direction] : undefined,
            disciplineCodes: disciplineCode ? [disciplineCode] : undefined,
            degreeTypes: degreeType ? [degreeType] : undefined,
            institutionIds: school
              ? [
                  ...new Set(
                    all
                      .filter(
                        (program) => program.display.institutionName === school,
                      )
                      .map((program) => program.identity.institutionId),
                  ),
                ]
              : undefined,
          },
          assessmentRefs: diagnoses
            .filter((attempt) =>
              assessmentIds.includes(attempt.assessmentAttemptId),
            )
            .map((attempt) => ({
              assessmentAttemptId: attempt.assessmentAttemptId,
              diagnosisVersion: attempt.diagnosis!.diagnosisVersion,
            })),
        },
      });
      onRecommend(result.data);
    });
  }
  async function showDetail(program: Program) {
    setDetail(program);
    setSources([]);
    setCorrection("");
    setCorrected(false);
    setError(null);
    try {
      const result = await request<Program & { sources?: Source[] }>(
        `/programs/${encodeURIComponent(program.programId)}?catalogVersion=${encodeURIComponent(catalog.catalogVersion)}`,
      );
      setDetail(result.data);
      setSources(result.data.sources ?? []);
    } catch (error) {
      setError(error);
    }
  }
  const save = (program: Program) =>
    act(() =>
      onSelection({
        savedProgramIds: selections.savedProgramIds.includes(program.programId)
          ? selections.savedProgramIds.filter((id) => id !== program.programId)
          : [...selections.savedProgramIds, program.programId],
      }),
    );
  const exclude = (program: Program) =>
    act(() =>
      onSelection({
        exclusions: exclusions.has(program.programId)
          ? selections.exclusions.filter(
              (item) =>
                !(
                  item.scope === "program" &&
                  item.objectId === program.programId
                ),
            )
          : [
              ...selections.exclusions,
              {
                scope: "program",
                objectId: program.programId,
                reason: "用户主动屏蔽",
              },
            ],
      }),
    );
  const hasExclusion = (
    scope: Selections["exclusions"][number]["scope"],
    objectId: string,
  ) =>
    selections.exclusions.some(
      (item) => item.scope === scope && item.objectId === objectId,
    );
  const toggleExclusion = (
    scope: Selections["exclusions"][number]["scope"],
    objectId: string,
  ) =>
    act(() =>
      onSelection({
        exclusions: hasExclusion(scope, objectId)
          ? selections.exclusions.filter(
              (item) => !(item.scope === scope && item.objectId === objectId),
            )
          : [
              ...selections.exclusions,
              { scope, objectId, reason: "用户主动屏蔽" },
            ],
      }),
    );
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">
            {favorites ? "04 / 认真比较" : "研途 · 一步步看清方向"}
          </span>
          <h1>
            {favorites ? "把心动的方向，放在一起。" : "找到属于你的下一站。"}
          </h1>
          <p>从专业或院校出发。用有来源的信息，做可以调整的选择。</p>
        </div>
        <button className="ws-secondary" onClick={() => setDegree(true)}>
          <BookOpen size={17} /> 学硕 / 专硕
        </button>
      </div>
      <div className="ws-notice">
        <BookOpen size={20} />
        <div>
          <strong>
            {catalog.coverage.description || "当前目录覆盖范围有限"}
          </strong>
          <p>
            {catalog.coverage.limitations?.join("；") ||
              "请核对目标年份的官方招生信息。"}
          </p>
          <small>
            目录版本 {catalog.catalogVersion} ·
            示例、待核验资料不会获得推荐排名。
          </small>
        </div>
      </div>
      <ErrorNotice error={error} />
      <ResearchInterestsPanel mode={favorites ? "favorites" : "catalog"} />
      {!favorites && (
        <DisciplineExplorer
          confirmedMajorId={selections.confirmedMajorId}
          onConfirm={async (id) => {
            await onSelection({ confirmedMajorId: id });
            setDisciplineCode(id ?? "");
            setDirection("");
          }}
          onBrowse={(code) => {
            setDisciplineCode(code);
            setDirection("");
            requestAnimationFrame(() =>
              document
                .getElementById("annual-programs")
                ?.scrollIntoView({ block: "start", behavior: "smooth" }),
            );
          }}
        />
      )}
      <section className="ws-panel ws-stack" id="annual-programs">
        <h2>各校年度招生项目</h2>
        <p>
          全国专业目录用于了解学科范围；具体学校是否招生、考试科目和资格要求，以目标年度已核验项目为准。
        </p>
        {disciplineCode && (
          <div className="ws-notice">
            正在查看专业代码 {disciplineCode} 的关联项目。
            <button className="ws-link" onClick={() => setDisciplineCode("")}>
              查看全部已收录项目
            </button>
          </div>
        )}
        <label className="ws-check">
          <input
            type="checkbox"
            checked={showExamples}
            onChange={(event) => setShowExamples(event.target.checked)}
          />
          显示未核验的交互示例项目（仅体验流程）
        </label>
        {!all.length && (
          <p>
            当前尚未收录可展示的正式招生项目。仍可浏览全国专业目录并获取个人专业探索结论，后续通过后台导入各校年度资料。
          </p>
        )}
      </section>
      <section className="ws-panel ws-filter">
        <div className="ws-search">
          <Search size={18} />
          <input
            aria-label="搜索院校或专业"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索院校、专业或方向"
          />
        </div>
        <label>
          城市
          <select
            value={city}
            onChange={(event) => setCity(event.target.value)}
          >
            <option value="">全部城市</option>
            {[...new Set(all.map((item) => item.display.city))].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          院校
          <select
            value={school}
            onChange={(event) => setSchool(event.target.value)}
          >
            <option value="">全部院校</option>
            {[...new Set(all.map((item) => item.display.institutionName))].map(
              (name) => (
                <option key={name}>{name}</option>
              ),
            )}
          </select>
        </label>
        <label>
          专业方向
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            <option value="">全部方向</option>
            {directions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          招生年份
          <select
            value={admissionYear}
            onChange={(event) => setAdmissionYear(event.target.value)}
          >
            <option value="">全部年份</option>
            {admissionYears.map((year) => (
              <option key={year} value={year}>
                {year} 年
              </option>
            ))}
          </select>
        </label>
        <label>
          学位类型
          <select
            value={degreeType}
            onChange={(event) => setDegreeType(event.target.value)}
          >
            <option value="">全部学位</option>
            {degreeTypes.map((type) => (
              <option key={type} value={type}>
                {degreeNames[type]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ws-link"
          onClick={() => {
            setQuery("");
            setCity("");
            setSchool("");
            setDirection("");
            setAdmissionYear("");
            setDegreeType("");
          }}
        >
          清空筛选
        </button>
      </section>
      {!favorites && (
        <section className="ws-panel">
          <div className="ws-between">
            <div>
              <h2>你的联合推荐</h2>
              <p className="ws-muted">
                基于已保存画像与当前筛选。未引用测评时，能力依据不足。
              </p>
            </div>
            <button className="ws-primary" disabled={busy} onClick={recommend}>
              <SlidersHorizontal size={17} />
              {busy ? "正在处理…" : "生成联合推荐"}
            </button>
          </div>
          {diagnoses.length > 0 && (
            <fieldset className="ws-assessment-refs">
              <legend>选择本次明确引用的测评</legend>
              {diagnoses.map((attempt) => (
                <label className="ws-check" key={attempt.assessmentAttemptId}>
                  <input
                    type="checkbox"
                    checked={assessmentIds.includes(
                      attempt.assessmentAttemptId,
                    )}
                    onChange={(event) =>
                      setAssessmentIds((current) =>
                        event.target.checked
                          ? [...current, attempt.assessmentAttemptId]
                          : current.filter(
                              (id) => id !== attempt.assessmentAttemptId,
                            ),
                      )
                    }
                  />
                  {new Date(attempt.createdAt).toLocaleDateString("zh-CN")} ·{" "}
                  {attempt.questions.length} 题
                  {attempt.example
                    ? " · 示例诊断，只作练习参考"
                    : " · 已提交诊断"}
                </label>
              ))}
            </fieldset>
          )}
          {recommendation && (
            <div className="ws-result" role="status">
              <strong>
                {recommendation.items.length
                  ? `有 ${recommendation.items.length} 个可比较的推荐项目`
                  : "暂无可以正式排序的推荐项目"}
              </strong>
              <p>
                待核验 {recommendation.pendingVerification.length}{" "}
                项。资料不足时保留待核验状态，不编造匹配率或录取概率。
              </p>
              <small>固定运行 {recommendation.recommendationRunId}</small>
              {recommendation.degreeAdvice && (
                <div className="ws-degree-advice">
                  <strong>学位方向说明</strong>
                  {profile.profile.degreePreference &&
                    profile.profile.degreePreference !== "不确定" && (
                      <p>
                        你已表达的学位偏好：{profile.profile.degreePreference}
                        。这是个人选择，仍需比较具体项目的培养与报考要求。
                      </p>
                    )}
                  {recommendation.degreeAdvice.reasons.map((reason, index) => (
                    <p key={index}>{reason}</p>
                  ))}
                </div>
              )}
              {recommendation.needsRefresh && (
                <p className="ws-warning" role="alert">
                  推荐依据已经变化，请重新生成推荐。下方保留的是当时的固定结果。
                </p>
              )}
              {recommendation.ignoredAssessmentRefs?.map((ref, i) => (
                <p key={i}>未采用测评依据：{explain(ref)}</p>
              ))}
              {recommendation.items.map((item) => (
                <p key={item.programId}>
                  {all.find((program) => program.programId === item.programId)
                    ?.display.institutionName ?? item.programId}{" "}
                  · {item.explanations.join("；")}
                </p>
              ))}
              {!!recommendation.pendingVerification.length && (
                <details className="ws-diagnosis">
                  <summary>
                    查看待核验原因（{recommendation.pendingVerification.length}{" "}
                    项）
                  </summary>
                  {recommendation.pendingVerification.map((item) => (
                    <div key={item.programId}>
                      <strong>
                        {item.program.display.institutionName} ·{" "}
                        {item.program.display.majorName}
                      </strong>
                      <p>
                        {[
                          ...new Set([
                            ...item.eligibility.reasons,
                            ...item.explanations,
                          ]),
                        ].join("；")}
                      </p>
                    </div>
                  ))}
                </details>
              )}
              {!!recommendation.eligibleUnranked?.length && (
                <details className="ws-diagnosis">
                  <summary>
                    资格满足、依据不足以排序（
                    {recommendation.eligibleUnranked.length} 项）
                  </summary>
                  {recommendation.eligibleUnranked.map((item) => (
                    <p key={item.programId}>
                      {item.program.display.institutionName} ·{" "}
                      {item.explanations.join("；")}
                    </p>
                  ))}
                </details>
              )}
            </div>
          )}
        </section>
      )}
      <div className="ws-between">
        <h2>
          {favorites ? "已收藏项目" : "浏览项目目录"}{" "}
          <span className="ws-muted">{visible.length}</span>
        </h2>
        <button
          className="ws-secondary"
          disabled={!comparison.length}
          onClick={() => setCompareOpen(true)}
        >
          对比已选 {comparison.length} / 3
        </button>
      </div>
      {favorites && (
        <div className="ws-notice" role="status">
          <span>
            共收藏 {selections.savedProgramIds.length} 项，其中{" "}
            {Math.max(0, selections.savedProgramIds.length - visible.length)}{" "}
            项被当前条件隐藏
          </span>
          {visible.length < selections.savedProgramIds.length && (
            <button
              className="ws-link"
              onClick={() => {
                setShowExamples(true);
                setQuery("");
                setCity("");
                setSchool("");
                setDirection("");
                setDisciplineCode("");
                setAdmissionYear("");
                setDegreeType("");
              }}
            >
              显示全部已收藏项目
            </button>
          )}
        </div>
      )}
      <div className="ws-cards">
        {visible.map((program) => (
          <article
            className={`ws-school ${exclusions.has(program.programId) ? "ws-excluded" : ""}`}
            key={program.programId}
          >
            <div className="ws-school-top">
              <span className="ws-school-mark">
                {program.display.shortName ||
                  program.display.institutionName.slice(0, 2)}
              </span>
              <div>
                <h3>
                  <button
                    className="ws-title-button"
                    onClick={() => showDetail(program)}
                  >
                    {program.display.institutionName}
                  </button>
                </h3>
                <span className="ws-muted">
                  <MapPin size={13} /> {program.display.city} ·{" "}
                  {program.identity.targetAdmissionYear}
                </span>
              </div>
              <button
                className="ws-icon"
                aria-label={`${selections.savedProgramIds.includes(program.programId) ? "取消收藏" : "收藏"}${program.display.institutionName}${program.display.majorName}`}
                aria-pressed={selections.savedProgramIds.includes(
                  program.programId,
                )}
                disabled={locked || busy}
                onClick={() => save(program)}
              >
                <Heart
                  size={20}
                  fill={
                    selections.savedProgramIds.includes(program.programId)
                      ? "currentColor"
                      : "none"
                  }
                />
              </button>
            </div>
            <h4>{program.display.majorName}</h4>
            <p className="ws-muted">{program.display.collegeName}</p>
            <div className="ws-tags">
              <span>
                {program.identity.degreeType === "academic"
                  ? "学术学位"
                  : "专业学位"}
              </span>
              <span
                className={
                  program.isExample ||
                  program.availability !== "verified_current"
                    ? "ws-warning"
                    : ""
                }
              >
                {program.isExample
                  ? "示例 · 待核验"
                  : program.availability === "verified_current"
                    ? "已核验"
                    : "资料待核验"}
              </span>
              {exclusions.has(program.programId) && <span>已屏蔽推荐</span>}
            </div>
            <p className="ws-subjects">
              {program.subjects.map((item) => item.name).join(" / ") ||
                "考试科目待核验"}
            </p>
            <div className="ws-school-footer">
              <label>
                <input
                  type="checkbox"
                  checked={comparison.includes(program.programId)}
                  disabled={
                    !comparison.includes(program.programId) &&
                    comparison.length >= 3
                  }
                  onChange={(event) =>
                    setComparison((current) =>
                      event.target.checked
                        ? [...current, program.programId]
                        : current.filter((id) => id !== program.programId),
                    )
                  }
                />{" "}
                加入对比
              </label>
              <button className="ws-link" onClick={() => showDetail(program)}>
                查看资料 <ArrowRight size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <Empty title="当前条件下没有项目">
          可以清空筛选、取消屏蔽或等待更多经审核资料发布。
        </Empty>
      )}
      {degree && (
        <Dialog title="学硕与专硕，怎样选择" onClose={() => setDegree(false)}>
          <DegreeInfo />
        </Dialog>
      )}
      {compareOpen && (
        <Dialog title="项目并排比较" onClose={() => setCompareOpen(false)}>
          <div className="ws-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>比较维度</th>
                  {all
                    .filter((p) => comparison.includes(p.programId))
                    .map((p) => (
                      <th key={p.programId}>
                        {p.display.institutionName}
                        <br />
                        {p.display.majorName}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {["城市", "培养方向", "实际科目", "资料状态", "学费 / 年"].map(
                  (label, index) => (
                    <tr key={label}>
                      <th>{label}</th>
                      {all
                        .filter((p) => comparison.includes(p.programId))
                        .map((p) => (
                          <td key={p.programId}>
                            {
                              [
                                p.display.city,
                                p.identity.degreeType === "academic"
                                  ? "学术研究"
                                  : "专业实践",
                                p.subjects.map((s) => s.name).join(" / "),
                                p.isExample ? "示例 · 待核验" : p.availability,
                                p.tuitionPerYear === null
                                  ? "暂无经核验数据"
                                  : `${p.tuitionPerYear} 元`,
                              ][index]
                            }
                          </td>
                        ))}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="ws-muted">
            比较不代表排名。就业、政策、历史分数与风险缺失时，不推断为有利。
          </p>
        </Dialog>
      )}
      {detail && (
        <Dialog
          title={`${detail.display.institutionName} · ${detail.display.majorName}`}
          onClose={() => setDetail(null)}
        >
          <ErrorNotice error={error} />
          <div className="ws-notice">
            {detail.isExample
              ? "该项目为开发示例，招生资格、分数、就业与政策依据均待核验。"
              : `资料状态：${detail.availability}。请核对当年官方信息。`}
          </div>
          <p>
            {detail.display.collegeName} · {detail.display.city} ·{" "}
            {detail.identity.targetAdmissionYear} 年
          </p>
          <h3>实际考试科目</h3>
          <ul>
            {detail.subjects.map((subject) => (
              <li key={subject.subjectId}>
                {subject.name} · 满分 {subject.maxScore ?? "待核验"} · 单科门槛{" "}
                {subject.minimumScore ?? "待核验"}
              </li>
            ))}
          </ul>
          <h3>资料与证据</h3>
          <p>
            报考条件：
            {detail.eligibility.reason ||
              (detail.eligibility.complete
                ? "查看各项资格条件"
                : "尚未完整核验")}
          </p>
          {detail.evidence.map((item) => (
            <p key={item.dimension}>
              {item.summary} · {item.availability}
            </p>
          ))}
          {sources.length ? (
            <ul>
              {sources.map((source) => (
                <li key={source.sourceId}>
                  {safeUrl(source.url ?? undefined) ? (
                    <a
                      href={safeUrl(source.url ?? undefined)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.title}
                    </a>
                  ) : (
                    source.title
                  )}
                  <small>
                    {" "}
                    · {source.publisher} · {source.collectedAt}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ws-muted">
              尚无可用于核验的官方来源链接。来源引用：
              {detail.sourceIds.join("、") || "未提供"}
            </p>
          )}
          <div className="ws-actions">
            <button
              className="ws-secondary"
              disabled={busy || locked}
              onClick={() => save(detail)}
            >
              {selections.savedProgramIds.includes(detail.programId)
                ? "取消收藏"
                : "收藏项目"}
            </button>
            <button
              className="ws-secondary"
              disabled={busy || locked}
              onClick={() => exclude(detail)}
            >
              {exclusions.has(detail.programId) ? "恢复推荐" : "屏蔽此项目"}
            </button>
            <button
              className="ws-secondary"
              disabled={busy || locked}
              onClick={() =>
                toggleExclusion("institution", detail.identity.institutionId)
              }
            >
              {hasExclusion("institution", detail.identity.institutionId)
                ? "恢复这所院校"
                : "屏蔽这所院校"}
            </button>
            {detail.majorDirectionIds.map((id) => (
              <button
                key={id}
                className="ws-secondary"
                disabled={busy || locked}
                onClick={() => toggleExclusion("majorDirection", id)}
              >
                {hasExclusion("majorDirection", id)
                  ? "恢复此专业方向"
                  : "屏蔽此专业方向"}
              </button>
            ))}
            <button
              className="ws-primary"
              disabled={busy || locked}
              onClick={() => {
                void act(async () => {
                  await onPlan(detail);
                  setDetail(null);
                });
              }}
            >
              设置目标与计划
            </button>
          </div>
          <form
            className="ws-correction"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                await request("/corrections", {
                  method: "POST",
                  body: {
                    programId: detail.programId,
                    programRevisionId: detail.programRevisionId,
                    field: "general",
                    description: correction,
                    evidenceUrls: [],
                  },
                });
                setCorrected(true);
                setCorrection("");
              });
            }}
          >
            <h3>发现资料问题</h3>
            <label>
              纠错说明
              <textarea
                value={correction}
                required
                minLength={5}
                maxLength={2000}
                onChange={(event) => setCorrection(event.target.value)}
                placeholder="请指出具体字段、年份和核验线索"
              />
            </label>
            <button
              className="ws-secondary"
              disabled={busy || correction.trim().length < 5}
            >
              提交纠错
            </button>
            {corrected && (
              <p role="status">
                已提交，等待人工核验；不会直接修改已发布资料。
              </p>
            )}
          </form>
        </Dialog>
      )}
    </>
  );
}
