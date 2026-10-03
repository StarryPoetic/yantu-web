import test from "node:test";
import assert from "node:assert/strict";
import type { ResearchReport } from "../../server/explanation/research.ts";
import type { ResearchJob } from "../../server/routes/research.ts";
import { researchReason } from "../../shared/research-status.ts";
import {
  researchCoverage,
  researchOutcome,
} from "../../src/workspace/research-report.ts";

const cityReason = "PREFERRED_CITY_COVERAGE_INCOMPLETE";
function report(): ResearchReport {
  return {
    schemaVersion: 1,
    reportVersion: "profile-research-v6",
    status: "partial",
    reason: cityReason,
    generatedAt: "2026-10-04T00:00:00Z",
    guidanceRunId: "display-fixture",
    versions: {} as ResearchReport["versions"],
    summary: "已取得外地学校依据，杭州覆盖仍需补充。",
    facts: [],
    recommendations: ["甲", "乙", "丙", "丁", "戊"].map((name) => ({
      institutionName: `${name}大学`,
      disciplineCode: "0401",
      programName: "教育学",
      tier: "alternative",
      rationale: "保留已有依据供比较。",
      preparation: [],
      uncertainties: [],
      citations: [],
    })),
    coverage: {
      targetMin: 5,
      targetMax: 10,
      schoolCount: 5,
      preferredCount: 0,
      alternativeCount: 5,
      shortfallReasons: [
        "意向城市杭州：目前可核验符合杭州的学校建议为 0 所，不能认定杭州没有合适学校。",
      ],
    },
    sources: [],
    limitations: [],
    model: { name: "deepseek-v4-pro", thinking: true, effort: "high" },
    searched: true,
  };
}
function job(value: ResearchReport): ResearchJob {
  return {
    jobId: "display-job",
    guidanceRunId: value.guidanceRunId,
    status: "partial",
    stage: "done",
    progress: 100,
    message: "保留已核对的学校建议。",
    createdAt: value.generatedAt,
    updatedAt: value.generatedAt,
    events: [],
    report: value,
  };
}

test("five recommendations remain readable with an explicit preferred-city coverage warning", () => {
  const value = report();
  assert.equal(researchOutcome(job(value)), "recommendations");
  const coverage = researchCoverage(value);
  assert.equal(coverage.schoolCount, 5);
  assert.equal(coverage.shortfall, true);
  assert.equal(coverage.noticeTitle, "意向城市覆盖仍不足，先保留已有建议");
  assert.deepEqual(coverage.reasons, value.coverage!.shortfallReasons);
  assert.match(researchReason(cityReason), /可核验.*意向城市.*仍不足/);
  assert.match(researchReason(cityReason), /不代表.*没有适合/);
});

test("the city-coverage reason is an evidence gap even when an older job saved it as blocked", () => {
  const value = report();
  value.recommendations = [];
  assert.equal(researchOutcome(job(value)), "empty");
  assert.equal(researchOutcome({ ...job(value), status: "blocked" }), "empty");
});

test("city warnings have a truthful fallback without classifying unknown cities as elsewhere", () => {
  const value = report();
  value.coverage!.shortfallReasons = [];
  const coverage = researchCoverage(value);
  assert.equal(coverage.shortfall, true);
  assert.deepEqual(coverage.reasons, [researchReason(cityReason)]);
  assert.equal(coverage.reasons.join(" ").includes("外地"), false);
  delete value.reason;
  assert.equal(researchCoverage(value).shortfall, false);
  value.recommendations = value.recommendations.slice(0, 2);
  assert.equal(
    researchCoverage(value).noticeTitle,
    "尚未达到 5 所，先保留已有建议",
  );
});

test("explicit city coverage gaps remain visible when another partial reason is retained, while unknown locations stay unknown", () => {
  const value = report();
  value.reason = "RESEARCH_PARTIAL_VALIDATION";
  Object.assign(value.coverage!, {
    preferredCities: ["杭州"],
    preferredCitySchoolCount: 0,
    unknownCitySchoolCount: 5,
    shortfallReasons: [],
  });
  const coverage = researchCoverage(value);
  assert.equal(coverage.shortfall, true);
  assert.match(coverage.noticeTitle, /意向城市覆盖/);
  assert.equal(coverage.reasons.join(" ").includes("外地"), false);
  value.coverage!.preferredCitySchoolCount = 1;
  assert.equal(researchCoverage(value).shortfall, false);
});
