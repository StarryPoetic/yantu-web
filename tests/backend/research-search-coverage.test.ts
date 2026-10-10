import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import { createWebAnswerModule } from "../../server/explanation/web.ts";
import {
  searchResearchSources,
  sourceHasSchoolIdentity,
} from "../../server/explanation/research-search.ts";
import { preferredCityCandidateLeads } from "../../server/explanation/research-candidates.ts";

const discipline = getDisciplineCatalog().items.find((d) => d.code === "0854")!;
type Hit = { name: string; url: string; summary: string };

function searchWeb(response: (query: string, include?: string) => Hit[]) {
  const requests: { query: string; include?: string }[] = [];
  const web = createWebAnswerModule({
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "test-only",
    searchDailyRequestsPerUser: 30,
    reader: async (url, options) => {
      assert.equal(new URL(url).hostname, "api.bocha.cn");
      const request = JSON.parse(options.body!);
      requests.push(request);
      return {
        contentType: "application/json",
        text: JSON.stringify({
          code: 200,
          data: {
            webPages: { value: response(request.query, request.include) },
          },
        }),
      };
    },
  });
  return { web, requests };
}

test("registry aliases scope every school-level search and seed URLs survive an indexing miss without changing search ceilings", async () => {
  const { web, requests } = searchWeb(() => []);
  const result = await searchResearchSources({
    web,
    subjectId: "alias-seeds",
    disciplines: [discipline],
    regions: ["西安"],
    schoolHints: new Map([[discipline.code, ["浙大"]]]),
    maxRequests: 18,
    maxSources: 40,
    includeFeeSearch: false,
    onProgress: async () => {},
  });
  const focused = requests.filter((r) => r.query.startsWith("浙江大学 "));
  assert.ok(focused.length >= 2);
  assert.ok(focused.every((r) => r.include === "zju.edu.cn"));
  assert.ok(requests.length <= 18);
  assert.ok(
    result.sources.some(
      (s) =>
        s.url.includes("grs.zju.edu.cn") &&
        s.kind === "search_snippet" &&
        !s.verified,
    ),
  );
});

test("expanded discovery first investigates three historical policies and target changes, then narrows school fees to observed domains", async () => {
  const schools = ["甲大学", "乙大学", "丙大学", "丁大学", "戊大学"];
  const { web, requests } = searchWeb((query) => {
    const index = schools.findIndex((school) => query.startsWith(school));
    if (index < 0) return [];
    return [
      {
        name: `${schools[index]}电子信息硕士${query.includes("学费") ? "学费收费标准" : "培养方案"}`,
        url: `https://grad.school${index}.edu.cn/${query.includes("学费") ? "fees" : "plan"}`,
        summary: `${schools[index]} 085400 电子信息 硕士研究生培养方案`,
      },
    ];
  });
  const result = await searchResearchSources({
    web,
    subjectId: "coverage",
    disciplines: [discipline],
    regions: ["杭州"],
    targetYear: "2027",
    schoolHints: new Map([[discipline.code, schools]]),
    maxRequests: 24,
    maxSources: 40,
    onProgress: async () => {},
  });
  assert.equal(requests.length, 24);
  assert.ok(
    requests
      .slice(4, 4 + schools.length)
      .every(
        ({ query, include }) =>
          !query.includes("2027") &&
          query.includes("2026") &&
          query.endsWith("硕士 培养方案") &&
          !include,
      ),
  );
  assert.ok(
    requests.some(
      ({ query, include }) =>
        query.includes("2027") &&
        query.includes("招生专业目录") &&
        query.includes("停招"),
    ),
  );
  const fees = requests.filter(({ query }) => query.includes("学费"));
  assert.equal(fees.length, schools.length);
  assert.deepEqual(
    fees.map(({ include }) => include),
    schools.map((_, index) => `school${index}.edu.cn`),
  );
  assert.equal(
    new Set(result.sources.map((source) => new URL(source.url).hostname)).size,
    5,
  );
});

test("national discovery can add schools outside model hints and duplicate query exhaustion cannot skip reserved fees", async () => {
  const { web, requests } = searchWeb((query) => {
    if (query.startsWith("甲大学"))
      return [
        {
          name: "甲大学电子信息硕士培养方案",
          url: "https://grad.hinted.edu.cn/plan",
          summary: "甲大学085400电子信息硕士研究生培养",
        },
      ];
    if (query.includes("招生专业目录") && !query.includes("甲大学"))
      return Array.from({ length: 5 }, (_, index) => ({
        name: `${["乙", "丙", "丁", "戊", "己"][index]}大学电子信息硕士招生专业目录`,
        url: `https://grad.discovered${index}.edu.cn/catalog`,
        summary: `${["乙", "丙", "丁", "戊", "己"][index]}大学 085400电子信息 硕士研究生招生`,
      }));
    return [];
  });
  const result = await searchResearchSources({
    web,
    subjectId: "dynamic-coverage",
    disciplines: [discipline],
    regions: ["杭州"],
    schoolHints: new Map([[discipline.code, ["甲大学"]]]),
    maxRequests: 24,
    maxSources: 40,
    onProgress: async () => {},
  });
  assert.ok(
    requests.some(
      ({ query, include }) => query.startsWith("杭州 ") && !include,
    ),
  );
  assert.ok(
    requests.some(
      ({ query, include }) =>
        !query.includes("甲大学") && include?.startsWith("discovered"),
    ),
  );
  assert.ok(requests.some(({ query }) => query.includes("学费")));
  assert.ok(requests.length <= 24);
  assert.ok(result.sources.length <= 40);
  assert.equal(
    new Set(result.sources.map((source) => new URL(source.url).hostname)).size,
    6,
  );
  assert.ok(result.sources.every((source) => source.kind === "search_snippet"));
});

test("a large school's similar pages cannot displace other schools' follow-up evidence within the candidate cap", async () => {
  const schools = ["甲大学", "乙大学", "丙大学", "丁大学", "戊大学"];
  const { web } = searchWeb((query) => {
    const index = schools.findIndex((school) => query.startsWith(school));
    if (index < 0 || query.includes("学费")) return [];
    const pass = query.endsWith("培养方案") ? "plan" : "catalog";
    return Array.from({ length: 10 }, (_, page) => ({
      name: `${schools[index]}电子信息硕士${pass === "plan" ? "培养方案" : "招生专业目录"}`,
      url: `https://grad.school${index}.edu.cn/${pass}/${page}`,
      summary: `${schools[index]} 085400 电子信息 硕士研究生培养与招生专业目录`,
    }));
  });
  const result = await searchResearchSources({
    web,
    subjectId: "balanced-pages",
    disciplines: [discipline],
    regions: [],
    schoolHints: new Map([[discipline.code, schools]]),
    maxRequests: 24,
    maxSources: 12,
    onProgress: async () => {},
  });
  assert.equal(result.sources.length, 12);
  const counts = schools.map(
    (_, index) =>
      result.sources.filter(
        (source) =>
          new URL(source.url).hostname === `grad.school${index}.edu.cn`,
      ).length,
  );
  assert.ok(counts.every((count) => count >= 2));
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test("fees prioritize useful graduate hints and observed schools before unsuccessful model names", async () => {
  const schools = ["甲大学", "乙大学", "丙大学", "丁大学", "戊大学", "己大学"];
  const { web, requests } = searchWeb((query) => {
    if (query.includes("学费")) return [];
    const index = schools.findIndex((school) => query.startsWith(school));
    if (index >= 0)
      return index < 4
        ? []
        : [
            {
              name: `${schools[index]}电子信息硕士培养方案`,
              url: `https://school${index}.edu.cn/plan`,
              summary: `${schools[index]}085400电子信息硕士研究生培养`,
            },
          ];
    return Array.from({ length: 3 }, (_, index) => ({
      name: `${["庚", "辛", "壬"][index]}大学电子信息硕士招生专业目录`,
      url: `https://observed${index}.edu.cn/catalog`,
      summary: `${["庚", "辛", "壬"][index]}大学085400电子信息硕士研究生招生`,
    }));
  });
  await searchResearchSources({
    web,
    subjectId: "useful-fees",
    disciplines: [discipline],
    regions: ["杭州"],
    schoolHints: new Map([[discipline.code, schools]]),
    maxRequests: 24,
    maxSources: 40,
    onProgress: async () => {},
  });
  const fees = requests.filter(({ query }) => query.includes("学费"));
  assert.equal(fees.length, 6);
  assert.deepEqual(
    fees.slice(0, 2).map(({ query }) => query.split(" ")[0]),
    ["戊大学", "己大学"],
  );
  assert.deepEqual(
    fees.slice(2, 5).map(({ include }) => include),
    ["observed0.edu.cn", "observed1.edu.cn", "observed2.edu.cn"],
  );
  assert.equal(
    fees.filter(({ query }) =>
      schools.slice(0, 4).some((school) => query.startsWith(school)),
    ).length,
    1,
  );
  assert.ok(requests.length <= 24);
});

test("observed school domains also receive fee lookups without any model school names", async () => {
  const { web, requests } = searchWeb((query) =>
    query.includes("学费")
      ? []
      : [
          {
            name: "庚大学电子信息硕士招生专业目录",
            url: "https://observed.edu.cn/catalog",
            summary: "庚大学085400电子信息硕士研究生招生",
          },
        ],
  );
  await searchResearchSources({
    web,
    subjectId: "observed-only-fees",
    disciplines: [discipline],
    regions: [],
    maxRequests: 24,
    maxSources: 40,
    onProgress: async () => {},
  });
  const fees = requests.filter(({ query }) => query.includes("学费"));
  assert.equal(fees.length, 1);
  assert.equal(fees[0].include, "observed.edu.cn");
  assert.ok(requests.length <= 24);
});

test("a partner school's university tutors cannot redirect a named university's focused lookup", async () => {
  const wrong = {
    name: "电子信息 - 浙大城市学院研究生招生网",
    url: "https://yz.hzcu.edu.cn/programme",
    summary:
      "电子信息硕士研究生培养，拥有浙江大学博士生导师，浙江大学等硕士生导师。",
  };
  const titleCollision = {
    name: "浙江大学城市学院电子信息硕士培养方案",
    url: "https://yz.hzcu.edu.cn/legacy",
    summary: "浙江大学城市学院电子信息硕士研究生培养。",
  };
  const { web, requests } = searchWeb(() => [wrong, titleCollision]);
  await searchResearchSources({
    web,
    subjectId: "school-ownership",
    disciplines: [discipline],
    regions: ["杭州"],
    targetYear: "2027",
    schoolHints: new Map([[discipline.code, ["浙江大学"]]]),
    maxRequests: 18,
    maxSources: 40,
    includeFeeSearch: false,
    onProgress: async () => {},
  });
  assert.ok(
    requests.filter(({ query }) => query.startsWith("浙江大学 ")).length >= 2,
  );
  assert.ok(
    requests
      .filter(({ query }) => query.startsWith("浙江大学 "))
      .every(({ include }) => include === "zju.edu.cn"),
  );
  const sources = await web.answer(
    { subjectId: "school-ownership", question: "检验学校标题", search: true },
    { sourcesOnly: true },
  );
  assert.equal(sourceHasSchoolIdentity(sources.sources[0], "浙江大学"), false);
  assert.equal(sourceHasSchoolIdentity(sources.sources[1], "浙江大学"), false);
  assert.equal(
    sourceHasSchoolIdentity(
      { ...sources.sources[0], title: "2025年浙江大学硕士招生专业目录" },
      "浙江大学",
    ),
    true,
  );
});

test("shared schools keep distinct discipline queries and one preferred city is used for every regional discovery direction", async () => {
  const directions = ["0854", "0855", "1256"].map(
    (code) => getDisciplineCatalog().items.find((d) => d.code === code)!,
  );
  const { web, requests } = searchWeb(() => []);
  await searchResearchSources({
    web,
    subjectId: "one-city-directions",
    disciplines: directions,
    regions: ["杭州"],
    schoolHints: new Map(
      directions.map((d) => [
        d.code,
        ["甲大学", "乙大学", "丙大学", "丁大学", "戊大学"],
      ]),
    ),
    maxRequests: 18,
    maxSources: 40,
    includeFeeSearch: false,
    onProgress: async () => {},
  });
  assert.equal(requests.length, 18);
  for (const direction of directions) {
    assert.ok(
      requests.some(
        ({ query }) => query === `甲大学 ${direction.name} 硕士 培养方案`,
      ),
    );
    assert.ok(
      requests.some(
        ({ query }) => query === `杭州 ${direction.name} 硕士 招生专业目录`,
      ),
    );
  }
  assert.equal(
    new Set(
      requests.map(({ query, include }) => JSON.stringify([query, include])),
    ).size,
    18,
  );
});

test("city inventory and registry investigate Hangzhou schools before unrelated model names even when search returns no hits", async () => {
  const { web, requests } = searchWeb(() => []);
  const leads = preferredCityCandidateLeads(["杭州"], [discipline]);
  const result = await searchResearchSources({
    web,
    subjectId: "deterministic-city",
    disciplines: [discipline],
    regions: ["杭州"],
    targetYear: "2027",
    schoolHints: new Map([[discipline.code, ["上海大学", "榆林学院"]]]),
    candidateLeads: leads,
    maxRequests: 18,
    maxSources: 20,
    onProgress: async () => {},
  });
  assert.equal(requests[0].query, "杭州 硕士研究生 招生单位 招生专业目录");
  assert.equal(
    requests[1].query,
    `杭州 2026 ${discipline.name} 硕士 招生专业目录`,
  );
  assert.deepEqual(
    requests.slice(2, 5).map(({ query }) => query.match(/20\d{2}/)?.[0]),
    ["2025", "2024", "2027"],
  );
  assert.equal(
    requests[5].query,
    `${leads[0].school} 2026 硕士 招生专业目录 招生章程`,
  );
  assert.equal(requests[5].include, leads[0].officialDomain);
  assert.deepEqual(
    result.candidateAttempts,
    leads.slice(0, 5).map((lead) => lead.school),
  );
  assert.deepEqual(result.inventoryAttempts, ["杭州"]);
  assert.ok(
    result.sources.some(
      (source) =>
        source.url === "https://grs.hdu.edu.cn/13497/list.htm" &&
        source.kind === "search_snippet",
    ),
  );
  assert.ok(
    result.sources.every(
      (source) => source.kind === "search_snippet" && source.verified === false,
    ),
  );
  assert.ok(requests.length <= 18);
});

test("all six demand directions receive deterministic catalogue discovery before model school hints", async () => {
  const directions = getDisciplineCatalog().items.filter((item) =>
    ["0802", "0855", "0812", "0835", "0854", "0811"].includes(item.code),
  );
  assert.equal(directions.length, 6);
  const { web, requests } = searchWeb(() => []);
  await searchResearchSources({
    web,
    subjectId: "six-directions",
    disciplines: directions,
    regions: ["南京"],
    targetYear: "2027",
    schoolHints: new Map(
      directions.map((item) => [item.code, ["模型甲大学", "模型乙大学"]]),
    ),
    candidateLeads: [],
    maxRequests: 18,
    includeFeeSearch: false,
    onProgress: async () => {},
  });
  assert.deepEqual(
    requests.slice(1, 7).map(({ query }) => query),
    directions.map((item) => `南京 2026 ${item.name} 硕士 招生专业目录`),
  );
  assert.ok(requests.slice(0, 7).every(({ query }) => !query.includes("模型")));
  assert.equal(requests.length, 18);
});

test("all three historical years get independent attempts even when the latest and target intakes return no indexed evidence", async () => {
  const { web, requests } = searchWeb((query) =>
    /2025|2024/.test(query)
      ? [
          {
            name: `甲大学${query.includes("2025") ? "2025" : "2024"}年电子信息硕士招生专业目录`,
            url: `https://yz.history.edu.cn/${query.includes("2025") ? "2025" : "2024"}.htm`,
            summary: "甲大学085400电子信息硕士招生",
          },
        ]
      : [],
  );
  const result = await searchResearchSources({
    web,
    subjectId: "history-no-current",
    disciplines: [discipline],
    regions: ["南京"],
    targetYear: "2027",
    candidateLeads: [],
    maxRequests: 24,
    maxSources: 40,
    onProgress: async () => {},
  });
  assert.deepEqual(
    requests.slice(1, 5).map(({ query }) => query.match(/20\d{2}/)?.[0]),
    ["2026", "2025", "2024", "2027"],
  );
  assert.ok(result.sources.some((source) => source.title.includes("2025")));
  assert.ok(result.sources.some((source) => source.title.includes("2024")));
  assert.ok(requests.length <= 24);
});

test("target-year stop evidence survives a large historical school's pages and the small source cap", async () => {
  const { web } = searchWeb((query) =>
    query.includes("2027")
      ? [
          {
            name: "甲大学2027年电子信息硕士招生专业目录调整：暂停招生",
            url: "https://yz.history.edu.cn/2027-stop.htm",
            summary: "甲大学085400电子信息硕士暂停招生",
          },
        ]
      : Array.from({ length: 20 }, (_, i) => ({
          name: `甲大学2026年电子信息硕士招生专业目录${i}`,
          url: `https://yz.history.edu.cn/2026-${i}.htm`,
          summary: "甲大学085400电子信息硕士招生",
        })),
  );
  const result = await searchResearchSources({
    web,
    subjectId: "history-current-stop",
    disciplines: [discipline],
    regions: ["南京"],
    targetYear: "2027",
    candidateLeads: [],
    maxRequests: 24,
    maxSources: 4,
    onProgress: async () => {},
  });
  assert.ok(
    result.sources.some((source) => source.url.endsWith("2027-stop.htm")),
  );
  assert.ok(result.sources.every((source) => source.kind === "search_snippet"));
});

test("unregistered cities still receive live discovery before national or model fallback", async () => {
  const { web, requests } = searchWeb(() => []);
  const result = await searchResearchSources({
    web,
    subjectId: "unregistered-city",
    disciplines: [discipline],
    regions: ["西安", "成都"],
    schoolHints: new Map([[discipline.code, ["甲大学"]]]),
    candidateLeads: [],
    maxRequests: 6,
    onProgress: async () => {},
  });
  assert.deepEqual(
    requests.slice(0, 2).map(({ query }) => query),
    [
      "西安 硕士研究生 招生单位 招生专业目录",
      "成都 硕士研究生 招生单位 招生专业目录",
    ],
  );
  assert.deepEqual(result.inventoryAttempts, ["西安", "成都"]);
});
