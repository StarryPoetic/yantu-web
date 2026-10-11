import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { RequestOptions } from "node:https";
import { createDeepSeekTransport } from "../../server/explanation/deepseek-transport.ts";
import { createDeepSeekAdapter } from "../../server/explanation/deepseek.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";

const endpoint = "https://api.deepseek.com/chat/completions";
const publicAddresses = [
  { address: "2606:4700::1111", family: 6 },
  { address: "8.8.8.8", family: 4 },
];
function init(signal = new AbortController().signal): RequestInit {
  return {
    method: "POST",
    redirect: "error",
    signal,
    body: "{}",
    headers: {
      Authorization: "Bearer mock-private-key",
      Host: "evil.test",
      Cookie: "private-cookie",
    },
  };
}
type FakeResponse = PassThrough & {
  statusCode: number;
  headers: Record<string, string>;
};
function fakeRequest(
  onRequest: (
    url: URL,
    options: RequestOptions,
    body: string,
    response: FakeResponse,
  ) => void,
  status = 200,
  headers: Record<string, string> = { "content-type": "application/json" },
) {
  return ((
    url: URL,
    options: RequestOptions,
    callback: (response: FakeResponse) => void,
  ) => {
    const response = Object.assign(new PassThrough(), {
      statusCode: status,
      headers,
    });
    const req = new EventEmitter();
    const signal = options.signal;
    const abort = () => {
      const error = new Error("mock abort");
      req.emit("error", error);
      response.destroy(error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    response.on("close", () => signal?.removeEventListener("abort", abort));
    // The real IncomingMessage always has transport-side error handling.
    response.on("error", () => {});
    return Object.assign(req, {
      end(body: string) {
        queueMicrotask(() => {
          if (signal?.aborted) return;
          callback(response);
          onRequest(url, options, body, response);
        });
      },
    });
  }) as never;
}

test("public-DoH model transport pins a validated IPv4 while preserving provider hostname, TLS and original endpoint path", async () => {
  let calls = 0;
  let resolved = 0;
  const transport = createDeepSeekTransport({
    resolver: async (host, options) => {
      resolved++;
      assert.equal(host, "api.deepseek.com");
      assert.deepEqual(options, { all: true, verbatim: true });
      return publicAddresses;
    },
    request: fakeRequest((url, options, body, response) => {
      calls++;
      assert.equal(url.href, "https://api.deepseek.com/v1/chat/completions");
      assert.equal(options.method, "POST");
      assert.equal(options.agent, false);
      assert.equal(options.servername, "api.deepseek.com");
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.checkServerIdentity, undefined);
      assert.deepEqual(options.headers, {
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        Authorization: "Bearer mock-private-key",
      });
      assert.equal(body, "{}");
      const lookup = options.lookup as (
        host: string,
        opts: { all?: boolean },
        callback: (...args: unknown[]) => void,
      ) => void;
      lookup("api.deepseek.com", { all: true }, (...args) =>
        assert.deepEqual(args, [null, [{ address: "8.8.8.8", family: 4 }]]),
      );
      lookup("api.deepseek.com", {}, (...args) =>
        assert.deepEqual(args, [null, "8.8.8.8", 4]),
      );
      response.end('{"ok":true}');
    }),
  });
  const response = await transport(
    "https://api.deepseek.com/v1/chat/completions",
    init(),
  );
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.status, 200);
  assert.equal(resolved, 1);
  assert.equal(calls, 1);
});

test("unsafe endpoints and invalid transport controls fail before DNS or sending credentials", async () => {
  let resolutions = 0;
  const transport = createDeepSeekTransport({
    resolver: async () => {
      resolutions++;
      return publicAddresses;
    },
    request: (() => {
      throw new Error("must not connect");
    }) as never,
  });
  for (const url of [
    "http://api.deepseek.com/chat/completions",
    "https://api.deepseek.com.evil.test/chat/completions",
    "https://user@api.deepseek.com/chat/completions",
    "https://api.deepseek.com:8443/chat/completions",
    "https://127.0.0.1/chat/completions",
    "https://api.deepseek.com/chat/completions?q=1",
    "https://api.deepseek.com/models",
  ])
    await assert.rejects(transport(url, init()), {
      code: "UNSAFE_PROVIDER_ENDPOINT",
    });
  for (const overrides of [
    { method: "GET" },
    { redirect: "follow" },
    { signal: null },
    { body: "a".repeat(B.requestBytes + 1) },
  ])
    await assert.rejects(
      transport(endpoint, { ...init(), ...overrides } as RequestInit),
      {
        code: "PROVIDER_INVALID_REQUEST",
      },
    );
  assert.equal(resolutions, 0);
});

test("all DNS answers must be public; mixed Fake-IP or IPv6 cannot bypass the shared guard", async () => {
  let requests = 0;
  for (const addresses of [
    [],
    [...publicAddresses, { address: "198.18.0.1", family: 4 }],
    [...publicAddresses, { address: "::1", family: 6 }],
  ]) {
    const transport = createDeepSeekTransport({
      resolver: async () => addresses,
      request: (() => {
        requests++;
        throw new Error("must not connect");
      }) as never,
    });
    await assert.rejects(transport(endpoint, init()), {
      code: "PROVIDER_DNS_UNAVAILABLE",
    });
  }
  assert.equal(requests, 0);
});

test("abort during DNS settles immediately and a late resolution never sends a model request", async () => {
  let finish!: (addresses: typeof publicAddresses) => void;
  let requests = 0;
  const controller = new AbortController();
  const transport = createDeepSeekTransport({
    resolver: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    request: (() => {
      requests++;
      throw new Error("must not connect");
    }) as never,
  });
  const pending = transport(endpoint, init(controller.signal));
  controller.abort();
  await assert.rejects(pending, { code: "MODEL_TIMEOUT" });
  finish(publicAddresses);
  await Promise.resolve();
  assert.equal(requests, 0);
  await assert.rejects(transport(endpoint, init(controller.signal)), {
    code: "MODEL_TIMEOUT",
  });
});

test("native model transport never follows a redirect or accepts a compressed response", async () => {
  for (const [status, headers, code] of [
    [
      302,
      { location: "https://evil.test/", "content-type": "text/plain" },
      "PROVIDER_UNAVAILABLE",
    ],
    [
      200,
      { "content-encoding": "gzip", "content-type": "application/json" },
      "INVALID_RESPONSE",
    ],
  ] as const) {
    let calls = 0;
    const transport = createDeepSeekTransport({
      resolver: async () => publicAddresses,
      request: fakeRequest(
        (_url, _options, _body, response) => {
          calls++;
          assert.equal(response.destroyed, true);
        },
        status,
        headers,
      ),
    });
    await assert.rejects(transport(endpoint, init()), { code });
    assert.equal(calls, 1);
  }
});

test("public-DoH transport preserves HTTP classification and streams final content without exposing reasoning", async () => {
  let errorBody: FakeResponse | undefined;
  const deniedTransport = createDeepSeekTransport({
    resolver: async () => publicAddresses,
    request: fakeRequest((_url, _opts, _body, response) => {
      errorBody = response;
      response.write("private upstream details");
    }, 402),
  });
  const denied = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock-private-key",
    fetch: deniedTransport,
    dnsMode: "public-doh",
  });
  await assert.rejects(denied.complete([]), {
    code: "PROVIDER_BALANCE_INSUFFICIENT",
  });
  assert.equal(errorBody?.destroyed, true);
  const transport = createDeepSeekTransport({
    resolver: async () => publicAddresses,
    request: fakeRequest(
      (_url, _opts, _body, response) => {
        response.write(
          'data: {"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"reasoning_content":"private thought"},"finish_reason":null}]}\n\n',
        );
        queueMicrotask(() =>
          response.end(
            'data: {"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"完成"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":5}}\n\ndata: [DONE]\n\n',
          ),
        );
      },
      200,
      { "content-type": "text/event-stream" },
    ),
  });
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock-private-key",
    fetch: transport,
  });
  const reply = await adapter.complete([], {
    model: "deepseek-v4-pro",
    thinking: true,
  });
  assert.deepEqual(reply, {
    model: "deepseek-v4-pro",
    content: "完成",
    inputTokens: 1,
    outputTokens: 5,
  });
});

test("valid 40k-character Chinese research prompts fit the transport byte bound; larger model inputs still fail", async () => {
  let sentBytes = 0;
  const transport = createDeepSeekTransport({
    resolver: async () => publicAddresses,
    request: fakeRequest(
      (_url, _opts, body, response) => {
        sentBytes = Buffer.byteLength(body);
        response.end(
          'data: {"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"完成"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\ndata: [DONE]\n\n',
        );
      },
      200,
      { "content-type": "text/event-stream" },
    ),
  });
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: transport,
  });
  const messages = [
    { role: "user" as const, content: "中".repeat(B.thinkingChars - 50) },
  ];
  assert.ok(JSON.stringify(messages).length < B.thinkingChars);
  await adapter.complete(messages, {
    model: "deepseek-v4-pro",
    thinking: true,
  });
  assert.ok(sentBytes > 65536 && sentBytes < B.requestBytes);
  await assert.rejects(
    adapter.complete(
      [{ role: "user", content: "中".repeat(B.thinkingChars + 1) }],
      {
        thinking: true,
      },
    ),
    { code: "EVIDENCE_TOO_LARGE" },
  );
});

test("native response abort stays within the adapter total timeout and does not retry", async () => {
  let calls = 0;
  let response: FakeResponse | undefined;
  const transport = createDeepSeekTransport({
    resolver: async () => publicAddresses,
    request: fakeRequest(
      (_url, _options, _body, incoming) => {
        calls++;
        response = incoming;
        incoming.write(": keepalive\n\n");
      },
      200,
      { "content-type": "text/event-stream" },
    ),
  });
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: transport,
  });
  await assert.rejects(
    adapter.complete([], { thinking: true, timeoutMs: 10 }),
    { code: "MODEL_TIMEOUT" },
  );
  assert.equal(calls, 1);
  assert.equal(response?.destroyed, true);
});

test("one DNS retry can recover without repeating the model POST; DNS and TLS errors stay distinct", async () => {
  let resolutions = 0,
    posts = 0;
  const recovered = createDeepSeekTransport({
    resolver: async () => {
      if (++resolutions === 1) throw new ModelError("WEB_DNS_UNAVAILABLE");
      return publicAddresses;
    },
    request: fakeRequest((_url, _opts, _body, response) => {
      posts++;
      response.end("{}");
    }),
  });
  await (await recovered(endpoint, init())).text();
  assert.equal(resolutions, 2);
  assert.equal(posts, 1);
  for (const code of ["WEB_DNS_UNAVAILABLE", "WEB_DNS_TIMEOUT"]) {
    resolutions = 0;
    const failed = createDeepSeekTransport({
      resolver: async () => {
        resolutions++;
        throw new ModelError(code);
      },
      request: (() => {
        posts++;
        throw new Error("must not POST");
      }) as never,
    });
    await assert.rejects(failed(endpoint, init()), {
      code: "PROVIDER_DNS_UNAVAILABLE",
    });
    assert.equal(resolutions, 2);
    assert.equal(posts, 1);
  }
  const tls = createDeepSeekTransport({
    resolver: async () => publicAddresses,
    request: (() => {
      const req = new EventEmitter();
      return Object.assign(req, {
        end() {
          posts++;
          queueMicrotask(() =>
            req.emit("error", new Error("private TLS details")),
          );
        },
      });
    }) as never,
  });
  await assert.rejects(tls(endpoint, init()), {
    code: "PROVIDER_NETWORK_ERROR",
  });
  assert.equal(posts, 2);
});
