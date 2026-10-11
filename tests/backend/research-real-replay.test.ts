import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  realReplayFixture,
  combinedRealReplayFixture,
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
import {
  missingPriorityQueries,
  fairPriorityQueries,
  priorityQueryCategory,
} from "../../server/explanation/research-targeted.ts";
const fixture = realReplayFixture();
test("cumulative real corpus has an evidence audit for every unfilled recommended slot", async () => {
  const combined = combinedRealReplayFixture();
  const result = await runRealReportReplay(combined);
  const coverage = result.report.priorityCoverage!;
  const audit = JSON.parse(
    readFileSync("tests/fixtures/research-v3a6-audit.json", "utf8"),
  );
  const missing = coverage.schools.flatMap((school) => [
    ...school.missingScoreYears.map(
      (x) => `${school.schoolName}:${x.field}:${x.year}`,
    ),
    ...school.pending
      .filter((x) => x !== "cutoff" && x !== "admissionScore")
      .map((x) => `${school.schoolName}:${x}:`),
  ]);
  assert.deepEqual(
    new Set(
      audit.map(
        (x: { school: string; field: string; year?: number }) =>
          `${x.school}:${x.field}:${x.year ?? ""}`,
      ),
    ),
    new Set(missing),
  );
  assert.equal(result.searches, B.searches);
  assert.equal(result.peakSearches, B.initialSearchConcurrency);
  assert.equal(result.finalCalls, 1);
  assert.ok(combined.pages.filter((p) => p.source).length >= 210);
  assert.ok(coverage.confirmed >= 8);
  for (const row of audit) {
    assert.ok(row.evidence.length > 20);
    assert.ok(row.reviewedUrls.length > 0);
    assert.ok(
      row.reviewedUrls.every((url: string) =>
        combined.pages.some((p) => p.url === url && p.source),
      ),
    );
  }
});
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
  assert.ok(queries.every((q) => !q.includes("080200")));
  assert.ok(
    queries
      .filter((q) => /复试|初试成绩/.test(q))
      .every((q) => q.includes("085500 机械 ")),
  );
  assert.ok(
    queries
      .filter((q) => /就业|生源/.test(q))
      .every((q) => !/085500|2026|机械工程学院/.test(q)),
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
test("many faculty variants cannot consume the allowance before every missing category gets a query", () => {
  const lists = Array.from({ length: 5 }, (_, i) =>
    missingPriorityQueries("浙江科技大学", replayDisciplines()[0], "2027", [], {
      majorCode: `08020${i}`,
      programName: "机械工程",
      collegeName: `学院${i}`,
    }),
  );
  assert.deepEqual(
    new Set(fairPriorityQueries(lists).slice(0, 5).map(priorityQueryCategory)),
    new Set(["scores", "competition", "background", "academic", "employment"]),
  );
  assert.ok(fairPriorityQueries(lists).every((q) => q.length < 60));
});
test("first new live corpus is retained and curriculum rows cannot count as city development", () => {
  const live = realReplayFixture("research-v3a6-run1.json");
  assert.equal(live.pages.length, 484);
  assert.equal(live.pages.filter((p) => p.source).length, 200);
  for (const p of live.pages.filter((p) =>
    /20250922001|20240930001|202309210001|0FDE6D936/.test(p.url),
  )) {
    assert.ok(p.source);
    assert.ok(
      !extractPriorityFacts(p.source!, replayDisciplines(), "2027").some(
        (f) => f.field === "cityDevelopment",
      ),
    );
  }
  const spaced = live.pages.find(
    (p) => p.url === "https://yzw.zust.edu.cn/info/1035/1986.htm",
  )!.source!;
  assert.ok(
    programEntries(spaced, replayDisciplines()).some(
      (p) =>
        p.majorCode === "080200" && p.collegeName === "智能制造与能源工程学院",
    ),
  );
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
  const { report, finalCalls, searches, peakSearches } =
    await runRealReportReplay();
  assert.equal(finalCalls, 1);
  assert.ok(report.recommendations.length > 0);
  assert.equal(
    report.recommendations.find((r) => r.institutionName === "浙江理工大学")
      ?.majorCode,
    "085501",
  );
  assert.ok(
    report.candidateAudit?.every((candidate) =>
      report.prefilter?.selected.some(
        (s) => s.institutionName === candidate.institutionName,
      ),
    ),
  );
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
  assert.equal(peakSearches, B.initialSearchConcurrency);
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
