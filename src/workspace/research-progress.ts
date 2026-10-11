import type { ResearchJob } from "../../server/routes/research.ts";

export const researchSteps = [
  {
    stage: "preparing",
    name: "准备",
    description: "结合画像选择研究方向",
    floor: 10,
    cap: 30,
  },
  {
    stage: "researching",
    name: "检索与读取",
    description: "检索学校与专业，读取官网原文",
    floor: 30,
    cap: 60,
  },
  {
    stage: "analyzing",
    name: "分析",
    description: "分析匹配与准备成本",
    floor: 60,
    cap: 90,
  },
  {
    stage: "writing",
    name: "整理",
    description: "整理具体建议",
    floor: 90,
    cap: 99,
  },
] as const;
export function progressBounds(stage: ResearchJob["stage"]) {
  if (stage === "done") return { floor: 100, cap: 100 };
  return (
    researchSteps.find((step) => step.stage === stage) ?? { floor: 0, cap: 10 }
  );
}
export function progressStopped(job: ResearchJob) {
  if (["queued", "running"].includes(job.status)) return false;
  return (
    ["failed", "blocked", "cancelled"].includes(job.status) ||
    !!job.report?.failureStage
  );
}
/** A frame is bounded even after a suspended tab resumes. No estimated completion time. */
export function advanceProgress(
  current: number,
  target: number,
  elapsedMs: number,
  floor = target,
) {
  const dt = Math.min(64, Math.max(0, elapsedMs));
  const delta = Math.min(
    (12 * dt) / 1000,
    Math.max(0, target - current) *
      (1 - Math.exp(-dt / (current < floor ? 700 : 30000))),
  );
  return Math.min(100, current + delta);
}
export function progressTarget(job: ResearchJob) {
  const { floor, cap } = progressBounds(job.stage);
  if (job.stage === "done" && !progressStopped(job)) return 100;
  // The upstream number currently marks a stage boundary, not measured work completion.
  return Math.min(
    cap,
    Math.max(
      floor,
      Number.isFinite(job.progress) ? job.progress : floor,
      cap - 1,
    ),
  );
}
