import test from "node:test";
import assert from "node:assert/strict";
import { resilienceFixture } from "../helpers/research-resilience-fixture.ts";
import { researchDeadline } from "../../server/explanation/research-resume.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";
import type { ModelReply } from "../../server/explanation/deepseek.ts";

for (const pageError of ["HTTP_404", "HTTP_410", "WEB_TIMEOUT"]) {
  test(`${pageError} skips one school source and still delivers other grounded programmes`, async () => {
    const f = resilienceFixture({ pageError });
    const report = await f.create().generate({
      subjectId: f.run.subjectId,
      run: f.run,
      onCheckpoint: f.save,
    });
    assert.ok(report.recommendations.length >= 5);
    assert.ok(!report.failureStage);
    assert.ok(report.readStatistics?.failuresByCode[pageError]);
    assert.ok(
      report.recommendations.every(
        (item) => item.institutionName !== "杭州电子科技大学",
      ),
    );
  });
}
test("one malformed school's page cannot erase valid schools", async () => {
  const f = resilienceFixture({ malformedSchool: true });
  const report = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run });
  assert.ok(report.recommendations.length >= 5);
  assert.ok(report.readStatistics!.failed > 0);
});
test("temporary final model failure retries once and both attempts consume the same ledger", async () => {
  const f = resilienceFixture({ modelFailures: 1 });
  const report = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run });
  assert.ok(report.recommendations.length >= 5);
  assert.ok(!report.failureStage);
  assert.equal(f.counts.final, 2);
  assert.equal(report.usage!.model.calls, 3);
});
test("persistent temporary model failure preserves evidence-derived recommendations and records the Chinese retryable cause", async () => {
  const f = resilienceFixture({ modelFailures: 99 });
  const report = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run, onCheckpoint: f.save });
  assert.equal(f.counts.final, 2);
  assert.equal(report.status, "partial");
  assert.equal(report.failureStage, "analyzing");
  assert.equal(report.reason, "PROVIDER_TEMPORARY_UNAVAILABLE");
  assert.ok(report.recommendations.length >= 5);
  assert.ok(f.checkpoint().evidenceReady);
});
test("retry after process replacement reuses paid discovery, successful reads and planning without another charge", async () => {
  const f = resilienceFixture({
    modelFailures: 1,
    modelError: "MODEL_TIMEOUT",
  });
  const first = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run, onCheckpoint: f.save });
  assert.equal(first.reason, "MODEL_TIMEOUT");
  const before = { ...f.counts };
  const second = await f.create().generate({
    subjectId: f.run.subjectId,
    run: f.run,
    mode: "retry",
    previousReport: first,
    checkpoint: f.checkpoint(),
    onCheckpoint: f.save,
  });
  assert.ok(second.recommendations.length >= 5);
  assert.ok(!second.failureStage);
  assert.equal(f.counts.searches, before.searches);
  assert.equal(f.counts.pages, before.pages);
  assert.equal(f.counts.planning, before.planning);
  assert.equal(second.usage!.searches.paid, 0);
  assert.equal(second.usage!.reads.reads, 0);
  assert.equal(second.usage!.model.calls, 1);
  assert.equal(second.sources.length, first.sources.length);
});
test("overall timeout during the model preserves a usable report and a durable evidence checkpoint", async () => {
  const f = resilienceFixture({ hang: "model", timeoutMs: 600 });
  const started = Date.now();
  const report = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run, onCheckpoint: f.save });
  assert.equal(report.reason, "RESEARCH_TOTAL_TIMEOUT");
  assert.equal(report.failureStage, "analyzing");
  assert.ok(report.recommendations.length >= 5);
  assert.ok(f.checkpoint().evidenceReady);
  assert.ok(Date.now() - started < 1800);
});
test("overall timeout during search returns a clear failure, and cancellation cannot save a late result", async () => {
  const f = resilienceFixture({ hang: "search", timeoutMs: 80 });
  const report = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run, onCheckpoint: f.save });
  assert.equal(report.reason, "RESEARCH_TOTAL_TIMEOUT");
  assert.equal(report.recommendations.length, 0);
  assert.equal(f.counts.planning, 1);
  const deadline = researchDeadline(20);
  try {
    await assert.rejects(deadline.wait(new Promise(() => {})), {
      code: "RESEARCH_TOTAL_TIMEOUT",
    });
  } finally {
    deadline.dispose();
  }
});

test("expired deadline observes an already-started rejecting operation without an unhandled rejection", async () => {
  const parent = new AbortController();
  const deadline = researchDeadline(1000, parent.signal);
  parent.abort(new ModelError("RESEARCH_TOTAL_TIMEOUT"));
  try {
    await assert.rejects(
      deadline.wait(Promise.reject(new ModelError("RESEARCH_TOTAL_TIMEOUT"))),
      { code: "RESEARCH_TOTAL_TIMEOUT" },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    deadline.dispose();
  }
});

test("a model result arriving after the total deadline cannot mutate the durable checkpoint or resurrect the report", async () => {
  const f = resilienceFixture({ timeoutMs: 300 });
  const complete = f.config.adapter!.complete;
  let finish!: (reply: ModelReply) => void;
  f.config.adapter = {
    async complete(messages, options) {
      if (messages[0].content.includes("research-direction-plan-v6"))
        return complete(messages, options);
      return new Promise<ModelReply>((resolve) => {
        finish = resolve;
      });
    },
  };
  const report = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run, onCheckpoint: f.save });
  assert.equal(report.reason, "RESEARCH_TOTAL_TIMEOUT");
  const saved = JSON.stringify(f.checkpoint());
  assert.equal(Object.keys(f.checkpoint().models).length, 1);
  finish({
    content: "{}",
    model: "deepseek-v4-pro",
    inputTokens: 1,
    outputTokens: 1,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(f.checkpoint()), saved);
  assert.equal(report.reason, "RESEARCH_TOTAL_TIMEOUT");
  assert.ok(report.recommendations.length >= 5);
});

test("fully completed model stages remain reusable after process replacement without a second token reservation", async () => {
  const f = resilienceFixture();
  const first = await f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run, onCheckpoint: f.save });
  assert.ok(!first.failureStage);
  const before = { ...f.counts };
  const second = await f.create().generate({
    subjectId: f.run.subjectId,
    run: f.run,
    mode: "retry",
    previousReport: first,
    checkpoint: f.checkpoint(),
    onCheckpoint: f.save,
  });
  assert.ok(second.recommendations.length >= 5);
  assert.deepEqual(f.counts, before);
  assert.equal(second.usage!.model.calls, 0);
  assert.equal(second.usage!.model.inputTokens, 0);
  assert.equal(second.usage!.model.outputTokens, 0);
});
