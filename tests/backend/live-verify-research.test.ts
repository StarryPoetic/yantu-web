import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { safeFailureCode } from "../../scripts/live-verify-research.mjs";

test("live verification without explicit consent exits before credentials, database, network or artifacts", () => {
  const inventory = () =>
    (existsSync("var") ? readdirSync("var") : []).filter((n) =>
      /^(?:live|rehearsal)-verify-|phase7-paid-run.lock/.test(n),
    );
  const before = inventory();
  const result = spawnSync(
    process.execPath,
    ["scripts/live-verify-research.mjs"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        YANTU_MODEL_ENABLED: "true",
        DEEPSEEK_API_KEY: "must-not-be-printed",
        YANTU_SEARCH_ENABLED: "true",
        BOCHA_API_KEY: "must-not-be-printed",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.event, "consent-required");
  assert.equal(output.upperBound.searches, 24);
  assert.equal(output.upperBound.modelCalls, 6);
  assert.equal(output.upperBound.inputCharsPerCall, 40000);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-be-printed/);
  assert.deepEqual(inventory(), before);
});
test("database contention remains diagnosable while unknown exception text stays private", () => {
  assert.equal(
    safeFailureCode(
      Object.assign(new Error("private database path"), {
        code: "ERR_SQLITE_ERROR",
        errcode: 5,
      }),
    ),
    "DATABASE_BUSY",
  );
  assert.equal(
    safeFailureCode(
      Object.assign(new Error("private database path"), {
        code: "ERR_SQLITE_ERROR",
        errcode: 6,
      }),
    ),
    "DATABASE_LOCKED",
  );
  assert.equal(
    safeFailureCode(new Error("PRIVATE_CREDENTIAL_VALUE")),
    "LIVE_VERIFY_FAILED",
  );
  assert.equal(
    safeFailureCode(
      Object.assign(new Error("private marker contents"), { code: "EEXIST" }),
    ),
    "PAID_ALREADY_STARTED",
  );
});
