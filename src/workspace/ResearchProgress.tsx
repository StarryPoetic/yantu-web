import type { ResearchJob } from "../../server/routes/research";

const steps = [
  ["preparing", "结合画像选择研究方向"],
  ["researching", "检索学校与专业"],
  ["analyzing", "分析匹配与准备成本"],
  ["writing", "整理具体建议"],
] as const;

export function researchStageName(stage: ResearchJob["stage"]) {
  return steps.find(([value]) => value === stage)?.[1];
}

export function ResearchProgress({
  job,
  failed = false,
}: {
  job: ResearchJob;
  failed?: boolean;
}) {
  const running = job.status === "queued" || job.status === "running";
  const stopped =
    failed || ["blocked", "failed", "cancelled"].includes(job.status);
  const stage = job.report?.failureStage ?? job.stage;
  const knownProgress = !(failed && job.stage === "done");
  const index =
    stage === "done" && !stopped
      ? steps.length
      : steps.findIndex(([value]) => value === stage);
  return (
    <div className="research-progress" aria-label="报告生成状态">
      <div className="ws-between">
        <strong role="status">
          {failed ? "本次报告生成未完成" : job.message}
        </strong>
        {knownProgress && <span>{job.progress}%</span>}
      </div>
      {knownProgress && (
        <progress max={100} value={job.progress} aria-label="报告阶段进度" />
      )}
      <ol>
        {steps.map(([value, name], position) => (
          <li
            key={value}
            className={
              position < index
                ? "is-complete"
                : running && stage === value
                  ? "is-current"
                  : ""
            }
            aria-current={running && stage === value ? "step" : undefined}
          >
            <span>{position < index ? "✓" : position + 1}</span>
            {name}
            {stopped && stage === value ? "（未完成）" : ""}
          </li>
        ))}
      </ol>
      <small className="ws-muted">
        {running
          ? "进度随实际阶段更新。等待模型分析时会停留在当前阶段，离开后可回来继续查看。"
          : stopped
            ? "本次处理已停止，不会在后台继续。需要再次生成时，请手动点击生成按钮。"
            : "本次处理已结束。再次生成需要你手动发起。"}
      </small>
      {!!job.events.length && (
        <details>
          <summary>查看处理记录</summary>
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
  );
}
