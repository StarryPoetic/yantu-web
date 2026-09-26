import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../server/app.ts";
import { environmentConfig } from "../../server/config.ts";

function environment(
  t: TestContext,
  values: Record<string, string | undefined>,
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  const apply = (entries: typeof values) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  t.after(() => apply(previous));
}

function isolatedEnvironment(t: TestContext, mode: string, limit?: string) {
  environment(t, {
    NODE_ENV: mode,
    YANTU_ORIGIN: "https://test.example",
    YANTU_TEST_API_RATE_LIMIT: limit,
    YANTU_ADMIN_CREDENTIALS: "[]",
    YANTU_BOOTSTRAP_ADMINS: "[]",
    YANTU_MODEL_ENABLED: "false",
    YANTU_SEARCH_ENABLED: "false",
  });
}

async function localServer(t: TestContext) {
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: false,
    staticDirectory: undefined,
  });
  t.after(() => app.close());
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  return async (path: string) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1${path}`,
    );
    return { status: response.status, body: await response.json() };
  };
}

test("the parallel-test API allowance cannot change development or production limits", (t) => {
  isolatedEnvironment(t, "production", "10000");
  for (const mode of ["production", "development", undefined]) {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    assert.equal(environmentConfig().rateLimit, 600);
    process.env.YANTU_TEST_API_RATE_LIMIT = "invalid-test-value";
    assert.equal(environmentConfig().rateLimit, 600);
    process.env.YANTU_TEST_API_RATE_LIMIT = "10000";
  }
});

test("test API allowance is explicit, bounded and rejects invalid configuration", (t) => {
  isolatedEnvironment(t, "test");
  assert.equal(environmentConfig().rateLimit, 600);
  process.env.YANTU_TEST_API_RATE_LIMIT = "10000";
  assert.equal(environmentConfig().rateLimit, 10000);
  for (const value of ["", "0", "-1", "1.5", "Infinity", "100001", "1e4"]) {
    process.env.YANTU_TEST_API_RATE_LIMIT = value;
    assert.throws(() => environmentConfig(), /1 至 100000/);
  }
});

test("production still limits the shared IP after 600 API requests even with the test setting", async (t) => {
  isolatedEnvironment(t, "production", "10000");
  const request = await localServer(t);
  for (let sent = 0; sent < 600; sent += 4) {
    const batch = await Promise.all(
      Array.from({ length: 4 }, () => request("/health")),
    );
    assert.ok(batch.every((response) => response.status === 200));
  }
  const denied = await request("/auth/session");
  assert.equal(denied.status, 429);
  assert.equal(denied.body.code, "rate_limited");
});

test("four test clients can share loopback beyond 600 requests without blocking a later session", async (t) => {
  isolatedEnvironment(t, "test", "10000");
  const request = await localServer(t);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let sent = 0; sent < 160; sent++) {
        const response = await request("/health");
        assert.equal(response.status, 200);
      }
    }),
  );
  const session = await request("/auth/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.authenticated, false);
});

test("the test allowance keeps enforcement rather than bypassing the limiter", async (t) => {
  isolatedEnvironment(t, "test", "3");
  const request = await localServer(t);
  for (let sent = 0; sent < 3; sent++)
    assert.equal((await request("/health")).status, 200);
  assert.equal((await request("/health")).status, 429);
});
