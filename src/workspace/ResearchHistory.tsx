import { useEffect, useState } from "react";
import type { GuidanceRun } from "../../server/disciplines/types";
import type { ResearchJob } from "../../server/routes/research";
import { request } from "./api";
import { ErrorNotice } from "./ui";
import { useResearch } from "./ResearchContext";
import { ResearchReportView } from "./ResearchReportView";
import { downloadResearchReport, researchOutcome } from "./research-report";

type HistoryItem = {
  jobId: string;
  generatedAt: string;
  versions: GuidanceRun["versions"];
  needsRefresh: boolean;
  status: string;
};
type HistoricalReport = {
  job: ResearchJob & { needsRefresh: boolean };
  run: GuidanceRun;
};
export function ResearchHistory() {
  const research = useResearch();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<HistoricalReport | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ items: HistoryItem[] }>("/research/history", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.data.items);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      });
    return () => controller.abort();
  }, [research.job?.jobId, research.job?.status, research.run?.guidanceRunId]);
  async function open(jobId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await request<HistoricalReport>(
        `/research/history/${encodeURIComponent(jobId)}`,
      );
      setSelected(result.data);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ws-panel ws-stack" aria-label="研究报告历史">
      <h2>研究报告历史</h2>
      <p>仅查看本人已保存的报告。历史查看和下载不会触发模型或检索。</p>
      <ErrorNotice error={error} />
      {!items.length && <p>尚无已保存研究报告。</p>}
      {items.map((item) => (
        <div className="ws-between" key={item.jobId}>
          <span>
            {new Date(item.generatedAt).toLocaleString("zh-CN")} · 画像版本{" "}
            {item.versions.profileVersion} · 选择版本{" "}
            {item.versions.selectionVersion} ·{" "}
            {item.needsRefresh ? "需更新，与当前输入不同" : "与当前输入一致"}
          </span>
          <button
            className="ws-link"
            disabled={busy}
            onClick={() => void open(item.jobId)}
          >
            只读查看历史报告
          </button>
        </div>
      ))}
      {selected?.job.report && (
        <section aria-label="历史报告只读内容" className="ws-stack">
          <p role="status">
            历史报告 · 只读 ·{" "}
            {selected.job.needsRefresh
              ? "需更新，与当前输入不同；请勿作为当前报考依据。"
              : "按生成时的输入版本展示。"}
          </p>
          <p>
            报告 jobId：{selected.job.jobId} · 画像版本{" "}
            {selected.run.versions.profileVersion} · 选择版本{" "}
            {selected.run.versions.selectionVersion}
          </p>
          <div className="ws-actions">
            <button
              className="ws-secondary"
              onClick={() =>
                downloadResearchReport(
                  selected.job.report!,
                  selected.run,
                  selected.job.needsRefresh,
                )
              }
            >
              下载历史研究报告
            </button>
            <button className="ws-link" onClick={() => setSelected(null)}>
              收起历史报告
            </button>
          </div>
          <ResearchReportView
            report={selected.job.report}
            run={selected.run}
            onProfile={() => {}}
            outcome={researchOutcome(selected.job)}
            readOnly
          />
        </section>
      )}
    </section>
  );
}
