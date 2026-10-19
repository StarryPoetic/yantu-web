import { useResearch } from "./ResearchContext";
import { ResearchInterestsPanel } from "./ResearchInterests";
import { useEffect, useState } from "react";
import { Download, Flag } from "lucide-react";
import { request } from "./api";
import type { Resource } from "./api";
import type {
  PlanResource,
  Program,
  Recommendation,
  Report,
  Selections,
  Task,
} from "./contracts";
import { Empty, ErrorNotice } from "./ui";

export function PlanPanel({
  programs,
  selections,
  recommendation,
  onSelectionsChanged,
  onTargetChange,
}: {
  programs: Program[];
  selections: Selections;
  recommendation: Recommendation | null;
  onSelectionsChanged: () => Promise<void>;
  onTargetChange: (program: Program | null) => Promise<void>;
}) {
  const { locked } = useResearch();
  const [resource, setResource] = useState<Resource<PlanResource> | null>(null),
    [tasks, setTasks] = useState<Task[]>([]),
    [reports, setReports] = useState<Report[]>([]),
    [targets, setTargets] = useState<Record<string, number>>({}),
    [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]),
    [report, setReport] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false);
  const programId = selections.targetProgramId ?? "";
  const program = programs.find((item) => item.programId === programId);
  const storedPlan = resource?.data.plan;
  const plan = storedPlan?.programId === programId ? storedPlan : null;
  const optionGroups = new Map<string, Program["subjects"]>();
  for (const subject of program?.subjects ?? []) {
    if (subject.optionGroupId)
      optionGroups.set(subject.optionGroupId, [
        ...(optionGroups.get(subject.optionGroupId) ?? []),
        subject,
      ]);
  }
  const selectedSubjects = (program?.subjects ?? []).filter(
    (subject) =>
      !subject.optionGroupId || selectedSubjectIds.includes(subject.subjectId),
  );
  const selectedTargets = Object.fromEntries(
    selectedSubjects.flatMap((subject) =>
      targets[subject.subjectId] === undefined
        ? []
        : [[subject.subjectId, targets[subject.subjectId]]],
    ),
  );
  const matchingRecommendation =
    program &&
    recommendation &&
    !recommendation.needsRefresh &&
    [
      ...recommendation.items,
      ...recommendation.pendingVerification,
      ...(recommendation.eligibleUnranked ?? []),
      ...(recommendation.historicalPreview ?? []),
    ].some(
      (item) =>
        item.programRevisionId === program.programRevisionId &&
        item.program.identity.targetAdmissionYear ===
          program.identity.targetAdmissionYear,
    )
      ? recommendation
      : null;
  async function load(signal?: AbortSignal) {
    const [planResult, tasksResult, reportsResult] = await Promise.all([
      request<PlanResource>("/me/plan", { signal }),
      request<{ items: Task[] }>("/me/tasks", { signal }),
      request<{ items: Report[] }>("/reports", { signal }),
    ]);
    if (signal?.aborted) return;
    setResource(planResult);
    setTasks(
      planResult.data.plan?.programId === programId
        ? tasksResult.data.items
        : [],
    );
    setReports(reportsResult.data.items);
    if (planResult.data.plan?.programId === programId) {
      setSelectedSubjectIds(
        planResult.data.plan.subjects
          .filter((subject) =>
            program?.subjects.some(
              (candidate) =>
                candidate.subjectId === subject.subjectId &&
                candidate.optionGroupId,
            ),
          )
          .map((subject) => subject.subjectId),
      );
      setTargets(
        Object.fromEntries(
          planResult.data.plan.subjects
            .filter((subject) => subject.targetScore !== null)
            .map((subject) => [subject.subjectId, subject.targetScore!]),
        ),
      );
    } else {
      setTargets({});
      setSelectedSubjectIds([]);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, []);
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
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!program || !resource) return;
    await act(async () => {
      const result = await request<PlanResource>("/me/plan", {
        method: "PUT",
        etag: resource.etag,
        body: {
          selectionVersion: selections.selectionVersion,
          programId: program.programId,
          programRevisionId: program.programRevisionId,
          recommendationRunId: matchingRecommendation?.recommendationRunId,
          subjectTargets: selectedTargets,
          selectedSubjectIds: selectedSubjects.map(
            (subject) => subject.subjectId,
          ),
        },
      });
      setResource(result);
      setSaved(true);
      await Promise.all([onSelectionsChanged(), load()]);
    });
  }
  function download(value: Report) {
    const blob = new Blob([value.markdown ?? ""], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `研途择校报告-${value.reportId}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function viewReport(id: string) {
    const result = await request<Report>(`/reports/${id}`);
    setReport(result.data);
  }
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">05 / 把选择变成行动</span>
          <h1>一个清晰目标，一步具体行动。</h1>
          <p>科目以项目当年要求为准；待核验数据不会变成可靠分数线。</p>
        </div>
        <Flag size={34} />
      </div>
      <ErrorNotice error={error} onReload={() => void act(() => load())} />
      <ResearchInterestsPanel
        mode="plan"
        onLinkedTarget={async (id) => {
          const linked = programs.find((program) => program.programId === id);
          if (linked) await act(() => onTargetChange(linked));
        }}
      />
      {program && (
        <section className="ws-panel ws-stack" aria-label="当前已选目标">
          <span className="ws-eyebrow">已保存的院校与专业目标</span>
          <h2>
            {program.display.institutionName} · {program.display.majorName}
          </h2>
          <p>
            {program.display.collegeName} ·{" "}
            {program.identity.targetAdmissionYear} 年 ·{" "}
            {program.identity.degreeType === "academic"
              ? "学术学位"
              : "专业学位"}
          </p>
          <p>
            目标已保存在账号中。下面可单独编辑计划；未保存的分数输入不会覆盖目标选择。
          </p>
          <button
            type="button"
            className="ws-link"
            disabled={busy || locked}
            onClick={() => void act(() => onTargetChange(null))}
          >
            取消当前目标
          </button>
        </section>
      )}
      {programId && !program && (
        <p className="ws-warning" role="alert">
          已保存的目标项目暂不可用，请重新核验或更换目标。旧计划不会替代当前选择。
        </p>
      )}
      {storedPlan && !plan && (
        <p className="ws-notice">
          此前的目标计划已保留为历史记录；当前
          {program ? "目标尚未保存计划" : "尚未选择目标"}
          ，不会沿用旧目标的分数和任务。
        </p>
      )}
      <form className="ws-panel ws-stack" onSubmit={save}>
        <h2>目标项目与分数规划</h2>
        <label>
          目标院校与专业
          <select
            value={programId}
            disabled={busy || locked}
            onChange={(event) => {
              const next =
                programs.find(
                  (item) => item.programId === event.target.value,
                ) ?? null;
              void act(() => onTargetChange(next));
            }}
          >
            <option value="">选择目标项目</option>
            {programId && !program && (
              <option value={programId}>已保存目标（资料暂不可用）</option>
            )}
            {programs.map((item) => (
              <option value={item.programId} key={item.programId}>
                {item.display.institutionName} · {item.display.majorName} ·{" "}
                {item.identity.targetAdmissionYear}
                {item.isExample ? " · 交互示例" : ""}
              </option>
            ))}
          </select>
        </label>
        {program ? (
          <>
            <div className="ws-notice">
              {program.isExample || program.availability !== "verified_current"
                ? "当前项目资料待核验，可记录关注目标，但分数方案可能无法通过正式校验。请先完善并审核招生依据。"
                : "保存时将校验项目修订、实际科目、单科及总分要求。"}
            </div>
            {[...optionGroups].map(([groupId, options]) => (
              <fieldset key={groupId} disabled={busy || locked}>
                <legend>官方可选科目 · 任选一项</legend>
                <p className="ws-muted">
                  仅可在本项目招生要求列出的科目中选择；未选择时保持待确认。
                </p>
                {options.map((subject) => (
                  <label key={subject.subjectId} className="ws-check">
                    <input
                      type="radio"
                      name={`exam-option-${groupId}`}
                      value={subject.subjectId}
                      checked={selectedSubjectIds.includes(subject.subjectId)}
                      onChange={() => {
                        const groupIds = new Set(
                          options.map((item) => item.subjectId),
                        );
                        setSelectedSubjectIds((current) => [
                          ...current.filter((id) => !groupIds.has(id)),
                          subject.subjectId,
                        ]);
                        setTargets((current) =>
                          Object.fromEntries(
                            Object.entries(current).filter(
                              ([id]) => !groupIds.has(id),
                            ),
                          ),
                        );
                        setSaved(false);
                      }}
                    />
                    {subject.name} · 满分 {subject.maxScore ?? "未知"}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="ws-form-grid">
              {selectedSubjects.map((subject) => (
                <label key={subject.subjectId}>
                  {subject.name} · 满分 {subject.maxScore ?? "未知"}
                  <input
                    aria-label={`${subject.name}目标分数`}
                    type="number"
                    min="0"
                    max={subject.maxScore ?? undefined}
                    value={targets[subject.subjectId] ?? ""}
                    disabled={subject.maxScore === null || busy || locked}
                    placeholder={
                      subject.maxScore === null
                        ? "满分待核验，暂不能规划"
                        : "填写目标分数"
                    }
                    onChange={(event) => {
                      setTargets((current) => {
                        const next = { ...current };
                        if (!event.target.value) delete next[subject.subjectId];
                        else
                          next[subject.subjectId] = Number(event.target.value);
                        return next;
                      });
                      setSaved(false);
                    }}
                  />
                  {subject.maxScore === null &&
                    targets[subject.subjectId] !== undefined && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setTargets((current) => {
                            const next = { ...current };
                            delete next[subject.subjectId];
                            return next;
                          });
                          setSaved(false);
                        }}
                      >
                        清除{subject.name}历史异常分数
                      </button>
                    )}
                </label>
              ))}
            </div>
            <p>
              已填写目标总分：
              {Object.values(selectedTargets).reduce(
                (sum, number) => sum + number,
                0,
              )}{" "}
              分 · 不代表预测成绩
            </p>
          </>
        ) : (
          <Empty title="还没有确定目标">
            可以从项目详情进入，也可以直接从上方选择。
          </Empty>
        )}
        <div className="ws-actions">
          <button
            className="ws-primary"
            disabled={!program || !resource || busy}
          >
            保存目标与计划
          </button>
          {saved && <span role="status">目标计划已保存</span>}
        </div>
        {plan && (
          <p className="ws-muted">
            计划版本 {resource?.data.planVersion} ·{" "}
            {plan.status === "needs_review"
              ? "条件变化，需要重新核对"
              : plan.status === "valid"
                ? "当前计划"
                : "待核验计划"}
          </p>
        )}
      </form>
      <section className="ws-panel">
        <h2>下一步任务</h2>
        {tasks.length ? (
          <div className="ws-task-list">
            {tasks.map((task) => (
              <label key={task.taskId}>
                <input
                  type="checkbox"
                  checked={task.completed}
                  disabled={busy}
                  onChange={(event) => {
                    const completed = event.target.checked;
                    void act(async () => {
                      setTasks((current) =>
                        current.map((item) =>
                          item.taskId === task.taskId
                            ? { ...item, completed }
                            : item,
                        ),
                      );
                      try {
                        await request(
                          `/me/tasks/${encodeURIComponent(task.taskId)}`,
                          {
                            method: "PATCH",
                            etag: task.etag ?? task.ETag,
                            body: { completed },
                          },
                        );
                      } catch (error) {
                        setTasks((current) =>
                          current.map((item) =>
                            item.taskId === task.taskId ? task : item,
                          ),
                        );
                        throw error;
                      }
                      const next = await request<{ items: Task[] }>(
                        "/me/tasks",
                      );
                      setTasks(next.data.items);
                    });
                  }}
                />
                <span>
                  <strong>{task.title}</strong>
                  {task.description && <small>{task.description}</small>}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <Empty title="保存目标后生成阶段任务">
            任务会保留对应计划依据，完成情况可独立更新。
          </Empty>
        )}
      </section>
      <section className="ws-panel">
        <div className="ws-between">
          <div>
            <h2>固定项目规划报告</h2>
            <p className="ws-muted">
              报告固定本次依据版本，保留缺失与待核验说明。
            </p>
          </div>
          <button
            className="ws-secondary"
            disabled={busy || !recommendation}
            onClick={() =>
              act(async () => {
                const result = await request<Report>("/reports", {
                  method: "POST",
                  body: {
                    recommendationRunId: recommendation!.recommendationRunId,
                    format: "markdown",
                    ...(plan?.recommendationRunId ===
                      recommendation!.recommendationRunId &&
                    plan.status !== "needs_review"
                      ? { planId: plan.planId, planVersion: plan.planVersion }
                      : {}),
                  },
                });
                await viewReport(result.data.reportId);
                await load();
              })
            }
          >
            生成本次推荐报告
          </button>
        </div>
        {!recommendation && (
          <p className="ws-muted">
            此处是基于正式目录或交互示例的固定项目规划报告。研究报告请到“推荐结论”查看；研究关注目标可直接使用上方待核验准备计划，无需生成联合推荐。
          </p>
        )}
        {reports.map((item) => (
          <div className="ws-between ws-report-row" key={item.reportId}>
            <span>
              {item.createdAt
                ? new Date(item.createdAt).toLocaleDateString("zh-CN")
                : "报告"}{" "}
              · {item.status === "succeeded" ? "已生成" : item.status}
            </span>
            <button
              className="ws-link"
              disabled={busy}
              onClick={() => act(() => viewReport(item.reportId))}
            >
              查看报告
            </button>
          </div>
        ))}
        {report && (
          <div className="ws-report">
            {report.withdrawn ? (
              <div className="ws-notice ws-error" role="alert">
                {report.warning ||
                  "报告依据已撤回。此处仅保留历史记录，请重新推荐；当前不能下载作为报考依据。"}
              </div>
            ) : report.needsRefresh ? (
              <div className="ws-notice" role="status">
                招生目录已有新版本。这是原版本的历史报告，请重新推荐以核对最新要求。
              </div>
            ) : null}
            <div className="ws-between">
              <h3>
                {report.status === "succeeded" ? "报告已就绪" : "报告处理中"}
              </h3>
              {report.markdown ? (
                <button
                  className="ws-secondary"
                  disabled={report.withdrawn}
                  onClick={() => download(report)}
                >
                  <Download size={16} />
                  下载 Markdown
                </button>
              ) : (
                <button
                  className="ws-secondary"
                  disabled={busy}
                  onClick={() => act(() => viewReport(report.reportId))}
                >
                  刷新状态
                </button>
              )}
            </div>
            <pre>{report.markdown ?? "正在生成，请稍后刷新状态。"}</pre>
          </div>
        )}
      </section>
    </>
  );
}
