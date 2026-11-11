import test from "node:test";
import assert from "node:assert/strict";
import {
  createSupplementPlan,
  matchesSupplementScope,
  supplementProgramKey,
} from "../../server/explanation/research-supplement-plan.ts";
import type { ResearchReport } from "../../server/explanation/research.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";

const main = {
  institutionName: "杭州电子科技大学",
  disciplineCode: "0802",
  majorCode: "080200",
  programName: "机械工程",
  collegeName: "机械工程学院",
  degreeType: "academic" as const,
  studyMode: "full_time" as const,
};
const gap = (
  overrides: Partial<ResearchEvidenceGap> = {},
): ResearchEvidenceGap => ({
  id: "tuition",
  ...main,
  field: "tuition",
  targetYear: "2027",
  referenceYears: [2026, 2025, 2024],
  requestedYear: 2027,
  purpose: "missing_evidence",
  reason: "缺少费用原文",
  nextAction: "补查费用",
  sourceIds: [],
  references: [],
  priority: "normal",
  attempts: [],
  ...overrides,
});
function report() {
  return {
    generatedAt: "2026-11-12T00:00:00Z",
    recommendations: [main],
    sources: [],
    evidenceCoverage: { gaps: [gap()] },
    candidateAudit: [{ institutionName: "浙江工业大学" }],
    prefilter: { selected: [{ institutionName: "浙江工业大学" }] },
  } as unknown as ResearchReport;
}

test("freezes only displayed projects, including their own displayed alternative identity", () => {
  const saved = report();
  saved.recommendations[0].programAlternatives = [
    {
      ...main,
      disciplineCode: "0855",
      majorCode: "085500",
      programName: "机械",
      degreeType: "professional",
    },
  ] as never;
  saved.evidenceCoverage!.gaps.push(
    gap({ institutionName: "浙江工业大学" }),
    gap({ majorCode: "080201" }),
  );
  const bytes = JSON.stringify(saved);
  const plan = createSupplementPlan(saved, []);
  assert.equal(JSON.stringify(saved), bytes);
  assert.equal(plan.scope.length, 2);
  assert.equal(plan.tasks.length, 1);
  assert.ok(
    plan.tasks.every(
      (t) => t.query.includes("080200") && !t.query.includes("浙江工业"),
    ),
  );
  assert.equal(plan.tasks[0].query.includes("2027年"), true);
  assert.deepEqual(createSupplementPlan(saved, []), plan);
});

test("fully covered reports produce no executable task; prefilter schools never become gaps", () => {
  const saved = report();
  saved.evidenceCoverage!.gaps = [];
  assert.equal(createSupplementPlan(saved, []).tasks.length, 0);
});

test("legacy missing major identity is scope_unverified and never partially executes", () => {
  const saved = report();
  saved.recommendations.push({
    ...saved.recommendations[0],
    majorCode: undefined,
  });
  const plan = createSupplementPlan(saved, []);
  assert.equal(plan.scopeVerified, false);
  assert.equal(plan.tasks.length, 0);
  assert.match(plan.limitations.join(""), /重新调研/);
});

test("a legacy report without a saved evidence ledger cannot assume every field is complete", () => {
  const saved = report();
  delete saved.evidenceCoverage;
  const plan = createSupplementPlan(saved, []);
  assert.equal(plan.scopeVerified, false);
  assert.equal(plan.tasks.length, 0);
});

test("project match rejects another college, mode, degree or major rather than school-only membership", () => {
  assert.equal(matchesSupplementScope(main, main), true);
  for (const delta of [
    { collegeName: "其他学院" },
    { studyMode: "part_time" },
    { degreeType: "professional" },
    { majorCode: "085500" },
  ])
    assert.equal(
      matchesSupplementScope({ ...main, ...delta } as never, main),
      false,
    );
  assert.notEqual(
    supplementProgramKey(main),
    supplementProgramKey({ ...main, studyMode: "part_time" }),
  );
});

test("wrong-year/other-program gaps cannot silently expand frozen projects", () => {
  const saved = report();
  saved.evidenceCoverage!.gaps = [
    gap({ requestedYear: Number.NaN }),
    gap({ collegeName: "其他学院" }),
    gap({ studyMode: "part_time" }),
  ];
  assert.deepEqual(createSupplementPlan(saved, []).tasks, []);
});
