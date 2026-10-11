import test from "node:test";
import assert from "node:assert/strict";
import {
  AssessmentError,
  closeAttempt,
  correctDiagnosis,
  createAttempt,
  loadQuestionBank,
  publicAttempt,
  publicDiagnosis,
  publishQuestionBank,
  reassessApplicability,
  saveDraft,
  submitAttempt,
  validateQuestion,
  validateQuestionBank,
} from "../../server/assessment/index.ts";
import type {
  AssessmentAttempt,
  QuestionBank,
} from "../../server/assessment/types.ts";
import { validStem } from "../../server/assessment/presentation.ts";

const bank = await loadQuestionBank();
// The original twenty-question fixture exercises legacy coverage/fallback paths.
bank.questions = bank.questions.filter((question) =>
  question.id.startsWith("v2-"),
);
test("T3-06 reasoning saves at 1000, rejects 1001 and lets legacy drafts be shortened without truncation", () => {
  const original = createAttempt(bank, {
    subjectId: "reasoning-owner",
    allowExampleBank: true,
    modules: ["math"],
  });
  const questionId = original.questions[0].id;
  const save = (reasoning: string) =>
    saveDraft(original, {
      expectedAttemptVersion: original.attemptVersion,
      answers: [{ questionId, selectedOption: null, reasoning }],
    });
  assert.equal(
    save("字".repeat(1000)).answers.find((a) => a.questionId === questionId)
      ?.reasoning?.length,
    1000,
  );
  assert.throws(() => save("字".repeat(1001)), { code: "INVALID_REASONING" });
  original.answers[0].reasoning = "旧".repeat(1500);
  assert.equal(publicAttempt(original).answers[0].reasoning?.length, 1500);
  assert.equal(save("字".repeat(1000)).answers[0].reasoning?.length, 1000);
  assert.equal(original.answers[0].reasoning?.length, 1500);
});
test("question stem permits inline mathematics but rejects diagrams, hidden fields and altered conditions", () => {
  const question = bank.questions.find((question) => question.id === "v2-m4")!;
  assert.equal(validStem(question.stem, question.text), true);
  assert.equal(
    validStem(
      [
        { kind: "text", text: question.text },
        { kind: "diagram", alt: "解释图" },
      ],
      question.text,
    ),
    false,
  );
  assert.equal(
    validStem(
      [{ kind: "text", text: question.text, correct: 0 }],
      question.text,
    ),
    false,
  );
  assert.equal(
    validStem([{ kind: "text", text: "删掉条件" }], question.text),
    false,
  );
});

test("legacy saved questions keep their snapshots while explanatory diagrams become result-only", () => {
  const legacyBank = structuredClone(bank);
  const question = legacyBank.questions.find(
    (question) => question.id === "v2-m4",
  )!;
  question.presentation = {
    formulas: question.stem!.flatMap((part) =>
      part.kind === "math"
        ? [{ label: part.label, expression: part.expression }]
        : [],
    ),
    diagram: question.solutionPresentation!.diagram,
  };
  delete question.solutionPresentation!.diagram;
  delete question.stem;
  question.revisionId = "v2-m4-example-r2";
  legacyBank.questionBankVersion = "example-unreviewed-v2-presentation";
  const attempt = createAttempt(legacyBank, {
    subjectId: "legacy-owner",
    allowExampleBank: true,
    modules: ["math"],
  });
  const original = structuredClone(attempt);
  const visible = publicAttempt(attempt).questions.find(
    (question) => question.id === "v2-m4",
  )!;
  assert.equal(visible.presentation, undefined);
  assert.equal(visible.stem![0].kind, "text");
  assert.equal(visible.stem![1].kind, "math");
  assert.equal(JSON.stringify(visible).includes("diagram"), false);
  assert.deepEqual(attempt, original);
  const completed = submitAttempt(attempt, {
    expectedAttemptVersion: attempt.attemptVersion,
    confirmUnanswered: true,
  });
  const item = completed.diagnosis!.items.find(
    (item) => item.questionId === question.id,
  )!;
  delete item.presentation!.diagram; // Simulate an already-saved diagnosis from the prior renderer.
  const fixedSnapshot = structuredClone(completed);
  const result = publicDiagnosis(completed).items.find(
    (item) => item.questionId === question.id,
  )!;
  assert.equal(result.presentation?.diagram?.kind, "matrix");
  assert.deepEqual(completed, fixedSnapshot);
});
const baseInput = {
  subjectId: "student-a",
  allowExampleBank: true,
  seed: "stable-test-seed",
  now: "2026-09-27T00:00:00Z",
};
const fresh = () => createAttempt(bank, baseInput);
const failure = (code: string) => (error: unknown) =>
  error instanceof AssessmentError && error.code === code;
const submitted = (attempt: AssessmentAttempt) =>
  submitAttempt(attempt, {
    expectedAttemptVersion: attempt.attemptVersion,
    confirmUnanswered: true,
  });
function reviewedBank(): QuestionBank {
  const fixture = structuredClone(bank);
  fixture.mode = "reviewed";
  fixture.questions.forEach((question) => {
    question.reviewStatus = "approved";
    question.publicationStatus = "unpublished";
    question.review = {
      reviewerId: "test-only-reviewer",
      reviewedAt: "2026-09-27T00:00:00Z",
      checks: [
        "answer_unique",
        "conditions_complete",
        "options_distinct",
        "explanation_consistent",
        "scope_checked",
        "rights_checked",
      ],
      rationale: "Synthetic test fixture, not an actual subject review.",
    };
  });
  return fixture;
}

test("default screening contains 15 fixed questions; opting out of mathematics retains five per module", () => {
  const attempt = fresh();
  assert.equal(attempt.questions.length, 15);
  assert.equal(new Set(attempt.questions.map((q) => q.id)).size, 15);
  assert.deepEqual(attempt.questions, fresh().questions);
  const two = createAttempt(bank, {
    ...baseInput,
    modules: ["english", "politics"],
  });
  assert.equal(two.questions.length, 10);
  assert.equal(two.questions.filter((q) => q.module === "english").length, 5);
  assert.throws(
    () => createAttempt(bank, { ...baseInput, modules: [] }),
    failure("INVALID_MODULES"),
  );
});

test("example bank cannot masquerade as reviewed or supply production diagnosis", () => {
  assert.throws(
    () => createAttempt(bank, { subjectId: "student-a" }),
    failure("REVIEWED_BANK_REQUIRED"),
  );
  assert.equal(bank.questions.length, 20);
  assert.ok(
    bank.questions.every(
      (q) =>
        q.reviewStatus === "draft" && q.publicationStatus === "unpublished",
    ),
  );
  assert.equal(
    publicDiagnosis(submitted(fresh())).usableForRecommendation,
    false,
  );
  assert.throws(
    () => publishQuestionBank(bank, "invalid-release"),
    failure("QUESTION_REVIEW_REQUIRED"),
  );
});

test("professional assessment requires confirmed major and remains independent", () => {
  assert.throws(
    () => createAttempt(bank, { ...baseInput, stage: "major" }),
    failure("MAJOR_CONFIRMATION_REQUIRED"),
  );
  const attempt = createAttempt(bank, {
    ...baseInput,
    stage: "major",
    confirmedMajorId: "research",
  });
  assert.equal(attempt.questions.length, 5);
  assert.ok(attempt.questions.every((q) => q.module === "major"));
  assert.throws(
    () =>
      createAttempt(bank, {
        ...baseInput,
        stage: "major",
        confirmedMajorId: "uncovered-major",
      }),
    failure("INSUFFICIENT_QUESTION_COVERAGE"),
  );
  assert.throws(
    () => createAttempt(bank, { ...baseInput, stage: "retest" }),
    failure("ORIGINAL_ATTEMPT_REQUIRED"),
  );
});

test("range is distinct from difficulty, insufficient applicable pool fails without shortening", () => {
  assert.throws(
    () =>
      createAttempt(bank, {
        ...baseInput,
        modules: ["math"],
        scope: { math: "math-two" },
      }),
    (error) =>
      error instanceof AssessmentError &&
      error.status === 422 &&
      error.code === "INSUFFICIENT_QUESTION_COVERAGE",
  );
  const short = structuredClone(bank);
  short.questions = short.questions.filter((q) => q.id !== "v2-e1");
  assert.throws(
    () => createAttempt(short, baseInput),
    failure("INSUFFICIENT_QUESTION_COVERAGE"),
  );
  const strong = createAttempt(bank, {
    ...baseInput,
    mathFoundation: "strong",
  });
  assert.ok(strong.assemblyNotes.length > 0);
  assert.ok(strong.questions.every((q) => q.difficulty === "basic"));
});

test("explicit question serialization never exposes answers or future internal fields before submit", () => {
  const attempt = fresh();
  Object.assign(attempt.questions[0], {
    privateRubric: "hidden",
    answerAlias: "hidden",
  });
  const publicValue = publicAttempt(attempt);
  assert.equal(publicValue.diagnosis, undefined);
  assert.deepEqual(Object.keys(publicValue.questions[0]).sort(), [
    "difficulty",
    "id",
    "module",
    "options",
    "point",
    "revisionId",
    "stem",
    "subject",
    "text",
  ]);
  assert.equal("subjectId" in publicValue, false);
  assert.throws(() => publicDiagnosis(attempt), failure("SUBMISSION_REQUIRED"));
  publicValue.questions[0].options[0] = "changed";
  assert.notEqual(
    publicValue.questions[0].options[0],
    attempt.questions[0].options[0],
  );
});

test("draft patch validates options, strips unauthorized fields and rejects stale saves", () => {
  const original = fresh();
  const id = original.questions[0].id;
  const changed = saveDraft(original, {
    expectedAttemptVersion: 1,
    answers: [{ questionId: id, selectedOption: 0, reasoning: "代入公式" }],
    currentIndex: 2,
  });
  assert.equal(changed.attemptVersion, 2);
  assert.equal(changed.currentIndex, 2);
  assert.equal(original.answers[0].selectedOption, null);
  assert.deepEqual(changed.questions, original.questions);
  assert.equal(changed.answers[1].selectedOption, null);
  assert.throws(
    () => saveDraft(changed, { expectedAttemptVersion: 1, answers: [] }),
    failure("VERSION_CONFLICT"),
  );
  assert.throws(
    () =>
      saveDraft(original, {
        expectedAttemptVersion: 1,
        answers: [{ questionId: id, selectedOption: 9 }],
      }),
    failure("INVALID_ANSWER"),
  );
  assert.throws(
    () =>
      saveDraft(original, {
        expectedAttemptVersion: 1,
        answers: [null] as never,
      }),
    failure("INVALID_ANSWERS"),
  );
});

test("submission requires explicit confirmation for unanswered, fixes latest draft, and is idempotent", () => {
  const original = fresh();
  assert.throws(
    () => submitAttempt(original, { expectedAttemptVersion: 1 }),
    failure("UNANSWERED_CONFIRMATION_REQUIRED"),
  );
  const draft = saveDraft(original, {
    expectedAttemptVersion: 1,
    answers: [
      {
        questionId: original.questions[0].id,
        selectedOption: original.questions[0].correct,
      },
    ],
  });
  assert.throws(
    () =>
      submitAttempt(draft, {
        expectedAttemptVersion: 1,
        confirmUnanswered: true,
      }),
    failure("VERSION_CONFLICT"),
  );
  const final = submitted(draft);
  assert.equal(final.diagnosis?.counts.correct, 1);
  assert.equal(final.diagnosis?.counts.unanswered, 14);
  assert.deepEqual(submitAttempt(final, { expectedAttemptVersion: 1 }), final);
  assert.equal(original.status, "in_progress");
  assert.throws(
    () =>
      saveDraft(final, {
        expectedAttemptVersion: final.attemptVersion,
        answers: [],
      }),
    failure("ATTEMPT_CLOSED"),
  );
});

test("all-correct results are counts and limited evidence, never entrance scores or probabilities", () => {
  const initial = fresh();
  const draft = saveDraft(initial, {
    expectedAttemptVersion: 1,
    answers: initial.questions.map((q) => ({
      questionId: q.id,
      selectedOption: q.correct,
    })),
  });
  const diagnosis = publicDiagnosis(submitted(draft));
  assert.equal(diagnosis.counts.correct, 15);
  assert.ok(diagnosis.uncoveredPoints.includes("其他未覆盖知识点（待评估）"));
  assert.ok(diagnosis.limitations.some((text) => text.includes("不推算")));
  for (const forbidden of [
    "score",
    "estimatedScore",
    "admissionProbability",
    "abilityScore",
  ])
    assert.equal(forbidden in diagnosis, false);
});

test("applicability switch preserves drafts/results, blocks writes, and only re-enables open compatible attempts", () => {
  const initial = createAttempt(bank, {
    ...baseInput,
    stage: "major",
    confirmedMajorId: "research",
  });
  const pending = reassessApplicability(initial, {});
  assert.equal(pending.status, "in_progress");
  assert.equal(pending.applicability.applicability, "pending");
  assert.throws(
    () => saveDraft(pending, { expectedAttemptVersion: 1, answers: [] }),
    failure("ATTEMPT_NOT_APPLICABLE"),
  );
  const incompatible = reassessApplicability(initial, {
    confirmedMajorId: "law",
  });
  assert.throws(
    () => submitted(incompatible),
    failure("ATTEMPT_NOT_APPLICABLE"),
  );
  const back = reassessApplicability(incompatible, {
    confirmedMajorId: "research",
  });
  assert.equal(submitted(back).status, "submitted");
  const history = reassessApplicability(submitted(initial), {
    confirmedMajorId: "law",
  });
  assert.equal(history.status, "submitted");
  assert.deepEqual(history.answers, initial.answers);
  const closed = closeAttempt(initial, "abandoned", "主动重新开始");
  assert.throws(
    () =>
      submitted(
        reassessApplicability(closed, { confirmedMajorId: "research" }),
      ),
    failure("ATTEMPT_CLOSED"),
  );
});

test("publication checks are per question and immutable publication does not forge review", () => {
  const fixture = reviewedBank();
  assert.deepEqual(validateQuestion(fixture.questions[0], true), []);
  assert.deepEqual(validateQuestionBank(fixture, true), []);
  const release = publishQuestionBank(fixture, "reviewed-test-v1");
  assert.equal(fixture.questions[0].publicationStatus, "unpublished");
  assert.equal(release.questions[0].publicationStatus, "published");
  assert.equal(
    createAttempt(release, { subjectId: "student-a" }).example,
    false,
  );
  fixture.questions[0].options[1] = fixture.questions[0].options[0];
  assert.ok(validateQuestion(fixture.questions[0], true).length);
  assert.throws(
    () => publishQuestionBank(fixture, "bad-v1"),
    failure("QUESTION_REVIEW_REQUIRED"),
  );
});

test("published question revisions and bank versions cannot be overwritten through a new release", () => {
  const fixture = reviewedBank();
  const released = publishQuestionBank(fixture, "stable-release-v1");
  assert.throws(
    () => publishQuestionBank(fixture, "stable-release-v1", [released]),
    failure("QUESTION_BANK_VERSION_EXISTS"),
  );
  fixture.questions[0].correct = (fixture.questions[0].correct + 1) % 4;
  assert.throws(
    () => publishQuestionBank(fixture, "changed-release-v2", [released]),
    failure("QUESTION_REVISION_IMMUTABLE"),
  );
  fixture.questions[0].revisionId += "-new-revision";
  assert.equal(
    publishQuestionBank(fixture, "changed-release-v2", [released])
      .questionBankVersion,
    "changed-release-v2",
  );
});

test("explicit answer correction retains original fixed questions and old immutable result", () => {
  const release = publishQuestionBank(reviewedBank(), "reviewed-test-v1");
  const original = submitted(
    createAttempt(release, { subjectId: "student-a", seed: "a" }),
  );
  const revisions = structuredClone(original.questions);
  revisions[0].revisionId += "-correction";
  revisions[0].explanation += "（测试更正依据）";
  const corrected = correctDiagnosis(original, revisions, "测试更正原因");
  assert.deepEqual(corrected.questions, original.questions);
  assert.equal(corrected.questionBankVersion, original.questionBankVersion);
  assert.notEqual(
    corrected.diagnosis?.diagnosisVersion,
    original.diagnosis?.diagnosisVersion,
  );
  assert.equal(corrected.previousDiagnoses?.[0].usableForRecommendation, false);
  assert.equal(
    corrected.diagnosis?.correction?.previousDiagnosisVersion,
    original.diagnosis?.diagnosisVersion,
  );
});
