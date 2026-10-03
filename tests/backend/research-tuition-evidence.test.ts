import test from "node:test";
import assert from "node:assert/strict";
import { deriveRecommendationConstraints } from "../../server/explanation/research-constraints.ts";
import type { RecommendationConstraintInput } from "../../server/explanation/research-constraints.ts";
import type { WebSource } from "../../server/explanation/web.ts";

function source(excerpt: string, changes: Partial<WebSource> = {}): WebSource {
  return {
    id: "fee",
    title: "甲大学硕士研究生收费资料",
    url: "https://yz.example.edu.cn/tuition.pdf",
    kind: "official_page",
    retrievedAt: "2026-10-04T00:00:00Z",
    verified: false,
    excerpt,
    ...changes,
  };
}
function input(
  excerpt: string,
  changes: Partial<RecommendationConstraintInput> = {},
): RecommendationConstraintInput {
  return {
    profile: { budget: "1万元以内", cities: [] },
    institutionName: "甲大学",
    programName: "教育学",
    degreeType: "academic",
    targetYear: 2027,
    studyMode: "full_time",
    citations: ["admission"],
    sources: [source(excerpt)],
    ...changes,
  };
}
const budget = (value: ReturnType<typeof deriveRecommendationConstraints>) =>
  value.constraintChecks.find((item) => item.field === "budget")!;

test("an omitted model tuition field is recovered from a separate read school source and carries its citation", () => {
  const result = deriveRecommendationConstraints(
    input("甲大学2027年教育学硕士全日制学费8000元/生·学年。"),
  );
  assert.equal(result.tuition?.amount, 8000);
  assert.equal(result.tuition?.sourceId, "fee");
  assert.equal(budget(result).status, "match");
  assert.deepEqual(budget(result).sourceIds, ["fee"]);
});

test("PDF project line wraps retain the cohort year and program-wide price without annualizing", () => {
  const excerpt =
    "甲大学教育收费项目公示表\n一、2023级研究生收费\n全日制控制工程硕士专业学位\n研究生学费 4万元/生·全程 浙大发计〔2022〕11号";
  const result = deriveRecommendationConstraints(
    input(excerpt, { programName: "控制工程", degreeType: "professional" }),
  );
  assert.equal(result.tuition?.amount, 40000);
  assert.equal(result.tuition?.year, 2023);
  assert.equal(result.tuition?.period, "program");
  assert.equal(result.tuition?.studyMode, "full_time");
  assert.ok(excerpt.includes(result.tuition!.quote));
  assert.equal(budget(result).status, "unknown");
  assert.match(budget(result).reason, /2023.*历史/);
});

test("a table numeric amount uses its explicit yuan and annual unit header", () => {
  const result = deriveRecommendationConstraints(
    input(
      "甲大学2027年硕士学费标准（元/生·学年）\n专业代码 专业名称 学习形式\n040100 教育学 全日制 8,000",
    ),
  );
  assert.equal(result.tuition?.amount, 8000);
  assert.equal(result.tuition?.period, "academic_year");
  assert.equal(budget(result).status, "match");
});

test("column units below a dated fee heading are usable for a later project row", () => {
  const result = deriveRecommendationConstraints(
    input(
      "甲大学2027年硕士收费标准\n专业名称 学习形式 学费标准（元/生·学年）\n心理学 全日制 10000\n教育学 全日制 8000",
    ),
  );
  assert.equal(result.tuition?.amount, 8000);
  assert.equal(result.tuition?.year, 2027);
});

test("a specific field's price cannot become the broader professional category's tuition", () => {
  for (const excerpt of [
    "甲大学2023级研究生收费\n全日制电子信息硕士专业学位类别计算机技术领域研究生学费4万元/生·全程",
    "甲大学2023级研究生收费\n非全日制电子信息类别软件工程/人工智能专业学位研究生学费9万元/生·全程",
  ]) {
    assert.equal(
      deriveRecommendationConstraints(
        input(excerpt, {
          programName: "电子信息",
          degreeType: "professional",
          studyMode: undefined,
        }),
      ).tuition,
      undefined,
    );
  }
});

test("separate learning modes are filtered to the actual candidate and stay ambiguous without one", () => {
  const excerpt =
    "甲大学2027年硕士学费标准\n教育学 全日制 学费8000元/生·学年\n教育学 非全日制 学费12000元/生·学年";
  assert.equal(
    deriveRecommendationConstraints(input(excerpt)).tuition?.amount,
    8000,
  );
  assert.equal(
    deriveRecommendationConstraints(input(excerpt, { studyMode: undefined }))
      .tuition,
    undefined,
  );
});

test("conflicting same-year project prices cannot be selected by their affordability", () => {
  const result = deriveRecommendationConstraints(
    input(
      "甲大学2027年硕士学费标准\n教育学 全日制 学费8000元/年\n教育学 全日制 学费12000元/年",
    ),
  );
  assert.equal(result.tuition, undefined);
  assert.equal(budget(result).status, "unknown");
});

test("a current official price is preferred to historical evidence using its own cohort heading", () => {
  const excerpt =
    "甲大学2026年硕士学费标准\n教育学 全日制 学费6000元/年\n2027年硕士学费标准\n教育学 全日制 学费8000元/年";
  const result = deriveRecommendationConstraints(input(excerpt));
  assert.equal(result.tuition?.year, 2027);
  assert.equal(result.tuition?.amount, 8000);
});

test("a long fee table allows a continuous local quote and checks its cohort in the read source", () => {
  const excerpt = `甲大学2027年硕士学费标准\n${"心理学 全日制 学费9000元/年\n".repeat(120)}教育学 全日制 学费8000元/年`;
  const result = deriveRecommendationConstraints(input(excerpt));
  assert.equal(result.tuition?.amount, 8000);
  assert.equal(result.tuition?.quote, "教育学 全日制 学费8000元/年");
  assert.equal(budget(result).status, "match");
});

test("omitted tuition does not bypass source, project, degree, row, currency-unit or cohort boundaries", () => {
  for (const excerpt of [
    "甲大学2027年硕士学费标准\n教育学 全日制硕士\n金融 全日制硕士 学费8000元/年",
    "甲大学2027年硕士学费标准\n学术学位研究生8000元/年。教育学全日制硕士招生。",
    "甲大学2027年专业学位硕士收费标准\n教育学 全日制 学费8000元/年",
    "甲大学2027年硕士学费标准\n教育学 博士 全日制 学费8000元/年",
    "甲大学2027年硕士学费标准\n二、本科生收费\n教育学 全日制 学费8000元/年",
    "甲大学2026年硕士学费标准\n二、2027年收费\n教育学 全日制 学费8000元/年",
    "甲大学2027年硕士学费标准\n教育学 全日制 学费待定，住宿费8000元/年",
    "甲大学2027年硕士学费标准\n教育学 全日制 8000",
    "甲大学2027年硕士学费标准（元/生·学年）\n教育学 全日制 8000 3",
    "甲大学硕士收费标准\n教育学 全日制 学费8000元/年 浙价费〔2027〕11号",
    "甲大学2027年硕士学费标准 … 教育学 全日制 学费8000元/年",
    "乙大学2027年教育学硕士全日制学费8000元/年。友情链接：甲大学。",
  ]) {
    assert.equal(
      deriveRecommendationConstraints(input(excerpt)).tuition,
      undefined,
      excerpt,
    );
  }
  for (const changes of [
    { kind: "search_snippet" },
    { url: "http://yz.example.edu.cn/fee" },
  ] as Partial<WebSource>[]) {
    const excerpt = "甲大学2027年教育学硕士全日制学费8000元/年。";
    assert.equal(
      deriveRecommendationConstraints(
        input(excerpt, { sources: [source(excerpt, changes)] }),
      ).tuition,
      undefined,
    );
  }
});

test("an explicit incorrect model tuition value remains rejected even when extraction could recover it", () => {
  const quote = "甲大学2027年教育学硕士全日制学费8000元/年。";
  const result = deriveRecommendationConstraints(
    input(quote, {
      citations: ["fee"],
      tuition: {
        amount: 6000,
        currency: "CNY",
        period: "academic_year",
        year: 2027,
        studyMode: "full_time",
        quote,
        sourceId: "fee",
      },
    }),
  );
  assert.equal(result.tuition, undefined);
  assert.equal(budget(result).status, "unknown");
});

test("dedicated Hong Kong/Macao/Taiwan or international-student tariffs cannot become ordinary domestic tuition", () => {
  const quote = "甲大学2027年教育学硕士全日制学费8000元/年。";
  for (const title of [
    "甲大学2027年招收港澳台地区研究生学费标准",
    "甲大学来华留学生硕士收费标准",
    "甲大学外国留学生招生简章",
  ]) {
    assert.equal(
      deriveRecommendationConstraints(
        input(quote, { sources: [source(quote, { title })] }),
      ).tuition,
      undefined,
      title,
    );
  }
  const text =
    "甲大学2027年港澳台地区研究生收费标准\n教育学 全日制 学费8000元/年";
  assert.equal(deriveRecommendationConstraints(input(text)).tuition, undefined);
  assert.equal(
    deriveRecommendationConstraints(
      input(
        `甲大学2027年硕士学费标准\n二、来华留学生\n教育学 全日制 学费8000元/年`,
      ),
    ).tuition,
    undefined,
  );
});

test("mixed identity fee documents use explicit local scopes and stay unknown when a project's population is unresolved", () => {
  const text =
    "甲大学2027年硕士学费标准\n一、港澳台研究生收费标准\n教育学 全日制 学费12000元/年\n二、普通统考研究生收费标准\n教育学 全日制 学费8000元/年";
  const result = deriveRecommendationConstraints(
    input(text, {
      sources: [
        source(text, { title: "甲大学普通统考及港澳台研究生收费标准" }),
      ],
    }),
  );
  assert.equal(result.tuition?.amount, 8000);
  const ambiguous = "甲大学2027年硕士学费标准\n教育学 全日制 学费8000元/年";
  assert.equal(
    deriveRecommendationConstraints(
      input(ambiguous, {
        sources: [
          source(ambiguous, { title: "甲大学普通统考及港澳台研究生收费标准" }),
        ],
      }),
    ).tuition,
    undefined,
  );
});

test("navigation and friend links mentioning special populations do not veto a plain domestic fee statement", () => {
  for (const text of [
    "甲大学网站导航：硕士招生 港澳台招生 国际招生。\n甲大学2027年教育学硕士全日制学费8000元/年。\n友情链接：港澳台学生事务办公室。",
    "甲大学网站导航：港澳台研究生学费标准。\n甲大学2027年教育学硕士全日制学费8000元/年。",
  ]) {
    assert.equal(
      deriveRecommendationConstraints(input(text)).tuition?.amount,
      8000,
    );
  }
});
