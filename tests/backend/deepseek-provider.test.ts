import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeepSeekAdapter,
  ModelError,
} from "../../server/explanation/deepseek.ts";
import { researchReason } from "../../shared/research-status.ts";

const statusCodes: [number, string][] = [
  [400, "PROVIDER_INVALID_REQUEST"],
  [401, "PROVIDER_AUTH_FAILED"],
  [402, "PROVIDER_BALANCE_INSUFFICIENT"],
  [403, "PROVIDER_AUTH_FAILED"],
  [404, "PROVIDER_UNAVAILABLE"],
  [408, "PROVIDER_UNAVAILABLE"],
  [422, "PROVIDER_INVALID_REQUEST"],
  [429, "RATE_LIMITED"],
  [500, "PROVIDER_TEMPORARY_UNAVAILABLE"],
  [502, "PROVIDER_TEMPORARY_UNAVAILABLE"],
  [503, "PROVIDER_TEMPORARY_UNAVAILABLE"],
  [504, "PROVIDER_TEMPORARY_UNAVAILABLE"],
  [501, "PROVIDER_UNAVAILABLE"],
];

test("collection cancellation aborts an in-flight provider request without sending its signal in JSON", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "offline-test",
    fetch: async (_url, init) => {
      assert.equal(
        Object.hasOwn(JSON.parse(String(init!.body)), "signal"),
        false,
      );
      started();
      return new Promise<Response>((_resolve, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      );
    },
  });
  const pending = adapter.complete([], { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof ModelError && error.code === "MODEL_TIMEOUT",
  );
});

test("DeepSeek HTTP errors are classified by status without reading or exposing provider bodies or retrying inside the adapter", async () => {
  for (const [status, code] of statusCodes) {
    let requests = 0;
    let cancelled = 0;
    const adapter = createDeepSeekAdapter({
      enabled: true,
      apiKey: "private-test-key",
      fetch: async () => {
        requests++;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  "private-test-key confidential upstream excerpt",
                ),
              );
            },
            cancel() {
              cancelled++;
            },
          }),
          { status },
        );
      },
    });
    await assert.rejects(
      adapter.complete([{ role: "user", content: "private request content" }]),
      (error: unknown) => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.code, code, String(status));
        assert.doesNotMatch(
          `${error.message} ${JSON.stringify(error)}`,
          /private|confidential/,
        );
        return true;
      },
    );
    assert.equal(requests, 1, `no hidden retry for HTTP ${status}`);
    assert.equal(cancelled, 1, `discard HTTP ${status} error body`);
  }
});

test("network failure, timed-out request and malformed successful response have distinct sanitized codes", async () => {
  const network = createDeepSeekAdapter({
    enabled: true,
    apiKey: "private-test-key",
    fetch: async () => {
      throw new TypeError("private-test-key socket failure");
    },
  });
  await assert.rejects(
    network.complete([]),
    (error: unknown) =>
      error instanceof ModelError &&
      error.code === "PROVIDER_NETWORK_ERROR" &&
      !error.message.includes("private"),
  );
  const timeout = createDeepSeekAdapter({
    enabled: true,
    apiKey: "private-test-key",
    timeoutMs: 5,
    fetch: async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new TypeError("private abort details")),
          { once: true },
        );
      }),
  });
  await assert.rejects(timeout.complete([]), { code: "MODEL_TIMEOUT" });
  for (const raw of ["<html>private error page</html>", "null", "[]", "42"]) {
    const invalid = createDeepSeekAdapter({
      enabled: true,
      apiKey: "private-test-key",
      fetch: async () => new Response(raw),
    });
    await assert.rejects(invalid.complete([]), { code: "INVALID_RESPONSE" });
  }
});

test("a broken successful response stream is a network failure and cannot be treated as a completed model reply", async () => {
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "private-test-key",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"choices":['));
          },
          pull(controller) {
            controller.error(new Error("private socket reset"));
          },
        }),
      ),
  });
  await assert.rejects(adapter.complete([]), {
    code: "PROVIDER_NETWORK_ERROR",
  });
});

test("provider failure copy explains infrastructure causes without blaming saved profile or exposing internal codes", () => {
  const expectations = [
    ["PROVIDER_BALANCE_INSUFFICIENT", /余额不足/],
    ["PROVIDER_INVALID_REQUEST", /格式或参数/],
    ["PROVIDER_AUTH_FAILED", /认证/],
    ["PROVIDER_TEMPORARY_UNAVAILABLE", /暂时故障/],
    ["PROVIDER_NETWORK_ERROR", /连接.*失败|断开/],
    ["PROVIDER_UNAVAILABLE", /模型服务/],
    ["INVALID_RESPONSE", /无法读取/],
    ["RESPONSE_TOO_LARGE", /响应.*上限/],
    ["INCOMPLETE_RESPONSE", /截断|未正常结束/],
    ["UNKNOWN_USAGE", /用量记录/],
  ] as const;
  for (const [code, expected] of expectations) {
    const message = researchReason(code);
    assert.match(message, expected);
    assert.doesNotMatch(message, /PROVIDER_|INVALID_|请补充画像|来源核对/);
  }
});
