import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createApplication } from "../../server/app.ts";
import type { AppConfig } from "../../server/config.ts";
import { environmentConfig } from "../../server/config.ts";
import { clientIpAddress, normalizeIpAddress } from "../../server/http.ts";
import type { IncomingMessage } from "node:http";

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

function localEnvironment(t: TestContext) {
  environment(t, {
    NODE_ENV: "test",
    YANTU_ORIGIN: undefined,
    YANTU_DATABASE_PATH: undefined,
    YANTU_SAMPLE_DATA: undefined,
    YANTU_PREVIEW_MODE: undefined,
    YANTU_TRUSTED_PROXY_IPS: undefined,
    YANTU_TEST_API_RATE_LIMIT: undefined,
    YANTU_ADMIN_CREDENTIALS: "[]",
    YANTU_BOOTSTRAP_ADMINS: "[]",
    YANTU_MODEL_ENABLED: "false",
    YANTU_SEARCH_ENABLED: "false",
  });
}

async function localServer(t: TestContext, config: Partial<AppConfig> = {}) {
  localEnvironment(t);
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: false,
    staticDirectory: undefined,
    ...config,
  });
  t.after(() => app.close());
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  return {
    app,
    async request(path = "/health", ip?: string, body?: object) {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...(ip ? { "x-forwarded-for": ip } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: await response.json(),
        headers: response.headers,
      };
    },
  };
}

test("production requires an explicit persistent absolute database path and never seeds examples", (t) => {
  localEnvironment(t);
  process.env.NODE_ENV = "production";
  process.env.YANTU_ORIGIN = "https://yantu.example";
  for (const path of [undefined, "", "  ", ":memory:", "./var/yantu.sqlite"]) {
    if (path === undefined) delete process.env.YANTU_DATABASE_PATH;
    else process.env.YANTU_DATABASE_PATH = path;
    assert.throws(() => environmentConfig(), /YANTU_DATABASE_PATH/);
  }
  process.env.YANTU_DATABASE_PATH = resolve(
    "var",
    "isolated-production.sqlite",
  );
  process.env.YANTU_SAMPLE_DATA = "true";
  const config = environmentConfig();
  assert.equal(config.databasePath, process.env.YANTU_DATABASE_PATH);
  assert.equal(config.sampleData, false);
  assert.equal(config.secureCookies, true);
  assert.deepEqual(config.trustedProxyIps, []);
  process.env.YANTU_ORIGIN = "http://yantu.example";
  assert.throws(() => environmentConfig(), /HTTPS/);
});

test("trusted proxies are explicit individual IPs, normalized and bounded", (t) => {
  localEnvironment(t);
  assert.deepEqual(environmentConfig().trustedProxyIps, []);
  process.env.YANTU_TRUSTED_PROXY_IPS = "127.0.0.1,::1,::ffff:127.0.0.1";
  assert.deepEqual(environmentConfig().trustedProxyIps, ["127.0.0.1", "::1"]);
  for (const value of [
    "*",
    "127.0.0.0/8",
    "localhost",
    "127.0.0.1,",
    "fe80::1%eth0",
    Array(33).fill("127.0.0.1").join(","),
  ]) {
    process.env.YANTU_TRUSTED_PROXY_IPS = value;
    assert.throws(() => environmentConfig(), /YANTU_TRUSTED_PROXY_IPS/);
  }
  assert.equal(normalizeIpAddress("0:0:0:0:0:0:0:1"), "::1");
  assert.equal(normalizeIpAddress("::ffff:7f00:1"), "127.0.0.1");
});

test("health checks the database and masks database failure details without requiring a session", async (t) => {
  const f = await localServer(t);
  const healthy = await f.request();
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body.status, "ok");
  assert.equal(healthy.body.database, "ok");
  assert.equal(healthy.body.sampleData, false);
  assert.equal(healthy.headers.get("cache-control"), "no-store");
  const original = f.app.store.db.prepare;
  f.app.store.db.prepare = () => {
    throw new Error("synthetic-private-path-and-credential");
  };
  try {
    const unavailable = await f.request();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.code, "database_unavailable");
    assert.equal(unavailable.body.database, "unavailable");
    assert.equal(
      JSON.stringify(unavailable.body).includes("synthetic-private"),
      false,
    );
  } finally {
    f.app.store.db.prepare = original;
  }
  assert.equal((await f.request()).status, 200);
});

test("an untrusted peer cannot evade API limiting with forged forwarding headers", async (t) => {
  const f = await localServer(t, { rateLimit: 2 });
  assert.equal((await f.request("/health", "198.51.100.1")).status, 200);
  assert.equal((await f.request("/health", "198.51.100.2")).status, 200);
  assert.equal((await f.request("/health", "198.51.100.3")).status, 429);
});

test("a configured single-hop proxy has separate API limits for its actual clients", async (t) => {
  const f = await localServer(t, {
    rateLimit: 2,
    trustedProxyIps: ["127.0.0.1"],
  });
  assert.equal((await f.request("/health", "198.51.100.1")).status, 200);
  assert.equal((await f.request("/health", "198.51.100.1")).status, 200);
  assert.equal((await f.request("/health", "198.51.100.1")).status, 429);
  assert.equal((await f.request("/health", "198.51.100.2")).status, 200);
  assert.equal((await f.request("/health", "2001:db8::2")).status, 200);
});

test("trusted proxy client IPs also isolate registration limits", async (t) => {
  const f = await localServer(t, {
    trustedProxyIps: ["127.0.0.1"],
    authRegistrationIpLimit: 1,
  });
  const register = (username: string, ip: string) =>
    f.request("/auth/register", ip, {
      username,
      password: "synthetic-safe-password-314159",
    });
  assert.equal((await register("proxy-first", "198.51.100.1")).status, 201);
  assert.equal((await register("proxy-second", "198.51.100.1")).status, 429);
  assert.equal((await register("proxy-third", "198.51.100.2")).status, 201);
});

test("trusted proxies must send one IP; lists, ports, hostnames and duplicate header arrays are rejected", async (t) => {
  const f = await localServer(t, { trustedProxyIps: ["127.0.0.1"] });
  for (const value of [
    "198.51.100.1, 198.51.100.2",
    "198.51.100.1:443",
    "client.example",
    "unknown",
    "[2001:db8::1]",
    "fe80::1%eth0",
  ]) {
    const response = await f.request("/health", value);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "invalid_forwarded_ip");
  }
  assert.equal((await f.request()).status, 200);
  const request = {
    socket: { remoteAddress: "::ffff:127.0.0.1" },
    headers: { "x-forwarded-for": ["198.51.100.1", "198.51.100.2"] },
  } as unknown as IncomingMessage;
  assert.throws(() => clientIpAddress(request, ["127.0.0.1"]), /一个有效/);
  assert.equal(clientIpAddress(request), "127.0.0.1");
});
