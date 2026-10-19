import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { resilienceFixture } from "../helpers/research-resilience-fixture.ts";
import { createDeepSeekAdapter } from "../../server/explanation/deepseek.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import { researchReason } from "../../shared/research-status.ts";

function streamingResearchFixture(totalTimeoutMs?: number) {
  const fixture = resilienceFixture({ timeoutMs: totalTimeoutMs });
  const contentModel = fixture.config.adapter!;
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let finalText = "";
  let notifyFinal!: () => void;
  let started = new Promise<void>((resolve) => {
    notifyFinal = resolve;
  });
  const finalTimeouts: number[] = [];
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "offline-placeholder",
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init!.body));
      const reply = await contentModel.complete(request.messages);
      const usage = {
        prompt_tokens: reply.inputTokens,
        completion_tokens: reply.outputTokens,
      };
      if (!request.stream)
        return Response.json({
          model: reply.model,
          choices: [
            { finish_reason: "stop", message: { content: reply.content } },
          ],
          usage,
        });
      finalText = `data: ${JSON.stringify({ model: reply.model, choices: [{ index: 0, delta: { content: reply.content }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
            notifyFinal();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  fixture.config.adapter = {
    complete(messages, options) {
      if (options?.thinking) finalTimeouts.push(options.timeoutMs!);
      return adapter.complete(messages, options);
    },
  };
  return {
    ...fixture,
    finalTimeouts,
    async finalStarted() {
      await started;
      await flush();
      started = new Promise<void>((resolve) => {
        notifyFinal = resolve;
      });
    },
    heartbeat() {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ model: "deepseek-v4-pro", choices: [{ index: 0, delta: { reasoning_content: "offline reasoning" }, finish_reason: null }] })}\n\n`,
        ),
      );
    },
    finish() {
      controller.enqueue(encoder.encode(finalText));
    },
  };
}

test(
  "offline slow-stream rehearsal: idle failure is recorded once, then a 180-second continuous final stream resumes to completed",
  { timeout: 10000 },
  async (t) => {
    t.mock.timers.enable({
      apis: ["setTimeout", "Date"],
      now: Date.parse("2026-10-11T05:00:00Z"),
    });
    const f = streamingResearchFixture();
    const firstPending = f.create().generate({
      subjectId: f.run.subjectId,
      run: f.run,
      onCheckpoint: f.save,
    });
    await f.finalStarted();
    t.mock.timers.tick(B.thinkingIdleTimeoutMs);
    const first = await firstPending;
    assert.equal(first.reason, "MODEL_TIMEOUT");
    assert.equal(first.failureStage, "analyzing");
    assert.equal(f.checkpoint().report?.reason, "MODEL_TIMEOUT");
    assert.match(researchReason(first.reason), /模型分析超时/);
    assert.equal(
      f.counts.final,
      1,
      "timeouts must not trigger automatic retries",
    );
    const before = { ...f.counts };
    const secondPending = f.create().generate({
      subjectId: f.run.subjectId,
      run: f.run,
      mode: "retry",
      previousReport: first,
      checkpoint: f.checkpoint(),
      onCheckpoint: f.save,
    });
    await f.finalStarted();
    for (let i = 0; i < 6; i++) {
      t.mock.timers.tick(30000);
      f.heartbeat();
      await flush();
    }
    f.finish();
    const report = await secondPending;
    assert.equal(report.status, "completed");
    assert.equal(report.failureStage, undefined);
    assert.equal(report.reason, undefined);
    assert.equal(report.recommendations.length, 5);
    assert.equal(f.counts.final, 2);
    assert.equal(f.counts.searches, before.searches);
    assert.equal(f.counts.pages, before.pages);
    assert.equal(f.counts.planning, before.planning);
    assert.deepEqual(f.finalTimeouts, [
      B.thinkingTimeoutMs,
      B.thinkingTimeoutMs,
    ]);
    assert.equal(report.usage!.model.calls, 1);
    assert.equal(report.usage!.model.inputTokens, 100);
    assert.equal(report.usage!.model.outputTokens, 100);
    t.diagnostic(
      JSON.stringify({
        simulatedFinalElapsedMs: 180000,
        status: report.status,
        recommendations: report.recommendations.length,
        newSearches: report.usage!.searches.paid,
        newReads: report.usage!.reads.reads,
        realPaidCalls: 0,
      }),
    );
  },
);

test("a configured final stream deadline is clamped to the report's remaining total deadline", async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "Date"],
    now: Date.parse("2026-10-11T05:00:00Z"),
  });
  const f = streamingResearchFixture(150000);
  f.config.researchTimeoutMs = 360000;
  const pending = f
    .create()
    .generate({ subjectId: f.run.subjectId, run: f.run, onCheckpoint: f.save });
  await f.finalStarted();
  assert.deepEqual(f.finalTimeouts, [150000]);
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(30000);
    f.heartbeat();
    await flush();
  }
  t.mock.timers.tick(30000);
  const report = await pending;
  assert.equal(report.reason, "RESEARCH_TOTAL_TIMEOUT");
  assert.equal(report.failureStage, "analyzing");
  assert.ok(report.recommendations.length >= 5);
  assert.equal(f.counts.final, 1);
});
