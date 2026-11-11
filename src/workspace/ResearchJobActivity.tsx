import { memo } from "react";
import type { ResearchJob } from "../../server/routes/research";

function EventTime({ at }: { at: string }) {
  return (
    <time dateTime={at}>
      {new Date(at).toLocaleTimeString("zh-CN", { hour12: false })}
    </time>
  );
}

export const ResearchJobActivity = memo(function ResearchJobActivity({
  job,
}: {
  job: ResearchJob;
}) {
  const label =
    job.mode === "supplement"
      ? "本次补查"
      : job.mode === "retry"
        ? "本次续查"
        : "本次调研";
  const latest = job.events.at(-1);
  return (
    <section className="research-activity" aria-label={`${label}记录`}>
      <p role="note" aria-label="最新处理记录">
        <strong>{label}最新记录</strong>
        {latest ? (
          <>
            <EventTime at={latest.at} /> · {latest.message}
          </>
        ) : (
          <span>等待服务器发送首条处理记录</span>
        )}
      </p>
      {!!job.events.length && (
        <details key={job.jobId}>
          <summary>查看处理记录</summary>
          <p className="ws-muted">
            仅显示本次任务，最新记录在前。阅读较早记录时不会自动跳回顶部。
          </p>
          <div
            className="research-activity-list"
            tabIndex={0}
            aria-label="本次任务处理记录列表"
          >
            <ul>
              {job.events
                .map((event, index) => (
                  <li key={`${job.jobId}:${index}`}>
                    <EventTime at={event.at} /> · {event.message}
                  </li>
                ))
                .reverse()}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
});
