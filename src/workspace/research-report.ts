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
      /^(INVALID_|UNGROUNDED_|UNSUPPORTED_|MODEL_|PROVIDER_|BUDGET_|CONCURRENCY_|RATE_LIMITED$|TIMEOUT$|EVIDENCE_TOO_LARGE$|INSUFFICIENT_PROFILE_FIT$|RESEARCH_DIRECTION_NOT_ALLOWED$|SEARCH_(DISABLED|NOT_CONFIGURED|UNAVAILABLE|PROVIDER_ERROR|PROVIDER_INVALID|INVALID_RESPONSE|BUDGET_EXHAUSTED)$)/.test(
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
  const content = [
    "# 研途 · 学校与专业推荐报告",
    report.generatedAt,
    ...(outdated ? ["历史报告：个人情况或依据已更新，仅供回顾。"] : []),
    "",
    "## 建议比较的学校与专业",
    ...report.recommendations.flatMap((item) => [
      "### " + item.institutionName + " · " + programName(item, run),
      "专业类别：" + item.disciplineCode,
      ...(item.degreeType
        ? [item.degreeType === "academic" ? "学术学位" : "专业学位"]
        : []),
      admissionLabel(item, run),
      item.rationale,
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
      ...item.uncertainties.map((text) => "- 待核实：" + text),
      ...item.citations.flatMap((id) => {
        const source = report.sources.find((entry) => entry.id === id);
        return source
          ? ["参考：[" + source.id + "] " + source.title + " " + source.url]
          : [];
      }),
      "",
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
