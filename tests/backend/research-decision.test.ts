import test from "node:test";
import assert from "node:assert/strict";
import { deriveResearchDecision } from "../../server/explanation/research-decision.ts";
import { generateGuidance } from "../../server/disciplines/index.ts";
import type {
  GuidanceAssessment,
  GuidanceRun,
} from "../../server/disciplines/types.ts";
import { blankProfile } from "../../server/profile.ts";

function assessment(
  overrides: Partial<GuidanceAssessment> = {},
): GuidanceAssessment {
  return {
    assessmentAttemptId: "attempt-one",
    diagnosisVersion: "diagnosis-one",
    questionBankVersion: "test-bank-only",
    submittedAt: "2026-10-03T10:00:00Z",
    scope: { math: "common-foundation", english: "common-foundation" },
    example: true,
    usableForRecommendation: false,
    modules: [
      { module: "math", correct: 1, incorrect: 3, unanswered: 1, total: 5 },
      { module: "english", correct: 5, incorrect: 0, unanswered: 0, total: 5 },
    ],
    items: [
      {
        questionId: "m-one",
        questionRevisionId: "m-r1",
        module: "math",
        point: "导数",
        outcome: "incorrect",
        scopes: ["common-foundation", "math-one", "math-two"],
        calibration: "manual_initial",
      },
      {
        questionId: "m-two",
        questionRevisionId: "m-r2",
        module: "math",
        point: "定积分",
        outcome: "unanswered",
        scopes: ["common-foundation", "math-one", "math-two"],
        calibration: "manual_initial",
      },
      {
        questionId: "e-one",
        questionRevisionId: "e-r1",
        module: "english",
        point: "阅读理解",
        outcome: "correct",
        scopes: ["common-foundation", "english-one", "english-two"],
        calibration: "manual_initial",
      },
    ],
    weakPoints: ["旧记录的混合薄弱点"],
    limitations: ["测试夹具，不是已发布的正式诊断。"],
    ...overrides,
  };
}

function run(
  assessments: GuidanceAssessment[] = [],
  profile: Record<string, string> = {},
): GuidanceRun {
  return generateGuidance({
    subjectId: "student-test",
    guidanceRunId: "guidance-test",
    generatedAt: "2026-10-04T00:00:00Z",
    profile: {
      ...blankProfile(),
      major: "机械设计制造及其自动化",
      cities: ["杭州"],
      ...profile,
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments,
  });
}

test("missing assessments remain unassessed and never default to weak ability or a degree route", () => {
  const result = deriveResearchDecision(run());
  assert.deepEqual(
    result.assessments.map((item) => item.status),
    ["unassessed", "unassessed"],
  );
  assert.ok(
    result.assessments.every(
      (item) => item.counts.total === 0 && item.references.length === 0,
    ),
  );
  assert.ok(result.degreeRoutes.every((item) => item.priority === "compare"));
  assert.match(result.examPolicy.summary, /数学与英语是不同科目/);
  assert.deepEqual(
    result.examPolicy.comparisons.map((item) => item.module),
    ["math", "english"],
  );
});

test("unreviewed example observations keep counts and module-specific actionable gaps without choosing exams or degrees", () => {
  const result = deriveResearchDecision(run([assessment()]));
  const math = result.assessments.find((item) => item.module === "math")!;
  const english = result.assessments.find((item) => item.module === "english")!;
  assert.equal(math.status, "example_practice");
  assert.deepEqual(math.counts, {
    correct: 1,
    incorrect: 3,
    unanswered: 1,
    total: 5,
  });
  assert.deepEqual(math.weakPoints, ["定积分", "导数"]);
  assert.deepEqual(english.weakPoints, []);
  assert.match(math.nextSteps[0], /定积分、导数/);
  assert.match(english.nextSteps[0], /变式题和完整限时/);
  assert.ok(
    math.limitations.some((item) => item.includes("不作为考试路线或学位选择")),
  );
  assert.ok(math.limitations.some((item) => item.includes("没有检测范围差异")));
  assert.ok(math.limitations.some((item) => item.includes("公共基础范围")));
  assert.ok(result.degreeRoutes.every((item) => item.priority === "compare"));
});

test("a reviewed usable diagnosis informs preparation only and does not convert perfect short scores into exam aptitude", () => {
  const result = deriveResearchDecision(
    run([
      assessment({
        example: false,
        usableForRecommendation: true,
        scope: { math: "math-one", english: "english-one" },
        items: assessment().items!.map((item) => ({
          ...item,
          calibration: "calibrated",
        })),
      }),
    ]),
  );
  assert.ok(
    result.assessments.every((item) => item.status === "local_diagnosis"),
  );
  assert.ok(
    result.assessments.every((item) =>
      item.limitations.some((text) => text.includes("完整限时卷")),
    ),
  );
  assert.equal(JSON.stringify(result).includes("fitScore"), false);
  assert.ok(result.degreeRoutes.every((item) => item.priority === "compare"));
});

test("newer retests replace an earlier same-scope observation rather than counting repeated questions twice", () => {
  const older = assessment();
  const newer = assessment({
    assessmentAttemptId: "attempt-two",
    diagnosisVersion: "diagnosis-two",
    submittedAt: "2026-10-04T10:00:00Z",
    modules: [
      { module: "math", correct: 4, incorrect: 1, unanswered: 0, total: 5 },
    ],
  });
  const result = deriveResearchDecision(run([older, newer, newer]));
  const math = result.assessments.find((item) => item.module === "math")!;
  assert.equal(math.counts.total, 5);
  assert.equal(math.counts.correct, 4);
  assert.equal(math.references[0].assessmentAttemptId, "attempt-two");
  assert.equal(
    result.assessments.find((item) => item.module === "english")!.references[0]
      .assessmentAttemptId,
    "attempt-one",
  );
  assert.ok(
    result.ignoredAssessments.some((item) =>
      item.reason.includes("不重复累加"),
    ),
  );
});

test("a later unreviewed example does not displace a current formal diagnosis", () => {
  const formal = assessment({ example: false, usableForRecommendation: true });
  const practice = assessment({
    assessmentAttemptId: "later-practice",
    submittedAt: "2026-10-04T10:00:00Z",
  });
  const result = deriveResearchDecision(run([formal, practice]));
  assert.ok(
    result.assessments.every((item) => item.status === "local_diagnosis"),
  );
  assert.ok(
    result.assessments.every(
      (item) => item.references[0].assessmentAttemptId === "attempt-one",
    ),
  );
  assert.ok(
    result.ignoredAssessments.some((item) =>
      item.reason.includes("可用正式诊断"),
    ),
  );
});

test("different scopes remain separate without implying differences in readiness from shared baseline questions", () => {
  const one = assessment({
    scope: { math: "math-one" },
    modules: [assessment().modules[0]],
  });
  const two = assessment({
    assessmentAttemptId: "two",
    scope: { math: "math-two" },
    modules: [assessment().modules[0]],
  });
  const result = deriveResearchDecision(run([one, two]));
  const maths = result.assessments.filter((item) => item.module === "math");
  assert.deepEqual(
    maths.map((item) => item.scope),
    ["math-one", "math-two"],
  );
  assert.ok(maths.every((item) => item.counts.total === 5));
  assert.ok(
    maths.every((item) =>
      item.limitations.some((text) => text.includes("没有检测范围差异")),
    ),
  );
});

test("old count-only records remain visible without assigning blended weak points to maths or English", () => {
  const legacy = assessment({
    scope: undefined,
    items: undefined,
    submittedAt: undefined,
    questionBankVersion: undefined,
  });
  const result = deriveResearchDecision(run([legacy]));
  assert.ok(result.assessments.every((item) => item.scope === null));
  assert.ok(
    result.assessments.every(
      (item) => item.points.length === 0 && item.weakPoints.length === 0,
    ),
  );
  assert.ok(
    result.assessments.every((item) =>
      item.limitations.some((text) => text.includes("旧记录缺少逐题")),
    ),
  );
  assert.ok(
    result.assessments.every((item) =>
      item.limitations.some((text) => text.includes("缺少有效提交时间")),
    ),
  );
  assert.match(result.assessments[0].nextSteps[0], /补充逐题知识点/);
});

test("invalid aggregate counts are excluded without manufacturing an assessment", () => {
  for (const modules of [
    [{ module: "math", correct: 4, incorrect: 1, unanswered: 1, total: 5 }],
    [{ module: "math", correct: -1, incorrect: 6, unanswered: 0, total: 5 }],
    [{ module: "math", correct: 0, incorrect: 0, unanswered: 0, total: 0 }],
  ]) {
    const result = deriveResearchDecision(run([assessment({ modules })]));
    assert.equal(result.assessments[0].status, "unassessed");
    assert.ok(
      result.ignoredAssessments.some((item) =>
        item.reason.includes("计数无效"),
      ),
    );
  }
});

test("explicit degree preference determines comparison priority while assessment changes leave degree advice unchanged", () => {
  const profile = {
    degreePreference: "只考虑学硕",
    studyGoal: "就业并获得工程实践能力",
  };
  const weak = deriveResearchDecision(run([assessment()], profile));
  const strong = deriveResearchDecision(
    run(
      [
        assessment({
          modules: [
            {
              module: "math",
              correct: 5,
              incorrect: 0,
              unanswered: 0,
              total: 5,
            },
          ],
        }),
      ],
      profile,
    ),
  );
  assert.deepEqual(weak.degreeRoutes, strong.degreeRoutes);
  assert.equal(
    weak.degreeRoutes.find((item) => item.degreeType === "academic")!.priority,
    "explicit_preference",
  );
  assert.equal(
    weak.degreeRoutes.find((item) => item.degreeType === "professional")!
      .priority,
    "compare",
  );
  assert.ok(
    weak.degreeRoutes
      .find((item) => item.degreeType === "professional")!
      .reasons.some((reason) => reason.includes("候选范围排除")),
  );
});

test("degree constraints in notes and double negatives share the same route interpretation", () => {
  const restricted = deriveResearchDecision(
    run([], { notes: "不考虑学硕", studyGoal: "科研训练" }),
  );
  assert.equal(
    restricted.degreeRoutes.find((item) => item.degreeType === "professional")!
      .priority,
    "explicit_preference",
  );
  assert.equal(
    restricted.degreeRoutes.find((item) => item.degreeType === "academic")!
      .priority,
    "compare",
  );
  for (const notes of [
    "并非不考虑学硕，学硕和专硕都可以比较",
    "不是不想读学硕",
    "不排除专硕",
    "没有说不考虑学硕",
  ]) {
    const result = deriveResearchDecision(run([], { notes }));
    assert.ok(
      result.degreeRoutes.every((item) => item.priority === "compare"),
      notes,
    );
  }
});

test("assessment narrative uses Chinese scope labels while storing the original scope", () => {
  const result = deriveResearchDecision(
    run([assessment({ scope: { math: "math-one", english: "english-two" } })]),
  );
  assert.equal(result.assessments[0].scope, "math-one");
  assert.match(result.assessments[0].observations[0], /数学一范围/);
  assert.match(result.assessments[1].observations[0], /英语二范围/);
  assert.equal(
    result.assessments
      .flatMap((item) => item.observations)
      .join("")
      .includes("math-one"),
    false,
  );
});

test("affirmative career and research goals supply transparent leads without universal degree stereotypes", () => {
  const result = deriveResearchDecision(
    run([], {
      studyGoal: "科研训练并提升工程实践能力",
      degreePreference: "学硕或专硕都可以",
    }),
  );
  assert.ok(result.degreeRoutes.every((item) => item.priority === "goal_lead"));
  assert.ok(
    result.degreeRoutes.every((item) =>
      item.verificationNeeded.some((text) => text.includes("培养方案")),
    ),
  );
  assert.ok(
    result.limitations.some((text) => text.includes("读博专属或就业专属")),
  );
});

test("negative interests are not interpreted as positive degree preference or goal", () => {
  const result = deriveResearchDecision(
    run([], {
      degreePreference: "不考虑学硕，只考虑专硕",
      studyGoal: "不想读博，希望就业",
    }),
  );
  assert.equal(
    result.degreeRoutes.find((item) => item.degreeType === "academic")!
      .priority,
    "compare",
  );
  assert.equal(
    result.degreeRoutes.find((item) => item.degreeType === "professional")!
      .priority,
    "explicit_preference",
  );
});

test("identical fixed snapshots and reordered references produce identical non-mutating decision output", () => {
  const input = run(
    [
      assessment(),
      assessment({
        assessmentAttemptId: "another",
        submittedAt: "2026-10-02T10:00:00Z",
      }),
    ],
    { studyGoal: "科研训练" },
  );
  const before = structuredClone(input);
  const first = deriveResearchDecision(input);
  assert.deepEqual(deriveResearchDecision(input), first);
  assert.deepEqual(input, before);
  input.assessmentSummary.references.reverse();
  assert.deepEqual(deriveResearchDecision(input), first);
});
