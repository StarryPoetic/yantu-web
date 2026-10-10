import test from "node:test";
import assert from "node:assert/strict";
import { deriveRecommendationConstraints } from "../../server/explanation/research-constraints.ts";
import type { RecommendationConstraintInput } from "../../server/explanation/research-constraints.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const feeQuote = "甲大学2027年教育学硕士全日制学费8000元/生·学年。";
const addressQuote = "甲大学教育学硕士培养地址：上海市徐汇区示例路1号。";
function input(
  overrides: Partial<RecommendationConstraintInput> = {},
): RecommendationConstraintInput {
  return {
    profile: { budget: "1 万元以内", cities: ["上海", "杭州"] },
    targetYear: "2027",
    institutionName: "甲大学",
    programName: "教育学",
    degreeType: "academic",
    studyMode: "full_time",
    citations: ["fee", "address"],
    sources: [source("fee", feeQuote), source("address", addressQuote)],
    tuition: {
      amount: 8000,
      currency: "CNY",
      period: "academic_year",
      year: 2027,
      studyMode: "full_time",
      quote: feeQuote,
      sourceId: "fee",
    },
    location: { city: "上海", quote: addressQuote, sourceId: "address" },
    ...overrides,
  };
}
function source(
  id: string,
  excerpt: string,
  changes: Partial<WebSource> = {},
): WebSource {
  return {
    id,
    excerpt,
    kind: "official_page",
    title: "甲大学硕士资料",
    url: `https://yz.example.edu.cn/${id}`,
    retrievedAt: "2026-10-04T00:00:00Z",
    verified: false,
    ...changes,
  };
}
function fee(
  text: string,
  values: Record<string, unknown> = {},
  changes: Partial<RecommendationConstraintInput> = {},
) {
  const base = input();
  return input({
    ...changes,
    sources: [source("fee", text), source("address", addressQuote)],
    tuition: { ...(base.tuition as object), quote: text, ...values },
  });
}
const budget = (value: ReturnType<typeof deriveRecommendationConstraints>) =>
  value.constraintChecks.find((check) => check.field === "budget")!;
const cities = (value: ReturnType<typeof deriveRecommendationConstraints>) =>
  value.constraintChecks.find((check) => check.field === "cities")!;

test("verified project-local annual tuition and address support comparison without promising total costs or admission", () => {
  const result = deriveRecommendationConstraints(input());
  assert.equal(result.tuition?.amount, 8000);
  assert.equal(result.tuition?.studyMode, "full_time");
  assert.equal(result.location?.city, "上海");
  assert.equal(
    "tier" in result,
    false,
    "soft conditions do not assign overall suitability",
  );
  assert.equal("tierReasons" in result, false);
  assert.equal(budget(result).status, "match");
  assert.match(budget(result).reason, /仅比较学费.*生活.*待核验/);
  assert.equal(cities(result).status, "match");
});

test("annual tuition over the real budget and an out-of-city address record independent mismatches without deciding suitability", () => {
  const result = deriveRecommendationConstraints(
    fee(
      "甲大学2027年教育学硕士全日制学费1.2万元/年。",
      { amount: 12000 },
      { profile: { budget: "1 万元以内", cities: ["北京"] } },
    ),
  );
  assert.equal(budget(result).status, "mismatch");
  assert.match(budget(result).reason, /12,000.*10,000/);
  assert.equal(cities(result).status, "mismatch");
  assert.equal(
    result.constraintChecks.filter((check) => check.status === "mismatch")
      .length,
    2,
  );
  assert.equal("tier" in result, false);
});

test("non-annual pricing remains quoted reference and is never converted to annual budget fit", () => {
  for (const [text, values] of [
    ["甲大学2027年教育学硕士全日制全程学费8000元。", { period: "program" }],
    ["甲大学2027年教育学硕士全日制学费8000元/学期。", { period: "semester" }],
    ["甲大学2027年教育学硕士全日制学费8000元/学分。", { period: "credit" }],
  ] as const) {
    const result = deriveRecommendationConstraints(fee(text, values));
    assert.equal(result.tuition?.amount, 8000, text);
    assert.equal(budget(result).status, "unknown", text);
    assert.notEqual(
      budget(result).status,
      "mismatch",
      "unknown cannot be described as a proven mismatch",
    );
  }
});

test("historical annual fees support explicitly dated reference comparisons, not target-year promises", () => {
  for (const year of [2026, 2025, 2024]) {
    const matched = deriveRecommendationConstraints(
      fee(`甲大学${year}年教育学硕士全日制学费8000元/年。`, { year }),
    );
    assert.equal(budget(matched).status, "match");
    assert.match(
      budget(matched).reason,
      new RegExp(`${year}年历史学费作参考比较`),
    );
    assert.match(budget(matched).reason, /2027年收费及适用条件仍待核对/);
    assert.equal(budget(matched).reason.includes("2027年度学费"), false);
    const over = deriveRecommendationConstraints(
      fee(`甲大学${year}年教育学硕士全日制学费12000元/年。`, {
        year,
        amount: 12000,
      }),
    );
    assert.equal(budget(over).status, "mismatch");
    assert.match(
      budget(over).reason,
      new RegExp(`${year}年历史学费作参考比较`),
    );
    assert.match(budget(over).reason, /2027年收费及适用条件仍待核对/);
  }
  const whole = deriveRecommendationConstraints(
    fee("甲大学2026年教育学硕士全日制全程学费8000元。", {
      year: 2026,
      period: "program",
    }),
  );
  assert.equal(budget(whole).status, "unknown");
  assert.match(budget(whole).reason, /2026年历史.*全程/);
  const unspecified = deriveRecommendationConstraints(
    fee(
      "甲大学2026年教育学硕士学费8000元/年。",
      { year: 2026, studyMode: "unspecified" },
      { studyMode: undefined },
    ),
  );
  assert.equal(budget(unspecified).status, "unknown");
  assert.match(budget(unspecified).reason, /未明确学习形式/);
});

test("unknown budget, absent evidence and open-ended budget do not invent numeric limits", () => {
  for (const value of ["", "不确定", "预算看情况", "10000"]) {
    const result = deriveRecommendationConstraints(
      input({ profile: { budget: value, cities: [] } }),
    );
    assert.equal(budget(result).status, "unknown");
  }
  const absent = deriveRecommendationConstraints(
    input({ tuition: undefined, location: undefined, sources: [] }),
  );
  assert.equal(budget(absent).status, "unknown");
  assert.equal(cities(absent).status, "unknown");
  const open = deriveRecommendationConstraints(
    fee(
      "甲大学2027年教育学硕士全日制学费12万元/年。",
      { amount: 120000 },
      { profile: { budget: "10 万元以上", cities: [] } },
    ),
  );
  assert.equal(budget(open).status, "unknown");
  assert.match(budget(open).reason, /未给出上限/);
});

test("labelled academic HTTP pages support cited tuition and location while keeping verification independent", () => {
  const value = deriveRecommendationConstraints(
    input({
      sources: [
        source("fee", feeQuote, {
          url: "http://yz.example.edu.cn/fee",
          transport: "http",
        }),
        source("address", addressQuote, {
          url: "http://yz.example.edu.cn/address",
          transport: "http",
        }),
      ],
    }),
  );
  assert.equal(value.tuition?.amount, 8000);
  assert.equal(value.location?.city, "上海");
  assert.equal(budget(value).status, "match");
});

test("tuition must be a continuous quote in an actually read cited school source", () => {
  const base = input();
  const original = base.tuition as Record<string, unknown>;
  const cases = [
    input({ citations: ["address"] }),
    input({ sources: [source("fee", feeQuote, { kind: "search_snippet" })] }),
    input({
      sources: [source("fee", feeQuote, { url: "http://yz.example.com/fee" })],
    }),
    input({
      tuition: {
        ...original,
        quote: "甲大学2027年教育学硕士……全日制学费8000元/生·学年。",
      },
    }),
    input({ sources: [source("fee", feeQuote.replace("甲大学", "乙大学"))] }),
    input({ sources: [source("fee", feeQuote), source("fee", feeQuote)] }),
    input({ tuition: { ...original, amount: 6000 } }),
    input({ tuition: { ...original, year: 2028 } }),
    input({ tuition: { ...original, currency: "USD" } }),
    input({ tuition: { ...original, amount: Infinity } }),
    input({ tuition: { ...original, period: "program" } }),
    input({
      tuition: {
        ...original,
        quote: "甲大学2027年教育学硕士 … 全日制学费8000元/生·学年。",
      },
      sources: [
        source("fee", "甲大学2027年教育学硕士 … 全日制学费8000元/生·学年。"),
      ],
    }),
  ];
  for (const value of cases) {
    const result = deriveRecommendationConstraints(value);
    assert.equal(result.tuition, undefined);
    assert.equal(budget(result).status, "unknown");
  }
});

test("fees cannot migrate from a neighboring program, a university-wide amount, a different degree or accommodation", () => {
  for (const text of [
    "甲大学2027年教育学全日制硕士招生。金融硕士学费8000元/年。",
    "甲大学2027年硕士研究生学费8000元/年。教育学全日制硕士招生。",
    "甲大学2027年硕士学费标准：\n教育学全日制硕士\n金融全日制硕士8000元/年。",
    "甲大学2027年教育学专业学位硕士全日制学费8000元/年。",
    "甲大学2027年教育学硕士全日制学费待定，住宿费8000元/年。",
    "甲大学2027年教育学硕士全日制学费12000元/年，金融硕士学费8000元/年。",
    "甲大学2027年教育学硕士全日制学费另定，025100金融硕士学费8000元/年。",
    "甲大学2027年教育学硕士全日制学费待定，金融硕士学费8000元/年。",
    "甲大学2027年教育学硕士全日制每年招收20人，学费8000元。",
    "甲大学教育学硕士全日制学费8000元/年。2027年金融硕士招生。",
    "甲大学2027年比较教育学硕士全日制学费8000元/年。",
    "甲大学2027年教育学原理硕士全日制学费8000元/年。",
  ]) {
    assert.equal(
      deriveRecommendationConstraints(fee(text)).tuition,
      undefined,
      text,
    );
  }
});

test("learning mode must match and an unspecified mode cannot produce a definitive budget comparison", () => {
  assert.equal(
    deriveRecommendationConstraints(
      fee("甲大学2027年教育学硕士非全日制学费8000元/年。"),
    ).tuition,
    undefined,
  );
  const result = deriveRecommendationConstraints(
    fee(
      "甲大学2027年教育学硕士学费8000元/年。",
      { studyMode: "unspecified" },
      { studyMode: undefined },
    ),
  );
  assert.equal(result.tuition?.studyMode, "unspecified");
  assert.equal(budget(result).status, "unknown");
  assert.equal(
    deriveRecommendationConstraints(
      fee("甲大学2027年教育学硕士全日制和非全日制学费8000元/年。"),
    ).tuition,
    undefined,
  );
  const neighboringMode = deriveRecommendationConstraints(
    fee(
      "甲大学2027年教育学硕士学费8000元/年。金融硕士全日制培养。",
      { studyMode: "unspecified" },
      { studyMode: undefined },
    ),
  );
  assert.equal(neighboringMode.tuition?.studyMode, "unspecified");
  assert.equal(budget(neighboringMode).status, "unknown");
});

test("location requires an address linked to the school/project, not its name, promotional text or an ambiguous campus", () => {
  for (const quote of [
    "甲大学教育学硕士欢迎上海考生报考。",
    "甲大学教育学硕士就业辐射上海市。",
    "甲大学地址：上海市；教育学硕士分属北京校区和上海校区。",
    "甲大学教育学硕士培养地址：北京市海淀区。",
  ]) {
    const result = deriveRecommendationConstraints(
      input({
        sources: [source("address", quote)],
        location: { city: "上海", quote, sourceId: "address" },
      }),
    );
    assert.equal(result.location, undefined, quote);
    assert.equal(cities(result).status, "unknown");
  }
});

test("table-like header years and explicit project row can be quoted, and friend links cannot establish a school owner", () => {
  const result = deriveRecommendationConstraints(
    fee("甲大学2027年硕士学费标准\n教育学 全日制 学费8,000元/生·年"),
  );
  assert.equal(result.tuition?.amount, 8000);
  const quote = "教育学2027年全日制学费8000元/年。";
  const wrong = deriveRecommendationConstraints(
    input({
      tuition: { ...(input().tuition as object), quote },
      sources: [source("fee", `乙大学。${quote}友情链接：甲大学。`)],
    }),
  );
  assert.equal(wrong.tuition, undefined);
});
