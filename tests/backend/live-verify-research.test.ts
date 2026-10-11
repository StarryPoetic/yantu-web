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

test("rehearsal search supplies bounded real library URLs and respects Bocha domain filters", async () => {
  const { rehearsalSearchResults } = await import(
    "../../scripts/live-verify-research.mjs"
  );
  const sources = Array.from({ length: 6 }, (_, i) => ({
    id: `${i}`,
    url: `https://${i % 2 ? "b" : "a"}.edu.cn/${i}`,
    title: "官网目录",
    excerpt: "公开原文".repeat(200),
    retrievedAt: "2026-10-01T00:00:00Z",
    kind: "official_page" as const,
    verified: false as const,
  }));
  assert.equal(rehearsalSearchResults(sources).length, 4);
  const hits = rehearsalSearchResults(sources, {
    include: "a.edu.cn|missing.edu.cn",
  });
  assert.equal(hits.length, 3);
  assert.ok(
    hits.every(
      (hit) => hit.url.includes("a.edu.cn") && hit.snippet.length <= 600,
    ),
  );
  assert.deepEqual(rehearsalSearchResults([], {}), []);
});

test("read log geography comes from the registry; unknown hosts remain unknown", async () => {
  const { publicSchoolContext } = await import(
    "../../scripts/live-verify-research.mjs"
  );
  assert.equal(publicSchoolContext("grs.hdu.edu.cn").city, "杭州");
  assert.equal(publicSchoolContext("www.nwu.edu.cn").city, "西安");
  assert.deepEqual(publicSchoolContext("hangzhou.unknown.edu.cn"), {
    school: null,
    city: "未知",
    campusCities: [],
  });
});

// Completion mode exercises only fake providers in automated checks.
test("completion consent gate ignores credentials and rehearsal override, with no artifacts", () => {
  const before = readdirSync("var").filter((n) => /model-completion/.test(n));
  for (const extras of [[], ["--rehearsal"]]) {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/live-verify-research.mjs",
        "--model-completion",
        "--dns-mode",
        "public-doh",
        ...extras,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          YANTU_DNS_MODE: "invalid",
          DEEPSEEK_API_KEY: "must-not-be-printed",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout.trim());
    assert.equal(plan.upperBound.searches, 0);
    assert.equal(plan.upperBound.modelCalls, 2);
    assert.equal(plan.upperBound.combinedTokens, 50000);
    assert.doesNotMatch(result.stdout + result.stderr, /must-not-be-printed/);
  }
  assert.deepEqual(
    readdirSync("var").filter((n) => /model-completion/.test(n)),
    before,
  );
});

test("completion reader never sends a search URL to HTTP, including case and trailing-dot variants", async () => {
  const { createSearchProtectedReader } = await import(
    "../../scripts/model-completion-guards.mjs"
  );
  const { rehearsalSearchResults } = await import(
    "../../scripts/live-verify-research.mjs"
  );
  const reached: string[] = [];
  const sources = [
    { url: "https://a.edu.cn/catalog", title: "真实官网", excerpt: "公开原文" },
  ];
  const reader = createSearchProtectedReader({
    searchHost: "api.bocha.cn",
    sources: () => sources,
    searchResults: rehearsalSearchResults,
    http: async (url: string) => {
      reached.push(url);
      return { text: "page", contentType: "text/plain" };
    },
  });
  for (const url of [
    "https://api.bocha.cn/v1/web-search",
    "https://API.BOCHA.CN./other",
  ]) {
    const result = await reader(url, { body: "{}" });
    assert.equal(
      JSON.parse(result.text).data.webPages.value[0].url,
      sources[0].url,
    );
  }
  await reader(sources[0].url);
  assert.deepEqual(reached, [sources[0].url]);
});

test("completion locks are exclusive and persist on failure; model guard allows one planning and final call only", async () => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ModelError } = await import("../../server/explanation/deepseek.ts");
  const {
    acquireCompletionLock,
    assertCompletionNotStarted,
    createCompletionModelGuard,
  } = await import("../../scripts/model-completion-guards.mjs");
  const directory = await mkdtemp(join(tmpdir(), "completion-lock-"));
  const path = join(directory, "run.lock");
  try {
    let calls = 0;
    const guard = createCompletionModelGuard(
      {
        async complete(_messages: unknown, options = {}) {
          assert.ok(options.maxOutputTokens! <= 16384);
          calls++;
          return {
            content: "{}",
            inputTokens: 2000,
            outputTokens: 1000,
            model: "mock",
          };
        },
      },
      { lock: () => acquireCompletionLock(path, directory) },
    );
    await assertCompletionNotStarted(path);
    await guard.complete([
      { role: "system", content: "research-direction-plan" },
    ]);
    await guard.complete([{ role: "system", content: "final" }]);
    await assert.rejects(
      guard.complete([{ role: "system", content: "final repair" }]),
      { code: "BUDGET_EXHAUSTED" },
    );
    assert.equal(calls, 2);
    assert.ok(JSON.parse(await readFile(path, "utf8")).startedAt);
    await assert.rejects(assertCompletionNotStarted(path), {
      code: "MODEL_COMPLETION_ALREADY_STARTED",
    });
    await assert.rejects(acquireCompletionLock(path, directory), {
      code: "MODEL_COMPLETION_ALREADY_STARTED",
    });
    const locked = createCompletionModelGuard(
      {
        async complete() {
          throw new Error("must not call");
        },
      },
      { lock: () => acquireCompletionLock(path, directory) },
    );
    await assert.rejects(
      locked.complete([{ role: "system", content: "final" }]),
      { code: "MODEL_COMPLETION_ALREADY_STARTED" },
    );
    assert.equal(calls, 2);
    const failedPath = join(directory, "failed.lock");
    const failed = createCompletionModelGuard(
      {
        async complete() {
          calls++;
          throw new ModelError("PROVIDER_TEMPORARY_UNAVAILABLE");
        },
      },
      { lock: () => acquireCompletionLock(failedPath, directory) },
    );
    await assert.rejects(
      failed.complete([{ role: "system", content: "research-direction-plan" }]),
      { code: "PROVIDER_TEMPORARY_UNAVAILABLE" },
    );
    await assert.rejects(
      failed.complete([{ role: "system", content: "final" }]),
      { code: "BUDGET_EXHAUSTED" },
    );
    assert.equal(calls, 3);
    assert.ok(await readFile(failedPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("completion rejects oversized input before locking and defaults to 0.5 tokens per character without measurements", async () => {
  const { createCompletionModelGuard } = await import(
    "../../scripts/model-completion-guards.mjs"
  );
  let locks = 0,
    calls = 0;
  const guard = createCompletionModelGuard(
    {
      async complete(messages: unknown, options = {}) {
        calls++;
        assert.equal(
          options.maxOutputTokens,
          Math.min(
            16384,
            50000 - 3918 - Math.ceil(JSON.stringify(messages).length * 0.5),
          ),
        );
        return {
          inputTokens: 100,
          outputTokens: 100,
          content: "{}",
          model: "mock",
        };
      },
    },
    {
      lock: async () => {
        locks++;
      },
    },
  );
  await assert.rejects(
    guard.complete([{ role: "user", content: "x".repeat(40000) }]),
    { code: "EVIDENCE_TOO_LARGE" },
  );
  assert.equal(locks, 0);
  assert.equal(calls, 0);
  await guard.complete([{ role: "user", content: "x".repeat(39000) }], {
    maxOutputTokens: 16384,
  });
  assert.equal(locks, 1);
  assert.equal(calls, 1);
});

test("zero-fee completion uses the production assembly and writes a report without real search or paid lock", async () => {
  const { mkdtemp, readFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { generateGuidance } = await import(
    "../../server/disciplines/index.ts"
  );
  const { blankProfile } = await import("../../server/profile.ts");
  const { ModelError } = await import("../../server/explanation/deepseek.ts");
  const { main } = await import("../../scripts/live-verify-research.mjs");
  const directory = await mkdtemp(join(tmpdir(), "completion-assembly-"));
  const previousExitCode = process.exitCode;
  const run = generateGuidance({
    subjectId: "synthetic",
    guidanceRunId: "synthetic",
    generatedAt: new Date().toISOString(),
    profile: {
      ...blankProfile(),
      cities: ["杭州"],
      major: "机械工程",
      year: "2027",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "0802",
    excludedMajorIds: [],
    assessments: [],
  });
  const events: Array<{ event: string; simulated?: boolean }> = [];
  let capturedRequests = 0;
  try {
    const summary = await main(
      [
        "--confirm-paid",
        "--model-completion",
        "--rehearsal",
        "--dns-mode",
        "public-doh",
      ],
      {
        directory,
        databasePath: join(directory, "test.sqlite"),
        run,
        log: (event: (typeof events)[number]) => events.push(event),
        onModelMessages: (messages) => {
          capturedRequests++;
          assert.ok(messages.length > 0);
        },
        http: async (url: string) => {
          assert.notEqual(new URL(url).hostname, "api.bocha.cn");
          throw new ModelError("WEB_UNAVAILABLE");
        },
      },
    );
    assert.ok(summary, JSON.stringify(events));
    assert.equal(summary.totals.searches, 0);
    assert.ok(summary.totals.modelCalls <= 2);
    assert.equal(capturedRequests, summary.totals.modelCalls);
    assert.ok(
      events
        .filter((event) => event.event === "search-request")
        .every((event) => event.simulated),
    );
    const files = await readdir(directory);
    assert.ok(files.includes("report.json"));
    assert.ok(files.includes("rehearsal-model-completion.lock"));
    assert.ok(!files.includes("phase7-model-completion.lock"));
    assert.ok(
      JSON.parse(await readFile(join(directory, "report.json"), "utf8")).status,
    );
  } finally {
    process.exitCode = previousExitCode;
    await rm(directory, { recursive: true, force: true });
  }
});

test("measured planning usage preserves the full thinking output allowance and accounts for both runs' actual tokens", async () => {
  const { createCompletionModelGuard } = await import(
    "../../scripts/model-completion-guards.mjs"
  );
  const events: Record<string, unknown>[] = [];
  let calls = 0;
  const messages = (chars: number, planning: boolean) => {
    const result = [
      {
        role: "system" as const,
        content: planning ? "research-direction-plan" : "final",
      },
    ];
    result[0].content += "x".repeat(chars - JSON.stringify(result).length);
    assert.equal(JSON.stringify(result).length, chars);
    return result;
  };
  const guard = createCompletionModelGuard(
    {
      async complete(_messages, options = {}) {
        calls++;
        if (calls === 2) assert.equal(options.maxOutputTokens, 16384);
        return {
          content: "{}",
          inputTokens: calls === 1 ? 3266 : 22000,
          outputTokens: calls === 1 ? 652 : 10000,
          model: "mock",
        };
      },
    },
    { log: (event) => events.push(event) },
  );
  await guard.complete(messages(11627, true), { maxOutputTokens: 4096 });
  await guard.complete(messages(37000, false), {
    thinking: true,
    maxOutputTokens: 16384,
  });
  const budgets = events.filter((event) => event.event === "model-budget");
  assert.equal(budgets[0].estimatedTokenRatio, 0.5);
  assert.equal(budgets[0].estimatedInputTokens, Math.ceil(11627 * 0.5));
  assert.equal(budgets[1].estimatedTokenRatio, (3266 / 11627) * 1.5);
  assert.equal(
    budgets[1].estimatedInputTokens,
    Math.ceil(37000 * ((3266 / 11627) * 1.5)),
  );
  assert.equal(budgets[1].priorKnownTokens, 3918 + 3266 + 652);
  assert.equal(
    events.at(-1)!.combinedKnownTokens,
    3918 + 3266 + 652 + 22000 + 10000,
  );
  assert.equal(calls, 2);
});

test("measured ratio has a 0.35 floor and 1.0 ceiling; insufficient thinking budget never sends a final request", async () => {
  const { createCompletionModelGuard } = await import(
    "../../scripts/model-completion-guards.mjs"
  );
  for (const planningTokens of [1, 10000]) {
    let calls = 0;
    const events: Record<string, unknown>[] = [];
    const guard = createCompletionModelGuard(
      {
        async complete() {
          calls++;
          return {
            content: "{}",
            inputTokens: planningTokens,
            outputTokens: 652,
            model: "mock",
          };
        },
      },
      { log: (event) => events.push(event) },
    );
    await guard.complete(
      [{ role: "system", content: "research-direction-plan" }],
      { maxOutputTokens: 4096 },
    );
    const final = [
      {
        role: "system" as const,
        content:
          "final" +
          "x".repeat(
            37000 -
              JSON.stringify([{ role: "system", content: "final" }]).length,
          ),
      },
    ];
    if (planningTokens === 10000) {
      await assert.rejects(
        guard.complete(final, { thinking: true, maxOutputTokens: 16384 }),
        { code: "BUDGET_EXHAUSTED" },
      );
      assert.equal(calls, 1);
    } else {
      await guard.complete(final, { thinking: true, maxOutputTokens: 16384 });
      assert.equal(calls, 2);
    }
    const budget = events
      .filter((event) => event.event === "model-budget")
      .at(-1)!;
    assert.equal(budget.estimatedTokenRatio, planningTokens === 1 ? 0.35 : 1);
    if (planningTokens === 10000)
      assert.ok(Number(budget.maxOutputTokens) < 12000);
  }
});
