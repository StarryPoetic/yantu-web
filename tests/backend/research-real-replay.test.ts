import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  realReplayFixture,
  replayDisciplines,
  runRealReplay,
} from "../helpers/research-real-replay.ts";
import {
  extractPriorityFacts,
  priorityCoverage,
  validatePriorityFacts,
} from "../../server/explanation/research-priority-facts.ts";
import {
  createSearchBudget,
  searchConfigFromEnvironment,
} from "../../server/explanation/search.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import { researchAttachments } from "../../server/explanation/research-pages.ts";
import { runRealReportReplay } from "../helpers/research-real-report-replay.ts";
import { programEntries } from "../../server/explanation/research-matching.ts";
import { replayAcceptanceCriteria } from "../helpers/research-replay-live.ts";
import { missingPriorityQueries } from "../../server/explanation/research-targeted.ts";
const fixture = realReplayFixture();
test("paid acceptance uses field mean, five schools, deadline and a completed final analysis", () => {
  const input = {
    elapsedMs: 500000,
    recommendations: 5,
    status: "partial",
    finalCompleted: true,
    partialAverage: 0.6,
  };
  assert.equal(replayAcceptanceCriteria(input).passed, true);
  for (const delta of [
    { recommendations: 4 },
    { partialAverage: 0.599 },
    { elapsedMs: 600001 },
    { finalCompleted: false },
    { reason: "BUDGET_EXHAUSTED" },
  ])
    assert.equal(
      replayAcceptanceCriteria({ ...input, ...delta }).passed,
      false,
    );
});
test("queries keep official concrete major name and code rather than another selected discipline", () => {
  const mechanical = replayDisciplines().find((d) => d.code === "0855")!;
  const queries = missingPriorityQueries(
    "杭州电子科技大学",
    mechanical,
    "2027",
    [],
    { majorCode: "085500", programName: "机械", collegeName: "机械工程学院" },
  );
  assert.ok(
    queries.every((q) => q.includes("085500 机械 ") && !q.includes("080200")),
  );
  for (const term of [
    "复试基本分数线",
    "报录统计",
    "生源质量",
    "学科评估",
    "就业质量报告",
  ])
    assert.ok(queries.some((q) => q.includes(term)));
});
test("real replay keeps 218 observed URLs; missing responses are not synthetic answers", () => {
  assert.equal(fixture.pages.length, 218);
  assert.equal(fixture.pages.filter((p) => p.source).length, 56);
  assert.equal(fixture.runs.flatMap((r) => r.queries).length, 120);
  assert.ok(fixture.pages.some((p) => !p.source));
  for (const p of fixture.pages) {
    if (p.source)
      assert.doesNotMatch(p.source.excerpt, /(?<!\d)\d{14,18}(?!\d)/);
  }
});
test("saved Hangzhou Dianzi PDF yields bounded admissions statistics, not invented recommendation zeros or cutoff", () => {
  const s = fixture.pages.find((p) => p.url.includes("bb749fd9"))!.source!;
  const facts = extractPriorityFacts(s, replayDisciplines(), "2027", {
    total: 350,
    maximum: 500,
  }).filter((f) => f.majorCode === "085500");
  assert.equal(
    facts.find((f) => f.field === "admittedCount")?.value.number,
    145,
  );
  assert.equal(
    facts.find((f) => f.field === "admittedCount")?.value.applicants,
    260,
  );
  assert.equal(
    facts.find((f) => f.field === "admissionScore")?.value.number,
    264,
  );
  assert.ok(
    facts.every((f) => f.collegeName === "机械工程学院" && !f.value.targetGap),
  );
  assert.ok(
    facts.every(
      (f) =>
        s.excerpt.includes(f.quote) &&
        f.evidenceQuotes?.every((q) => s.excerpt.includes(q)),
    ),
  );
  assert.ok(
    !facts.some((f) =>
      ["cutoff", "recommendationShare", "applicationAdmissionRatio"].includes(
        f.field,
      ),
    ),
  );
  assert.match(facts[0].value.population!, /士兵计划/);
  assert.equal(
    validatePriorityFacts(
      [
        {
          sourceId: s.id,
          field: "admittedCount",
          quote: "085500机械录取999人",
        },
      ],
      s,
      replayDisciplines(),
      "2027",
    ).length,
    0,
  );
});
test("real college-code header and employment policy negatives", () => {
  const s = fixture.pages.find((p) => p.url.endsWith("/8507.htm"))!.source!;
  const facts = extractPriorityFacts(s, replayDisciplines(), "2027");
  const entry = programEntries(s, replayDisciplines()).find(
    (p) => p.majorCode === "080200",
  );
  assert.equal(entry?.collegeName, "机械工程学院");
  assert.ok(s.excerpt.includes(entry!.catalogQuote));
  assert.equal(
    facts.find((f) => f.majorCode === "080200")?.collegeName,
    "机械工程学院",
  );
  for (const p of fixture.pages.filter((p) =>
    /3395.htm|8385.htm|577822/.test(p.url),
  )) {
    assert.ok(
      !extractPriorityFacts(p.source!, replayDisciplines(), "2027").some(
        (f) => f.field === "employment" || f.field === "cityDevelopment",
      ),
    );
  }
  const quote = "2026年机械工程硕士毕业生去向落实率：95%";
  const employment = { ...s, excerpt: `浙江理工大学\n${quote}` };
  const accepted = validatePriorityFacts(
    [{ field: "employment", sourceId: s.id, quote }],
    employment,
    replayDisciplines(),
    "2027",
  );
  assert.equal(accepted[0]?.value.employmentRate, 95);
});
test("full generation on the real public corpus calls final analysis and exports both coverage definitions", async () => {
  const { report, finalCalls, searches } = await runRealReportReplay();
  assert.equal(finalCalls, 1);
  assert.ok(report.recommendations.length > 0);
  assert.ok(
    report.priorityFacts?.some(
      (f) => f.schoolName === "杭州电子科技大学" && f.field === "admittedCount",
    ),
  );
  assert.ok(
    report.priorityCoverage!.partialAverage >
      report.priorityCoverage!.completeAverage,
  );
  assert.match(
    report.limitations.join("\n"),
    /字段级部分覆盖率.*整类完整覆盖率/,
  );
  assert.ok(searches <= B.searches);
  const audited = JSON.parse(
    readFileSync(
      new URL("../fixtures/research-real-replay-audit.json", import.meta.url),
      "utf8",
    ),
  ) as {
    school: string;
    field: string;
    year: number | null;
    reviewedUrls: string[];
    evidence: string;
  }[];
  const missing = report.priorityCoverage!.schools.flatMap((s) => [
    ...s.missingScoreYears.map((x) => `${s.schoolName}:${x.field}:${x.year}`),
    ...s.pending
      .filter((f) => !["cutoff", "admissionScore"].includes(f))
      .map((f) => `${s.schoolName}:${f}:null`),
  ]);
  assert.deepEqual(
    audited.map((x) => `${x.school}:${x.field}:${x.year}`).sort(),
    missing.sort(),
  );
  assert.ok(
    audited.every(
      (x) =>
        x.evidence.length > 20 &&
        x.reviewedUrls.every((url) =>
          fixture.pages.some((p) => p.url === url && p.source),
        ),
    ),
  );
  assert.ok(
    !report.sources.some(
      (s, i, all) => all.findIndex((p) => p.id === s.id) !== i,
    ),
  );
});
test("official historical-data URL in prose becomes a bounded same-school lead", () => {
  const s = fixture.pages.find((p) => p.url.includes("547458"))!.source!;
  assert.ok(
    researchAttachments(s, s.excerpt, {
      targetYear: "2027",
      maxLinks: 12,
    }).some((l) => l.url === "https://yzw.zjnu.edu.cn/wnzssj/list.htm"),
  );
  assert.ok(
    !researchAttachments(
      { ...s, excerpt: "历年招生数据 https://127.0.0.1/x.htm" },
      "",
    ).length,
  );
});
test("deployment legacy allowance supports all 72 requests without resetting ledger; zero remains disabled", () => {
  const config = searchConfigFromEnvironment({
    YANTU_SEARCH_USER_DAILY_REQUESTS: "60",
    YANTU_SEARCH_DAILY_REQUESTS: "300",
  });
  const budget = createSearchBudget(config);
  for (let i = 0; i < B.searches; i++) assert.ok(budget.claim("same", "day"));
  assert.equal(budget.claim("same", "day"), false);
  assert.equal(
    createSearchBudget(
      searchConfigFromEnvironment({ YANTU_SEARCH_USER_DAILY_REQUESTS: "0" }),
    ).claim("same", "day"),
    false,
  );
});
test("real replay drains saved leads, records unavailable bodies, and preserves partial versus complete coverage", async () => {
  const r = await runRealReplay(1);
  assert.equal(r.deniedSearches, 0);
  assert.ok(r.reads > 34, JSON.stringify(r));
  assert.ok(r.success > 16);
  assert.ok(r.uncapturedReads > 0);
  assert.ok(r.coverage.partialAverage > r.coverage.completeAverage);
  assert.ok(
    r.facts.some(
      (f) => f.schoolName === "杭州电子科技大学" && f.field === "admittedCount",
    ),
  );
  assert.equal(r.paidCalls, 0);
  assert.equal(priorityCoverage([], [], "2027").partialAverage, 0);
});
