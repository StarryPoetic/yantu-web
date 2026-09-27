import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import { createWebAnswerModule } from "../../server/explanation/web.ts";
import { searchResearchSources } from "../../server/explanation/research-search.ts";

test("research discovers official school domains before narrowing, ranks graduate sources and shares a bounded budget", async () => {
  const requests: Record<string, unknown>[] = [];
  const disciplines = getDisciplineCatalog().items.filter((item) =>
    ["0401", "0503", "0712"].includes(item.code),
  );
  const web = createWebAnswerModule({
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "test-only",
    searchDailyRequestsPerUser: 6,
    reader: async (_url, options) => {
      const request = JSON.parse(options.body!);
      requests.push(request);
      const discipline = disciplines.find((item) =>
        request.query.includes(item.name),
      )!;
      const host = `school${discipline.code}.edu.cn`;
      const hit = (path: string, name: string) => ({
        name,
        url: `https://grad.${host}/${path}`,
        summary: `${discipline.code} ${discipline.name} 硕士培养方案`,
      });
      return {
        contentType: "application/json",
        text: JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: [
                {
                  name: "培训报名",
                  url: "https://training.example.org/course",
                  summary: discipline.name,
                },
                hit("BS/catalog", "博士研究生招生目录"),
                hit("bkjx/intro", "本科专业介绍"),
                hit("master/intro", `${discipline.name}硕士培养方案`),
                ...Array.from({ length: 6 }, (_, index) =>
                  hit(
                    `master/${request.include ? "target" : "discover"}/${index}`,
                    `${discipline.name}硕士专业介绍`,
                  ),
                ),
              ],
            },
          },
        }),
      };
    },
  });
  let updates = 0;
  const result = await searchResearchSources({
    web,
    subjectId: "synthetic",
    disciplines,
    regions: ["上海", "杭州"],
    onProgress: async () => {
      updates++;
    },
  });
  assert.equal(requests.length, 6);
  assert.equal(updates, 12);
  assert.ok(
    requests.every(
      (request) =>
        request.count === 10 && !String(request.query).includes("site:"),
    ),
  );
  assert.ok(
    requests.slice(0, 3).every((request) => request.include === undefined),
  );
  assert.deepEqual(
    requests.slice(3).map((request) => request.include),
    disciplines.map((item) => `school${item.code}.edu.cn`),
  );
  assert.equal(result.sources.length, 12);
  assert.equal(new Set(result.sources.map((item) => item.url)).size, 12);
  assert.ok(result.sources.every((source) => source.url.includes("/master/")));
  assert.deepEqual(
    result.sources
      .slice(0, 3)
      .map((source) => result.sourceDirections.get(source.id)),
    disciplines.map((item) => item.code),
  );
  assert.equal(result.searched, true);
  assert.equal(
    (
      await web.answer({
        subjectId: "synthetic",
        question: "不能额外调用",
        search: true,
      })
    ).reason,
    "SEARCH_BUDGET_EXHAUSTED",
  );
});

test("missing official domains use a bounded alternate-city query and cancellation stops subsequent requests", async () => {
  const discipline = getDisciplineCatalog().items.find(
    (item) => item.code === "0401",
  )!;
  const questions: string[] = [];
  const web = createWebAnswerModule({
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "test-only",
    reader: async (_url, options) => {
      const body = JSON.parse(options.body!);
      questions.push(body.query);
      assert.equal(body.include, undefined);
      return {
        contentType: "application/json",
        text: JSON.stringify({ code: 200, data: { webPages: { value: [] } } }),
      };
    },
  });
  const input = {
    web,
    subjectId: "synthetic",
    disciplines: [discipline],
    regions: ["上海", "杭州"],
    onProgress: async () => {},
  };
  const result = await searchResearchSources(input);
  assert.equal(questions.length, 2);
  assert.match(questions[0], /^上海 /);
  assert.match(questions[1], /^杭州 /);
  assert.equal(result.sources.length, 0);
  await assert.rejects(
    searchResearchSources({
      ...input,
      onProgress: async () => {
        throw new Error("cancelled");
      },
    }),
    /cancelled/,
  );
  assert.equal(questions.length, 2);
});

test("model school hints guide retrieval but never create evidence or recommendations", async () => {
  const discipline = getDisciplineCatalog().items.find(
    (item) => item.code === "0401",
  )!;
  const queries: string[] = [];
  const web = createWebAnswerModule({
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "test-only",
    reader: async (_url, options) => {
      queries.push(JSON.parse(options.body!).query);
      return {
        contentType: "application/json",
        text: JSON.stringify({ code: 200, data: { webPages: { value: [] } } }),
      };
    },
  });
  const result = await searchResearchSources({
    web,
    subjectId: "synthetic",
    disciplines: [discipline],
    regions: ["上海"],
    schoolHints: new Map([[discipline.code, ["甲师范大学", "乙师范大学"]]]),
    onProgress: async () => {},
  });
  assert.equal(queries[0], "甲师范大学 官网");
  assert.match(queries[1], /^乙师范大学 教育学 硕士/);
  assert.deepEqual(result.sources, []);
  assert.equal(result.sourceDirections.size, 0);
});

test("a mentioned official domain is only a search clue, not a fetched URL or invented source", async () => {
  const discipline = getDisciplineCatalog().items.find(
    (item) => item.code === "0712",
  )!;
  const requests: Record<string, unknown>[] = [];
  const web = createWebAnswerModule({
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "test-only",
    reader: async (url, options) => {
      assert.equal(new URL(url).hostname, "api.bocha.cn");
      requests.push(JSON.parse(options.body!));
      return {
        contentType: "application/json",
        text: JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value:
                requests.length === 1
                  ? [
                      {
                        name: "甲大学官网 http://www.first.edu.cn/",
                        url: "https://directory.example.org/school",
                        summary:
                          "甲大学官网地址 www.first.edu.cn；localhost 不是学校地址。",
                      },
                    ]
                  : [],
            },
          },
        }),
      };
    },
  });
  const result = await searchResearchSources({
    web,
    subjectId: "synthetic",
    disciplines: [discipline],
    regions: [],
    schoolHints: new Map([[discipline.code, ["甲大学"]]]),
    onProgress: async () => {},
  });
  assert.equal(requests[1].include, "first.edu.cn");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://directory.example.org/school");
  assert.equal(result.sources[0].kind, "search_snippet");
});
