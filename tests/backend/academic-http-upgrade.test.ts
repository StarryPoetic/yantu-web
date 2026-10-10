import test from "node:test";
import assert from "node:assert/strict";
import {
  createHttpsReader,
  createWebAnswerModule,
} from "../../server/explanation/web.ts";
import type {
  WebAnswerInput,
  WebAnswerOptions,
} from "../../server/explanation/web.ts";
import { ModelError } from "../../server/explanation/index.ts";

function searchFixture(urls: string[]) {
  const requests: string[] = [];
  const module = createWebAnswerModule({
    searchEnabled: true,
    searchKey: "mock-search-key",
    reader: async (url) => {
      requests.push(url);
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: urls.map((url) => ({
              url,
              title: "学校硕士专业资料",
              description: "此摘要仍待官网原文核验。",
            })),
          },
        }),
      };
    },
  });
  return { module, requests };
}
const input: WebAnswerInput = {
  subjectId: "research-test",
  question: "教育学 硕士 培养",
  search: true,
};
const researchOptions: WebAnswerOptions = {
  sourcesOnly: true,
  upgradeAcademicHttp: true,
  search: { count: 10 },
};

test("only research opt-in retains original academic HTTP search URLs as unread candidates", async () => {
  const { module, requests } = searchFixture([
    "http://YJS.example.edu.cn/path/program.pdf?year=2027&form=full#major",
    "https://other.example.edu.cn/program",
  ]);
  const result = await module.answer(input, researchOptions);
  assert.equal(result.sources.length, 2);
  assert.equal(
    result.sources[0].url,
    "http://yjs.example.edu.cn/path/program.pdf?year=2027&form=full#major",
  );
  assert.match(result.sources[0].retrievalNote ?? "", /HTTP.*明文.*尚未/);
  assert.equal(result.sources[0].kind, "search_snippet");
  assert.equal(result.sources[0].verified, false);
  assert.equal(result.sources[1].retrievalNote, undefined);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]).hostname, "api.search.brave.com");
  assert.ok(requests.every((url) => url.startsWith("https://")));
});

test("ordinary chat and public request fields cannot enable HTTP normalization", async () => {
  const { module, requests } = searchFixture(["http://example.edu.cn/program"]);
  const injected = { ...input, upgradeAcademicHttp: true };
  assert.equal((await module.answer(injected)).sources.length, 0);
  assert.equal(
    (await module.answer(input, { sourcesOnly: true })).sources.length,
    0,
  );
  const explicit = await module.answer(
    { ...input, search: false, urls: ["http://example.edu.cn/program"] },
    researchOptions,
  );
  assert.equal(explicit.reason, "WEB_HOST_NOT_ALLOWED");
  assert.equal(requests.length, 2);
});

test("academic upgrade rejects credentials, explicit ports, IPs and ambiguous or unrelated hosts", async () => {
  for (const url of [
    "http://example.edu.cn:80/program",
    "http://example.edu.cn:443/program",
    "http://example.edu.cn:8080/program",
    "http://user:password@example.edu.cn/program",
    "http://@example.edu.cn/program",
    "http://127.0.0.1/program",
    "http://[::1]/program",
    "http://example.com/program",
    "http://edu.cn/program",
    "http://example.edu.cn.evil.test/program",
    "http://example.edu.cn./program",
    "http://example..edu.cn/program",
    "http://example.edu.cn\\@evil.test/program",
    "http://exam\tple.edu.cn/program",
    "http://%65xample.edu.cn/program",
    " http://example.edu.cn/program",
    `http://example.edu.cn/${"a".repeat(2048)}`,
  ]) {
    const { module, requests } = searchFixture([url]);
    assert.equal(
      (await module.answer(input, researchOptions)).sources.length,
      0,
      url,
    );
    assert.equal(requests.length, 1);
    assert.ok(requests.every((request) => request.startsWith("https://")));
  }
});

test("invalid internal upgrade options fail before reserving or requesting search", async () => {
  const { module, requests } = searchFixture(["http://example.edu.cn/program"]);
  for (const options of [
    { upgradeAcademicHttp: true },
    { sourcesOnly: false, upgradeAcademicHttp: true },
    { sourcesOnly: true, upgradeAcademicHttp: "true" },
  ])
    await assert.rejects(
      module.answer(input, options as WebAnswerOptions),
      (error: unknown) =>
        error instanceof ModelError && error.code === "SEARCH_OPTIONS_INVALID",
    );
  assert.equal(requests.length, 0);
});

test("retained HTTP search URLs still require research opt-in, approved host and every DNS answer to be public", async () => {
  const { module } = searchFixture(["http://example.edu.cn/program"]);
  const source = (await module.answer(input, researchOptions)).sources[0];
  let connections = 0;
  const reader = createHttpsReader({
    resolver: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    request: (() => {
      connections += 1;
      throw new Error("must not connect");
    }) as never,
  });
  await assert.rejects(
    reader(source.url, { allowedHosts: [] }),
    (error: unknown) =>
      error instanceof ModelError && error.code === "WEB_HOST_NOT_ALLOWED",
  );
  await assert.rejects(
    reader(source.url, { allowedHosts: ["example.edu.cn"], allowHttp: true }),
    (error: unknown) =>
      error instanceof ModelError && error.code === "WEB_ADDRESS_BLOCKED",
  );
  await assert.rejects(
    reader("http://example.edu.cn/program", {
      allowedHosts: ["example.edu.cn"],
    }),
    (error: unknown) =>
      error instanceof ModelError && error.code === "WEB_HOST_NOT_ALLOWED",
  );
  assert.equal(connections, 0);
});
