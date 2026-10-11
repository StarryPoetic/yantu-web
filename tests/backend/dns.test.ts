import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ModelError } from "../../server/explanation/deepseek.ts";
import {
  createPublicDohResolver,
  dnsModeFromEnvironment,
} from "../../server/explanation/dns.ts";
import {
  createHttpsReader,
  resolvePublicAddress,
} from "../../server/explanation/web.ts";

const host = "api.bocha.cn";
const json = (value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/dns-json", ...headers },
  });
function payload(url: URL, entries?: unknown[]) {
  const type = Number(url.searchParams.get("type"));
  return {
    Status: 0,
    TC: false,
    Question: { name: host + ".", type },
    Answer:
      entries ?? (type === 1 ? [{ name: host, type: 1, data: "8.8.8.8" }] : []),
  };
}
const resolverWith = (transform: (url: URL) => Response | Promise<Response>) =>
  createPublicDohResolver({
    fetch: (async (url) => transform(new URL(String(url)))) as typeof fetch,
  });

test("DNS mode is explicit, defaults to system and rejects unsupported configuration", () => {
  assert.equal(dnsModeFromEnvironment({}), "system");
  assert.equal(
    dnsModeFromEnvironment({ YANTU_DNS_MODE: "public-doh" }),
    "public-doh",
  );
  assert.equal(dnsModeFromEnvironment({ YANTU_DNS_MODE: "system" }), "system");
  assert.throws(
    () => dnsModeFromEnvironment({ YANTU_DNS_MODE: "https://attacker.test" }),
    { code: "WEB_DNS_MODE_INVALID" },
  );
});

test("public DoH uses only the fixed credential-free HTTPS endpoint and binds A/AAAA records to its CNAME chain", async () => {
  const calls: Array<{ url: URL; options: RequestInit }> = [];
  const resolver = createPublicDohResolver({
    fetch: (async (value, options) => {
      const url = new URL(String(value));
      calls.push({ url, options: options! });
      const type = Number(url.searchParams.get("type"));
      const answer = [
        { name: host, type: 5, data: "target.example.com." },
        {
          name: "target.example.com.",
          type,
          data: type === 1 ? "8.8.8.8" : "2606:4700::1111",
        },
      ];
      const valueObject = payload(url, answer);
      return json({
        ...valueObject,
        Question: type === 1 ? valueObject.Question : [valueObject.Question],
      });
    }) as typeof fetch,
  });
  assert.deepEqual(await resolvePublicAddress(host, resolver), {
    address: "8.8.8.8",
    family: 4,
  });
  assert.deepEqual(
    calls.map((call) => call.url.searchParams.get("type")).sort(),
    ["1", "28"],
  );
  for (const { url, options } of calls) {
    assert.equal(url.origin + url.pathname, "https://dns.alidns.com/resolve");
    assert.equal(url.searchParams.get("name"), host);
    assert.deepEqual([...url.searchParams.keys()].sort(), ["name", "type"]);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.body, undefined);
    assert.ok(options.signal);
    const headers = new Headers(options.headers);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Subscription-Token"), null);
  }
});

test("DoH cannot allow private/Fake-IP or mixed answers through the existing all-public guard", async () => {
  for (const ip of [
    "198.18.0.118",
    "198.19.1.2",
    "127.0.0.1",
    "10.0.0.2",
    "169.254.169.254",
  ]) {
    const resolver = resolverWith((url) =>
      json(
        payload(
          url,
          Number(url.searchParams.get("type")) === 1
            ? [
                { name: host, type: 1, data: "8.8.8.8" },
                { name: host, type: 1, data: ip },
              ]
            : [],
        ),
      ),
    );
    await assert.rejects(resolvePublicAddress(host, resolver), {
      code: "WEB_ADDRESS_BLOCKED",
    });
  }
  const mixedFamilies = resolverWith((url) =>
    json(
      payload(
        url,
        Number(url.searchParams.get("type")) === 28
          ? [{ name: host, type: 28, data: "::1" }]
          : undefined,
      ),
    ),
  );
  await assert.rejects(resolvePublicAddress(host, mixedFamilies), {
    code: "WEB_ADDRESS_BLOCKED",
  });
});

test("malformed questions, records, unrelated aliases, CNAME loops and DNS failures are rejected", async () => {
  const cases = [
    (url: URL) => ({ ...payload(url), Status: 3 }),
    (url: URL) => ({ ...payload(url), TC: true }),
    (url: URL) => ({
      ...payload(url),
      Question: {
        name: "other.example.com",
        type: Number(url.searchParams.get("type")),
      },
    }),
    (url: URL) => ({ ...payload(url), Question: { name: host, type: 16 } }),
    (url: URL) =>
      payload(url, [
        { name: "unrelated.example.com", type: 1, data: "8.8.8.8" },
      ]),
    (url: URL) =>
      payload(url, [
        { name: host, type: 5, data: "target.example.com" },
        { name: "target.example.com", type: 5, data: host },
      ]),
    (url: URL) =>
      payload(url, [
        { name: host, type: 5, data: "one.example.com" },
        { name: host, type: 5, data: "two.example.com" },
      ]),
    (url: URL) => payload(url, [{ name: host, type: 1, data: "not-an-ip" }]),
    (url: URL) =>
      payload(
        url,
        Array.from({ length: 65 }, () => ({
          name: host,
          type: 1,
          data: "8.8.8.8",
        })),
      ),
  ];
  for (const transform of cases)
    await assert.rejects(
      resolvePublicAddress(
        host,
        resolverWith((url) => json(transform(url))),
      ),
      { code: "WEB_DNS_INVALID_RESPONSE" },
    );
  let calls = 0;
  const resolver = createPublicDohResolver({
    fetch: (async () => {
      calls++;
      throw new Error("must not request");
    }) as typeof fetch,
  });
  for (const name of [
    "localhost",
    "127.0.0.1",
    "host.local",
    "api.bocha.cn/path",
    "user@host.test",
    "a..com",
    "host.test?x=y",
  ]) {
    await assert.rejects(resolver(name, { all: true, verbatim: true }), {
      code: "WEB_DNS_HOST_INVALID",
    });
  }
  assert.equal(calls, 0);
});

test("DoH rejects redirects, unexpected HTTP bodies, large streams, HTTP errors and bounded timeouts", async () => {
  for (const [response, code] of [
    [
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1" },
        }),
      "WEB_DNS_UNAVAILABLE",
    ],
    [() => new Response("failed", { status: 500 }), "WEB_DNS_UNAVAILABLE"],
    [
      () =>
        new Response("<html>unexpected</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      "WEB_DNS_INVALID_RESPONSE",
    ],
    [() => json({}, { "Content-Length": "32769" }), "WEB_DNS_INVALID_RESPONSE"],
    [
      () =>
        new Response("x".repeat(32769), {
          headers: { "Content-Type": "application/json" },
        }),
      "WEB_DNS_INVALID_RESPONSE",
    ],
    [
      () =>
        new Response("{broken", {
          headers: { "Content-Type": "application/json" },
        }),
      "WEB_DNS_INVALID_RESPONSE",
    ],
  ] as const)
    await assert.rejects(resolvePublicAddress(host, resolverWith(response)), {
      code,
    });
  const redirected = resolverWith((url) => {
    const response = json(payload(url));
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  await assert.rejects(resolvePublicAddress(host, redirected), {
    code: "WEB_DNS_UNAVAILABLE",
  });
  const changedUrl = resolverWith((url) => {
    const response = json(payload(url));
    Object.defineProperty(response, "url", {
      value: "https://other.example.com/resolve",
    });
    return response;
  });
  await assert.rejects(resolvePublicAddress(host, changedUrl), {
    code: "WEB_DNS_UNAVAILABLE",
  });
  let signal: AbortSignal | null | undefined;
  const timeout = createPublicDohResolver({
    timeoutMs: 5,
    fetch: ((_url, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    }) as typeof fetch,
  });
  await assert.rejects(resolvePublicAddress(host, timeout), {
    code: "WEB_DNS_TIMEOUT",
  });
  assert.equal(signal?.aborted, true);
});

test("HTTPS reader pins DoH's public address, keeps original TLS hostname and never sends business credentials to DNS", async () => {
  let captured: Record<string, unknown> = {};
  const reader = createHttpsReader({
    dnsMode: "public-doh",
    fetch: (async (value) =>
      json(payload(new URL(String(value))))) as typeof fetch,
    request: ((
      _url: URL,
      options: Record<string, unknown>,
      callback: (response: unknown) => void,
    ) => {
      captured = options;
      const request = Object.assign(new EventEmitter(), {
        destroy() {},
        end() {
          const response = Object.assign(new EventEmitter(), {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            destroy() {},
          });
          queueMicrotask(() => {
            callback(response);
            response.emit("data", Buffer.from("{}"));
            response.emit("end");
          });
        },
      });
      return request;
    }) as never,
  });
  await reader("https://api.bocha.cn/v1/web-search", {
    allowedHosts: [host],
    method: "POST",
    body: "{}",
    headers: { Authorization: "Bearer fake-test-key" },
  });
  assert.equal(captured.servername, host);
  assert.equal(
    (captured.headers as Record<string, string>).Authorization,
    "Bearer fake-test-key",
  );
  const pinned = captured.lookup as (
    host: string,
    options: { all: boolean },
    callback: (error: null, addresses: unknown) => void,
  ) => void;
  pinned(host, { all: true }, (_error, addresses) =>
    assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]),
  );
});

test("independent families retain A success when AAAA fails or times out, and preserve original errors if neither succeeds", async () => {
  for (const hanging of [false, true]) {
    const resolver = createPublicDohResolver({
      timeoutMs: 10,
      fetch: (async (value) => {
        const url = new URL(String(value));
        if (url.searchParams.get("type") === "28") {
          if (hanging) return new Promise(() => {});
          throw new Error("mock failure");
        }
        return json(payload(url));
      }) as typeof fetch,
    });
    assert.deepEqual(await resolver(host, { all: true, verbatim: true }), [
      { address: "8.8.8.8", family: 4 },
    ]);
  }
  for (const [fetcher, code] of [
    [
      async () => {
        throw new Error("private DNS error");
      },
      "WEB_DNS_UNAVAILABLE",
    ],
    [async () => new Promise(() => {}), "WEB_DNS_TIMEOUT"],
  ] as const) {
    const resolver = createPublicDohResolver({
      fetch: fetcher as typeof fetch,
      timeoutMs: 5,
    });
    await assert.rejects(resolver(host, { all: true, verbatim: true }), {
      code,
    });
  }
});

test("reader retries only transient DNS failures once and never repeats search POST", async () => {
  for (const code of ["WEB_DNS_UNAVAILABLE", "WEB_DNS_TIMEOUT"]) {
    let resolutions = 0,
      posts = 0;
    const reader = createHttpsReader({
      resolver: async () => {
        if (++resolutions === 1) throw new ModelError(code);
        return [{ address: "8.8.8.8", family: 4 }];
      },
      request: ((
        _url: URL,
        _options: unknown,
        callback: (response: unknown) => void,
      ) => {
        const req = new EventEmitter();
        return Object.assign(req, {
          end() {
            posts++;
            const response = Object.assign(new EventEmitter(), {
              statusCode: 200,
              headers: { "content-type": "application/json" },
              destroy() {},
            });
            queueMicrotask(() => {
              callback(response);
              response.emit("data", Buffer.from("{}"));
              response.emit("end");
            });
          },
          destroy() {},
        });
      }) as never,
    });
    await reader("https://api.bocha.cn/v1/web-search", {
      allowedHosts: [host],
      method: "POST",
      body: "{}",
    });
    assert.equal(resolutions, 2);
    assert.equal(posts, 1);
  }
});

test("DNS retry stays within the original deadline and never retries unsafe or invalid answers", async () => {
  let calls = 0;
  const started = Date.now();
  await assert.rejects(
    resolvePublicAddress(
      host,
      async () => {
        calls++;
        return new Promise(() => {});
      },
      { timeoutMs: 10 },
    ),
    { code: "WEB_DNS_TIMEOUT" },
  );
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 500);
  calls = 0;
  await assert.rejects(
    resolvePublicAddress(host, async () => {
      calls++;
      throw new ModelError("WEB_DNS_INVALID_RESPONSE");
    }),
    { code: "WEB_DNS_INVALID_RESPONSE" },
  );
  assert.equal(calls, 1);
});
