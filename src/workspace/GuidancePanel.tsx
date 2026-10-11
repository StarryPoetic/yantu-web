import { useResearch } from "./ResearchContext";
import { useEffect, useState } from "react";
import { Compass, Sparkles } from "lucide-react";
import type { GuidanceRun } from "../../server/disciplines/types";
import type { PublicAttempt } from "../../server/assessment/types";
import type { ProfileResource, Selections } from "./contracts";
import { request } from "./api";
import { ErrorNotice, safeUrl } from "./ui";
import { ResearchPanel } from "./ResearchPanel";

type Guidance = GuidanceRun & { needsRefresh?: boolean };
const statusNames = {
  explicit_interest: "明确兴趣",
  background_connection: "本科基础关联",
  goal_connection: "学习目标关联",
  open_exploration: "待进一步探索",
  user_excluded: "已排除",
};
export function GuidancePanel({
  profile,
  selections,
  onExplore,
  onProfile,
  onSelection,
}: {
  profile: ProfileResource;
  selections: Selections;
  onExplore: () => void;
  onProfile: () => void;
  onSelection: (value: Partial<Selections>) => Promise<void>;
}) {
  const research = useResearch();
  const [run, setRun] = useState<Guidance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [model, setModel] = useState<{
    status: string;
    text: string;
    reason?: string;
  } | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const saved = profile.profileCompleted || Number(profile.profileVersion) > 0;
  async function generate(signal?: AbortSignal, reuse = false) {
    if (research.running || research.startingMode) return;
    setBusy(true);
    setError(null);
    setModel(null);
    try {
      const [attempts, latest] = await Promise.all([
        request<{ items: PublicAttempt[] }>("/assessment-attempts", { signal }),
        reuse
          ? request<{ guidance: Guidance | null }>("/guidance/latest", {
              signal,
            })
          : Promise.resolve(null),
      ]);
      const completed = attempts.data.items.filter(
        (item) =>
          item.status === "submitted" &&
          item.diagnosis &&
          item.modules.some((module) => module !== "major"),
      );
      const assessmentRefs = completed.slice(0, 10).map((item) => ({
        assessmentAttemptId: item.assessmentAttemptId,
        diagnosisVersion: item.diagnosis!.diagnosisVersion,
      }));
      const existing = latest?.data.guidance;
      const referenceKey = (refs: typeof assessmentRefs) =>
        [
          ...new Set(
            refs.map(
              (item) => `${item.assessmentAttemptId}:${item.diagnosisVersion}`,
            ),
          ),
        ]
          .sort()
          .join("|");
      if (
        existing &&
        !existing.needsRefresh &&
        existing.versions.profileVersion === Number(profile.profileVersion) &&
        existing.versions.selectionVersion ===
          Number(selections.selectionVersion) &&
        referenceKey([
          ...existing.versions.assessmentRefs,
          ...existing.assessmentSummary.ignored,
        ]) === referenceKey(assessmentRefs)
      ) {
        if (!signal?.aborted) setRun(existing);
        return;
      }
      const result = await request<Guidance>("/guidance", {
        method: "POST",
        signal,
        body: {
          profileVersion: profile.profileVersion,
          selectionVersion: selections.selectionVersion,
          assessmentRefs,
        },
      });
      if (!signal?.aborted) setRun(result.data);
    } catch (failure) {
      if (!signal?.aborted) setError(failure);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (!saved || research.loading) return;
    if (
      research.run &&
      (research.job || research.startingMode) &&
      (research.running ||
        research.startingMode ||
        (research.run.versions.profileVersion ===
          Number(profile.profileVersion) &&
          research.run.versions.selectionVersion ===
            Number(selections.selectionVersion)))
    ) {
      setRun(research.run);
      return;
    }
    const controller = new AbortController();
    void generate(controller.signal, true);
    return () => controller.abort();
    // Each visit creates a snapshot for the profile and selection versions shown here.
    // Changing a confirmed major below is explicit and requires pressing regenerate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.profileVersion, research.loading]);
  async function explain() {
    if (!run) return;
    setModelBusy(true);
    setError(null);
    try {
      const result = await request<{
        status: string;
        text: string;
        reason?: string;
      }>(`/guidance/${run.guidanceRunId}/explanation`, {
        method: "POST",
        body: {},
      });
      setModel(result.data);
    } catch (failure) {
      setError(failure);
    } finally {
      setModelBusy(false);
    }
  }
  const highlights =
    run?.directions.filter((item) =>
      run.highlightedIds.includes(item.discipline.code),
    ) ?? [];
  const stale =
    !!run &&
    (run.needsRefresh ||
      run.versions.profileVersion !== Number(profile.profileVersion) ||
      run.versions.selectionVersion !== Number(selections.selectionVersion));
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">03 / 从了解自己，到选择方向</span>
          <h1>你的院校与专业建议</h1>
          <p>先看具体学校与专业，再比较匹配理由、准备成本和报考条件。</p>
        </div>
        <Compass size={34} />
      </div>
      <ErrorNotice error={error} />
      {!saved ? (
        <section className="ws-panel">
          <h2>先保存你的个人画像</h2>
          <p>
            我们还不了解你的本科背景、兴趣和目标，不能替你默认任何报考专业。
          </p>
          <button className="ws-primary" onClick={onProfile}>
            填写个人画像
          </button>
        </section>
      ) : (
        <>
          {busy && <p role="status">正在综合已保存的个人画像与测评记录…</p>}
          {run && (
            <>
              {stale && (
                <p role="status" className="ws-notice">
                  个人条件或确认专业已变化，以下为此前结论。请点击“重新生成结论”后查看当前建议。
                </p>
              )}
              <ResearchPanel
                key={run.guidanceRunId}
                run={run}
                stale={!!stale}
                onProfile={onProfile}
              />
              <details className="ws-panel research-basic-exploration">
                <summary>查看基础探索与专业选择</summary>
                <p className="ws-muted">
                  根据已保存的意向、本科背景和学习目标提供基础探索提示；你可以在这里查看依据并自主确认专业。
                </p>
                <div className="ws-stack">
                  <section className="ws-panel ws-guidance-conclusion">
                    <span className="ws-pill">
                      {run.status === "evidence_based"
                        ? "有依据的探索建议"
                        : "初步探索结论"}
                    </span>
                    <h2>基础探索提示</h2>
                    <p className="ws-answer">{run.conclusion}</p>
                    <ul>
                      {run.considerations.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                    <small>
                      画像版本 {run.versions.profileVersion} · 全国目录{" "}
                      {run.versions.catalogVersion} · 生成于{" "}
                      {new Date(run.generatedAt).toLocaleString("zh-CN")}
                    </small>
                  </section>
                  <section className="ws-panel ws-stack">
                    <div className="ws-between">
                      <h2>理解基础探索依据</h2>
                      <button
                        className="ws-secondary"
                        disabled={modelBusy || stale}
                        onClick={() => void explain()}
                      >
                        <Sparkles size={16} />
                        {modelBusy ? "正在整理…" : "解释基础探索依据"}
                      </button>
                    </div>
                    <p>
                      帮助理解下方基础探索提示；具体学校与专业建议请查看上方联网研究报告。
                    </p>
                    {model && (
                      <div className="ws-answer" role="status">
                        {model.text}
                      </div>
                    )}
                  </section>
                  {notice && (
                    <p role="status" className="ws-notice">
                      {notice}
                    </p>
                  )}
                  {highlights.length ? (
                    <section className="ws-stack">
                      <h2>可进一步探索的专业类别</h2>
                      <div className="ws-guidance-grid">
                        {highlights.map((item) => (
                          <article
                            className="ws-panel ws-stack"
                            key={item.discipline.code}
                          >
                            <span className="ws-eyebrow">
                              {item.discipline.groupName} ·{" "}
                              {statusNames[item.status]}
                            </span>
                            <h3>
                              {item.discipline.code} {item.discipline.name}
                            </h3>
                            <p>
                              {item.discipline.degreeType === "academic"
                                ? "学术学位"
                                : "专业学位"}{" "}
                              · 资格待核验
                            </p>
                            <ul>
                              {item.reasons.map((reason, index) => (
                                <li key={index}>{reason}</li>
                              ))}
                            </ul>
                            <details>
                              <summary>准备成本与需要确认的条件</summary>
                              <ul>
                                {[
                                  ...item.preparation,
                                  ...item.verificationNeeded,
                                ].map((line, index) => (
                                  <li key={index}>{line}</li>
                                ))}
                              </ul>
                            </details>
                            <button
                              disabled={research.locked}
                              className="ws-secondary"
                              onClick={() => {
                                void onSelection({
                                  confirmedMajorId: item.discipline.code,
                                })
                                  .then(() =>
                                    setNotice(
                                      `已确认 ${item.discipline.name}，可继续比较院校。`,
                                    ),
                                  )
                                  .catch(setError);
                              }}
                            >
                              {selections.confirmedMajorId ===
                              item.discipline.code
                                ? "已确认该专业"
                                : "确认此报考专业"}
                            </button>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : (
                    <section className="ws-panel">
                      <h2>暂时不缩小专业范围</h2>
                      <p>
                        当前信息不足以排出优先专业，先补充兴趣与职业目标，或从全国目录选择感兴趣的方向进一步比较。
                      </p>
                    </section>
                  )}
                  <section className="ws-panel">
                    <h2>公共课诊断如何影响建议</h2>
                    <ul>
                      {run.assessmentSummary.observations.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                      {run.assessmentSummary.ignored.map((item) => (
                        <li key={item.assessmentAttemptId}>{item.reason}</li>
                      ))}
                    </ul>
                    <p>
                      公共课用于识别复习任务，不用五题表现断言你适合或不适合某个专业。
                    </p>
                  </section>
                  {!!run.followUpQuestions.length && (
                    <section className="ws-panel">
                      <h2>再回答这些问题，建议会更具体</h2>
                      <ul>
                        {run.followUpQuestions.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                      <button className="ws-link" onClick={onProfile}>
                        补充个人画像
                      </button>
                    </section>
                  )}
                  <details className="ws-panel">
                    <summary>基础探索的适用范围与目录来源</summary>
                    <ul>
                      {run.limitations.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                    <details>
                      <summary>查看目录来源</summary>
                      {run.sources.map((source) => (
                        <p key={source.sourceId}>
                          <a
                            href={safeUrl(source.url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.title}
                          </a>
                        </p>
                      ))}
                    </details>
                  </details>
                </div>
              </details>
            </>
          )}
          <div className="ws-actions">
            <button className="ws-primary" onClick={onExplore}>
              比较全国专业与院校
            </button>
            <button
              className="ws-secondary"
              disabled={busy || research.locked}
              onClick={() => void generate()}
            >
              重新生成结论
            </button>
          </div>
        </>
      )}
    </>
  );
}
