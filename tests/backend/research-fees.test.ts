import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import { enrichResearchFees } from "../../server/explanation/research-fees.ts";
import { deriveRecommendationConstraints } from "../../server/explanation/research-constraints.ts";
import { validatedSourceProvenance } from "../../server/explanation/research-provenance.ts";
import { safeSourceYear } from "../../server/explanation/research-years.ts";
import { createWebAnswerModule } from "../../server/explanation/web.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const discipline = getDisciplineCatalog().items.find(
  (item) => item.code === "0401",
)!;
type Input = Parameters<typeof enrichResearchFees>[0];
function school(name = "甲大学", host = "a", id = "admission"): WebSource {
  return {
    id,
    title: `${name}硕士招生目录`,
    excerpt: `${name}2027年教育学全日制硕士研究生招生`,
    kind: "official_page",
    url: `https://grad.${host}.edu.cn/master`,
    retrievedAt: "2026-10-04T00:00:00Z",
    verified: false,
  };
}
function search(
  results: (
    question: string,
  ) => { name: string; url: string; summary?: string }[],
) {
  const queries: string[] = [];
  const web = createWebAnswerModule({
    enabled: true,
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "test-only",
    searchDailyRequestsPerUser: 100,
    reader: async (_url, options) => {
      const query = JSON.parse(options.body!).query;
      queries.push(query);
      return {
        contentType: "application/json",
        text: JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: results(query).map((item) => ({
                summary: "研究生学费收费标准",
                ...item,
              })),
            },
          },
        }),
      };
    },
  });
  return { web, queries };
}
function input(web: Input["web"], changes: Partial<Input> = {}): Input {
  return {
    subjectId: "student",
    web,
    recommendations: [
      {
        institutionName: "甲大学",
        programName: "教育学",
        disciplineCode: "0401",
        studyMode: "full_time",
        citations: ["admission"],
      },
    ],
    sources: [school()],
    disciplines: [discipline],
    targetYear: 2027,
    remainingReads: 8,
    readPage: async () => ({
      contentType: "text/html",
      text: "甲大学2027年教育学硕士全日制学费8000元/年。",
    }),
    onProgress: async () => {},
    ...changes,
  };
}
function tuition(value: Input, additional: WebSource[]) {
  return deriveRecommendationConstraints({
    profile: { budget: "1万元以内", cities: [] },
    targetYear: value.targetYear,
    institutionName: "甲大学",
    programName: "教育学",
    degreeType: "academic",
    studyMode: "full_time",
    citations: ["admission"],
    sources: [...value.sources, ...additional],
  });
}

test("late fee discovery uses a verified school's observed root domain and only returns newly read official bodies", async () => {
  const { web, queries } = search(() => [
    { name: "甲大学教育学学费", url: "https://finance.a.edu.cn/fee" },
    { name: "甲大学教育学学费", url: "https://fees.b.edu.cn/fee" },
    { name: "甲大学教育学学费", url: "https://a.edu.cn.evil.example/fee" },
  ]);
  const reads: string[] = [];
  const original = input(web, {
    sources: [
      school(),
      { ...school("乙大学", "b", "fee-1"), excerpt: "乙大学硕士招生" },
    ],
    readPage: async (url) => {
      reads.push(url);
      return {
        contentType: "text/html",
        text: "<p>甲大学2027年教育学硕士全日制学费8000元/年。</p>",
      };
    },
  });
  const snapshot = structuredClone(original.sources);
  const recommendations = structuredClone(original.recommendations);
  const result = await enrichResearchFees(original);
  assert.equal(queries.length, 1);
  assert.deepEqual(reads, ["https://finance.a.edu.cn/fee"]);
  assert.equal(result.requestCount, 1);
  assert.equal(result.readCount, 1);
  assert.equal(result.sources[0].id, "fee-2");
  assert.equal(result.sources[0].kind, "official_page");
  assert.equal(tuition(original, result.sources).tuition?.amount, 8000);
  assert.deepEqual(original.sources, snapshot);
  assert.deepEqual(original.recommendations, recommendations);
});

test("the shared search and remaining-read ceilings rotate actual schools without an additional model call", async () => {
  const { web, queries } = search((query) => {
    const index = Number(query.match(/^学校(\d)/)?.[1]);
    return [1, 2, 3].map((page) => ({
      name: `学校${index}大学学费标准`,
      url: `https://fees.school${index}.edu.cn/${page}`,
    }));
  });
  const reads: string[] = [];
  const sources = Array.from({ length: 10 }, (_, index) =>
    school(`学校${index}大学`, `school${index}`, `admission-${index}`),
  );
  const result = await enrichResearchFees(
    input(web, {
      sources,
      recommendations: sources.map((source, index) => ({
        institutionName: `学校${index}大学`,
        programName: "教育学",
        disciplineCode: "0401",
        citations: [source.id],
      })),
      remainingReads: 100,
      maxRequests: 100,
      readPage: async (url) => {
        reads.push(url);
        return {
          contentType: "text/html",
          text: "研究生费用标准仍待公布，尚无专业金额。",
        };
      },
    }),
  );
  assert.equal(queries.length, 10);
  assert.equal(result.requestCount, 10);
  assert.equal(result.readCount, Math.min(10, B.feeSearches) * 3);
  assert.equal(reads.length, Math.min(10, B.feeSearches) * 3);
  assert.equal(
    new Set(reads.slice(0, 6).map((url) => new URL(url).hostname)).size,
    6,
  );
});

test("zero or invalid shared read budgets do not spend a search request", async () => {
  const { web, queries } = search(() => []);
  for (const remainingReads of [0, -1, NaN]) {
    const result = await enrichResearchFees(input(web, { remainingReads }));
    assert.equal(result.requestCount, 0);
    assert.equal(result.readCount, 0);
  }
  assert.equal(queries.length, 0);
});

test("a school name in a snippet or third-party body cannot identify a trusted school domain", async () => {
  const { web, queries } = search(() => []);
  for (const source of [
    { ...school(), kind: "search_snippet" as const },
    { ...school(), url: "https://third-party.example/school" },
    { ...school(), excerpt: "乙大学教育学硕士。友情链接：甲大学。" },
  ]) {
    const result = await enrichResearchFees(input(web, { sources: [source] }));
    assert.equal(result.requestCount, 0);
    assert.ok(result.limitations.length > 0);
  }
  assert.equal(queries.length, 0);
});

test("a discovered same-school fee PDF shares the read budget and preserves historical cohort and full-program units", async () => {
  const { web } = search(() => [
    { name: "甲大学研究生收费项目", url: "https://finance.a.edu.cn/notice" },
  ]);
  const reads: string[] = [];
  const original = input(web, {
    readPage: async (url) => {
      reads.push(url);
      return url.endsWith(".pdf")
        ? {
            contentType: "application/pdf",
            text: "甲大学教育收费项目公示表\n2023级研究生收费\n全日制教育学硕士\n研究生学费 4万元/生·全程",
          }
        : {
            contentType: "text/html",
            text: '<p>甲大学研究生学费标准详见附件</p><a href="https://finance.a.edu.cn/fees.pdf">研究生学费收费标准</a><a href="https://finance.b.edu.cn/other.pdf">学费收费标准</a>',
          };
    },
  });
  const result = await enrichResearchFees(original);
  assert.deepEqual(reads, [
    "https://finance.a.edu.cn/notice",
    "https://finance.a.edu.cn/fees.pdf",
  ]);
  const value = tuition(original, result.sources);
  assert.equal(value.tuition?.amount, 40000);
  assert.equal(value.tuition?.year, 2023);
  assert.equal(value.tuition?.period, "program");
  assert.equal(value.constraintChecks[0].status, "unknown");
  assert.match(result.sources[1].excerpt, /\n/);
});

test("successful public fee queries reuse the same web cache for 15 minutes while page reads remain caller-controlled", async () => {
  const { web, queries } = search(() => [
    { name: "甲大学教育学学费", url: "https://finance.a.edu.cn/fee" },
  ]);
  let now = 1_800_000_000_000;
  let reads = 0;
  const original = input(web, {
    now: () => now,
    readPage: async () => {
      reads++;
      return {
        contentType: "text/html",
        text: "甲大学2027年教育学硕士全日制学费8000元/年。",
      };
    },
  });
  await enrichResearchFees(original);
  now += 60_000;
  await enrichResearchFees(original);
  assert.equal(queries.length, 1);
  assert.equal(reads, 2);
  now += 16 * 60_000;
  await enrichResearchFees(original);
  assert.equal(queries.length, 2);
});

test("failed search responses are not cached and failed bodies do not become official evidence", async () => {
  let searches = 0;
  const failed = createWebAnswerModule({
    searchEnabled: true,
    searchProvider: "bocha",
    searchKey: "test-only",
    reader: async () => {
      searches++;
      throw new Error("transport failed");
    },
  });
  await enrichResearchFees(input(failed));
  await enrichResearchFees(input(failed));
  assert.equal(searches, 2);
  const { web } = search(() => [
    { name: "甲大学教育学学费", url: "https://finance.a.edu.cn/fee" },
  ]);
  const result = await enrichResearchFees(
    input(web, {
      readPage: async () => {
        throw new Error("offline");
      },
    }),
  );
  assert.equal(result.readCount, 1);
  assert.deepEqual(result.sources, []);
  assert.ok(result.limitations.length > 0);
});

test("awaited progress failures and read cancellation stop delivery rather than becoming fee limitations", async () => {
  const { web, queries } = search(() => [
    { name: "甲大学教育学学费", url: "https://finance.a.edu.cn/fee" },
  ]);
  const progress = new Error("authorization revoked");
  await assert.rejects(
    enrichResearchFees(
      input(web, {
        onProgress: async () => {
          await Promise.resolve();
          throw progress;
        },
      }),
    ),
    (error) => error === progress,
  );
  assert.equal(queries.length, 0);
  const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
  await assert.rejects(
    enrichResearchFees(
      input(web, {
        readPage: async () => {
          throw abort;
        },
      }),
    ),
    (error) => error === abort,
  );
});

test("a read price for another programme or a scholarship cannot overwrite the recommendation", async () => {
  const { web } = search(() => [
    { name: "甲大学教育学学费", url: "https://finance.a.edu.cn/fee" },
  ]);
  const original = input(web, {
    readPage: async () => ({
      contentType: "text/html",
      text: "甲大学2027年金融硕士全日制学费8000元/年。教育学全日制硕士奖学金8000元/年。",
    }),
  });
  const before = structuredClone(original.recommendations);
  const result = await enrichResearchFees(original);
  assert.equal(tuition(original, result.sources).tuition, undefined);
  assert.deepEqual(original.recommendations, before);
});

test("already verified tuition needs no late paid fee discovery", async () => {
  const { web, queries } = search(() => []);
  const quote = "甲大学2027年教育学硕士全日制学费8000元/年。";
  const original = input(web, {
    sources: [
      school(),
      {
        ...school("甲大学", "a", "fee"),
        url: "https://finance.a.edu.cn/fee",
        excerpt: quote,
      },
    ],
    recommendations: [
      {
        institutionName: "甲大学",
        programName: "教育学",
        disciplineCode: "0401",
        studyMode: "full_time",
        citations: ["admission", "fee"],
        tuition: {
          amount: 8000,
          currency: "CNY",
          period: "academic_year",
          year: 2027,
          studyMode: "full_time",
          quote,
          sourceId: "fee",
        },
      },
    ],
  });
  const result = await enrichResearchFees(original);
  assert.equal(result.requestCount, 0);
  assert.equal(queries.length, 0);
});

test("a newly referenced cached body preserves its original retrieval timestamp", async () => {
  const { web } = search(() => [
    { name: "甲大学教育学学费", url: "https://finance.a.edu.cn/fee" },
  ]);
  const retrievedAt = "2026-10-03T08:00:00Z";
  const original = input(web, {
    now: () => Date.parse("2026-10-04T09:00:00Z"),
    readPage: async () => ({
      contentType: "text/html",
      text: "甲大学2027年教育学硕士全日制学费8000元/年。",
      retrievedAt,
    }),
  });
  const first = await enrichResearchFees(original);
  const second = await enrichResearchFees(original);
  assert.equal(first.sources[0].retrievedAt, retrievedAt);
  assert.equal(second.sources[0].retrievedAt, retrievedAt);
});

test("combined undergraduate and graduate fee notices may be read while undergraduate-only titles and third-party bodies stay excluded", async () => {
  const { web } = search(() => [
    {
      name: "甲大学本科与研究生综合收费标准",
      url: "https://finance.a.edu.cn/combined.pdf",
    },
    {
      name: "甲大学本科生学费标准",
      url: "https://finance.a.edu.cn/undergraduate.pdf",
    },
    {
      name: "甲大学本科与研究生收费标准",
      url: "https://third-party.example/combined.pdf",
    },
  ]);
  const reads: string[] = [];
  const original = input(web, {
    readPage: async (url) => {
      reads.push(url);
      return {
        contentType: "application/pdf",
        text: "甲大学本科与研究生综合收费标准\n本科生收费\n教育学 全日制 学费5000元/年\n2027年硕士学费标准\n教育学 全日制 学费8000元/年",
      };
    },
  });
  const result = await enrichResearchFees(original);
  assert.deepEqual(reads, ["https://finance.a.edu.cn/combined.pdf"]);
  assert.equal(result.sources.length, 1);
  assert.equal(tuition(original, result.sources).tuition?.amount, 8000);
});

test("late fee bodies retain another programme's exact row at the end of a long official table", async () => {
  const { web } = search(() => [
    { name: "甲大学研究生学费标准", url: "https://finance.a.edu.cn/fees.pdf" },
  ]);
  const tail = "机械工程 全日制 学费12000元/年";
  const body = [
    "甲大学2026年硕士研究生学费标准",
    "教育学 全日制 学费8000元/年",
    ...Array.from(
      { length: 500 },
      (_, index) =>
        `第${index + 1}项收费管理说明：公开标准请结合本人实际培养专业和学习形式核对，其他服务费用不属于研究生学费。`,
    ),
    tail,
  ].join("\n");
  assert.ok(body.length > 12000 && body.length < 200000);
  const original = input(web, {
    readPage: async () => ({ contentType: "application/pdf", text: body }),
  });
  const result = await enrichResearchFees(original);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].excerpt, body);
  assert.ok(result.sources[0].excerpt.endsWith(tail));
  assert.equal(tuition(original, result.sources).tuition?.amount, 8000);
  const other = deriveRecommendationConstraints({
    profile: { budget: "1万元以内", cities: [] },
    targetYear: 2027,
    institutionName: "甲大学",
    programName: "机械工程",
    degreeType: "academic",
    studyMode: "full_time",
    citations: [],
    sources: result.sources,
  });
  assert.equal(other.tuition?.amount, 12000);
  assert.equal(other.tuition?.year, 2026);
  assert.equal(other.tuition?.quote, tail);
  assert.equal(other.tuition?.sourceId, result.sources[0].id);
});

test("actual fee attachment links bind anonymous PDF context without borrowing parent words into its body", async () => {
  const parentUrl = "https://finance.a.edu.cn/notice";
  const childUrl = "https://finance.a.edu.cn/anonymous.pdf";
  const { web } = search(() => [
    { name: "甲大学2026年研究生收费标准", url: parentUrl },
  ]);
  for (const body of [
    "2026年硕士研究生学费标准\n教育学 全日制 学费8000元/年",
    "硕士研究生学费标准\n教育学 全日制 学费8000元/年",
  ]) {
    const original = input(web, {
      readPage: async (url) =>
        url === parentUrl
          ? {
              contentType: "text/html",
              text: '<p>甲大学2026年硕士研究生学费标准，实际金额见附件。</p><a href="/anonymous.pdf">2026年硕士研究生学费标准</a><a href="https://finance.b.edu.cn/other.pdf">2026年硕士研究生学费标准</a>',
            }
          : { contentType: "application/pdf", text: body },
    });
    const result = await enrichResearchFees(original);
    assert.equal(result.readCount, 2);
    const parent = result.sources.find((source) => source.url === parentUrl)!;
    const child = result.sources.find((source) => source.url === childUrl)!;
    assert.deepEqual(parent.documentLinks, [
      { url: childUrl, title: "2026年硕士研究生学费标准" },
    ]);
    assert.equal(child.parentSourceId, parent.id);
    assert.equal(child.excerpt, body);
    assert.ok(!child.excerpt.includes("甲大学"));
    const context = validatedSourceProvenance(child);
    assert.equal(context?.institutionName, "甲大学");
    assert.equal(context?.admissionYear, "2026");
    assert.equal(context?.parentUrl, parentUrl);
    assert.equal(context?.linkedTitle, "2026年硕士研究生学费标准");
    assert.equal(safeSourceYear(child), 2026);
    if (body.startsWith("2026年")) {
      assert.equal(tuition(original, result.sources).tuition?.amount, 8000);
      assert.equal(
        tuition(original, result.sources).tuition?.sourceId,
        child.id,
      );
    } else {
      // A contextual year must not be inserted into the literal fee quote.
      assert.equal(tuition(original, result.sources).tuition, undefined);
    }
  }
});

test("oversized net fee bodies are rejected instead of storing a truncated official page", async () => {
  const { web } = search(() => [
    { name: "甲大学教育学学费", url: "https://finance.a.edu.cn/fee" },
  ]);
  const body = `甲大学2026年教育学全日制硕士学费8000元/年。${"说明".repeat(100000)}`;
  for (const contentType of ["application/pdf", "text/html"]) {
    const result = await enrichResearchFees(
      input(web, {
        readPage: async () => ({
          contentType,
          text:
            contentType === "text/html" ? `<article>${body}</article>` : body,
        }),
      }),
    );
    assert.equal(result.readCount, 1);
    assert.deepEqual(result.sources, []);
    assert.ok(result.limitations.some((reason) => /200000/.test(reason)));
  }
  const clean = "甲大学2026年教育学全日制硕士学费8000元/年。";
  const usable = await enrichResearchFees(
    input(web, {
      readPage: async () => ({
        contentType: "text/html",
        text: `<script>${"x".repeat(200001)}</script><p>${clean}</p>`,
      }),
    }),
  );
  assert.equal(usable.sources[0].excerpt, clean);
});

test("a search-result title cannot bind an anonymous fee PDF to a school or year", async () => {
  const { web } = search(() => [
    {
      name: "甲大学2026年硕士研究生学费标准",
      url: "https://finance.a.edu.cn/anonymous.pdf",
    },
  ]);
  const body = "硕士研究生学费标准\n教育学 全日制 学费8000元/年";
  const original = input(web, {
    readPage: async () => ({ contentType: "application/pdf", text: body }),
  });
  const result = await enrichResearchFees(original);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].excerpt, body);
  assert.equal(result.sources[0].parentSourceId, undefined);
  assert.equal(validatedSourceProvenance(result.sources[0]), undefined);
  assert.equal(safeSourceYear(result.sources[0]), undefined);
  assert.equal(tuition(original, result.sources).tuition, undefined);
});
