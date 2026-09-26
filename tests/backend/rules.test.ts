import test from "node:test";
import assert from "node:assert/strict";
import {
  createSeedCatalog,
  getCatalogSnapshot,
  withdrawRevision,
} from "../../server/catalog/index.ts";
import type {
  EvidenceDimension,
  ProgramRevision,
} from "../../server/catalog/types.ts";
import {
  evaluateEligibility,
  recommend,
  validateRule,
} from "../../server/recommendation/index.ts";
import type {
  RecommendationInput,
  RecommendationRule,
} from "../../server/recommendation/index.ts";
import { buildPlan } from "../../server/planning/index.ts";
import { buildReport } from "../../server/reports/index.ts";

const at = "2026-09-27T10:00:00.000Z";
const dimensions: EvidenceDimension[] = [
  "employment",
  "prospects",
  "policy",
  "interest",
  "schoolCity",
  "transparency",
];
const rule: RecommendationRule = {
  ruleVersion: "reviewed-test-rule",
  reviewStatus: "approved",
  reviewedBy: ["reviewer-a", "reviewer-b"],
  compatibleSchemaVersions: [1],
  requiredDimensions: dimensions,
  missingStrategy: "do_not_rank",
  defaultWeights: {
    employment: 1,
    prospects: 1,
    policy: 1,
    interest: 1,
    schoolCity: 1,
    transparency: 1,
  },
  riskPenalty: 0.1,
  excludeSevereRisk: true,
};
function input(): RecommendationInput {
  return {
    recommendationRunId: "run-test",
    subjectId: "subject-test",
    profileVersion: 1,
    selectionVersion: 1,
    targetAdmissionYear: 2027,
    profile: {},
    selection: {},
    assessmentRefs: [],
    catalog: getCatalogSnapshot(createSeedCatalog()),
    generatedAt: at,
  };
}
function verified(program = input().catalog.programs[0]): ProgramRevision {
  const value = structuredClone(program);
  value.isExample = false;
  value.availability = "verified_current";
  value.eligibility = {
    availability: "verified_current",
    complete: true,
    reason: null,
    conditions: [],
  };
  value.evidence = dimensions.map((dimension) => ({
    dimension,
    availability: "verified_current",
    sourceIds: ["official-fixture"],
    summary: "明确标记的测试事实",
    value: 0.5,
    ruleVersion: rule.ruleVersion,
  }));
  value.subjects = value.subjects.map((subject, index) => ({
    ...subject,
    maxScore: index < 2 ? 100 : 150,
    minimumScore: index < 2 ? 40 : 60,
    availability: "verified_current",
  }));
  value.scoreRequirements = {
    totalMaxScore: 500,
    totalMinimumScore: 300,
    interviewRequirement: "需通过复试资格与面试要求（测试）",
    availability: "verified_current",
  };
  return value;
}
function planInput(program = verified()) {
  return {
    planId: "plan-test",
    planVersion: 1,
    subjectId: "subject-test",
    program,
    catalogVersion: "catalog-example-v1",
    generatedAt: at,
    profile: {},
  };
}

test("no assessment and unknown majors do not block reference browsing or fabricate formal rankings", () => {
  const result = recommend(input());
  assert.equal(result.status, "facts_only");
  assert.equal(result.ranked.length, 0);
  assert.equal(result.pendingVerification.length, 8);
  assert.ok(result.pendingVerification.every((item) => item.score === null));
  assert.equal(result.degreeAdvice.inclination, "undetermined");
});

test("any known failed eligibility takes precedence over other missing facts", () => {
  const program = verified();
  program.eligibility.complete = false;
  program.availability = "unverified";
  program.eligibility.conditions = [
    {
      conditionId: "graduation",
      label: "毕业年份",
      profileField: "graduationYear",
      operator: "at_most",
      expected: 2027,
      availability: "verified_current",
      sourceIds: ["official"],
    },
    {
      conditionId: "degree",
      label: "学历",
      profileField: "degree",
      operator: "equals",
      expected: "bachelor",
      availability: "verified_current",
      sourceIds: ["official"],
    },
  ];
  assert.equal(
    evaluateEligibility(program, { graduationYear: 2028 }, 2027).status,
    "ineligible",
  );
  assert.equal(
    evaluateEligibility(program, { graduationYear: 2027 }, 2027).status,
    "unknown",
  );
  program.availability = "verified_current";
  program.eligibility.complete = true;
  assert.equal(
    evaluateEligibility(
      program,
      { graduationYear: 2027, degree: "bachelor" },
      2027,
    ).status,
    "eligible",
  );
  assert.equal(
    evaluateEligibility(
      program,
      { graduationYear: "2027", degree: "bachelor" },
      2027,
    ).status,
    "eligible",
  );
  assert.equal(
    evaluateEligibility(
      program,
      { graduationYear: "2027–2028", degree: "bachelor" },
      2027,
    ).status,
    "unknown",
  );
});

test("school, major and complete-project exclusions are independent and reversible", () => {
  const data = input();
  const first = data.catalog.programs[0];
  for (const selection of [
    { blockedInstitutionIds: [first.identity.institutionId] },
    { blockedMajorIds: [first.majorDirectionIds[0]] },
    { blockedProgramIds: [first.programId] },
  ]) {
    const result = recommend({ ...data, selection });
    assert.ok(
      result.excluded.some((item) => item.programId === first.programId),
    );
    assert.ok(
      !result.pendingVerification.some(
        (item) => item.programId === first.programId,
      ),
    );
  }
  assert.equal(recommend(data).pendingVerification.length, 8);
});

test("same input returns stable ordering and snapshots; unknown candidates never fill top ten", () => {
  const data = input();
  data.rule = rule;
  data.catalog.programs = [
    verified(data.catalog.programs[1]),
    verified(data.catalog.programs[0]),
    data.catalog.programs[2],
  ];
  const first = recommend(data);
  const second = recommend(structuredClone(data));
  assert.deepEqual(first, second);
  assert.equal(first.ranked.length, 2);
  assert.equal(first.pendingVerification.length, 1);
  assert.ok(first.ranked[0].programId < first.ranked[1].programId);
  data.profile.hello = "changed";
  assert.equal(first.inputSnapshot.profile.hello, undefined);
});

test("unreviewed rules and missing weighted evidence cannot create production scores", () => {
  const data = input();
  data.catalog.programs = [verified()];
  assert.equal(recommend(data).eligibleUnranked.length, 1);
  data.rule = rule;
  data.catalog.programs[0].evidence = data.catalog.programs[0].evidence.filter(
    (item) => item.dimension !== "policy",
  );
  const result = recommend(data);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.eligibleUnranked[0].score, null);
  assert.equal(
    result.eligibleUnranked[0].dimensions.find(
      (item) => item.dimension === "policy",
    )?.value,
    null,
  );
});

test("weights reject negative, infinite and out-of-range values and do not divide by zero", () => {
  for (const bad of [-1, 101, Infinity, NaN])
    assert.throws(
      () => recommend({ ...input(), profile: { priorities: { 就业: bad } } }),
      /INVALID_WEIGHT/,
    );
  const data = input();
  data.rule = rule;
  data.catalog.programs = [verified()];
  data.profile.priorities = Object.fromEntries(dimensions.map((d) => [d, 0]));
  const result = recommend(data);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.status, "facts_only");
});

test("risk acceptance never gives risky projects a bonus; anonymous material does not penalize", () => {
  const data = input();
  data.rule = rule;
  const program = verified();
  data.catalog.programs = [program];
  program.risks = [
    {
      riskId: "risk",
      summary: "测试风险",
      severity: "moderate",
      reviewStatus: "draft",
      reviewers: [],
      independentEvidenceClusters: ["same-repost"],
      sourceIds: ["fixture"],
      applicableYears: [2027],
      validUntil: null,
      status: "active",
    },
  ];
  const neutral = recommend(data).ranked[0].score!;
  program.risks[0].reviewStatus = "approved";
  program.risks[0].reviewers = ["a", "b"];
  program.risks[0].independentEvidenceClusters = ["a", "b"];
  data.profile.priorities = { riskAcceptance: 0 };
  const cautious = recommend(data).ranked[0].score!;
  data.profile.priorities = { riskAcceptance: 100 };
  const accepting = recommend(data).ranked[0].score!;
  assert.ok(cautious < neutral);
  assert.equal(accepting, neutral);
  program.risks[0].severity = "severe";
  assert.equal(recommend(data).ranked.length, 0);
  program.risks[0].status = "remediated";
  assert.equal(recommend(data).ranked.length, 1);
});

test("withdrawn revisions and historical years cannot enter new recommendations", () => {
  const data = input();
  let state = createSeedCatalog();
  const first = state.revisions[0];
  state = withdrawRevision(state, first.programRevisionId, {
    at,
    reason: "测试撤回",
  });
  data.catalog = getCatalogSnapshot(state);
  const result = recommend(data);
  assert.ok(
    result.excluded.some(
      (item) =>
        item.programId === first.programId && item.stage === "publication",
    ),
  );
  data.targetAdmissionYear = 2028;
  const historical = recommend(data);
  assert.equal(historical.pendingVerification.length, 0);
  assert.equal(historical.historicalPreview.length, 7);
});

test("duplicate major tags cannot consume extra ranks; duplicate annual projects reject mixed snapshots", () => {
  const data = input();
  data.rule = rule;
  const program = verified();
  program.majorDirectionIds.push(program.majorDirectionIds[0]);
  data.catalog.programs = [program];
  assert.equal(recommend(data).ranked.length, 1);
  data.catalog.programs.push(structuredClone(program));
  assert.throws(() => recommend(data), /DUPLICATE_CATALOG_PROJECT/);
});

test("published rules require independent reviewers and mandatory severe-risk handling", () => {
  assert.equal(validateRule(rule).valid, true);
  assert.equal(
    validateRule({ ...rule, reviewedBy: ["same", "same"] }).valid,
    false,
  );
  assert.equal(
    validateRule({ ...rule, excludeSevereRisk: false }).valid,
    false,
  );
});

test("example planning leaves all unknown scores null", () => {
  const result = buildPlan(planInput(input().catalog.programs[0]));
  assert.equal(result.status, "pending_verification");
  assert.equal(result.totalTargetScore, null);
  assert.equal(result.totalMaxScore, null);
  assert.ok(
    result.subjects.every(
      (subject) =>
        subject.targetScore === null &&
        subject.currentScore === null &&
        subject.gap === null,
    ),
  );
});

test("actual per-subject bounds, minima and total are all checked before a plan can be valid", () => {
  const data = planInput();
  const ids = data.program.subjects.map((subject) => subject.subjectId);
  const targets = Object.fromEntries(
    ids.map((id, index) => [id, index < 2 ? 60 : 100]),
  );
  const result = buildPlan({ ...data, targetScores: targets });
  assert.equal(result.totalTargetScore, 320);
  assert.equal(result.status, "valid");
  assert.equal(
    buildPlan({ ...data, targetScores: { ...targets, [ids[0]]: 101 } }).status,
    "draft",
  );
  assert.equal(
    buildPlan({ ...data, targetScores: { ...targets, [ids[0]]: 20 } }).status,
    "draft",
  );
  assert.equal(
    buildPlan({ ...data, targetScores: targets, targetTotalScore: 330 }).status,
    "draft",
  );
  assert.equal(
    buildPlan({
      ...data,
      targetScores: Object.fromEntries(
        ids.map((id, i) => [id, i < 2 ? 40 : 60]),
      ),
    }).status,
    "draft",
  );
});

test("five correct diagnostic answers never become current scores; reliable comparable mocks can yield nonnegative gaps", () => {
  const data = planInput();
  const subject = data.program.subjects[0];
  const base = {
    subjectId: subject.subjectId,
    score: 90,
    maxScore: 100,
    measuredAt: at,
    source: "test-mock",
    examGroupId: null,
    reviewed: true,
  };
  const screening = buildPlan({
    ...data,
    targetScores: { [subject.subjectId]: 80 },
    currentPerformance: [{ ...base, kind: "five_question_screening" }],
  });
  assert.equal(screening.subjects[0].currentScore, null);
  assert.equal(screening.subjects[0].gap, null);
  const mock = buildPlan({
    ...data,
    targetScores: { [subject.subjectId]: 80 },
    currentPerformance: [{ ...base, kind: "standardized_mock" }],
  });
  assert.equal(mock.subjects[0].gap, 0);
  assert.equal(mock.subjects[0].gapStatus, "reached");
  const incomparable = buildPlan({
    ...data,
    currentPerformance: [{ ...base, kind: "standardized_mock", maxScore: 150 }],
  });
  assert.equal(incomparable.subjects[0].currentScore, null);
});

test("official alternative exam subjects require choosing exactly one and use their actual maximum", () => {
  const data = planInput();
  data.program.subjects[0].optionGroupId = "english";
  data.program.subjects.push({
    ...data.program.subjects[0],
    subjectId: "alternative-english",
    name: "替代外语",
  });
  assert.ok(
    buildPlan(data).pendingItems.some((item) => item.includes("可选科目组")),
  );
  const result = buildPlan({
    ...data,
    selectedSubjectIds: [
      data.program.subjects[0].subjectId,
      "alternative-english",
    ],
  });
  assert.ok(result.errors.some((item) => item.includes("只能选择一项")));
});

test("incompatible target major marks plan needs_review and retains old task references", () => {
  const data = planInput();
  const previous = buildPlan(data);
  const changed = buildPlan({
    ...data,
    planVersion: 2,
    previousPlan: previous,
    confirmedMajorId: "unrelated-major",
  });
  assert.equal(changed.status, "needs_review");
  assert.equal(
    changed.previousTaskIdsNeedingReconfirmation.length,
    previous.tasks.length,
  );
  assert.ok(changed.tasks.every((task) => task.needsReconfirmation));
  assert.equal(previous.planVersion, 1);
});

test("report fixes all snapshots, preserves unknowns and escapes imported text", () => {
  const data = input();
  const run = recommend(data);
  const plan = buildPlan({
    ...planInput(data.catalog.programs[0]),
    recommendationRunId: run.recommendationRunId,
    ruleVersion: run.versions.ruleVersion,
  });
  run.pendingVerification[0].program.display.institutionName =
    "<script>alert(1)</script> ![tracker](https://example.test)";
  const report = buildReport({
    reportId: "report-test",
    subjectId: data.subjectId,
    generatedAt: at,
    recommendation: run,
    plan,
    catalog: data.catalog,
  });
  assert.match(report.markdown, /暂无有效/);
  assert.match(report.markdown, /待制定／待评估/);
  assert.ok(!report.markdown.includes("<script>"));
  assert.ok(report.markdown.includes("&lt;script&gt;"));
  data.catalog.programs.length = 0;
  assert.equal(report.catalog.programs.length, 8);
  assert.throws(
    () =>
      buildReport({
        reportId: "bad",
        subjectId: "another-subject",
        generatedAt: at,
        recommendation: run,
        catalog: data.catalog,
      }),
    /OWNERSHIP/,
  );
  assert.throws(
    () =>
      buildReport({
        reportId: "bad",
        subjectId: data.subjectId,
        generatedAt: at,
        recommendation: run,
        catalog: { ...data.catalog, catalogVersion: "different" },
      }),
    /CATALOG_MISMATCH/,
  );
});

test("planning cannot bypass ineligible or missing profile conditions without a recommendation", () => {
  const data = planInput();
  const targets = Object.fromEntries(
    data.program.subjects.map((subject, index) => [
      subject.subjectId,
      index < 2 ? 60 : 100,
    ]),
  );
  data.program.eligibility.conditions = [
    {
      conditionId: "required-degree",
      label: "必须本科毕业",
      profileField: "degree",
      operator: "equals",
      expected: "bachelor",
      availability: "verified_current",
      sourceIds: ["official"],
    },
  ];
  const failed = buildPlan({
    ...data,
    profile: { degree: "ineligible" },
    targetScores: targets,
  });
  assert.equal(failed.valid, false);
  assert.equal(failed.status, "draft");
  assert.ok(failed.errors.some((error) => error.includes("报考资格不满足")));
  const unknown = buildPlan({
    ...data,
    profile: undefined,
    targetScores: targets,
  });
  assert.equal(unknown.valid, false);
  assert.equal(unknown.status, "pending_verification");
});

test("version and unsupported input contracts fail explicitly rather than switching dependencies", () => {
  assert.throws(
    () => recommend({ ...input(), profileVersion: -1 }),
    /INVALID_INPUT_VERSION/,
  );
  assert.throws(
    () => recommend({ ...input(), targetAdmissionYear: 1999 }),
    /INVALID_INPUT_VERSION/,
  );
  assert.throws(
    () => recommend({ ...input(), generatedAt: "not-a-date" }),
    /INVALID_GENERATED_AT/,
  );
  assert.throws(
    () =>
      recommend({
        ...input(),
        filters: { degreeTypes: ["unrecognized" as "academic"] },
      }),
    /INVALID_FILTER_ENUM/,
  );
  assert.throws(
    () => recommend({ ...input(), profile: { priorities: [] } }),
    /INVALID_WEIGHT/,
  );
  const previous = buildPlan(planInput());
  assert.throws(
    () => buildPlan({ ...planInput(), previousPlan: previous, planVersion: 3 }),
    /PLAN_VERSION_CONFLICT/,
  );
  assert.throws(
    () =>
      buildPlan({
        ...planInput(),
        previousPlan: previous,
        planVersion: 2,
        subjectId: "other",
      }),
    /PLAN_VERSION_CONFLICT/,
  );
});

test("reports reject mismatched plan versions and fixed dependency references", () => {
  const data = input();
  const recommendation = recommend(data);
  const plan = buildPlan({
    ...planInput(data.catalog.programs[0]),
    recommendationRunId: recommendation.recommendationRunId,
    ruleVersion: recommendation.versions.ruleVersion,
  });
  const payload = {
    reportId: "report-test",
    subjectId: data.subjectId,
    generatedAt: at,
    recommendation,
    plan,
    catalog: data.catalog,
  };
  assert.throws(
    () =>
      buildReport({
        ...payload,
        plan: { ...plan, catalogVersion: "new-catalog" },
      }),
    /REPORT_CATALOG_MISMATCH/,
  );
  assert.throws(
    () =>
      buildReport({ ...payload, plan: { ...plan, recommendationRunId: null } }),
    /REPORT_RECOMMENDATION_MISMATCH/,
  );
  assert.throws(
    () =>
      buildReport({ ...payload, plan: { ...plan, ruleVersion: "other-rule" } }),
    /REPORT_PLAN_MISMATCH/,
  );
  assert.throws(
    () =>
      buildReport({ ...payload, plan: { ...plan, status: "needs_review" } }),
    /REPORT_PLAN_MISMATCH/,
  );
});
