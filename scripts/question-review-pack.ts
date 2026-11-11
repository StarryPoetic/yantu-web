import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  QUESTION_REVIEW_CHECKS,
  validateQuestionBank,
} from "../server/assessment/index.ts";
import type { QuestionBank } from "../server/assessment/types.ts";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sourcePath = "knowledge/questions/example-v1.json";
export const packPath =
  "knowledge/questions/review-candidates/question-review-pack.json";
export const coveragePath = "knowledge/questions/review-candidates/coverage.md";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const sorted = (values: string[]) => [...new Set(values)].sort();
const modules = ["math", "english", "politics", "major"] as const;
const difficultyCounts = (questions: QuestionBank["questions"]) =>
  Object.fromEntries(
    ["basic", "intermediate", "advanced"].map((level) => [
      level,
      questions.filter((question) => question.difficulty === level).length,
    ]),
  );
const blankChecks = (checks: readonly string[]) =>
  Object.fromEntries(
    checks.map((name) => [name, { passed: null, notes: null }]),
  );

/** Describes the stored example bank; does not answer, review or calibrate questions. */
export function buildQuestionReviewPack(bank: QuestionBank) {
  const errors = validateQuestionBank(bank);
  if (errors.length) throw new Error(errors.join("; "));
  if (
    bank.mode !== "example" ||
    bank.questions.some(
      (question) =>
        question.reviewStatus !== "draft" ||
        question.publicationStatus !== "unpublished" ||
        question.calibration !== "manual_initial" ||
        question.review !== undefined,
    )
  )
    throw new Error(
      "Only unreviewed, uncalibrated example drafts may seed this template",
    );
  const scopeNames = sorted(
    bank.questions.flatMap((question) => question.scopes),
  );
  return {
    schemaVersion: 1,
    kind: "question-review-template-not-publishable",
    source: {
      file: sourcePath,
      questionBankVersion: bank.questionBankVersion,
      hashScope:
        "JSON.stringify(parsed source), UTF-8; not original file bytes",
      sha256: hash(bank),
    },
    notice: `${bank.questions.length}题现存示例库的审校准备材料。未经真实学科审校或样本校准；每科五题仅观察本次知识点，不预测考研成绩、能力排名或录取概率。人工结果须另存，模板不自动发布。`,
    status: {
      humanReviewed: 0,
      calibrated: false,
      publication: "unpublished",
      importableAsQuestionBank: false,
    },
    coverage: {
      basis:
        "repository-declared points/scopes only; not official syllabus coverage",
      questionCount: bank.questions.length,
      byModule: modules.map((module) => {
        const questions = bank.questions.filter(
          (question) => question.module === module,
        );
        const represented = sorted(questions.map((question) => question.point));
        const declared = bank.knowledgePoints[module] ?? [];
        return {
          module,
          count: questions.length,
          difficulties: difficultyCounts(questions),
          representedPoints: represented,
          declaredPoints: declared,
          declaredWithoutQuestions: declared.filter(
            (point) => !represented.includes(point),
          ),
          questionPointsNotDeclared: represented.filter(
            (point) => !declared.includes(point),
          ),
        };
      }),
      byScope: scopeNames.map((scope) => {
        const questions = bank.questions.filter((question) =>
          question.scopes.includes(scope),
        );
        return {
          scope,
          count: questions.length,
          difficulties: difficultyCounts(questions),
          questionIds: questions.map((question) => question.id),
          emptyDifficultyBands: Object.entries(difficultyCounts(questions))
            .filter(([, count]) => count === 0)
            .map(([level]) => level),
          caution: "范围标签可能重叠；跨范围数量不能相加，也不证明整套考试覆盖",
        };
      }),
      legacyMajorIds: sorted(
        bank.questions.flatMap((question) => question.majorIds),
      ),
      majorMappingConfirmed: false,
      missingStudyHintQuestionIds: bank.questions
        .filter((question) => !question.studyHint)
        .map((question) => question.id),
      missingDistractorHypothesesQuestionIds: bank.questions
        .filter((question) => !Object.keys(question.errorHypotheses).length)
        .map((question) => question.id),
    },
    calibrationDecisions: {
      owner: null,
      targetPopulation: null,
      samplingAndConsentProtocol: null,
      sampleSizePlan: null,
      observedSampleSize: null,
      itemDifficultyMethod: null,
      itemDiscriminationMethod: null,
      reliabilityMethodAndResult: null,
      validityEvidence: null,
      scoreMappingMethodAndValidation: null,
      biasAndAccessibilityReview: null,
      acceptanceCriteria: null,
      approvedBy: null,
      approvedAt: null,
    },
    entries: bank.questions.map((question, index) => ({
      questionId: question.id,
      revisionId: question.revisionId,
      sourcePointer: `${sourcePath}#/questions/${index}`,
      questionSha256: hash(question),
      snapshot: structuredClone(question),
      review: {
        reviewerId: null,
        reviewedAt: null,
        decision: null,
        rationale: null,
        correctedAnswerOrRevision: null,
        requiredChecks: blankChecks(QUESTION_REVIEW_CHECKS),
        additionalChecks: blankChecks([
          "hint_does_not_reveal_answer",
          "math_and_diagram_match_explanation",
          "accessible_text_equivalent",
          "distractor_hypotheses_supported",
          "difficulty_and_exam_scope_reviewed",
        ]),
      },
    })),
  };
}

type ReviewPack = ReturnType<typeof buildQuestionReviewPack>;
export function assertCurrentReviewTemplate(pack: unknown, bank: QuestionBank) {
  if (JSON.stringify(pack) !== JSON.stringify(buildQuestionReviewPack(bank)))
    throw new Error(
      "Review template is stale, incomplete or contains human decisions; preserve results separately",
    );
}

/** Do not let --write silently discard manually completed review results. */
export function assertBlankReviewResults(pack: unknown) {
  const allNull = (value: unknown): boolean =>
    value === null ||
    (typeof value === "object" &&
      value !== null &&
      Object.values(value).every(allNull));
  const candidate = pack as Partial<ReviewPack> | null;
  if (
    !candidate ||
    !Array.isArray(candidate.entries) ||
    candidate.calibrationDecisions === undefined ||
    !allNull(candidate.calibrationDecisions) ||
    candidate.entries.some((entry) => !entry.review || !allNull(entry.review))
  )
    throw new Error("Refusing to overwrite human review/calibration results");
}

export function renderReviewCoverage(pack: ReviewPack) {
  const rows = pack.coverage.byModule.map(
    (row) =>
      `| ${row.module} | ${row.count} | ${row.difficulties.basic}/${row.difficulties.intermediate}/${row.difficulties.advanced} | ${row.representedPoints.length} | ${row.declaredWithoutQuestions.join("；") || "无"} |`,
  );
  const scopeRows = pack.coverage.byScope.map(
    (row) =>
      `| ${row.scope} | ${row.count} | ${row.difficulties.basic}/${row.difficulties.intermediate}/${row.difficulties.advanced} |`,
  );
  const questionRows = pack.entries.map(
    (entry) =>
      `| ${entry.questionId} | ${entry.snapshot.module} | ${entry.snapshot.point} | ${entry.snapshot.difficulty} | ${entry.snapshot.scopes.join("、")} | 待独立审校 |`,
  );
  return `# 现存示例题库审校覆盖清单

本文件由 \`node scripts/question-review-pack.ts --write\` 离线生成。当前版本 \`${pack.source.questionBankVersion}\`，共${pack.coverage.questionCount}题；学科人工审核0、校准0。只描述仓库题目和标签，不是官方考试大纲覆盖率。

每科五题不足以换算考研成绩、确定能力等级或录取概率。难度仍为人工初分；英语翻译/写作题为选择题片段，未实际测量完整翻译或写作产出；专业题为计算机/研究方法示例，不能代表机械等所有专业考试。

## 模块与范围

| 模块 | 题数 | 基础/中等/提高 | 已有知识点数 | 声明中无题的知识点 |
| --- | ---: | --- | ---: | --- |
${rows.join("\n")}

上表“其他未覆盖知识点（待评估）”是旧库保留的缺项说明，不是已覆盖的具体知识点。正式大纲逐点映射及未列出的内容仍等学科人员确认。

| 范围标签 | 题数 | 基础/中等/提高 |
| --- | ---: | --- |
${scopeRows.join("\n")}

标签会重叠，不能把范围数量相加。专业标识 \`${pack.coverage.legacyMajorIds.join(" / ")}\` 为历史示例值，尚未映射为已确认的国家学科/真实目标专业。

## 明确缺项

- ${pack.coverage.missingStudyHintQuestionIds.length}题没有独立提示正文（运行时可使用通用提示），需逐题审查是否应补提示；现有提示也要检查是否泄露答案。
- ${pack.coverage.missingDistractorHypothesesQuestionIds.length}题未记录干扰项错误假设；不能因此自动解释学生真实错因，仍需学科复核。
- 范围标签下的难度空档：${pack.coverage.byScope
    .filter((row) => row.emptyDifficultyBands.length)
    .map((row) => `${row.scope}缺${row.emptyDifficultyBands.join("/")}`)
    .join(
      "；",
    )}。这表示当前标签题池空档，是否补题及适用范围需学科确认，不能自动改标签凑数。
- 全部题目缺真实独立学科审核、来源/使用权确认和试测校准；结构检查不能替代这些工作。
- 校准的人群、采样/同意程序、样本量、难度/区分度方法、信度效度、分数映射与验收阈值均为null，尚无人批准。不按题数自动设置校准通过线。
- 审校包包含正确答案，只存服务端知识目录，不复制到public或前端资源。

逐题完整题干、选项、答案、解析、公式/图示、提示、来源和人工空白检查表见 \`question-review-pack.json\`。原题快照和每题哈希用于发现题目更新；不得在模板中填完结果后运行生成器覆盖。

## 逐题审校索引

| 题号 | 模块 | 知识点 | 初分难度 | 范围标签 | 状态 |
| --- | --- | --- | --- | --- | --- |
${questionRows.join("\n")}
`;
}

export function reviewPackOutputs(bank: QuestionBank) {
  const pack = buildQuestionReviewPack(bank);
  return new Map([
    [packPath, JSON.stringify(pack, null, 2) + "\n"],
    [coveragePath, renderReviewCoverage(pack)],
  ]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  if (!["--write", "--check"].includes(mode) || process.argv.length !== 3)
    throw new Error(
      "Usage: node scripts/question-review-pack.ts --write|--check",
    );
  const bank = JSON.parse(
    readFileSync(resolve(root, sourcePath), "utf8"),
  ) as QuestionBank;
  if (mode === "--write" && existsSync(resolve(root, packPath)))
    assertBlankReviewResults(
      JSON.parse(readFileSync(resolve(root, packPath), "utf8")),
    );
  for (const [path, content] of reviewPackOutputs(bank)) {
    if (mode === "--write") writeFileSync(resolve(root, path), content);
    else if (
      readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n") !==
      content
    )
      throw new Error(`Generated review pack is stale: ${path}`);
  }
  console.log(
    JSON.stringify({
      mode,
      questions: bank.questions.length,
      humanReviewed: 0,
      calibrated: false,
      paidCalls: 0,
    }),
  );
}
