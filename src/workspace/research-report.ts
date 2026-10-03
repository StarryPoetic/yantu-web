import type { ResearchReport } from "../../server/explanation/research.ts";
import type { GuidanceRun } from "../../server/disciplines/types.ts";
import type { ResearchJob } from "../../server/routes/research.ts";
import { researchReason } from "../../shared/research-status.ts";
import type { ResearchDecisionBasis } from "../../shared/research-decision.ts";

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
    "PREFERRED_CITY_COVERAGE_INCOMPLETE",
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
  "按已保存需求与读取到的学校证据逐项核对，未知条件保留待确认；分级不换算录取率，也不保证录取。";
export const legacyResearchNotice =
  "这是旧版报告，尚未应用需求匹配与考试科目核验的新规则。重新生成后，可按完整画像重新调查学校与具体专业，查看匹配依据、测评准备和学位路线。";
export const assessmentLabels = {
  unassessed: "尚未测评",
  example_practice: "示例练习观察",
  practice_observation: "练习观察",
  local_diagnosis: "局部正式诊断",
};
export function assessmentScopeLabel(scope: string) {
  return (
    (
      {
        "math-one": "数学一",
        "math-two": "数学二",
        "math-three": "数学三",
        "english-one": "英语一",
        "english-two": "英语二",
        "common-foundation": "公共基础",
      } as Record<string, string>
    )[scope] ?? scope
  );
}
export const degreePriorityLabels = {
  compare: "保留比较",
  goal_lead: "与目标更相关，优先比较",
  explicit_preference: "本人明确偏好",
};
export const candidateStatusLabels = {
  recommended: "已列入建议",
  excluded: "已排除（有明确依据）",
  awaiting_evidence: "资料待补充",
  not_selected: "本次未选入",
};
export const factorStatusLabels = {
  match: "已有匹配依据",
  mismatch: "与需求有差异",
  unknown: "尚未核实",
  not_requested: "未限定此项",
};

export function isLegacyResearchReport(report: ResearchReport) {
  return (
    report.reportVersion !== "profile-research-v7" ||
    report.recommendations.some(
      (item) => item.match?.ruleVersion !== "demand-match-v1",
    )
  );
}

export function examDescription(exams?: SchoolRecommendation["exams"]) {
  if (!exams || exams.status === "unknown") return "考试科目尚未核验";
  if (exams.status === "ambiguous") return "考试科目存在歧义，需核对具体项目";
  if (exams.status === "historical")
    return `${exams.year ? exams.year + " 年" : "历史年度"}考试科目参考，目标年度待核验`;
  return `${exams.year ? exams.year + " 年" : "目标年度"}考试科目已有官网依据`;
}

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
  const countShortfall = schoolCount < targetMin;
  const cityShortfall =
    report.reason?.split(",").includes("PREFERRED_CITY_COVERAGE_INCOMPLETE") ||
    (!!report.coverage?.preferredCities?.length &&
      report.coverage.preferredCitySchoolCount === 0);
  return {
    schoolCount,
    targetMin,
    targetMax,
    shortfall: countShortfall || !!cityShortfall,
    noticeTitle: countShortfall
      ? `尚未达到 ${targetMin} 所，先保留已有建议`
      : "意向城市覆盖仍不足，先保留已有建议",
    reasons: reasons.length
      ? reasons
      : cityShortfall
        ? [researchReason("PREFERRED_CITY_COVERAGE_INCOMPLETE")]
        : countShortfall
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

function examMarkdown(exams?: SchoolRecommendation["exams"], heading = "####") {
  return [
    heading + " 实际考试科目",
    examDescription(exams),
    ...(exams?.subjects.map((subject) => `- ${subject.code} ${subject.name}`) ??
      []),
    exams?.reason ??
      "尚未取得可核验的招生目录考试科目，准备建议不能替代报考要求。",
    ...(exams?.quote
      ? [
          `考试科目原文：${exams.quote}${exams.sourceId ? ` [${exams.sourceId}]` : ""}`,
        ]
      : []),
  ];
}

function matchMarkdown(
  match?: SchoolRecommendation["match"],
  heading = "####",
) {
  if (!match) return [];
  return [
    heading + " 需求匹配依据",
    match.summary,
    ...match.factors.map(
      (factor) =>
        `- ${factor.label}：${factorStatusLabels[factor.status]}；${factor.reason}${factor.sourceIds.length ? ` [${factor.sourceIds.join(", ")}]` : ""}`,
    ),
  ];
}

export function decisionBasisMarkdown(basis?: ResearchDecisionBasis) {
  if (!basis) return [];
  return [
    "## 测评与学位路线依据",
    basis.summary,
    ...basis.assessments.flatMap((assessment) => [
      `### ${assessment.module === "math" ? "数学" : "英语"}准备观察`,
      assessmentLabels[assessment.status],
      ...(assessment.scope
        ? ["练习范围：" + assessmentScopeLabel(assessment.scope)]
        : []),
      ...(assessment.status !== "unassessed"
        ? [
            `答题记录：答对 ${assessment.counts.correct} 题，答错 ${assessment.counts.incorrect} 题，未答 ${assessment.counts.unanswered} 题，共 ${assessment.counts.total} 题。`,
          ]
        : []),
      ...(assessment.points.length
        ? ["已观察知识点：" + assessment.points.join("、")]
        : []),
      ...(assessment.weakPoints.length
        ? ["需要复习的知识点：" + assessment.weakPoints.join("、")]
        : []),
      ...assessment.observations.map((text) => "- 观察：" + text),
      ...assessment.nextSteps.map((text) => "- 下一步复习：" + text),
      ...assessment.limitations.map((text) => "- 测评适用范围：" + text),
      ...assessment.references.map(
        (reference) =>
          `- 测评记录：${reference.assessmentAttemptId}；诊断版本 ${reference.diagnosisVersion}${reference.questionBankVersion ? `；题库版本 ${reference.questionBankVersion}` : ""}${reference.submittedAt ? `；提交时间 ${reference.submittedAt}` : ""}${reference.example ? "；示例练习" : ""}`,
      ),
    ]),
    ...basis.degreeRoutes.flatMap((route) => [
      `### ${route.degreeType === "academic" ? "学术学位" : "专业学位"}路线`,
      degreePriorityLabels[route.priority],
      ...route.reasons.map((text) => "- 路线依据：" + text),
      ...route.verificationNeeded.map((text) => "- 仍需核对：" + text),
    ]),
    "### 考试类型怎么比较",
    basis.examPolicy.summary,
    ...basis.examPolicy.comparisons.flatMap((comparison) => [
      `${comparison.module === "math" ? "数学" : "英语"}科目：${comparison.options.join("、")}`,
      comparison.assessmentUse,
      ...comparison.nextSteps.map((text) => "- 科目比较：" + text),
    ]),
    ...basis.ignoredAssessments.map(
      (item) =>
        `- 未用于本次判断的测评：${item.assessmentAttemptId}；诊断版本 ${item.diagnosisVersion}；${item.reason}`,
    ),
    ...basis.limitations.map((text) => "- 判断适用范围：" + text),
    "",
  ];
}

export function researchReportMarkdown(
  report: ResearchReport,
  run: GuidanceRun,
  outdated: boolean,
) {
  const coverage = researchCoverage(report);
  return [
    "# 研途 · 学校与专业推荐报告",
    report.generatedAt,
    suitabilityNotice,
    ...(isLegacyResearchReport(report) ? [legacyResearchNotice] : []),
    ...(outdated ? ["历史报告：个人情况或依据已更新，仅供回顾。"] : []),
    `本次建议 ${coverage.schoolCount} 所不同学校，目标比较 ${coverage.targetMin}–${coverage.targetMax} 所。`,
    ...coverage.reasons.map((text) => "- 覆盖说明：" + text),
    "",
    ...decisionBasisMarkdown(report.decisionBasis),
    "## 建议比较的学校与专业",
    ...recommendationGroups(report.recommendations).flatMap((group) => [
      "## " + group.title,
      ...group.items.flatMap((item) => [
        "### " + item.institutionName + " · " + programName(item, run),
        "专业类别：" + item.disciplineCode,
        ...(item.collegeName ? ["招生院系：" + item.collegeName] : []),
        ...(item.majorCode ? ["专业代码：" + item.majorCode] : []),
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
        ...matchMarkdown(item.match),
        ...examMarkdown(item.exams),
        "#### 准备建议",
        "这些是复习任务，实际报考科目以招生目录核验结果为准。",
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
        ...(item.programAlternatives?.length
          ? [
              "#### 同校其他专业比较",
              ...item.programAlternatives.flatMap((alternative) => [
                `##### ${alternative.programName} · ${alternative.disciplineCode}`,
                `${alternative.degreeType === "academic" ? "学术学位" : "专业学位"} · ${tierLabels[alternative.tier]}`,
                ...(alternative.collegeName
                  ? ["招生院系：" + alternative.collegeName]
                  : []),
                ...(alternative.majorCode
                  ? ["专业代码：" + alternative.majorCode]
                  : []),
                ...(alternative.rationale ? [alternative.rationale] : []),
                ...matchMarkdown(alternative.match, "######"),
                ...examMarkdown(alternative.exams, "######"),
                ...(alternative.preparation?.length
                  ? [
                      "###### 该专业的准备建议",
                      ...alternative.preparation.map(
                        (text) => "- 准备：" + text,
                      ),
                    ]
                  : []),
                ...(alternative.tradeoffs?.length
                  ? [
                      "###### 该专业需要权衡",
                      ...alternative.tradeoffs.map(
                        (text) => "- 需要权衡：" + text,
                      ),
                    ]
                  : []),
                ...(alternative.uncertainties?.length
                  ? [
                      "###### 该专业仍需确认",
                      ...alternative.uncertainties.map(
                        (text) => "- 待确认：" + text,
                      ),
                    ]
                  : []),
                `专业依据：[${alternative.citations.join(", ")}]`,
              ]),
            ]
          : []),
        ...item.citations.flatMap((id) => {
          const source = report.sources.find((entry) => entry.id === id);
          return source
            ? ["参考：[" + source.id + "] " + source.title + " " + source.url]
            : [];
        }),
        "",
      ]),
    ]),
    ...(report.candidateAudit?.length
      ? [
          "## 候选院校覆盖与排除说明",
          "待补充资料或本次未选入，不代表学校不适合或没有该专业。",
          ...report.candidateAudit.flatMap((candidate) => [
            `### ${candidate.institutionName} · ${candidateStatusLabels[candidate.status]}`,
            ...candidate.reasons.map((reason) => "- " + reason),
            ...(candidate.sourceIds.length
              ? [`调查来源：[${candidate.sourceIds.join(", ")}]`]
              : []),
          ]),
          "",
        ]
      : report.reportVersion === "profile-research-v7"
        ? [
            "## 候选院校覆盖与排除说明",
            "本报告未记录逐校调查结果，未出现的院校不能据此排除。",
            "",
          ]
        : []),
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
}

export function downloadResearchReport(
  report: ResearchReport,
  run: GuidanceRun,
  outdated: boolean,
) {
  const content = researchReportMarkdown(report, run, outdated);
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "研途-联网研究报告.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
