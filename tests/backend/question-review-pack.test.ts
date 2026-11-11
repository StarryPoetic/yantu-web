import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertBlankReviewResults,
  assertCurrentReviewTemplate,
  buildQuestionReviewPack,
  packPath,
  reviewPackOutputs,
  root,
  sourcePath,
} from "../../scripts/question-review-pack.ts";
import {
  QUESTION_REVIEW_CHECKS,
  validateQuestionBank,
} from "../../server/assessment/index.ts";
import type { QuestionBank } from "../../server/assessment/types.ts";

const bank = JSON.parse(
  readFileSync(resolve(root, sourcePath), "utf8"),
) as QuestionBank;
const pack = buildQuestionReviewPack(bank);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const allNull = (value: unknown): boolean =>
  value === null ||
  (typeof value === "object" &&
    value !== null &&
    Object.values(value).every(allNull));

test("all 56 real draft revisions have complete snapshots, provenance and blank independent checks", () => {
  assert.equal(pack.entries.length, 56);
  assert.equal(new Set(pack.entries.map((entry) => entry.questionId)).size, 56);
  assert.equal(pack.source.sha256, hash(bank));
  for (const [index, entry] of pack.entries.entries()) {
    assert.deepEqual(entry.snapshot, bank.questions[index]);
    assert.equal(entry.questionSha256, hash(entry.snapshot));
    assert.equal(entry.sourcePointer, `${sourcePath}#/questions/${index}`);
    assert.deepEqual(Object.keys(entry.review.requiredChecks), [
      ...QUESTION_REVIEW_CHECKS,
    ]);
    assert.equal(Object.keys(entry.review.additionalChecks).length, 5);
    assert.ok(allNull(entry.review));
    assert.equal(entry.snapshot.reviewStatus, "draft");
    assert.equal(entry.snapshot.publicationStatus, "unpublished");
    assert.equal(entry.snapshot.calibration, "manual_initial");
  }
  assert.ok(allNull(pack.calibrationDecisions));
  assert.equal(pack.status.humanReviewed, 0);
  assert.equal(pack.status.calibrated, false);
  assert.match(pack.notice, /不预测考研成绩.*录取概率/);
});

test("coverage describes stored tags and explicit gaps without inventing a syllabus or major mapping", () => {
  assert.deepEqual(
    pack.coverage.byModule.map((module) => [module.module, module.count]),
    [
      ["math", 23],
      ["english", 17],
      ["politics", 8],
      ["major", 8],
    ],
  );
  assert.equal(
    pack.coverage.byModule.reduce((sum, module) => sum + module.count, 0),
    56,
  );
  for (const scope of pack.coverage.byScope) {
    const questions = bank.questions.filter((question) =>
      question.scopes.includes(scope.scope),
    );
    assert.equal(scope.count, questions.length);
    assert.deepEqual(
      scope.questionIds,
      questions.map((question) => question.id),
    );
    assert.equal(
      Object.values(scope.difficulties).reduce((sum, count) => sum + count, 0),
      scope.count,
    );
  }
  for (const module of pack.coverage.byModule) {
    assert.deepEqual(module.declaredWithoutQuestions, [
      "其他未覆盖知识点（待评估）",
    ]);
    assert.deepEqual(module.questionPointsNotDeclared, []);
  }
  assert.equal(pack.coverage.missingStudyHintQuestionIds.length, 19);
  assert.equal(pack.coverage.missingDistractorHypothesesQuestionIds.length, 56);
  assert.deepEqual(
    pack.coverage.byScope.find((scope) => scope.scope === "english-two")!
      .emptyDifficultyBands,
    ["advanced"],
  );
  assert.deepEqual(
    pack.coverage.byScope.find((scope) => scope.scope === "politics")!
      .emptyDifficultyBands,
    ["intermediate", "advanced"],
  );
  assert.deepEqual(pack.coverage.legacyMajorIds, ["practice", "research"]);
  assert.equal(pack.coverage.majorMappingConfirmed, false);
  assert.match(pack.coverage.basis, /not official syllabus coverage/);
});

test("missing, duplicated, stale-answer or silently reviewed entries cannot pass the template checker", () => {
  assertCurrentReviewTemplate(pack, bank);
  const missing = structuredClone(pack);
  missing.entries.pop();
  assert.throws(() => assertCurrentReviewTemplate(missing, bank), /incomplete/);
  const duplicate = structuredClone(pack);
  duplicate.entries[1] = duplicate.entries[0];
  assert.throws(
    () => assertCurrentReviewTemplate(duplicate, bank),
    /incomplete/,
  );
  const changed = structuredClone(bank);
  changed.questions[0].correct = (changed.questions[0].correct + 1) % 4;
  assert.throws(() => assertCurrentReviewTemplate(pack, changed), /stale/);
  const reviewed = JSON.parse(JSON.stringify(pack));
  reviewed.entries[0].review.requiredChecks.answer_unique.passed = true;
  assert.throws(
    () => assertCurrentReviewTemplate(reviewed, bank),
    /human decisions/,
  );
});

test("regeneration refuses both approval and rejection decisions and preserves calibration work", () => {
  assertBlankReviewResults(pack);
  for (const result of [true, false]) {
    const review = JSON.parse(JSON.stringify(pack));
    review.entries[0].review.requiredChecks.answer_unique.passed = result;
    assert.throws(() => assertBlankReviewResults(review), /overwrite human/);
  }
  const calibration = JSON.parse(JSON.stringify(pack));
  calibration.calibrationDecisions.observedSampleSize = 0;
  assert.throws(() => assertBlankReviewResults(calibration), /overwrite human/);
  const note = JSON.parse(JSON.stringify(pack));
  note.entries[0].review.rationale = "Review in progress; not approved";
  assert.throws(() => assertBlankReviewResults(note), /overwrite human/);
});

test("the preparation pack cannot be treated as a published question bank or erase reviewed source history", () => {
  assert.ok(
    validateQuestionBank(pack as unknown as QuestionBank, true).length > 0,
  );
  assert.equal(pack.status.importableAsQuestionBank, false);
  const approved = structuredClone(bank);
  approved.questions[0].reviewStatus = "approved";
  assert.throws(() => buildQuestionReviewPack(approved), /Only unreviewed/);
  const calibrated = structuredClone(bank);
  calibrated.questions[0].calibration = "calibrated";
  assert.throws(() => buildQuestionReviewPack(calibrated), /uncalibrated/);
  const duplicate = structuredClone(bank);
  duplicate.questions.push(duplicate.questions[0]);
  assert.throws(() => buildQuestionReviewPack(duplicate), /重复/);
  const original = structuredClone(bank);
  const detached = buildQuestionReviewPack(bank);
  detached.entries[0].snapshot.text = "Local reviewer copy";
  assert.deepEqual(bank, original);
});

test("committed review artifacts reproduce offline and --check never changes source or results", () => {
  const originals = [sourcePath, packPath].map((path) =>
    readFileSync(resolve(root, path)),
  );
  for (const [path, expected] of reviewPackOutputs(bank))
    assert.equal(
      readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n"),
      expected,
    );
  const output = execFileSync(
    process.execPath,
    ["scripts/question-review-pack.ts", "--check"],
    {
      cwd: root,
      env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
      encoding: "utf8",
    },
  );
  assert.equal(JSON.parse(output).questions, 56);
  assert.equal(JSON.parse(output).paidCalls, 0);
  assert.deepEqual(
    [sourcePath, packPath].map((path) => readFileSync(resolve(root, path))),
    originals,
  );
});
