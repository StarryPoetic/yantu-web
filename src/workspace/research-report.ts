import type { ResearchReport } from "../../server/explanation/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import type { ResearchJob } from "../../server/routes/research";

/** Older jobs can save a technical failure as partial/done; do not mistake it for missing profile data. */
export function researchOutcome(job: ResearchJob | null) {
  if (!job) return "ready";
  if (job.status === "queued" || job.status === "running") return "running";
  const report = job.report;
  if (report?.recommendations.length) return "recommendations";
  if (
    job.status === "failed" ||
    job.status === "cancelled" ||
    report?.failureStage
  )
    return "failure";
  const reasons = report?.reason?.split(",") ?? [];
  if (
    reasons.some((reason) =>
      /^(INVALID_|UNGROUNDED_|UNSUPPORTED_|MODEL_|PROVIDER_|BUDGET_|CONCURRENCY_|RATE_LIMITED$|TIMEOUT$|RESPONSE_TOO_LARGE$|INCOMPLETE_RESPONSE$|UNKNOWN_USAGE$|EVIDENCE_TOO_LARGE$|INSUFFICIENT_PROFILE_FIT$|RESEARCH_DIRECTION_NOT_ALLOWED$|SEARCH_(DISABLED|NOT_CONFIGURED|UNAVAILABLE|PROVIDER_ERROR|PROVIDER_INVALID|INVALID_RESPONSE|BUDGET_EXHAUSTED)$)/.test(
        reason,
      ),
    )
  )
    return "failure";
  if (
    reasons.includes("RESEARCH_PROFILE_REQUIRED") ||
    report?.followUpQuestions?.some((question) => question.trim())
  )
    return "profile";
  const evidenceReasons = [
    "NO_WEB_EVIDENCE",
    "SEARCH_SNIPPETS_ONLY",
    "INSUFFICIENT_RESEARCH_EVIDENCE",
    "RESEARCH_EVIDENCE_EXCLUDED",
    "RESEARCH_PARTIAL_VALIDATION",
    "KNOWN_ADMISSION_CONFLICT",
    "ADMISSION_EVIDENCE_NOT_APPLICABLE",
  ];
  if (
    job.status === "blocked" &&
    !reasons.some((reason) => evidenceReasons.includes(reason))
  )
    return "failure";
  return "empty";
}

export type SchoolRecommendation = ResearchReport["recommendations"][number];
export const tierLabels = {
  preferred: "第一级·优先推荐",
  alternative: "第二级·适合备选",
  exploratory: "第三级·探索选择",
};
export const suitabilityNotice =
  "综合目标、兴趣、基础、跨考成本、时间、城市和预算分层。费用未知或较高不自动降级；优先推荐不代表录取率或录取保证。";

export function recommendationGroups(items: SchoolRecommendation[]) {
  return [
    {
      tier: "preferred",
      title: tierLabels.preferred,
      description: "综合目标、兴趣、基础与现实条件更契合，值得优先深入比较。",
      items: items.filter((item) => item.tier === "preferred"),
    },
    {
      tier: "alternative",
      title: tierLabels.alternative,
      description: "有明确匹配点，综合准备成本与个人取舍后，可作为合适的备选。",
      items: items.filter((item) => item.tier === "alternative"),
    },
    {
      tier: "exploratory",
      title: tierLabels.exploratory,
      description:
        "有值得探索的可能，学习基础、跨考准备或具体目标仍需进一步了解。",
      items: items.filter((item) => item.tier === "exploratory"),
    },
    {
      tier: "unclassified",
      title: "待补充分级的建议",
      description: "旧报告未记录综合适合度分级，可以重新生成后比较。",
      items: items.filter((item) => !item.tier),
    },
  ].filter((group) => group.items.length);
}

export function researchCoverage(report: ResearchReport) {
  const schoolCount = new Set(
    report.recommendations.map((item) => item.institutionName.trim()),
  ).size;
  const targetMin = report.coverage?.targetMin ?? 5;
  const targetMax = report.coverage?.targetMax ?? 10;
  const reasons = report.coverage?.shortfallReasons ?? [];
  return {
    schoolCount,
    targetMin,
    targetMax,
    shortfall: schoolCount < targetMin,
    reasons: reasons.length
      ? reasons
      : schoolCount < targetMin
        ? [
            "其他学校尚未查到足以支持具体专业建议的资料，现有结果不代表没有其他合适学校。",
          ]
        : [],
  };
}

export function tuitionDescription(
  item: SchoolRecommendation,
  run: GuidanceRun,
) {
  const tuition = item.tuition;
  if (!tuition)
    return "尚未查到可核对的学费金额，暂不能判断是否符合你的年度预算。";
  const periods = {
    academic_year: "学年",
    program: "全程",
    semester: "学期",
    credit: "学分",
  };
  const mode = {
    full_time: "全日制",
    part_time: "非全日制",
    unspecified: "学习方式未明确",
  };
  const targetYear = Number(run.inputSnapshot.profile.year);
  const reference = tuition.year === targetYear ? "学费" : "参考学费";
  return `${tuition.year} 年${reference}：${tuition.amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元/${periods[tuition.period]}（${mode[tuition.studyMode]}）`;
}

export function tuitionCaution(item: SchoolRecommendation, run: GuidanceRun) {
  if (!item.tuition) return "";
  const year = Number(run.inputSnapshot.profile.year);
  return [
    ...(item.tuition.year !== year
      ? ["该费用为其他年度参考，目标年度收费尚需核对。"]
      : []),
    ...(item.tuition.period !== "academic_year"
      ? ["此金额不是按学年计费，不能直接与年度预算比较。"]
      : []),
    "金额仅为学费，生活等支出需另计。",
  ].join("");
}
const profileLabels: Record<string, string> = {
  university: "本科院校",
  major: "本科专业",
  targetMajor: "专业兴趣",
  year: "报考年份",
  graduation: "毕业年份",
  english: "英语经历",
  math: "数学基础",
  hours: "每天可投入时间",
  budget: "年度预算",
  cities: "意向城市",
  crossMajor: "跨专业意愿",
  studyGoal: "职业与学习目标",
  degreePreference: "学位偏好",
  preparation: "备考进度",
  courses: "相关课程基础",
  notes: "补充说明",
  priorities: "选择侧重",
};
export function profileLabel(field: string) {
  const priority = field.startsWith("priorities.")
    ? field.slice(11).trim()
    : "";
  return priority
    ? "选择侧重 · " + priority
    : (profileLabels[field] ?? "个人情况");
}

export function programName(item: SchoolRecommendation, run: GuidanceRun) {
  return (
    item.programName ||
    run.directions.find(
      (direction) => direction.discipline.code === item.disciplineCode,
    )?.discipline.name ||
    item.disciplineCode
  );
}

export function admissionLabel(item: SchoolRecommendation, run: GuidanceRun) {
  const year = String(run.inputSnapshot.profile.year ?? "");
  const targetYear = /^20\d{2}$/.test(year) ? year + "年" : "目标年度";
  return item.admissionStatus === "current_evidence"
    ? "已找到" + targetYear + "相关招生依据"
    : targetYear + "报考条件待核验";
}

export function downloadResearchReport(
  report: ResearchReport,
  run: GuidanceRun,
  outdated: boolean,
) {
  const coverage = researchCoverage(report);
  const content = [
    "# 研途 · 学校与专业推荐报告",
    report.generatedAt,
    suitabilityNotice,
    ...(outdated ? ["历史报告：个人情况或依据已更新，仅供回顾。"] : []),
    `本次建议 ${coverage.schoolCount} 所不同学校，目标比较 ${coverage.targetMin}–${coverage.targetMax} 所。`,
    ...coverage.reasons.map((text) => "- 覆盖说明：" + text),
    "",
    "## 建议比较的学校与专业",
    ...recommendationGroups(report.recommendations).flatMap((group) => [
      "## " + group.title,
      ...group.items.flatMap((item) => [
        "### " + item.institutionName + " · " + programName(item, run),
        "专业类别：" + item.disciplineCode,
        ...(item.degreeType
          ? [item.degreeType === "academic" ? "学术学位" : "专业学位"]
          : []),
        admissionLabel(item, run),
        item.rationale,
        ...(item.tierReasons?.map((text) => "- 分级原因：" + text) ?? []),
        ...(item.fitReasons ?? []).map(
          (fit) =>
            "- " +
            profileLabel(fit.profileField) +
            "：" +
            fit.profileValue +
            "；" +
            fit.reason,
        ),
        ...item.preparation.map((text) => "- 准备：" + text),
        ...(item.tradeoffs ?? []).map((text) => "- 需要权衡：" + text),
        tuitionDescription(item, run),
        tuitionCaution(item, run),
        ...(item.constraintChecks ?? []).map(
          (check) =>
            `- ${check.field === "budget" ? "预算" : "意向城市"}：${check.reason}`,
        ),
        ...(item.tuition
          ? [
              "学费原文：" +
                item.tuition.quote +
                " [" +
                item.tuition.sourceId +
                "]",
            ]
          : []),
        ...(item.location
          ? [
              "城市依据：" +
                item.location.city +
                "；" +
                item.location.quote +
                " [" +
                item.location.sourceId +
                "]",
            ]
          : []),
        ...item.uncertainties.map((text) => "- 待核实：" + text),
        ...item.citations.flatMap((id) => {
          const source = report.sources.find((entry) => entry.id === id);
          return source
            ? ["参考：[" + source.id + "] " + source.title + " " + source.url]
            : [];
        }),
        "",
      ]),
    ]),
    "## 综合分析",
    report.summary,
    "",
    "## 后续可以补充",
    ...(report.followUpQuestions ?? []).map((text) => "- " + text),
    "",
    "## 检索到的资料",
    ...report.facts.map(
      (fact) => "- " + fact.text + " [" + fact.citations.join(", ") + "]",
    ),
    "",
    "## 适用范围",
    ...report.limitations.map((text) => "- " + text),
    "",
    "## 来源",
    ...report.sources.map(
      (source) =>
        "- [" +
        source.id +
        "] " +
        source.title +
        "\n  " +
        source.url +
        "\n  获取时间：" +
        source.retrievedAt,
    ),
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "研途-联网研究报告.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
