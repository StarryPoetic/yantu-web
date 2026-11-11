import type { ResearchJob } from "../../server/routes/research";

import { useEffect, useState } from "react";
import { useResearch } from "./ResearchContext";
import { JellyMascot } from "./JellyMascot";
import { ResearchJobActivity } from "./ResearchJobActivity";
import {
  researchSteps,
  progressBounds,
  progressStopped,
  progressTarget,
  advanceProgress,
} from "./research-progress";
const steps = researchSteps.map(
  (step) => [step.stage, step.description] as const,
);
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
  const { position } = useResearch();
  if (position.current.jobId !== job.jobId)
    position.current = {
      jobId: job.jobId,
      value: Math.min(
        progressBounds(job.report?.failureStage ?? job.stage).floor,
        job.progress,
      ),
    };
  const [value, setValue] = useState(position.current.value);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (progressStopped(job)) {
      setValue(position.current.value);
      return;
    }
    if (reduced) {
      position.current.value = Math.max(
        position.current.value,
        progressBounds(job.stage).floor,
      );
      setValue(position.current.value);
      return;
    }
    let frame = 0,
      previous = performance.now();
    const tick = (time: number) => {
      let next = advanceProgress(
        position.current.value,
        progressTarget(job),
        time - previous,
        progressBounds(job.stage).floor,
      );
      if (job.stage === "done" && 100 - next < 0.01) next = 100;
      previous = time;
      position.current.value = next;
      setValue(next);
      if (next < progressTarget(job)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    job.jobId,
    job.stage,
    job.status,
    job.progress,
    job.report?.failureStage,
    reduced,
    position,
  ]);
  const running = job.status === "queued" || job.status === "running";
  const stopped =
    failed || ["blocked", "failed", "cancelled"].includes(job.status);
  const stage = (running ? undefined : job.report?.failureStage) ?? job.stage;
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
        {knownProgress && <span>{Math.floor(value)}%</span>}
      </div>
      {knownProgress && (
        <div
          className="research-journey"
          role="progressbar"
          aria-label="报告阶段进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number(value.toFixed(2))}
          aria-valuetext={`${researchStageName(stage) ?? (stage === "done" ? "已完成" : "等待开始")}，${Math.floor(value)}%`}
        >
          <div className="research-road">
            <div
              className={`research-walker ${running && !stopped && !reduced ? "is-walking" : ""}`}
              style={{ left: `${value}%` }}
            >
              <JellyMascot />
            </div>
            <div className="research-road-signs">
              {researchSteps.map((step) => (
                <span
                  className="research-road-sign"
                  key={step.stage}
                  style={{ left: `${step.floor}%` }}
                >
                  {step.stage === "researching" ? (
                    <>
                      检索与
                      <wbr />
                      读取
                    </>
                  ) : (
                    step.name
                  )}
                </span>
              ))}
            </div>
          </div>
          <div className="research-road-ends">
            <span>起点</span>
            <span>终点</span>
          </div>
        </div>
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
          ? "位置随真实阶段更新，区间内为等待动画，不代表精确完成比例。离开后可回来继续查看。"
          : stopped
            ? "本次处理已停止，不会在后台继续。需要再次生成时，请手动点击生成按钮。"
            : "本次处理已结束。再次生成需要你手动发起。"}
      </small>
      <ResearchJobActivity key={job.jobId} job={job} />
    </div>
  );
}
