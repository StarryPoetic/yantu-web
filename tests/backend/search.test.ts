import test from "node:test";
import assert from "node:assert/strict";
import { createWebAnswerModule } from "../../server/explanation/web.ts";
import type { WebReader } from "../../server/explanation/web.ts";
import {
  createSearchBudget,
  normalizeSearchResponse,
  searchConfigFromEnvironment,
  searchRequest,
} from "../../server/explanation/search.ts";

const input = {
  subjectId: "student-a",
  question: "法学硕士招生条件",
  search: true,
};
const bochaResults = (value: unknown[]) => ({
  code: 200,
  data: { webPages: { value } },
});
const hit = {
  name: "招生通知",
  url: "https://law.example.edu.cn/notice",
  snippet: "招生简章片段",
  summary: "请核对当年官方招生条件。",
};

test("application defaults to Bocha and resolves only the selected provider credential", () => {
  const env = {
    YANTU_SEARCH_ENABLED: "true",
    BOCHA_API_KEY: "bocha-test-secret",
    BRAVE_SEARCH_API_KEY: "brave-test-secret",
  };
  const primary = searchConfigFromEnvironment(env);
  assert.equal(primary.searchProvider, "bocha");
  assert.equal(primary.searchKey, env.BOCHA_API_KEY);
  assert.equal(
    searchConfigFromEnvironment({
      YANTU_SEARCH_ENABLED: "true",
      BRAVE_SEARCH_API_KEY: "unused",
    }).searchKey,
    undefined,
  );
  const legacy = searchConfigFromEnvironment({
    ...env,
    YANTU_SEARCH_PROVIDER: "brave",
  });
  assert.equal(legacy.searchKey, env.BRAVE_SEARCH_API_KEY);
  assert.equal(
    searchConfigFromEnvironment({
      YANTU_SEARCH_PROVIDER: "brave",
      BOCHA_API_KEY: "unused",
    }).searchKey,
    undefined,
  );
  assert.throws(
    () => searchConfigFromEnvironment({ YANTU_SEARCH_PROVIDER: "untrusted" }),
    { code: "SEARCH_PROVIDER_INVALID" },
  );
  for (const config of [primary, legacy]) {
    const request = searchRequest(
      config.searchProvider!,
      config.searchKey!,
      input.question,
    );
    const encoded = JSON.stringify(request);
    assert.ok(encoded.includes(config.searchKey!));
    assert.ok(
      !encoded.includes(
        config.searchProvider === "bocha"
          ? env.BRAVE_SEARCH_API_KEY
          : env.BOCHA_API_KEY,
      ),
    );
    assert.equal(new URL(request.url).protocol, "https:");
    assert.deepEqual(request.options.allowedHosts, [
      new URL(request.url).hostname,
    ]);
  }
});

test("Bocha sends fixed POST JSON and bearer key, normalizes summaries, filters unsafe links without fetching results", async () => {
  const requests: Array<{ url: string; options: Parameters<WebReader>[1] }> =
    [];
  const module = createWebAnswerModule({
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "bocha-test-secret",
    reader: async (url, options) => {
      requests.push({ url, options });
      return {
        contentType: "application/json",
        text: JSON.stringify(
          bochaResults([
            hit,
            {
              ...hit,
              name: "备用片段",
              summary: "",
              url: "https://grad.example.edu.cn/",
            },
            { ...hit, url: "https://127.0.0.1/" },
            { ...hit, url: "javascript:alert(1)" },
            { ...hit, url: "not a url" },
          ]),
        ),
      };
    },
  });
  const result = await module.answer(input, { sourcesOnly: true });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, "https://api.bocha.cn/v1/web-search");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(request.options.allowedHosts, ["api.bocha.cn"]);
  assert.equal(
    request.options.headers?.Authorization,
    "Bearer bocha-test-secret",
  );
  assert.equal(request.options.headers?.["X-Subscription-Token"], undefined);
  assert.equal(request.options.headers?.["Content-Type"], "application/json");
  assert.equal(request.options.maxBytes, 100000);
  assert.deepEqual(JSON.parse(request.options.body!), {
    query: input.question,
    freshness: "noLimit",
    summary: true,
    count: 5,
  });
  assert.equal(result.searched, true);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].excerpt, hit.summary);
  assert.equal(result.sources[1].excerpt, hit.snippet);
  assert.ok(
    result.sources.every(
      (source) => source.kind === "search_snippet" && !source.verified,
    ),
  );
  assert.equal(JSON.stringify(result).includes("bocha-test-secret"), false);
});

test("Bocha business failures and malformed responses never report successful search or fall back to Brave", async () => {
  assert.equal(
    normalizeSearchResponse(
      "bocha",
      JSON.stringify({ ...bochaResults([hit]), code: "200" }),
    ).length,
    1,
  );
  for (const response of [
    {
      code: 500,
      message: "private vendor details",
      data: { webPages: { value: [hit] } },
    },
    { code: 403 },
    { code: "403" },
    { code: 200, data: {} },
    { code: 200, data: { webPages: { value: {} } } },
    null,
    "invalid JSON",
  ]) {
    const calls: string[] = [];
    const module = createWebAnswerModule({
      searchEnabled: true,
      searchProvider: "bocha",
      searchKey: "test-key",
      reader: async (url) => {
        calls.push(url);
        return {
          contentType: "application/json",
          text:
            typeof response === "string" ? response : JSON.stringify(response),
        };
      },
    });
    const result = await module.answer(input);
    assert.equal(result.searched, false);
    assert.equal(result.sources.length, 0);
    assert.equal(result.status, "unavailable");
    assert.match(result.reason!, /^SEARCH_(PROVIDER_ERROR|INVALID_RESPONSE)$/);
    assert.equal(calls.length, 1);
    assert.ok(calls.every((url) => new URL(url).hostname === "api.bocha.cn"));
    assert.equal(
      JSON.stringify(result).includes("private vendor details"),
      false,
    );
  }
});

test("disabled, missing selected key and zero budget prevent Bocha requests", async () => {
  let calls = 0;
  for (const [config, reason] of [
    [{ searchEnabled: false, searchKey: "configured" }, "SEARCH_DISABLED"],
    [
      searchConfigFromEnvironment({
        YANTU_SEARCH_ENABLED: "true",
        BRAVE_SEARCH_API_KEY: "wrong-provider",
      }),
      "SEARCH_NOT_CONFIGURED",
    ],
    [
      {
        searchEnabled: true,
        searchKey: "configured",
        searchDailyRequestsPerUser: 0,
      },
      "SEARCH_BUDGET_EXHAUSTED",
    ],
  ] as const) {
    const module = createWebAnswerModule({
      ...config,
      searchProvider: "bocha",
      reader: async () => {
        calls++;
        throw new Error("must not request");
      },
    });
    const result = await module.answer(input);
    assert.equal(result.reason, reason);
    assert.equal(result.searched, false);
  }
  assert.equal(calls, 0);
});

test("shared search ledger counts failed sends across consumers/providers, survives clear and resets next UTC day", async () => {
  let time = Date.parse("2026-09-27T10:00:00Z"),
    calls = 0;
  const budget = createSearchBudget({
    searchDailyRequestsPerUser: 1,
    searchDailyRequestsGlobal: 2,
  });
  const reader: WebReader = async () => {
    calls++;
    throw new Error("upstream failure");
  };
  const common = {
    searchEnabled: true,
    searchKey: "test",
    searchBudget: budget,
    now: () => time,
    reader,
  };
  const bocha = createWebAnswerModule({ ...common, searchProvider: "bocha" });
  const brave = createWebAnswerModule({ ...common, searchProvider: "brave" });
  assert.equal((await bocha.answer(input)).reason, "SEARCH_UNAVAILABLE");
  bocha.clearSubject(input.subjectId);
  assert.equal((await brave.answer(input)).reason, "SEARCH_BUDGET_EXHAUSTED");
  assert.equal(calls, 1);
  await brave.answer({ ...input, subjectId: "student-b" });
  assert.equal(
    (await bocha.answer({ ...input, subjectId: "student-c" })).reason,
    "SEARCH_BUDGET_EXHAUSTED",
  );
  assert.equal(calls, 2);
  time += 24 * 60 * 60 * 1000;
  assert.equal((await bocha.answer(input)).reason, "SEARCH_UNAVAILABLE");
  assert.equal(calls, 3);
  for (const limit of [-1, NaN, Infinity, 1.5])
    assert.throws(
      () => createSearchBudget({ searchDailyRequestsGlobal: limit }),
      { code: "INVALID_BUDGET_CONFIG" },
    );
});
