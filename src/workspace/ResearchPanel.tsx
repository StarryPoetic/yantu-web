import { useEffect, useState } from "react";
import { Download, Globe, RefreshCw, Sparkles } from "lucide-react";
import type { ResearchJob, ResearchEngine } from "../../server/routes/research";
import type { ResearchReport } from "../../server/explanation/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import { request } from "./api";
import { ErrorNotice, safeUrl } from "./ui";
import "./research.css";
import { researchReason } from "../../shared/research-status";

type Job = ResearchJob & { needsRefresh?: boolean; refreshReasons?: string[] };
type Readiness = ReturnType<ResearchEngine["getReadiness"]>;
const steps = [
  ["preparing", "整理画像与测评"],
  ["researching", "联网调查院校与专业"],
  ["analyzing", "模型综合分析"],
  ["writing", "核对依据并生成报告"],
] as const;
const active = (job: Job | null) =>
  !!job && ["queued", "running"].includes(job.status);

function download(report: ResearchReport) {
  const content = [
    "# 研途 · 联网研究报告",
    report.generatedAt,
    "",
    report.summary,
    "",
    "## 检索到的资料",
    ...report.facts.map(
      (fact) => `- ${fact.text} [${fact.citations.join(", ")}]`,
    ),
    "",
    "## 建议比较的学校与专业",
    ...report.recommendations.flatMap((item) => [
      `### ${item.institutionName} · ${item.disciplineCode}`,
      item.rationale,
      ...item.preparation.map((text) => `- 准备：${text}`),
      ...item.uncertainties.map((text) => `- 待核实：${text}`),
      `参考：${item.citations.join(", ")}`,
      "",
    ]),
    "## 适用范围",
    ...report.limitations.map((text) => `- ${text}`),
    "",
    "## 来源",
    ...report.sources.map(
      (source) =>
        `- [${source.id}] ${source.title}\n  ${source.url}\n  获取时间：${source.retrievedAt}`,
    ),
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "研途-联网研究报告.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResearchPanel({
  run,
  stale,
}: {
  run: GuidanceRun;
  stale: boolean;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      request<Readiness>("/research/status", { signal: controller.signal }),
      request<{ job: Job | null }>(
        `/guidance/${run.guidanceRunId}/research/latest`,
        { signal: controller.signal },
      ),
    ])
      .then(([configuration, latest]) => {
        if (!controller.signal.aborted) {
          setReadiness(configuration.data);
          setJob(latest.data.job);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [run.guidanceRunId, reload]);
  const running = active(job);
  useEffect(() => {
    if (!job || !running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await request<Job>(`/research-jobs/${job.jobId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJob(result.data);
        if (active(result.data)) timer = setTimeout(() => void poll(), 1000);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure);
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job?.jobId, running, reload]);
  async function generate() {
    setStarting(true);
    setError(null);
    try {
      const result = await request<Job>(
        `/guidance/${run.guidanceRunId}/research`,
        { method: "POST", body: {} },
      );
      setJob(result.data);
    } catch (failure) {
      setError(failure);
    } finally {
      setStarting(false);
    }
  }
  const outdated = stale || !!job?.needsRefresh;
  const report = job?.report;
  const index =
    job?.stage === "done"
      ? steps.length
      : steps.findIndex(([stage]) => stage === job?.stage);
  return (
    <section className="ws-panel research-panel" aria-label="联网研究报告">
      <div className="ws-between">
        <div>
          <span className="ws-eyebrow">
            <Globe size={16} /> 从个人情况到真实院校资料
          </span>
          <h2>联网调研与深度推荐报告</h2>
        </div>
        <Sparkles size={26} />
      </div>
      <p>
        结合已保存的个人画像、公共课测评和当前目标，搜索学校与专业资料，再由思考模型给出有来源、可核对的建议。
      </p>
      <ErrorNotice
        error={error}
        onReload={() => setReload((value) => value + 1)}
      />
      {loading && <p role="status">正在读取报告和服务状态…</p>}
      {readiness && !readiness.ready && (
        <div className="ws-notice">
          <div>
            <strong>报告服务尚未准备好</strong>
            <ul>
              {readiness.reasons.map((reason) => (
                <li key={reason}>{researchReason(reason)}</li>
              ))}
            </ul>
            <p>
              下方基础探索建议仍可查看；服务配置完成后，点击“重新检查服务”即可继续。
            </p>
          </div>
        </div>
      )}
      {outdated && (
        <p className="ws-notice" role="status">
          画像、测评、目标或资料已更新。已有报告仅供回顾，请先重新生成基础结论，再进行联网调研。
        </p>
      )}
      <div className="ws-actions">
        <button
          className="ws-primary"
          onClick={() => void generate()}
          disabled={
            loading || starting || running || !readiness?.ready || outdated
          }
        >
          <Sparkles size={17} />
          {starting
            ? "正在创建报告任务…"
            : running
              ? "报告生成中…"
              : report
                ? "重新调研并生成报告"
                : "联网调研并生成报告"}
        </button>
        <button
          className="ws-secondary"
          disabled={loading || starting}
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={16} />
          {running ? "刷新生成进度" : "重新检查服务"}
        </button>
        {report && report.status !== "blocked" && (
          <button className="ws-secondary" onClick={() => download(report)}>
            <Download size={16} />
            下载研究报告
          </button>
        )}
      </div>
      {readiness?.ready && (
        <small className="ws-muted">
          研究模型：{readiness.model.name} ·
          已启用思考。点击生成后会调用模型与网页检索服务。
        </small>
      )}
      {job && (
        <div className="research-progress" aria-label="报告生成状态">
          <div className="ws-between">
            <strong role="status">{job.message}</strong>
            <span>{job.progress}%</span>
          </div>
          <progress max={100} value={job.progress} aria-label="报告阶段进度" />
          <ol>
            {steps.map(([stage, name], position) => (
              <li
                key={stage}
                className={
                  position < index
                    ? "is-complete"
                    : job.stage === stage
                      ? "is-current"
                      : ""
                }
                aria-current={job.stage === stage ? "step" : undefined}
              >
                <span>{position < index ? "✓" : position + 1}</span>
                {name}
              </li>
            ))}
          </ol>
          <small className="ws-muted">
            进度随实际阶段更新；等待模型分析时会停留在当前阶段。离开页面后，可返回查看任务进度。
          </small>
          {!!job.events.length && (
            <details>
              <summary>查看已完成的处理步骤</summary>
              <ul>
                {job.events.map((event, i) => (
                  <li key={i}>
                    {new Date(event.at).toLocaleTimeString("zh-CN")} ·{" "}
                    {event.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {report && report.status !== "blocked" && (
        <div className="research-report">
          <div className="ws-between">
            <h3>
              {report.status === "completed" ? "研究报告" : "部分研究报告"}
            </h3>
            <span className="ws-pill">
              {report.searched ? "已取得网页检索资料" : "未完成网页检索"}
            </span>
          </div>
          <p className="research-summary">{report.summary}</p>
          {report.reason && (
            <p className="ws-notice">{researchReason(report.reason)}</p>
          )}
          {!!report.recommendations.length && (
            <>
              <h3>建议进一步比较</h3>
              <div className="ws-guidance-grid">
                {report.recommendations.map((item, i) => (
                  <article className="ws-panel" key={i}>
                    <h4>
                      {item.institutionName} ·{" "}
                      {run.directions.find(
                        (direction) =>
                          direction.discipline.code === item.disciplineCode,
                      )?.discipline.name ?? item.disciplineCode}
                    </h4>
                    <p>{item.rationale}</p>
                    <h5>准备建议</h5>
                    <ul>
                      {item.preparation.map((text, j) => (
                        <li key={j}>{text}</li>
                      ))}
                    </ul>
                    <h5>需要进一步确认</h5>
                    <ul>
                      {item.uncertainties.map((text, j) => (
                        <li key={j}>{text}</li>
                      ))}
                    </ul>
                    <small>参考来源：{item.citations.join("、")}</small>
                  </article>
                ))}
              </div>
            </>
          )}
          {!!report.facts.length && (
            <>
              <h3>检索资料摘录</h3>
              <ul>
                {report.facts.map((fact, i) => (
                  <li key={i}>
                    {fact.text} <small>[{fact.citations.join("、")}]</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>结论的适用范围</h3>
          <ul>
            {report.limitations.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
          <details className="research-sources" open>
            <summary>来源与获取时间 · {report.sources.length} 条</summary>
            {report.sources.map((source) => (
              <article key={source.id}>
                <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                  [{source.id}] {source.title}
                </a>
                <small>
                  {source.kind === "official_page" ? "官网原文" : "搜索摘要"} ·{" "}
                  {new Date(source.retrievedAt).toLocaleString("zh-CN")}
                </small>
                <p>{source.excerpt}</p>
              </article>
            ))}
          </details>
        </div>
      )}
    </section>
  );
}
