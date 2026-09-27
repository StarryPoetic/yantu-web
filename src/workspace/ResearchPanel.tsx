import { useEffect, useState } from "react";
import { Download, RefreshCw, Sparkles } from "lucide-react";
import type { ResearchJob, ResearchEngine } from "../../server/routes/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import { researchReason } from "../../shared/research-status";
import { request } from "./api";
import { ErrorNotice } from "./ui";
import { ResearchReportView } from "./ResearchReportView";
import { ResearchProgress } from "./ResearchProgress";
import { downloadResearchReport } from "./research-report";
import "./research.css";

type Job = ResearchJob & { needsRefresh?: boolean; refreshReasons?: string[] };
type Readiness = ReturnType<ResearchEngine["getReadiness"]>;
const active = (job: Job | null) =>
  !!job && ["queued", "running"].includes(job.status);

export function ResearchPanel({
  run,
  stale,
  onProfile,
  onExplore,
}: {
  run: GuidanceRun;
  stale: boolean;
  onProfile: () => void;
  onExplore: () => void;
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
        "/guidance/" + run.guidanceRunId + "/research/latest",
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
        const result = await request<Job>("/research-jobs/" + job.jobId, {
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
        "/guidance/" + run.guidanceRunId + "/research",
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
  const serviceNotice = readiness && !readiness.ready && (
    <div className="research-service-notice">
      <strong>报告服务尚未准备好</strong>
      <ul>
        {readiness.reasons.map((reason) => (
          <li key={reason}>{researchReason(reason)}</li>
        ))}
      </ul>
      <p>
        可展开“查看基础探索与专业选择”继续浏览；服务配置完成后，点击“重新检查服务”即可继续。
      </p>
    </div>
  );
  return (
    <section className="ws-panel research-panel" aria-label="联网研究报告">
      <div className="research-panel-heading">
        <h2>
          {report?.recommendations.length
            ? "你的院校与专业建议"
            : "生成学校与专业建议"}
        </h2>
        {report && (
          <span className="ws-muted">
            {report.status === "completed" ? "研究报告" : "部分研究报告"}
          </span>
        )}
      </div>
      {!report && (
        <p>
          结合你的本科背景、跨专业意愿、学习目标和现实条件，比较具体学校与专业，并说明理由和准备成本。
        </p>
      )}
      <ErrorNotice
        error={error}
        onReload={() => setReload((value) => value + 1)}
      />
      {loading && <p role="status">正在读取报告和服务状态…</p>}
      {outdated && (
        <p className="research-stale" role="status">
          画像、测评、目标或资料已更新。已有报告仅供回顾，请先重新生成基础结论，再进行联网调研。
        </p>
      )}
      {report && (
        <ResearchReportView
          report={report}
          run={run}
          onProfile={onProfile}
          onExplore={onExplore}
        />
      )}
      {!report && serviceNotice}
      <div className="ws-actions research-actions">
        <button
          className={report ? "ws-secondary" : "ws-primary"}
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
          <button
            className="ws-secondary"
            onClick={() => downloadResearchReport(report, run, outdated)}
          >
            <Download size={16} />
            下载研究报告
          </button>
        )}
      </div>
      {!report && readiness?.ready && (
        <small className="ws-muted">点击生成后会使用联网搜索与模型服务。</small>
      )}
      {job &&
        (report ? (
          <details className="research-job-details">
            <summary>生成过程与服务信息</summary>
            <ResearchProgress job={job} />
            {serviceNotice}
            {readiness?.ready && (
              <p>使用模型：{readiness.model.name}，已启用思考。</p>
            )}
          </details>
        ) : (
          <ResearchProgress job={job} />
        ))}
    </section>
  );
}
