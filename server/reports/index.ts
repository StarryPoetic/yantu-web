import type { CatalogSnapshot } from "../catalog/types.ts";
import type { PlanSnapshot } from "../planning/index.ts";
import type { RecommendationRun } from "../recommendation/index.ts";

export class ReportError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ReportError";
  }
}

export interface ReportSnapshot {
  schemaVersion: 1;
  reportId: string;
  subjectId: string;
  generatedAt: string;
  recommendation: RecommendationRun;
  plan: PlanSnapshot | null;
  catalog: CatalogSnapshot;
  markdown: string;
}

/** Escape user/source prose so a downloaded report cannot inject HTML or remote images. */
const prose = (value: unknown): string =>
  String(value ?? "待核验")
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
    .replace(/[\\`*_{}\[\]()#!|]/g, "\\$&")
    .replace(/\r?\n/g, " ");
const number = (value: number | null): string =>
  value === null ? "待制定／待评估" : String(value);

export function renderReportMarkdown(
  snapshot: Omit<ReportSnapshot, "markdown">,
): string {
  const run = snapshot.recommendation;
  const lines = [
    "# 择校与备考报告",
    "",
    `生成时间：${prose(snapshot.generatedAt)}`,
    "",
    `报告编号：${prose(snapshot.reportId)}`,
    `目标招生年度：${run.inputSnapshot.targetAdmissionYear}`,
    "",
    `目录版本：${prose(run.versions.catalogVersion)}；规则版本：${prose(run.versions.ruleVersion)}`,
    `画像版本：${run.versions.profileVersion}；选择版本：${run.versions.selectionVersion}`,
    "",
    "> 本报告固定生成时的资料与个人输入。五题测评不换算考研分数、录取概率或能力上限。",
    "",
    "## 推荐结果",
    "",
  ];
  if (!run.ranked.length)
    lines.push("暂无有效的正式推荐结果。资料不足的项目仅供核验与比较。", "");
  for (const candidate of run.ranked)
    lines.push(
      `- ${prose(candidate.program.display.institutionName)} · ${prose(candidate.program.display.collegeName)} · ${prose(candidate.program.display.majorName)} · ${candidate.program.identity.targetAdmissionYear}`,
      `  - ${candidate.explanations.map(prose).join("；")}`,
    );
  lines.push("", "## 待核验候选", "");
  if (!run.pendingVerification.length) lines.push("本次没有待核验候选。");
  for (const candidate of run.pendingVerification)
    lines.push(
      `- ${prose(candidate.program.display.institutionName)} · ${prose(candidate.program.display.majorName)}：${candidate.eligibility.reasons.map(prose).join("；")}`,
    );
  if (run.eligibleUnranked.length)
    lines.push(
      "",
      "已符合已核验资格但无法排序：",
      ...run.eligibleUnranked.map(
        (candidate) =>
          `- ${prose(candidate.program.display.institutionName)}：${candidate.explanations.map(prose).join("；")}`,
      ),
    );
  lines.push(
    "",
    "## 未入选原因",
    "",
    ...run.excluded.map(
      (item) =>
        `- ${prose(item.programId)}：${item.reasons.map(prose).join("；")}`,
    ),
  );
  if (!run.excluded.length) lines.push("无额外排除记录。");
  if (snapshot.plan) {
    const plan = snapshot.plan;
    lines.push(
      "",
      "## 分数与备考规划",
      "",
      `计划：${prose(plan.planId)} / v${plan.planVersion}；状态：${prose(plan.status)}`,
      "",
      `目标项目：${prose(plan.programSnapshot.display.institutionName)} · ${prose(plan.programSnapshot.display.majorName)}`,
      "",
      "| 科目 | 实际满分 | 用户目标 | 当前表现 | 差距 |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const subject of plan.subjects)
      lines.push(
        `| ${prose(subject.name)} | ${number(subject.maxScore)} | ${number(subject.targetScore)} | ${number(subject.currentScore)} | ${subject.gapStatus === "reached" ? "已达到" : number(subject.gap)} |`,
      );
    lines.push(
      "",
      `目标合计：${number(plan.totalTargetScore)}；总分满分：${number(plan.totalMaxScore)}`,
      "",
      "待处理事项：",
      ...[...plan.errors, ...plan.pendingItems].map(
        (item) => `- ${prose(item)}`,
      ),
      "",
      "阶段任务：",
      ...plan.tasks.map((task) => `- ${prose(task.title)}`),
    );
    lines.push("", "历史成绩：");
    if (!plan.historicalReferences.length)
      lines.push("- 缺少已核验历史成绩，不使用演示分数补齐。");
    for (const record of plan.historicalReferences)
      lines.push(
        `- ${record.year} / ${prose(record.population)} / ${prose(record.metric)}：${record.value} / ${record.totalMaxScore}；资料状态 ${prose(record.availability)}；可比性 ${prose(record.comparability)}，${prose(record.comparabilityReason)}；来源 ${record.sourceIds.map(prose).join("、")}`,
      );
  } else
    lines.push(
      "",
      "## 分数与备考规划",
      "",
      "尚未创建计划；未生成假定目标或当前分数。",
    );
  lines.push(
    "",
    "## 来源与覆盖限制",
    "",
    prose(snapshot.catalog.coverage.description),
    ...snapshot.catalog.coverage.limitations.map((item) => `- ${prose(item)}`),
  );
  for (const source of snapshot.catalog.sources) {
    const link =
      source.url && /^https?:\/\//.test(source.url)
        ? `[${prose(source.title)}](${source.url.replace(/[()\s<>]/g, (c) => encodeURIComponent(c))})`
        : `${prose(source.title)}（${prose(source.fileReference)}）`;
    lines.push(
      `- ${link}；发布机构：${prose(source.publisher)}；核验时间：${prose(source.verifiedAt ?? "尚未核验")}`,
    );
  }
  lines.push(
    "",
    "## 限制与风险",
    "",
    ...run.warnings.map((item) => `- ${prose(item)}`),
  );
  if (snapshot.catalog.withdrawnRevisionIds.length)
    lines.push(
      "- 本目录包含已撤回修订；历史结果保留以供追溯，重新决策前请更新资料。",
    );
  lines.push(
    "",
    "资料更新不会改写本报告。请显式重新推荐和生成新报告以纳入更新。",
    "",
  );
  return lines.join("\n");
}

export function buildReport(input: {
  reportId: string;
  subjectId: string;
  generatedAt: string;
  recommendation: RecommendationRun;
  plan?: PlanSnapshot | null;
  catalog: CatalogSnapshot;
}): ReportSnapshot {
  if (
    input.recommendation.subjectId !== input.subjectId ||
    (input.plan && input.plan.subjectId !== input.subjectId)
  )
    throw new ReportError("REPORT_OWNERSHIP_MISMATCH");
  if (
    input.recommendation.versions.catalogVersion !==
      input.catalog.catalogVersion ||
    (input.plan && input.plan.catalogVersion !== input.catalog.catalogVersion)
  )
    throw new ReportError("REPORT_CATALOG_MISMATCH");
  if (
    input.plan &&
    input.plan.recommendationRunId !== input.recommendation.recommendationRunId
  )
    throw new ReportError("REPORT_RECOMMENDATION_MISMATCH");
  if (
    input.plan &&
    (input.plan.status === "needs_review" ||
      input.plan.ruleVersion !== input.recommendation.versions.ruleVersion ||
      ![
        ...input.recommendation.ranked,
        ...input.recommendation.pendingVerification,
        ...input.recommendation.eligibleUnranked,
      ].some(
        (candidate) =>
          candidate.programRevisionId === input.plan!.programRevisionId,
      ))
  )
    throw new ReportError("REPORT_PLAN_MISMATCH");
  if (!Number.isFinite(Date.parse(input.generatedAt)))
    throw new ReportError("INVALID_GENERATED_AT");
  const snapshot = structuredClone({
    schemaVersion: 1 as const,
    reportId: input.reportId,
    subjectId: input.subjectId,
    generatedAt: input.generatedAt,
    recommendation: input.recommendation,
    plan: input.plan ?? null,
    catalog: input.catalog,
  });
  return { ...snapshot, markdown: renderReportMarkdown(snapshot) };
}
