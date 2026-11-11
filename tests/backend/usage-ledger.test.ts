import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { Store } from "../../server/store.ts";
import { createPersistentUsageLedger } from "../../server/explanation/usage-ledger.ts";
import { createSearchBudget } from "../../server/explanation/search.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import type { ModelReply } from "../../server/explanation/index.ts";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "yantu-usage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "usage.sqlite");
  const store = new Store(path);
  createPersistentUsageLedger(store);
  store.close();
  return path;
}

const workerUrl = new URL("./helpers/usage-ledger-worker.ts", import.meta.url);
function worker(path: string, mode: string) {
  return fork(workerUrl, [path, mode], {
    execArgv: [],
    env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
}
const reply: ModelReply = {
  content: "{}",
  inputTokens: 2,
  outputTokens: 3,
  model: "deepseek-flash",
};
const day = "2026-11-11";

test("concurrent processes cannot overspend shared daily search allowance", async (t) => {
  const path = await fixture(t);
  const children = [worker(path, "search"), worker(path, "search")];
  t.after(() => children.forEach((child) => child.kill()));
  await Promise.all(children.map((child) => once(child, "message")));
  const responses = children.map((child) => once(child, "message"));
  const exited = children.map((child) => once(child, "exit"));
  children.forEach((child) => child.send("go"));
  const results = await Promise.all(responses);
  assert.equal(
    results.reduce((sum, [value]) => sum + value.accepted, 0),
    30,
  );
  await Promise.all(exited);
  const reopened = new Store(path);
  try {
    const budget = createSearchBudget({
      usageLedger: createPersistentUsageLedger(reopened),
      searchDailyRequestsPerUser: 30,
      searchDailyRequestsGlobal: 35,
    });
    assert.equal(budget.claim("same-student", day), false);
    for (let i = 0; i < 5; i++)
      assert.equal(budget.claim("other-student", day), true);
    assert.equal(budget.claim("third-student", day), false);
    assert.equal(budget.claim("same-student", "2026-11-12"), true);
    assert.equal(
      budget.claim("same-student", day),
      false,
      "clock rollback must not erase the prior day",
    );
  } finally {
    reopened.close();
  }
});

test("killing a process after reservation retains unknown model spend on restart", async (t) => {
  const path = await fixture(t);
  const child = worker(path, "model");
  t.after(() => child.kill());
  await once(child, "message");
  const reserved = once(child, "message");
  child.send("go");
  assert.equal((await reserved)[0], "reserved");
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const store = new Store(path);
  try {
    let calls = 0;
    const runtime = createModelRuntime({
      usageLedger: createPersistentUsageLedger(store),
      userDailyTokens: 18,
      globalDailyTokens: 18,
      now: () => Date.parse(`${day}T00:00:00Z`),
      adapter: {
        async complete() {
          calls++;
          return reply;
        },
      },
    });
    await assert.rejects(
      runtime.run("student", "retry", [], JSON.parse, { maxOutputTokens: 16 }),
      { code: "BUDGET_EXHAUSTED" },
    );
    runtime.clearSubject("student");
    await assert.rejects(
      runtime.run("student", "retry2", [], JSON.parse, { maxOutputTokens: 16 }),
      { code: "BUDGET_EXHAUSTED" },
    );
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});

test("known usage settles only the original UTC day, including midnight and failed validation", async (t) => {
  const path = await fixture(t);
  const store = new Store(path);
  try {
    const usageLedger = createPersistentUsageLedger(store);
    let time = Date.parse(`${day}T23:59:59Z`);
    let finish!: (value: ModelReply) => void;
    const runtime = createModelRuntime({
      usageLedger,
      now: () => time,
      userDailyTokens: 18,
      globalDailyTokens: 36,
      adapter: {
        complete: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    const pending = runtime.run(
      "student",
      "first",
      [],
      () => {
        throw new Error("invalid output");
      },
      { maxOutputTokens: 16 },
    );
    time += 2000;
    finish(reply);
    await assert.rejects(pending, /invalid output/);
    assert.equal(
      store.db
        .prepare("SELECT amount FROM usage_reservations WHERE day=?")
        .get(day)?.amount,
      5,
    );
    const next = runtime.run("student", "next-day", [], JSON.parse, {
      maxOutputTokens: 16,
    });
    finish(reply);
    await next;
    assert.deepEqual(
      store.db
        .prepare("SELECT day,amount FROM usage_reservations ORDER BY day")
        .all()
        .map((row) => ({ ...row })),
      [
        { day, amount: 5 },
        { day: "2026-11-12", amount: 5 },
      ],
    );
  } finally {
    store.close();
  }
});

test("timeouts retain reservation, lowered limits do not reset usage, headroom is enforced", async (t) => {
  const path = await fixture(t);
  let store = new Store(path);
  const runtime = createModelRuntime({
    usageLedger: createPersistentUsageLedger(store),
    now: () => Date.parse(`${day}T00:00:00Z`),
    adapter: {
      async complete() {
        throw new Error("timeout");
      },
    },
  });
  await assert.rejects(
    runtime.run("student", "unknown", [], JSON.parse, { maxOutputTokens: 16 }),
    /timeout/,
  );
  store.close();
  store = new Store(path);
  try {
    const usageLedger = createPersistentUsageLedger(store);
    const request = {
      kind: "model" as const,
      subjectId: "student",
      day,
      amount: 1,
      headroom: 2,
      userLimit: 20,
      globalLimit: 100,
    };
    assert.equal(usageLedger.reserve(request), null);
    assert.equal(
      usageLedger.reserve({ ...request, headroom: 0, userLimit: 10 }),
      null,
    );
    assert.equal(
      store.db
        .prepare("SELECT SUM(amount) AS total FROM usage_reservations")
        .get()?.total,
      18,
    );
    const id = usageLedger.reserve({ ...request, headroom: 0 })!;
    assert.ok(id);
    usageLedger.settle(id, 0);
    usageLedger.settle(id, 99);
    assert.equal(
      store.db
        .prepare("SELECT SUM(amount) AS total FROM usage_reservations")
        .get()?.total,
      18,
      "settlement is idempotent",
    );
    assert.throws(() => usageLedger.settle(id, -1), /INVALID_USAGE_AMOUNT/);
  } finally {
    store.close();
  }
});

test("model and search quotas remain separate and profile erasure cannot refund usage", async (t) => {
  const path = await fixture(t);
  const store = new Store(path);
  try {
    const usageLedger = createPersistentUsageLedger(store);
    const request = {
      kind: "model" as const,
      subjectId: "student",
      day,
      amount: 4,
      headroom: 0,
      userLimit: 4,
      globalLimit: 4,
    };
    assert.ok(usageLedger.reserve(request));
    store.erase("student");
    assert.equal(usageLedger.reserve(request), null);
    assert.ok(usageLedger.reserve({ ...request, kind: "search" }));
    assert.equal(usageLedger.reserve({ ...request, subjectId: "other" }), null);
  } finally {
    store.close();
  }
});
