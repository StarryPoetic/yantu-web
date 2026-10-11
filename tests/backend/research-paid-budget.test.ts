import test from "node:test";
import assert from "node:assert/strict";
import {
  createPaidAcceptanceBudget,
  acceptanceCriteria,
} from "../helpers/research-paid-budget.ts";

test("paid acceptance shares a conservative ceiling with the next run and protects final analysis", () => {
  const budget = createPaidAcceptanceBudget(7.86);
  budget.search();
  assert.throws(() => budget.search(), { code: "BUDGET_EXHAUSTED" });
  const settle = budget.reserve([{ role: "user", content: "offline" }], {
    model: "deepseek-v4-pro",
    thinking: true,
    maxOutputTokens: 16384,
  });
  settle({ inputTokens: 100, outputTokens: 100 });
  assert.ok(budget.snapshot().conservativeCny < 9.5);
  assert.throws(() => createPaidAcceptanceBudget(9.5), {
    code: "BUDGET_EXHAUSTED",
  });
});
test("concurrent pending and unknown model usage cannot disappear from the cash limit", () => {
  const budget = createPaidAcceptanceBudget(7.87);
  const settle = budget.reserve([{ role: "user", content: "离线测试" }], {
    maxOutputTokens: 2048,
  });
  assert.throws(
    () =>
      budget.reserve([{ role: "user", content: "offline" }], {
        maxOutputTokens: 2048,
      }),
    { code: "BUDGET_EXHAUSTED" },
  );
  const before = budget.snapshot().conservativeCny;
  settle();
  assert.equal(budget.snapshot().conservativeCny, before);
  assert.ok(budget.snapshot().unknownReservedCny > 0);
  assert.throws(() => settle());
});
test("acceptance requires five schools, every denominator, score coverage, time and a completed final analysis", () => {
  const groups = Object.fromEntries(
    ["scores", "competition", "background", "academic", "employment"].map(
      (k) => [k, { confirmed: 3, total: 5 }],
    ),
  );
  const good = {
    elapsedMs: 600000,
    recommendations: 5,
    status: "partial",
    reason: "RESEARCH_PARTIAL_VALIDATION",
    finalCompleted: true,
    groups,
  };
  assert.equal(acceptanceCriteria(good).passed, true);
  for (const change of [
    { recommendations: 4 },
    { elapsedMs: 600001 },
    { finalCompleted: false },
    { reason: "MODEL_TIMEOUT" },
    { failureStage: "analyzing" },
    { groups: {} },
  ])
    assert.equal(acceptanceCriteria({ ...good, ...change }).passed, false);
  assert.equal(
    acceptanceCriteria({
      ...good,
      groups: { ...groups, scores: { confirmed: 2, total: 5 } },
    }).passed,
    false,
  );
});
