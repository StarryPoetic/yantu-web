import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  acquireBatchPaidLock,
  researchCostEstimate,
  runBatchLive,
} from "../helpers/research-batch-live.ts";

test("batch acceptance cannot start implicitly and a paid-run lock survives a failed attempt", async () => {
  assert.deepEqual(await runBatchLive([]), { status: "not-started" });
  assert.deepEqual(await runBatchLive(["--rehearsal"]), {
    status: "not-started",
  });
  const prefix = resolve("var/batch1-lock-test-");
  const directory = mkdtempSync(prefix);
  try {
    const path = join(directory, "once.lock");
    acquireBatchPaidLock(path);
    assert.throws(() => acquireBatchPaidLock(path), { code: "EEXIST" });
  } finally {
    assert.ok(resolve(directory).startsWith(prefix));
    rmSync(directory, { recursive: true });
  }
});

test("cost estimates separate Flash, Pro, search and unknown failed-request billing", () => {
  const result = researchCostEstimate(
    {
      "deepseek-flash": {
        calls: 2,
        inputTokens: 1000000,
        outputTokens: 1000000,
        unknownCalls: 1,
      },
      "deepseek-v4-pro": {
        calls: 1,
        inputTokens: 1000000,
        outputTokens: 1000000,
        unknownCalls: 0,
      },
    },
    10,
  );
  assert.equal(result.byModelOffPeakCny["deepseek-flash"], 5);
  assert.equal(result.byModelOffPeakCny["deepseek-v4-pro"], 18);
  assert.equal(result.knownModelPeakCny, 46);
  assert.equal(result.knownTotalOffPeakCny, 23.36);
  assert.equal(result.unknownModelCalls, 1);
});
