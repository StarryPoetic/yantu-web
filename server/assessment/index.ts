import { REASONING_MAX_LENGTH } from "../../shared/input-contracts.ts";
import {
  knowledgeArea,
  SCREENING_AREAS,
} from "../../shared/assessment-knowledge.ts";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  validPresentation,
  validStem,
  questionStem,
  questionSolution,
} from "./presentation.ts";
import type {
  Answer,
  ApplicabilityTarget,
  AssessmentAttempt,
  AssessmentModule,
  CreateAttemptInput,
  Diagnosis,
  Difficulty,
  PublicAttempt,
  QuestionBank,
  QuestionRevision,
  SaveDraftInput,
  SubmitAttemptInput,
} from "./types.ts";
export type * from "./types.ts";

export class AssessmentError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AssessmentError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ASSEMBLY_VERSION = "screening-five-domains-v3";
export const SCORING_VERSION = "single-choice-v1";
const modules: AssessmentModule[] = ["math", "english", "politics", "major"];
export const QUESTION_REVIEW_CHECKS = [
  "answer_unique",
  "conditions_complete",
  "options_distinct",
  "explanation_consistent",
  "scope_checked",
  "rights_checked",
];
const snapshot = <T>(value: T): T => structuredClone(value);
function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): never {
  throw new AssessmentError(status, code, message, details);
}

/** Reads a server-only file. This module is never imported by the browser at runtime. */
export async function loadQuestionBank(
  path: string | URL = new URL(
    "../../knowledge/questions/example-v1.json",
    import.meta.url,
  ),
): Promise<QuestionBank> {
  const bank = JSON.parse(await readFile(path, "utf8")) as QuestionBank;
  const errors = validateQuestionBank(bank);
  if (errors.length)
    fail(500, "INVALID_QUESTION_BANK", "题库结构验证未通过。", errors);
  return bank;
}

/** Structural checks supplement a recorded human subject review; they cannot replace it. */
export function validateQuestion(
  question: QuestionRevision,
  forPublication = false,
): string[] {
  const errors: string[] = [];
  if (!question || typeof question !== "object") return ["题目必须是对象"];
  if (question.stem !== undefined && !validStem(question.stem, question.text))
    errors.push("stem 题干内容或公式结构无效");
  for (const field of ["presentation", "solutionPresentation"] as const)
    if (question[field] !== undefined && !validPresentation(question[field]))
      errors.push(`${field} 公式或图示结构无效`);
  if (
    question.studyHint !== undefined &&
    (typeof question.studyHint !== "string" || question.studyHint.length > 1500)
  )
    errors.push("知识点提示格式无效");
  for (const key of [
    "id",
    "revisionId",
    "subject",
    "point",
    "text",
    "explanation",
  ] as const) {
    if (typeof question[key] !== "string" || !question[key].trim())
      errors.push(`${key} 必填`);
  }
  if (!modules.includes(question.module)) errors.push("module 无效");
  if (
    !Array.isArray(question.options) ||
    question.options.length < 2 ||
    question.options.length > 8 ||
    question.options.some(
      (option) => typeof option !== "string" || !option.trim(),
    ) ||
    new Set(question.options.map((option) => option.trim())).size !==
      question.options.length
  )
    errors.push("选项须为 2 至 8 个不重复的非空文本");
  if (
    !Number.isInteger(question.correct) ||
    question.correct < 0 ||
    question.correct >= (question.options?.length ?? 0)
  )
    errors.push("单选正确答案必须唯一且位于选项范围内");
  if (
    !Array.isArray(question.scopes) ||
    !question.scopes.length ||
    question.scopes.some((scope) => typeof scope !== "string" || !scope.trim())
  )
    errors.push("须提供考试范围");
  if (!["basic", "intermediate", "advanced"].includes(question.difficulty))
    errors.push("难度档位无效（考试范围不是难度）");
  if (!["manual_initial", "calibrated"].includes(question.calibration))
    errors.push("须标注难度校准状态");
  if (
    !Array.isArray(question.majorIds) ||
    question.majorIds.some((id) => typeof id !== "string" || !id.trim())
  )
    errors.push("majorIds 格式无效");
  if (question.module === "major" && !question.majorIds?.length)
    errors.push("专业题须提供适用专业");
  if (
    !question.source?.title ||
    !question.source.origin ||
    !question.source.rights ||
    !Array.isArray(question.source.applicableYears)
  )
    errors.push("须登记来源、版权和适用年份");
  if (
    !question.errorHypotheses ||
    typeof question.errorHypotheses !== "object" ||
    Array.isArray(question.errorHypotheses)
  )
    errors.push("须提供错误假设映射");
  else
    for (const [key, value] of Object.entries(question.errorHypotheses))
      if (
        !/^\d+$/.test(key) ||
        Number(key) >= (question.options?.length ?? 0) ||
        Number(key) === question.correct ||
        typeof value !== "string" ||
        !value.trim()
      )
        errors.push("错误假设只能对应错误选项");
  if (
    !["draft", "pending_review", "approved", "rejected"].includes(
      question.reviewStatus,
    )
  )
    errors.push("审核状态无效");
  if (
    !["unpublished", "published", "withdrawn"].includes(
      question.publicationStatus,
    )
  )
    errors.push("发布状态无效");
  if (forPublication || question.publicationStatus === "published") {
    if (question.reviewStatus !== "approved") errors.push("仅已批准题目可发布");
    if (
      !question.review?.reviewerId ||
      !question.review.reviewedAt ||
      !Number.isFinite(Date.parse(question.review.reviewedAt)) ||
      !question.review.rationale ||
      !Array.isArray(question.review.checks) ||
      QUESTION_REVIEW_CHECKS.some(
        (check) => !question.review?.checks.includes(check),
      )
    )
      errors.push("缺少完整人工审校记录");
  }
  return errors;
}

export function validateQuestionBank(
  bank: QuestionBank,
  forPublication = false,
): string[] {
  if (!bank || typeof bank !== "object" || !Array.isArray(bank.questions))
    return ["题库必须包含 questions 数组"];
  const errors = bank.questions.flatMap((question, index) =>
    validateQuestion(question, forPublication).map(
      (error) => `questions[${index}]: ${error}`,
    ),
  );
  if (
    bank.schemaVersion !== 1 ||
    !bank.questionBankVersion ||
    !["example", "reviewed"].includes(bank.mode) ||
    !bank.knowledgePoints ||
    typeof bank.knowledgePoints !== "object" ||
    Object.entries(bank.knowledgePoints).some(
      ([module, points]) =>
        !modules.includes(module as AssessmentModule) ||
        !Array.isArray(points) ||
        points.some((point) => typeof point !== "string" || !point.trim()),
    )
  )
    errors.push("题库版本、模式或知识点目录无效");
  if (
    new Set(bank.questions.map((q) => q?.id)).size !== bank.questions.length ||
    new Set(bank.questions.map((q) => q?.revisionId)).size !==
      bank.questions.length
  )
    errors.push("题目或修订 ID 重复");
  if (forPublication && bank.mode !== "reviewed")
    errors.push("示例题库不能作为正式题库发布");
  if (forPublication && !bank.questions.length) errors.push("发布题库不可为空");
  return errors;
}

export function publishQuestionBank(
  bank: QuestionBank,
  version: string,
  previousBanks: QuestionBank[] = [],
): QuestionBank {
  if (!version || version === bank.questionBankVersion)
    fail(422, "NEW_VERSION_REQUIRED", "发布须使用新的不可变题库版本。");
  const errors = validateQuestionBank(bank, true);
  if (errors.length)
    fail(
      422,
      "QUESTION_REVIEW_REQUIRED",
      "题库必须通过人工审校与结构验证后才能发布。",
      errors,
    );
  if (
    previousBanks.some((previous) => previous.questionBankVersion === version)
  )
    fail(409, "QUESTION_BANK_VERSION_EXISTS", "已发布题库版本不可覆盖。");
  for (const question of bank.questions) {
    const previous = previousBanks
      .flatMap((release) => release.questions)
      .find((old) => old.revisionId === question.revisionId);
    if (previous && immutableContent(previous) !== immutableContent(question))
      fail(
        409,
        "QUESTION_REVISION_IMMUTABLE",
        "已发布题目内容不可原地修改，请创建新的题目修订。",
        { revisionId: question.revisionId },
      );
  }
  return {
    ...snapshot(bank),
    questionBankVersion: version,
    questions: bank.questions.map((question) => ({
      ...snapshot(question),
      publicationStatus: "published",
    })),
  };
}

function immutableContent(question: QuestionRevision): string {
  const {
    reviewStatus: _review,
    publicationStatus: _publication,
    review: _record,
    ...content
  } = question;
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, nested]) => [key, canonical(nested)]),
          )
        : value;
  return JSON.stringify(canonical(content));
}

export function createAttempt(
  bank: QuestionBank,
  input: CreateAttemptInput,
): AssessmentAttempt {
  if (!input.subjectId) fail(401, "SUBJECT_REQUIRED", "需要有效会话。");
  const bankErrors = validateQuestionBank(bank);
  if (bankErrors.length)
    fail(422, "INVALID_QUESTION_BANK", "题库结构无效。", bankErrors);
  if (bank.mode === "example" && input.allowExampleBank !== true)
    fail(
      422,
      "REVIEWED_BANK_REQUIRED",
      "正式测评题库尚未审校发布；可跳过测评。",
    );
  const stage = input.stage ?? "initial";
  if (!["initial", "major", "retest"].includes(stage))
    fail(422, "INVALID_STAGE", "不支持此测评阶段。");
  const selected =
    input.modules ??
    (stage === "major" ? ["major"] : ["math", "english", "politics"]);
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.some((module) => !modules.includes(module)) ||
    new Set(selected).size !== selected.length
  )
    fail(422, "INVALID_MODULES", "至少选择一个有效科目，且不能重复。");
  if (
    selected.includes("major") &&
    (!input.confirmedMajorId || selected.length !== 1 || stage === "initial")
  )
    fail(
      422,
      "MAJOR_CONFIRMATION_REQUIRED",
      "专业课须先确认报考专业，并创建独立的专业课测评。",
    );
  if (stage === "major" && !selected.includes("major"))
    fail(422, "INVALID_MODULES", "专业课阶段只允许专业课模块。");
  if (stage === "retest" && !input.derivedFrom)
    fail(422, "ORIGINAL_ATTEMPT_REQUIRED", "重测须关联原测评。");
  const foundation = input.mathFoundation ?? "unknown";
  if (!["weak", "average", "strong", "unknown"].includes(foundation))
    fail(422, "INVALID_FOUNDATION", "基础自评无效。");
  const now = input.now ?? new Date().toISOString();
  const seed = input.seed ?? randomUUID();
  const scope = Object.fromEntries(
    selected.map((module) => [
      module,
      input.scope?.[module] ?? "common-foundation",
    ]),
  );
  if (
    Object.values(scope).some(
      (value) =>
        typeof value !== "string" || !value.trim() || value.length > 80,
    )
  )
    fail(422, "INVALID_SCOPE", "考试范围无效。");
  const chosen: QuestionRevision[] = [];
  const assemblyNotes: string[] = [];
  for (const module of selected) {
    const candidates = bank.questions.filter(
      (question) =>
        question.module === module &&
        question.scopes.includes(scope[module]!) &&
        (module !== "major" ||
          question.majorIds.includes(input.confirmedMajorId!)) &&
        (bank.mode === "example"
          ? question.reviewStatus === "draft" &&
            question.publicationStatus === "unpublished"
          : question.reviewStatus === "approved" &&
            question.publicationStatus === "published"),
    );
    const requiredPoints = bank.knowledgePoints[module] ?? [];
    if (
      candidates.length < 5 ||
      new Set(candidates.map((q) => q.point)).size <
        Math.min(5, requiredPoints.length)
    )
      fail(
        422,
        "INSUFFICIENT_QUESTION_COVERAGE",
        "题库无法满足该科五题、范围与覆盖要求，请调整科目或跳过测评。",
        {
          module,
          scope: scope[module],
          available: candidates.length,
          required: 5,
        },
      );
    const pattern: Difficulty[] =
      foundation === "strong"
        ? ["basic", "basic", "intermediate", "intermediate", "advanced"]
        : foundation === "weak"
          ? ["basic", "basic", "basic", "basic", "intermediate"]
          : ["basic", "basic", "basic", "intermediate", "intermediate"];
    const ranked = [...candidates].sort((a, b) =>
      hash(`${seed}:${a.revisionId}`).localeCompare(
        hash(`${seed}:${b.revisionId}`),
      ),
    );
    const selectedQuestions: QuestionRevision[] = [];
    // Cross-scope screening samples all route-distinguishing domains when the
    // bank supplies them. Scope-specific and legacy pools keep their coverage.
    const areas =
      scope[module] === "common-foundation" &&
      (module === "math" || module === "english")
        ? SCREENING_AREAS[module].filter((area) =>
            candidates.some((q) => knowledgeArea(module, q.point) === area),
          )
        : [];
    for (const [index, preferred] of pattern.entries()) {
      const remaining = ranked.filter(
        (q) => !selectedQuestions.some((item) => item.id === q.id),
      );
      const newPoint = remaining.filter(
        (q) => !selectedQuestions.some((item) => item.point === q.point),
      );
      // A common English screen includes a challenging reading/sentence item.
      // Self-rated mathematics foundation must not remove this discriminator.
      const challenge =
        module === "english" && areas.length === 4 && index === 4
          ? newPoint.find(
              (q) =>
                q.difficulty === "advanced" &&
                ["reading", "sentence"].includes(
                  knowledgeArea(module, q.point),
                ),
            )
          : undefined;
      const areaPool = newPoint.filter(
        (q) => knowledgeArea(module, q.point) === areas[index],
      );
      const pool = areaPool.length
        ? areaPool
        : newPoint.length
          ? newPoint
          : remaining;
      const question =
        challenge ?? pool.find((q) => q.difficulty === preferred) ?? pool[0];
      selectedQuestions.push(question);
    }
    if (selectedQuestions.some((q, index) => q.difficulty !== pattern[index]))
      assemblyNotes.push(
        `${module}：可用题目难度未覆盖全部优先配比，采用同一范围内已允许题目；实际难度已逐题标注。`,
      );
    chosen.push(...selectedQuestions);
  }
  const attempt: AssessmentAttempt = {
    schemaVersion: 1,
    assessmentAttemptId: input.assessmentAttemptId ?? randomUUID(),
    subjectId: input.subjectId,
    stage,
    modules: selected,
    scope,
    mathFoundation: foundation,
    confirmedMajorId: input.confirmedMajorId,
    questionBankVersion: bank.questionBankVersion,
    assemblyRuleVersion: ASSEMBLY_VERSION,
    scoringVersion: SCORING_VERSION,
    attemptVersion: 1,
    status: "in_progress",
    createdAt: now,
    derivedFrom: input.derivedFrom,
    seed,
    questions: chosen,
    knowledgePoints: selected.flatMap(
      (module) => bank.knowledgePoints[module] ?? [],
    ),
    assemblyNotes,
    answers: chosen.map((question) => ({
      questionId: question.id,
      selectedOption: null,
    })),
    currentIndex: 0,
    applicability: {
      applicability: "applicable",
      reason: "符合当前已选择范围。",
      confirmedMajorId: input.confirmedMajorId,
      programRevisionId: input.programRevisionId,
      scope,
      ruleVersion: "scope-applicability-v1",
      evaluatedAt: now,
    },
    example: bank.mode === "example",
    notice: bank.notice,
  };
  return snapshot(attempt);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function assertWritable(attempt: AssessmentAttempt, expected: number) {
  if (attempt.status !== "in_progress")
    fail(409, "ATTEMPT_CLOSED", "该测评不能继续修改，请创建新测评。");
  if (attempt.applicability.applicability !== "applicable")
    fail(409, "ATTEMPT_NOT_APPLICABLE", attempt.applicability.reason);
  if (expected !== attempt.attemptVersion)
    fail(409, "VERSION_CONFLICT", "草稿已有更新，请重新载入后操作。", {
      attemptVersion: attempt.attemptVersion,
    });
}

export function saveDraft(
  attempt: AssessmentAttempt,
  input: SaveDraftInput,
): AssessmentAttempt {
  assertWritable(attempt, input.expectedAttemptVersion);
  if (
    !Array.isArray(input.answers) ||
    input.answers.some((answer) => !answer || typeof answer !== "object") ||
    new Set(input.answers.map((answer) => answer.questionId)).size !==
      input.answers.length
  )
    fail(422, "INVALID_ANSWERS", "作答列表无效或题目重复。");
  const updates = new Map<string, Answer>();
  for (const answer of input.answers) {
    const question = attempt.questions.find(
      (item) => item.id === answer.questionId,
    );
    if (
      !question ||
      (answer.selectedOption !== null &&
        (!Number.isInteger(answer.selectedOption) ||
          answer.selectedOption < 0 ||
          answer.selectedOption >= question.options.length))
    )
      fail(422, "INVALID_ANSWER", "题目或选择的选项无效。");
    if (
      answer.reasoning !== undefined &&
      (typeof answer.reasoning !== "string" ||
        answer.reasoning.length > REASONING_MAX_LENGTH)
    )
      fail(422, "INVALID_REASONING", "简要思路最多 1000 字。");
    if (
      answer.confidence !== undefined &&
      !["sure", "unsure"].includes(answer.confidence)
    )
      fail(422, "INVALID_CONFIDENCE", "自信度选项无效。");
    if (
      answer.durationSeconds !== undefined &&
      (!Number.isFinite(answer.durationSeconds) ||
        answer.durationSeconds < 0 ||
        answer.durationSeconds > 86400)
    )
      fail(422, "INVALID_DURATION", "作答用时无效。");
    const previous = attempt.answers.find(
      (item) => item.questionId === answer.questionId,
    );
    updates.set(answer.questionId, {
      questionId: answer.questionId,
      selectedOption: answer.selectedOption,
      reasoning: answer.reasoning ?? previous?.reasoning,
      confidence: answer.confidence ?? previous?.confidence,
      durationSeconds: answer.durationSeconds ?? previous?.durationSeconds,
    });
  }
  const currentIndex = input.currentIndex ?? attempt.currentIndex;
  if (
    !Number.isInteger(currentIndex) ||
    currentIndex < 0 ||
    currentIndex >= attempt.questions.length
  )
    fail(422, "INVALID_POSITION", "题号超出范围。");
  return {
    ...snapshot(attempt),
    attemptVersion: attempt.attemptVersion + 1,
    answers: attempt.answers.map((answer) =>
      snapshot(updates.get(answer.questionId) ?? answer),
    ),
    currentIndex,
  };
}

export function submitAttempt(
  attempt: AssessmentAttempt,
  input: SubmitAttemptInput,
): AssessmentAttempt {
  if (attempt.status === "submitted") return snapshot(attempt);
  assertWritable(attempt, input.expectedAttemptVersion);
  const unanswered = attempt.answers.filter(
    (answer) => answer.selectedOption === null,
  ).length;
  if (unanswered && input.confirmUnanswered !== true)
    fail(
      422,
      "UNANSWERED_CONFIRMATION_REQUIRED",
      `还有 ${unanswered} 题未答，请确认后主动提交。`,
      { unanswered },
    );
  if (attempt.scoringVersion !== SCORING_VERSION)
    fail(
      409,
      "UNSUPPORTED_SCORING_VERSION",
      "此测评评分版本不再受支持，请保留草稿并联系维护者。",
    );
  const now = input.now ?? new Date().toISOString();
  return {
    ...snapshot(attempt),
    status: "submitted",
    submittedAt: now,
    attemptVersion: attempt.attemptVersion + 1,
    diagnosis: score(attempt, attempt.questions, attempt.scoringVersion, now),
  };
}

function score(
  attempt: AssessmentAttempt,
  questions: QuestionRevision[],
  scoringVersion: string,
  now: string,
): Diagnosis {
  const items = questions.map((question) => {
    const answer = attempt.answers.find(
      (item) => item.questionId === question.id,
    )!;
    const outcome =
      answer.selectedOption === null
        ? ("unanswered" as const)
        : answer.selectedOption === question.correct
          ? ("correct" as const)
          : ("incorrect" as const);
    return {
      questionId: question.id,
      questionRevisionId: question.revisionId,
      module: question.module,
      point: question.point,
      outcome,
      selectedOption: answer.selectedOption,
      correctOption: question.correct,
      explanation: question.explanation,
      ...(questionSolution(question)
        ? { presentation: questionSolution(question) }
        : {}),
      source: question.source.title,
      observation:
        outcome === "correct"
          ? "本题选择与参考答案一致。"
          : outcome === "incorrect"
            ? "本题选择与参考答案不一致。"
            : "本题未作答，保持待评估。",
      possibleCause:
        outcome === "incorrect" && answer.selectedOption !== null
          ? (question.errorHypotheses[String(answer.selectedOption)] ?? null)
          : null,
      uncertainty: answer.reasoning
        ? "简要过程仅提供线索，尚不能排除猜测、误读或其他原因。"
        : "未提供解题过程，无法区分概念、运算、误读或猜测等原因。",
      nextStep:
        outcome === "correct"
          ? `可用其他 ${question.point} 变式继续检查。`
          : `先阅读固定解析，再复习 ${question.point} 并尝试同类练习。`,
    };
  });
  const countsFor = (subset: typeof items) => ({
    correct: subset.filter((item) => item.outcome === "correct").length,
    incorrect: subset.filter((item) => item.outcome === "incorrect").length,
    unanswered: subset.filter((item) => item.outcome === "unanswered").length,
    total: subset.length,
  });
  return {
    assessmentAttemptId: attempt.assessmentAttemptId,
    diagnosisVersion: randomUUID(),
    questionBankVersion: attempt.questionBankVersion,
    scoringVersion,
    diagnosisRuleVersion: "limited-screening-v1",
    createdAt: now,
    counts: countsFor(items),
    modules: attempt.modules.map((module) => ({
      module,
      ...countsFor(items.filter((item) => item.module === module)),
    })),
    items,
    uncoveredPoints: attempt.knowledgePoints.filter(
      (point) =>
        !items.some(
          (item) => item.point === point && item.outcome !== "unanswered",
        ),
    ),
    limitations: [
      "每科五题只提供有限筛查线索，不推算考研科目分、总分、能力上限或录取概率。",
      "未覆盖或未作答知识点保持待评估；自报基础、自信度和用时不构成能力结论。",
      "政治题只反映所测知识，不推断政治认同，也不作为专业硬性排除条件。",
      ...(attempt.example
        ? [
            "当前为未经真实学科审校的本地示例练习，不能作为正式能力测评或推荐依据。",
          ]
        : []),
    ],
    example: attempt.example,
    usableForRecommendation:
      !attempt.example && attempt.applicability.applicability === "applicable",
  };
}

export function reassessApplicability(
  attempt: AssessmentAttempt,
  target: ApplicabilityTarget,
): AssessmentAttempt {
  const scope = target.scope ?? attempt.scope;
  let applicability: "applicable" | "not_applicable" | "pending" = "applicable";
  let reason = "符合当前目标与考试范围。";
  if (attempt.modules.includes("major") && !target.confirmedMajorId) {
    applicability = "pending";
    reason = "尚未确认当前报考专业。";
  } else if (
    attempt.modules.includes("major") &&
    attempt.questions.some(
      (q) => !q.majorIds.includes(target.confirmedMajorId!),
    )
  ) {
    applicability = "not_applicable";
    reason = "当前专业与此测评题目范围不兼容；历史作答保留。";
  } else if (
    attempt.questions.some(
      (q) => !scope[q.module] || !q.scopes.includes(scope[q.module]!),
    )
  ) {
    applicability = "not_applicable";
    reason = "当前考试范围与此测评不兼容；历史作答保留。";
  }
  return {
    ...snapshot(attempt),
    applicability: {
      applicability,
      reason,
      confirmedMajorId: target.confirmedMajorId,
      programRevisionId: target.programRevisionId,
      scope: snapshot(scope),
      ruleVersion: "scope-applicability-v1",
      evaluatedAt: target.now ?? new Date().toISOString(),
    },
  };
}

export function closeAttempt(
  attempt: AssessmentAttempt,
  status: "abandoned" | "invalidated",
  reason: string,
): AssessmentAttempt {
  if (attempt.status !== "in_progress")
    fail(409, "ATTEMPT_CLOSED", "只能关闭进行中的测评。");
  if (
    !["abandoned", "invalidated"].includes(status) ||
    typeof reason !== "string" ||
    !reason.trim()
  )
    fail(422, "CLOSE_REASON_REQUIRED", "需要有效的关闭原因。");
  return {
    ...snapshot(attempt),
    status,
    closedReason: reason,
    attemptVersion: attempt.attemptVersion + 1,
  };
}

/** Re-score through an explicit reviewed correction while retaining the original question snapshot and result. */
export function correctDiagnosis(
  attempt: AssessmentAttempt,
  revisedQuestions: QuestionRevision[],
  reason: string,
  now = new Date().toISOString(),
): AssessmentAttempt {
  if (attempt.status !== "submitted" || !attempt.diagnosis)
    fail(409, "SUBMISSION_REQUIRED", "仅能更正已提交诊断。");
  if (
    !reason.trim() ||
    revisedQuestions.length !== attempt.questions.length ||
    revisedQuestions.some(
      (q, i) =>
        q.id !== attempt.questions[i].id || validateQuestion(q, true).length,
    )
  )
    fail(
      422,
      "INVALID_CORRECTION",
      "更正必须提供同一题集的完整审核修订和原因。",
    );
  if (
    revisedQuestions.some(
      (question, index) =>
        question.revisionId === attempt.questions[index].revisionId &&
        immutableContent(question) !==
          immutableContent(attempt.questions[index]),
    )
  )
    fail(
      409,
      "QUESTION_REVISION_IMMUTABLE",
      "答案或解析更正必须创建新的题目修订。",
    );
  const diagnosis = score(attempt, revisedQuestions, SCORING_VERSION, now);
  diagnosis.correction = {
    previousDiagnosisVersion: attempt.diagnosis.diagnosisVersion,
    reason,
    correctedRevisionIds: revisedQuestions.map((q) => q.revisionId),
  };
  return {
    ...snapshot(attempt),
    previousDiagnoses: [
      ...snapshot(attempt.previousDiagnoses ?? []),
      { ...snapshot(attempt.diagnosis), usableForRecommendation: false },
    ],
    diagnosis,
  };
}

/** Explicit allowlist; adding an internal property cannot accidentally disclose an answer. */
export function publicAttempt(attempt: AssessmentAttempt): PublicAttempt {
  return snapshot({
    schemaVersion: attempt.schemaVersion,
    assessmentAttemptId: attempt.assessmentAttemptId,
    stage: attempt.stage,
    modules: attempt.modules,
    scope: attempt.scope,
    mathFoundation: attempt.mathFoundation,
    confirmedMajorId: attempt.confirmedMajorId,
    questionBankVersion: attempt.questionBankVersion,
    assemblyRuleVersion: attempt.assemblyRuleVersion,
    scoringVersion: attempt.scoringVersion,
    attemptVersion: attempt.attemptVersion,
    status: attempt.status,
    createdAt: attempt.createdAt,
    submittedAt: attempt.submittedAt,
    derivedFrom: attempt.derivedFrom,
    questions: attempt.questions.map((q) => ({
      id: q.id,
      revisionId: q.revisionId,
      module: q.module,
      subject: q.subject,
      point: q.point,
      text: q.text,
      options: q.options,
      difficulty: q.difficulty,
      stem: questionStem(q),
    })),
    answers: attempt.answers.map((a) => ({
      questionId: a.questionId,
      selectedOption: a.selectedOption,
      reasoning: a.reasoning,
      confidence: a.confidence,
      durationSeconds: a.durationSeconds,
    })),
    currentIndex: attempt.currentIndex,
    applicability: attempt.applicability,
    example: attempt.example,
    notice: attempt.notice,
    assemblyNotes: attempt.assemblyNotes,
    ...(attempt.status === "submitted" && attempt.diagnosis
      ? { diagnosis: publicDiagnosis(attempt) }
      : {}),
    closedReason: attempt.closedReason,
  });
}

export function publicDiagnosis(attempt: AssessmentAttempt): Diagnosis {
  if (attempt.status !== "submitted" || !attempt.diagnosis)
    fail(409, "SUBMISSION_REQUIRED", "主动提交后才可查看答案与解析。");
  return {
    ...snapshot(attempt.diagnosis),
    items: attempt.diagnosis.items.map((item) => {
      const question = attempt.questions.find(
        (question) => question.id === item.questionId,
      );
      const presentation = question
        ? questionSolution(question, item.presentation)
        : item.presentation;
      return {
        ...snapshot(item),
        ...(presentation ? { presentation: snapshot(presentation) } : {}),
      };
    }),
    usableForRecommendation:
      attempt.diagnosis.usableForRecommendation &&
      attempt.applicability.applicability === "applicable",
  };
}
