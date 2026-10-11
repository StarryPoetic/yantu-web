import test from "node:test";
import assert from "node:assert/strict";
import {
  createAttempt,
  loadQuestionBank,
  publicAttempt,
  validateQuestionBank,
} from "../../server/assessment/index.ts";
import {
  knowledgeArea,
  SCREENING_AREAS,
} from "../../shared/assessment-knowledge.ts";

const bank = await loadQuestionBank();

test("V3B bank has 56 unique, answered, explained and tagged questions with tiered original additions", () => {
  assert.deepEqual(validateQuestionBank(bank), []);
  const counts = { math: 23, english: 17, politics: 8, major: 8 };
  for (const [module, count] of Object.entries(counts)) {
    const questions = bank.questions.filter((q) => q.module === module);
    assert.equal(questions.length, count);
    assert.deepEqual(
      new Set(questions.map((q) => q.difficulty)),
      new Set(["basic", "intermediate", "advanced"]),
    );
    for (const q of questions) {
      assert.ok(q.options[q.correct] && q.explanation.trim() && q.point.trim());
      assert.ok(bank.knowledgePoints[q.module]?.includes(q.point));
    }
  }
  const added = bank.questions.filter((q) => q.id.startsWith("v3b-"));
  assert.equal(added.length, 36);
  for (const q of added) {
    assert.match(q.source.origin, /原创/);
    assert.equal(q.reviewStatus, "draft");
    assert.equal(q.publicationStatus, "unpublished");
    assert.ok(q.studyHint);
    if (knowledgeArea(q.module, q.point) === "probability")
      assert.ok(!q.scopes.includes("math-two"));
    if (q.point.startsWith("经济应用："))
      assert.ok(q.scopes.includes("math-three"));
  }
});

test("V3B common screens deterministically sample distinguishing domains across seeds and foundations", () => {
  for (const mathFoundation of [
    "weak",
    "average",
    "strong",
    "unknown",
  ] as const)
    for (let seed = 0; seed < 20; seed++) {
      const input = {
        subjectId: "bank-test",
        seed: String(seed),
        now: "2026-10-12T00:00:00Z",
        mathFoundation,
        allowExampleBank: true,
      };
      const attempt = createAttempt(bank, input);
      assert.deepEqual(attempt.questions, createAttempt(bank, input).questions);
      for (const module of ["math", "english"] as const) {
        const questions = attempt.questions.filter((q) => q.module === module);
        assert.equal(questions.length, 5);
        const areas = new Set(
          questions.map((q) => knowledgeArea(module, q.point)),
        );
        for (const area of SCREENING_AREAS[module])
          assert.ok(areas.has(area), `${module}:${area}`);
      }
      assert.equal(new Set(attempt.questions.map((q) => q.id)).size, 15);
      assert.ok(
        publicAttempt(attempt).questions.every(
          (q) => !("correct" in q) && !("explanation" in q),
        ),
      );
    }
});

test("V3B named scopes all assemble five questions without leaking probability into math two", () => {
  for (const scope of [
    "math-one",
    "math-two",
    "math-three",
    "english-one",
    "english-two",
  ]) {
    const module = scope.startsWith("math") ? "math" : "english";
    const attempt = createAttempt(bank, {
      subjectId: "scope-test",
      modules: [module],
      scope: { [module]: scope },
      allowExampleBank: true,
    });
    assert.equal(attempt.questions.length, 5);
    assert.ok(attempt.questions.every((q) => q.scopes.includes(scope)));
    if (scope === "math-two")
      assert.ok(
        attempt.questions.every(
          (q) => knowledgeArea(module, q.point) !== "probability",
        ),
      );
  }
});

test("V3B validator rejects missing answers, explanations, tags, and difficulty", () => {
  for (const field of [
    "correct",
    "explanation",
    "point",
    "difficulty",
  ] as const) {
    const broken = structuredClone(bank);
    Reflect.deleteProperty(broken.questions[0], field);
    assert.ok(validateQuestionBank(broken).length > 0, field);
  }
});
