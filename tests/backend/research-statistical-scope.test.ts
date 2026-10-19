import test from "node:test";
import assert from "node:assert/strict";
import {
  ratioStatistics,
  backgroundStatistics,
  graduateEmploymentScope,
} from "../../server/explanation/research-statistical-scope.ts";
import {
  extractPriorityFacts,
  validatePriorityFacts,
  priorityFactMatches,
} from "../../server/explanation/research-priority-facts.ts";
import { loadEvidenceCorpus } from "../../scripts/research-evidence-audit.ts";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const corpus = loadEvidenceCorpus();
const disciplines = getDisciplineCatalog().items.filter((d) =>
  ["0802", "0855"].includes(d.code),
);
// Explicitly synthetic public statistics; never included in the real-evidence ledger.
const prefix = "2026年机械工程学院085500机械全日制硕士研究生";
const ratio = `${prefix}一志愿报考人数120人，一志愿实际录取人数30人，报录比4:1`;
const share = `${prefix}实际录取总人数100人，其中推免录取人数20人，推免占比20%`;
function source(quote: string): WebSource {
  return {
    id: "synthetic-statistics",
    url: "https://yjs.hdu.edu.cn/synthetic",
    title: "杭州电子科技大学2026年硕士研究生统计",
    excerpt: `杭州电子科技大学\n${quote}`,
    kind: "official_page",
    verified: false,
    retrievedAt: "2026-10-20T00:00:00Z",
  };
}

test("ratios require actual same-population counts and preserve their denominator; explicit zero differs from blank", () => {
  const result = ratioStatistics("applicationAdmissionRatio", ratio)!;
  assert.equal(result.number, 4);
  assert.deepEqual(result.ratioBasis, {
    numerator: 120,
    denominator: 30,
    numeratorLabel: "一志愿报考人数",
    denominatorLabel: "一志愿实际录取人数",
  });
  for (const bad of [
    ratio.replace("一志愿实际录取人数", "总录取人数"),
    ratio.replace("一志愿实际录取人数", "一志愿计划录取人数"),
    ratio.replace("4:1", "5:1"),
    `${prefix}报录比4:1`,
    ratio.replace("120人", "约120人"),
    ratio.replace("30人", "0人"),
  ])
    assert.equal(
      ratioStatistics("applicationAdmissionRatio", bad),
      undefined,
      bad,
    );
  assert.equal(ratioStatistics("recommendationShare", share)!.number, 20);
  assert.equal(
    ratioStatistics(
      "recommendationShare",
      share.replace("20人", "0人").replace("20%", "0%"),
    )!.number,
    0,
  );
  for (const bad of [
    share.replace("20人", "—"),
    `${prefix}推免占比20%`,
    share.replace("总人数100人", "总人数100人（不含推免）"),
    share.replace("20人", "120人"),
  ])
    assert.equal(ratioStatistics("recommendationShare", bad), undefined);
  const mixedYears = ratio.replace("一志愿实际录取", "2025年一志愿实际录取");
  assert.equal(
    extractPriorityFacts(source(mixedYears), disciplines, "2027").filter(
      (f) => f.field === "applicationAdmissionRatio",
    ).length,
    0,
  );
  for (const marker of ["届", "级"])
    assert.equal(
      ratioStatistics(
        "applicationAdmissionRatio",
        ratio.replace("一志愿实际录取", `2025${marker}一志愿实际录取`),
      ),
      undefined,
    );
});

test("explicit table populations retain part-time scope and reject mixed modes or generic totals", () => {
  const title = "杭州电子科技大学2026年非全日制硕士研究生报录统计";
  const text =
    "学院 | 专业代码 | 专业名称 | 一志愿报考人数 | 一志愿实际录取人数\n机械工程学院 | 085500 | 机械 | 120 | 30";
  const s = { ...source(text), title, excerpt: `${title}\n${text}` };
  const facts = extractPriorityFacts(s, disciplines, "2027");
  const ratio = facts.find((f) => f.field === "applicationAdmissionRatio")!;
  assert.equal(ratio.value.number, 4);
  assert.match(ratio.value.population!, /非全日制/);
  for (const change of [
    { ...s, title: title + "与全日制硕士研究生" },
    { ...s, excerpt: s.excerpt.replaceAll("一志愿实际录取人数", "录取人数") },
  ])
    assert.equal(
      extractPriorityFacts(change, disciplines, "2027").filter(
        (f) => f.field === "applicationAdmissionRatio",
      ).length,
      0,
    );
});

test("background needs actual graduate cohort counts; digits in years and codes cannot substitute for counts", () => {
  const positive = `${prefix}实际录取新生中，双非本科生20人，跨专业考生10人`;
  assert.equal(
    backgroundStatistics("undergraduateAdmission", positive)!.number,
    20,
  );
  assert.equal(
    backgroundStatistics("crossMajorAdmission", positive)!.number,
    10,
  );
  for (const bad of [
    `${prefix}录取学生包括双非本科毕业生`,
    `${prefix}欢迎跨专业报考`,
    `${prefix}对双非学生友好`,
    "2026年085500普通本科录取新生4204人",
  ]) {
    assert.equal(
      backgroundStatistics("undergraduateAdmission", bad),
      undefined,
    );
    assert.equal(backgroundStatistics("crossMajorAdmission", bad), undefined);
  }
});

test("different study modes, applicant backgrounds and another faculty cannot be merged into one population", () => {
  assert.equal(
    ratioStatistics(
      "applicationAdmissionRatio",
      ratio.replace("一志愿实际录取人数", "非全日制一志愿实际录取人数"),
    ),
    undefined,
  );
  assert.equal(
    backgroundStatistics(
      "undergraduateAdmission",
      `${prefix}实际录取30人，报考该项目的双非考生200人`,
    ),
    undefined,
  );
  const quote = "2026年机械工程学院发布就业报告，控制学院硕士毕业生就业率：95%";
  assert.equal(graduateEmploymentScope(quote), undefined);
  assert.equal(
    extractPriorityFacts(source(quote), disciplines, "2027").filter(
      (f) => f.field === "employment",
    ).length,
    0,
  );
});

test("real ZUST undergraduate enrolment and an adjacent historical year cannot pass model-proposed graduate background validation", () => {
  const page = corpus.pages.find(
    (p) => p.url === "https://www.zust.edu.cn/info/1089/2002.htm",
  )!;
  assert.ok(page.source);
  const text = page.source!.excerpt;
  const start = text.indexOf("日前，我校");
  const end = text.indexOf("。", text.indexOf("2015年", start)) + 1;
  const quote = text.slice(start, end).trim();
  assert.ok(quote.length > 8 && quote.length <= 600);
  assert.match(quote, /普通本科新生4204人/);
  assert.match(quote, /2015年/);
  assert.equal(
    validatePriorityFacts(
      [{ field: "undergraduateAdmission", sourceId: page.source!.id, quote }],
      page.source!,
      disciplines,
      "2027",
    ).length,
    0,
  );
});

test("real HDU first-choice applicants cannot be divided by all admitted students or imply zero recommended students", () => {
  const facts = corpus.pages
    .filter((p) => p.source && p.url.includes("hdu.edu.cn"))
    .flatMap((p) => extractPriorityFacts(p.source!, disciplines, "2027"));
  const count = facts.find(
    (f) =>
      f.field === "admittedCount" &&
      f.year === 2026 &&
      f.majorCode === "085500",
  )!;
  assert.equal(count.value.applicants, 260);
  assert.equal(count.value.number, 145);
  assert.equal(
    facts.filter((f) =>
      ["applicationAdmissionRatio", "recommendationShare"].includes(f.field),
    ).length,
    0,
  );
});

test("employment keeps faculty or graduate-school scope and refuses programme advertising and college transfer", () => {
  assert.equal(
    graduateEmploymentScope("2026年085500机械硕士毕业生就业率98%"),
    undefined,
  );
  assert.equal(graduateEmploymentScope("2026年本科毕业生就业率98%"), undefined);
  const schoolQuote = "2026年研究生院公布全校硕士毕业生就业率：96%";
  const school = extractPriorityFacts(
    source(schoolQuote),
    disciplines,
    "2027",
  ).find((f) => f.field === "employment")!;
  assert.equal(school.scope, "school");
  assert.equal(school.majorCode, undefined);
  const facultyQuote = "2026年机械工程学院硕士毕业生就业率：95%";
  const faculty = extractPriorityFacts(
    source(facultyQuote),
    disciplines,
    "2027",
  ).find((f) => f.field === "employment")!;
  assert.equal(faculty.collegeName, "机械工程学院");
  assert.equal(
    priorityFactMatches(faculty, {
      institutionName: "杭州电子科技大学",
      disciplineCode: "0855",
      majorCode: "085500",
      collegeName: "艺术设计学院",
    }),
    false,
  );
  assert.equal(
    priorityFactMatches(faculty, {
      institutionName: "杭州电子科技大学",
      disciplineCode: "0855",
      majorCode: "085500",
    }),
    false,
  );
  const real = corpus.pages
    .filter((p) => p.source && p.url.includes("zstu.edu.cn"))
    .flatMap((p) => extractPriorityFacts(p.source!, disciplines, "2027"))
    .find((f) => f.field === "employment" && f.collegeName === "机械工程学院")!;
  assert.equal(real.value.employmentRate, 97.79);
  assert.equal(real.majorCode, undefined);
  assert.match(real.value.population!, /学院毕业研究生/);
});
