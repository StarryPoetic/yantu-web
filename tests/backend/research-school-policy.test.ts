import test from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_SCHOOL_POLICY,
  savedResearchSchoolPolicy,
  researchSchoolRange,
} from "../../shared/research-policy.ts";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import {
  buildEvidenceCandidates,
  rankDemandCandidates,
} from "../../server/explanation/research-matching.ts";
import { researchDirectory } from "../../server/explanation/research-planning.ts";
import {
  researchCoverage,
  researchReportMarkdown,
} from "../../src/workspace/research-report.ts";

test("new school policy separates range, aim and evidence while old snapshots remain unchanged", () => {
  assert.equal(researchSchoolRange(RESEARCH_SCHOOL_POLICY), "4–5");
  assert.equal(RESEARCH_SCHOOL_POLICY.target, 5);
  assert.deepEqual(savedResearchSchoolPolicy({}), {
    version: "legacy-five-to-ten",
    minimum: 5,
    target: 10,
    maximum: 10,
  });
  assert.equal(savedResearchSchoolPolicy({ prefilter: {} }).minimum, 10);
  assert.equal(
    savedResearchSchoolPolicy({
      prefilter: {},
      coverage: { targetMin: 5, targetMax: 10 },
    }).minimum,
    5,
  );
  const saved = { schoolPolicy: { ...RESEARCH_SCHOOL_POLICY } };
  savedResearchSchoolPolicy(saved).minimum = 10;
  assert.equal(saved.schoolPolicy.minimum, 4);
});

for (const available of [3, 4, 5, 6]) {
  test(`${available} grounded schools obey the new range without clearing missing evidence`, async () => {
    const f = prefilterFixture({ available });
    const report = await f.create().generate({
      strategy: "two-stage",
      subjectId: f.run.subjectId,
      run: f.run,
      onCheckpoint: f.save,
    });
    assert.equal(report.recommendations.length, Math.min(available, 5));
    assert.equal(report.coverage!.targetMin, 4);
    assert.equal(report.coverage!.targetMax, 5);
    assert.equal(report.status, "partial");
    assert.ok(report.priorityCoverage!.pending > 0);
    assert.equal(
      report.coverage!.shortfallReasons.some((reason) =>
        reason.includes("尚未达到"),
      ),
      available < 4,
    );
    assert.deepEqual(f.checkpoint().schoolPolicy, RESEARCH_SCHOOL_POLICY);
    assert.equal(
      researchCoverage({ ...report, coverage: undefined }).targetMin,
      4,
    );
    assert.match(
      researchReportMarkdown(report, f.run, false),
      /目标比较 4–5 所/,
    );
  });
}

for (const minimum of [5, 10] as const) {
  test(`saved ${minimum}–10 policy survives retry without adopting the new five-school cap`, async () => {
    const f = prefilterFixture();
    const first = await f.create().generate({
      strategy: "two-stage",
      subjectId: f.run.subjectId,
      run: f.run,
      onCheckpoint: f.save,
    });
    const checkpoint = f.checkpoint();
    const disciplines = researchDirectory(f.run).allowed;
    const inventory = buildEvidenceCandidates({
      run: f.run,
      disciplines,
      sources: first.sources,
      targetYear: String(f.run.inputSnapshot.profile.year),
    });
    checkpoint.report!.recommendations = rankDemandCandidates(
      inventory.recommendations,
      f.run,
      disciplines,
      first.sources,
      String(f.run.inputSnapshot.profile.year),
      10,
    );
    assert.equal(checkpoint.report!.recommendations.length, 10);
    delete checkpoint.schoolPolicy;
    delete checkpoint.report!.schoolPolicy;
    checkpoint.report!.coverage = {
      ...first.coverage!,
      schoolCount: 10,
      targetMin: minimum,
      targetMax: 10,
    };
    const before = JSON.stringify(checkpoint);
    const report = await f.create().generate({
      strategy: "two-stage",
      mode: "retry",
      subjectId: f.run.subjectId,
      run: f.run,
      checkpoint,
      previousReport: checkpoint.report,
    });
    assert.equal(report.schoolPolicy!.minimum, minimum);
    assert.equal(report.schoolPolicy!.maximum, 10);
    assert.equal(report.coverage!.targetMin, minimum);
    assert.equal(report.recommendations.length, 10);
    assert.equal(JSON.stringify(checkpoint), before);
  });
}
