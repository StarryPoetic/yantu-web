import type { ResearchJob } from "../../server/routes/research";

const steps = [
  ["preparing", "结合画像选择研究方向"],
  ["researching", "检索学校与专业"],
  ["analyzing", "分析匹配与准备成本"],
  ["writing", "整理具体建议"],
] as const;

export function ResearchProgress({ job }: { job: ResearchJob }) {
  const index =
    job.stage === "done"
      ? steps.length
      : steps.findIndex(([stage]) => stage === job.stage);
  return (
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
        进度随实际阶段更新。等待模型分析时会停留在当前阶段，离开后可回来继续查看。
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
  );
}
