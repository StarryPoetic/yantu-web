import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceProgress,
  progressBounds,
  progressTarget,
  progressStopped,
  researchSteps,
} from "../../src/workspace/research-progress.ts";
import type { ResearchJob } from "../../server/routes/research.ts";
const job = (
  stage: ResearchJob["stage"],
  progress = 0,
  status: ResearchJob["status"] = "running",
) => ({ stage, progress, status }) as ResearchJob;

test("progress easing is monotone, frame bounded and cannot overrun each real stage", () => {
  for (const stage of [
    "queued",
    ...researchSteps.map((step) => step.stage),
  ] as const) {
    const { floor, cap } = progressBounds(stage);
    for (const reported of [floor, 100, NaN, -20]) {
      const target = progressTarget(job(stage, reported));
      assert.ok(target <= cap);
      let value = floor;
      for (let i = 0; i < 10000; i++) {
        const next = advanceProgress(
          value,
          target,
          i % 17 === 0 ? 5000 : 16,
          floor,
        );
        assert.ok(next >= value && next <= cap);
        assert.ok(next - value <= 0.768000001);
        value = next;
      }
      assert.ok(value > floor);
    }
  }
});
test("phase changes catch up smoothly and completion reaches the endpoint", () => {
  let value = 28;
  assert.equal(advanceProgress(value, 60, -10), value);
  assert.equal(advanceProgress(value, 20, 16), value);
  for (let i = 0; i < 1200; i++) value = advanceProgress(value, 100, 16);
  assert.ok(value > 99.99 && value <= 100);
  assert.equal(progressTarget(job("done", 100, "completed")), 100);
});
test("failure, cancellation, blocked and partial failure freeze movement", () => {
  for (const status of ["failed", "cancelled", "blocked"] as const)
    assert.equal(progressStopped(job("analyzing", 60, status)), true);
  assert.equal(
    progressStopped({
      ...job("analyzing", 60, "partial"),
      report: { failureStage: "analyzing" } as ResearchJob["report"],
    }),
    true,
  );
  assert.equal(progressStopped(job("done", 100, "partial")), false);
});
