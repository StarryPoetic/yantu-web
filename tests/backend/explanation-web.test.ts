import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createHttpsReader,
  createWebAnswerModule,
  isPublicAddress,
  resolvePublicAddress,
  validateOutboundUrl,
} from "../../server/explanation/web.ts";
import { ModelError } from "../../server/explanation/index.ts";
import type { WebReader } from "../../server/explanation/web.ts";

test("HTTPS official host allowlist denies internal, credentials, nonstandard ports and deceptive hosts", () => {
  const hosts = ["yz.chsi.com.cn"];
  for (const url of [
    "http://yz.chsi.com.cn/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "file:///etc/passwd",
    "https://yz.chsi.com.cn.evil.test/",
    "https://secret@yz.chsi.com.cn/",
    "https://yz.chsi.com.cn:8080/",
    "https://yz.chsi.com.cn./",
  ])
    assert.throws(() => validateOutboundUrl(url, hosts), ModelError);
  assert.equal(
    validateOutboundUrl("https://yz.chsi.com.cn/page#x", hosts).href,
    "https://yz.chsi.com.cn/page",
  );
});

test("all DNS answers must be global; mixed/private/rebinding candidates cannot connect", async () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.1.1",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.20.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.19.0.1",
    "224.1.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700::1111"), true);
  await assert.rejects(
    resolvePublicAddress("yz.chsi.com.cn", (async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]) as never),
    (error: unknown) =>
      error instanceof ModelError && error.code === "WEB_ADDRESS_BLOCKED",
  );
  assert.deepEqual(
    await resolvePublicAddress("yz.chsi.com.cn", (async () => [
      { address: "8.8.8.8", family: 4 },
    ]) as never),
    { address: "8.8.8.8", family: 4 },
  );
});

test("HTTPS transport pins validated DNS address and enforces redirect, MIME, byte and total time limits", async () => {
  let calls = 0;
  let captured: Record<string, unknown> = {};
  let mode = "ok";
  const reader = createHttpsReader({
    resolver: (async () => [{ address: "8.8.8.8", family: 4 }]) as never,
    get: ((
      _url: URL,
      options: Record<string, unknown>,
      callback: (
        response: EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          destroy(): void;
        },
      ) => void,
    ) => {
      calls += 1;
      captured = options;
      const request = Object.assign(new EventEmitter(), { destroy() {} });
      const response = Object.assign(new EventEmitter(), {
        statusCode: mode === "redirect" ? 302 : 200,
        headers: {
          "content-type": mode === "pdf" ? "application/pdf" : "text/html",
        },
        destroy() {},
      });
      queueMicrotask(() => {
        callback(response);
        if (mode !== "timeout") {
          response.emit(
            "data",
            Buffer.from(mode === "large" ? "x".repeat(30) : "hello"),
          );
          response.emit("end");
        }
      });
      return request;
    }) as never,
  });
  assert.equal(
    (
      await reader("https://yz.chsi.com.cn/", {
        allowedHosts: ["yz.chsi.com.cn"],
      })
    ).text,
    "hello",
  );
  assert.equal(captured.servername, "yz.chsi.com.cn");
  assert.equal(captured.agent, false);
  const pinnedLookup = captured.lookup as (
    hostname: string,
    options: { all: boolean },
    callback: (error: null, addresses: unknown) => void,
  ) => void;
  pinnedLookup("yz.chsi.com.cn", { all: true }, (_error, addresses) =>
    assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]),
  );
  for (const [nextMode, code] of [
    ["redirect", "WEB_REDIRECT_BLOCKED"],
    ["pdf", "WEB_FORMAT_UNSUPPORTED"],
    ["large", "WEB_TOO_LARGE"],
    ["timeout", "WEB_TIMEOUT"],
  ]) {
    mode = nextMode;
    await assert.rejects(
      reader("https://yz.chsi.com.cn/", {
        allowedHosts: ["yz.chsi.com.cn"],
        timeoutMs: 5,
        maxBytes: 10,
      }),
      (error: unknown) => error instanceof ModelError && error.code === code,
    );
  }
  assert.equal(calls, 5);
});

test("search off/unconfigured transparently yields no web evidence and makes no request", async () => {
  let calls = 0;
  const module = createWebAnswerModule({
    reader: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
  });
  const response = await module.answer({
    subjectId: "a",
    question: "今年报考条件是什么？",
    search: true,
  });
  assert.equal(response.status, "unavailable");
  assert.equal(response.searched, false);
  assert.equal(response.reason, "SEARCH_DISABLED");
  assert.equal(calls, 0);
  const unconfigured = await createWebAnswerModule({
    searchEnabled: true,
  }).answer({ subjectId: "a", question: "报考条件", search: true });
  assert.equal(unconfigured.reason, "SEARCH_NOT_CONFIGURED");
});

test("explicit page evidence is text-only with retrieval time; it cannot expose hidden question data", async () => {
  const module = createWebAnswerModule({
    reader: async () => ({
      text: "<title>官方招生通知</title><script>steal secrets</script><p>报名条件请以当年招生简章为准。</p>",
      contentType: "text/html",
    }),
  });
  const result = await module.answer({
    subjectId: "a",
    question: "怎么查看报考条件？",
    urls: ["https://yz.chsi.com.cn/notice"],
  });
  assert.equal(result.status, "sources_only");
  assert.equal(result.sources[0].verified, false);
  assert.equal(result.sources[0].kind, "official_page");
  assert.ok(result.sources[0].retrievedAt);
  assert.equal(result.sources[0].excerpt.includes("steal secrets"), false);
  const blocked = await module.answer({
    subjectId: "a",
    question: "question",
    urls: ["https://localhost/secret"],
  });
  assert.equal(blocked.sources.length, 0);
  assert.equal(blocked.reason, "WEB_HOST_NOT_ALLOWED");
});

test("search calls one fixed provider and keeps snippets display-only with server key scoped to provider", async () => {
  const requests: Array<{ url: string; options: Parameters<WebReader>[1] }> =
    [];
  const module = createWebAnswerModule({
    searchEnabled: true,
    searchKey: "test-search-key",
    searchDailyRequestsPerUser: 1,
    reader: async (url, options) => {
      requests.push({ url, options });
      return {
        text: JSON.stringify({
          web: {
            results: [
              {
                title: "相关资料",
                url: "https://example.edu.cn/notice",
                description: "请按当年招生章程确认报考条件。",
              },
            ],
          },
        }),
        contentType: "application/json",
      };
    },
  });
  const result = await module.answer({
    subjectId: "a",
    question: "报考条件",
    search: true,
  });
  assert.equal(result.searched, true);
  assert.equal(result.sources.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).hostname, "api.search.brave.com");
  assert.equal(
    requests[0].options.headers?.["X-Subscription-Token"],
    "test-search-key",
  );
  assert.equal(result.sources[0].kind, "search_snippet");
  assert.equal(JSON.stringify(result).includes("test-search-key"), false);
  const limited = await module.answer({
    subjectId: "a",
    question: "再次搜索",
    search: true,
  });
  assert.equal(limited.reason, "SEARCH_BUDGET_EXHAUSTED");
  assert.equal(requests.length, 1);
});

test("web model may select only exact source excerpts with matching citations; invented facts fall back", async () => {
  const excerpt = "报名条件请以当年招生简章为准。";
  const reader: WebReader = async () => ({
    text: excerpt,
    contentType: "text/plain",
  });
  for (const bad of [false, true]) {
    const module = createWebAnswerModule({
      enabled: true,
      reader,
      adapter: {
        async complete() {
          return {
            model: "deepseek-flash",
            inputTokens: 1,
            outputTokens: 1,
            content: JSON.stringify({
              points: [
                {
                  text: bad ? "录取概率保证百分之百。" : excerpt,
                  citations: ["web-1"],
                },
              ],
            }),
          };
        },
      },
    });
    const result = await module.answer({
      subjectId: "a",
      question: "报名条件？",
      urls: ["https://yz.chsi.com.cn/notice"],
    });
    assert.equal(result.status, bad ? "sources_only" : "answered");
    if (bad) {
      assert.equal(result.reason, "CITATION_VALIDATION_FAILED");
      assert.equal(result.points.length, 0);
    } else
      assert.deepEqual(result.points, [
        { text: excerpt, citations: ["web-1"] },
      ]);
  }
});

test("deletion while web retrieval runs cannot return or persist private question context", async () => {
  let complete!: (value: { text: string; contentType: string }) => void;
  const module = createWebAnswerModule({
    reader: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const pending = module.answer({
    subjectId: "a",
    question: "私人问题",
    urls: ["https://yz.chsi.com.cn/notice"],
  });
  module.clearSubject("a");
  complete({ text: "示例资料", contentType: "text/plain" });
  await assert.rejects(pending, /删除/);
});
