import test from "node:test";
import assert from "node:assert/strict";
import type { ResearchReport } from "../../server/explanation/research.ts";
import type { ResearchJob } from "../../server/routes/research.ts";
import { researchReason } from "../../shared/research-status.ts";
import {
  researchCoverage,
  researchOutcome,
  researchReportMarkdown,
  isLegacyResearchReport,
  examDescription,
  assessmentScopeLabel,
  admissionLabel,
  tuitionDescription,
  tuitionCaution,
} from "../../src/workspace/research-report.ts";
import type { GuidanceRun } from "../../server/disciplines/types.ts";
import { decisionDisplayFixture } from "../helpers/research-decision-fixture.ts";
import {
  withEvidenceCoverage,
  withSupplementedTuition,
} from "../helpers/research-coverage-fixture.ts";

test("school-wide tuition labels retain historical scope and undated school mode tariffs never invent a year", () => {
  const value = report();
  const item = value.recommendations[0];
  const run = {
    inputSnapshot: { profile: { year: "2027" } },
  } as unknown as GuidanceRun;
  item.tuition = {
    amount: 7000,
    currency: "CNY",
    period: "academic_year",
    year: 2024,
    studyMode: "unspecified",
    scope: "school_wide",
    quote: "我校研究生学费均为7000元/年",
    sourceId: "fee",
  };
  assert.match(tuitionDescription(item, run), /2024 年参考学费.*全校统一标准/);
  assert.match(tuitionCaution(item, run), /目标年度收费尚需核对/);
  item.tuition = {
    ...item.tuition,
    year: undefined,
    studyMode: "full_time",
    scope: "school_wide_mode",
  };
  assert.match(
    tuitionDescription(item, run),
    /年度未明确.*全校按学习方式标准.*全日制/,
  );
  assert.ok(!tuitionDescription(item, run).includes("undefined"));
  item.tuition = {
    ...item.tuition,
    year: 2027,
    scope: "school_degree_type",
    amount: 8000,
  };
  assert.match(
    tuitionDescription(item, run),
    /2027 年学费.*8,000.*全校按学位类型与学习方式标准.*全日制/,
  );
  assert.match(
    researchReportMarkdown(value, run, false),
    /全校按学位类型与学习方式标准/,
  );
});

const cityReason = "PREFERRED_CITY_COVERAGE_INCOMPLETE";
function report(): ResearchReport {
  return {
    schemaVersion: 1,
    reportVersion: "profile-research-v6",
    status: "partial",
    reason: cityReason,
    generatedAt: "2026-10-04T00:00:00Z",
    guidanceRunId: "display-fixture",
    versions: {} as ResearchReport["versions"],
    summary: "已取得外地学校依据，杭州覆盖仍需补充。",
    facts: [],
    recommendations: ["甲", "乙", "丙", "丁", "戊"].map((name) => ({
      institutionName: `${name}大学`,
      disciplineCode: "0401",
      programName: "教育学",
      tier: "alternative",
      rationale: "保留已有依据供比较。",
      preparation: [],
      uncertainties: [],
      citations: [],
    })),
    coverage: {
      targetMin: 5,
      targetMax: 10,
      schoolCount: 5,
      preferredCount: 0,
      alternativeCount: 5,
      shortfallReasons: [
        "意向城市杭州：目前可核验符合杭州的学校建议为 0 所，不能认定杭州没有合适学校。",
      ],
    },
    sources: [],
    limitations: [],
    model: { name: "deepseek-v4-pro", thinking: true, effort: "high" },
    searched: true,
  };
}

test("Markdown exports pending literal evidence and bounded technical diagnostic counts", () => {
  const value = report();
  value.recommendations[0].pendingEvidence = [
    {
      field: "tuition",
      quote: "该专业全程学费待核对。",
      year: 2026,
      sourceId: "read-fee",
      reason: "学习方式未明确。",
    },
  ];
  value.rejectedRecommendations = [
    {
      institutionName: "甲大学",
      programName: "教育学",
      code: "UNSUPPORTED_RESEARCH_CLAIM",
      removedSentences: 2,
    },
    {
      institutionName: "未知学院",
      programName: "学科简介",
      code: "UNGROUNDED_RESEARCH_RECOMMENDATION",
      removedSentences: 0,
    },
  ];
  value.validationIssues = [
    {
      path: "recommendations[0].sentences",
      code: "UNSUPPORTED_RESEARCH_CLAIM",
    },
  ];
  value.readStatistics = {
    success: 3,
    failed: 2,
    failuresByCode: { HTTP_404: 2 },
  };
  const markdown = researchReportMarkdown(
    value,
    { inputSnapshot: { profile: { year: "2027" } } } as unknown as GuidanceRun,
    false,
  );
  for (const phrase of [
    "待确认原文",
    "不用于预算或城市匹配",
    "该专业全程学费待核对。",
    "2026年",
    "[read-fee]",
    "学习方式未明确",
    "技术信息",
    "整条拒绝：1 次",
    "删除无据句子：2 句",
    "校验问题：1 项",
    "读取成功：3 次",
    "失败：2 次",
    "HTTP_404：2 次",
  ])
    assert.ok(markdown.includes(phrase), phrase);
});
function job(value: ResearchReport): ResearchJob {
  return {
    jobId: "display-job",
    guidanceRunId: value.guidanceRunId,
    status: "partial",
    stage: "done",
    progress: 100,
    message: "保留已核对的学校建议。",
    createdAt: value.generatedAt,
    updatedAt: value.generatedAt,
    events: [],
    report: value,
  };
}

test("five recommendations remain readable with an explicit preferred-city coverage warning", () => {
  const value = report();
  assert.equal(researchOutcome(job(value)), "recommendations");
  const coverage = researchCoverage(value);
  assert.equal(coverage.schoolCount, 5);
  assert.equal(coverage.shortfall, true);
  assert.equal(coverage.noticeTitle, "意向城市覆盖仍不足，先保留已有建议");
  assert.deepEqual(coverage.reasons, value.coverage!.shortfallReasons);
  assert.match(researchReason(cityReason), /可核验.*意向城市.*仍不足/);
  assert.match(researchReason(cityReason), /不代表.*没有适合/);
});

test("history-first export shows dated reference exams and annual changes while retaining target-year verification", () => {
  const value = report();
  const run = {
    inputSnapshot: { profile: { year: "2027" } },
    directions: [],
  } as unknown as GuidanceRun;
  value.referencePolicy = {
    strategy: "history-first-v1",
    targetYear: "2027",
    referenceYears: [2026, 2025, 2024],
    summary: "优先整合2026年、2025年、2024年官网政策；2027年资料用于补充核验。",
  };
  value.recommendations = value.recommendations.slice(0, 1);
  const item = value.recommendations[0];
  item.referenceBasis = {
    year: 2026,
    sourceIds: ["ref26"],
    reason: "已读取2026年专业目录，目标年度资格另行核验。",
  };
  item.admissionStatus = "current_evidence";
  item.exams = {
    status: "verified_current",
    year: 2027,
    subjects: [{ code: "201", name: "英语一" }],
    reason: "2027年目录已改为英语一。",
    historicalReference: {
      status: "historical",
      year: 2026,
      subjects: [{ code: "204", name: "英语二" }],
      reason: "2026年科目供准备参考，不能冒充2027年要求。",
      sourceId: "ref26",
    },
    history: [
      {
        status: "historical",
        year: 2026,
        subjects: [{ code: "204", name: "英语二" }],
        reason: "2026年参考",
      },
      {
        status: "historical",
        year: 2025,
        subjects: [{ code: "201", name: "英语一" }],
        reason: "2025年参考",
      },
    ],
    historicalChanges: [
      {
        fromYear: 2025,
        toYear: 2026,
        sourceIds: ["ref25", "ref26"],
        summary: "2025年至2026年英语一变为英语二。",
      },
    ],
  };
  value.facts = [
    { text: "2026年教育学硕士招生专业目录", citations: ["ref26"], year: 2026 },
  ];
  const markdown = researchReportMarkdown(value, run, false);
  assert.match(markdown, /资料年份与使用顺序/);
  assert.match(markdown, /2026年备考参考科目/);
  assert.ok(
    markdown.indexOf("2026年备考参考科目") <
      markdown.indexOf("2027年科目补充核验"),
  );
  assert.match(markdown, /2025年至2026年英语一变为英语二/);
  assert.match(markdown, /2027 年考试科目已有官网依据/);
  assert.match(markdown, /2026年资料：2026年教育学/);
  assert.match(
    admissionLabel(item, run),
    /2026年资料为比较基准.*2027年相关招生依据/,
  );
  item.admissionStatus = "needs_verification";
  assert.match(
    admissionLabel(item, run),
    /2026年资料支持专业比较.*2027年报考条件待核验/,
  );
  item.exams = {
    ...item.exams,
    status: "historical",
    year: 2026,
    subjects: [{ code: "204", name: "英语二" }],
    history: [item.exams.historicalReference!],
    historicalChanges: [],
  };
  const historicalOnly = researchReportMarkdown(value, run, false);
  assert.match(historicalOnly, /目标年度科目补充核验/);
  assert.match(historicalOnly, /目标年度科目尚待补充核验/);
  assert.equal((historicalOnly.match(/- 204 英语二/g) ?? []).length, 1);
});

test("the city-coverage reason is an evidence gap even when an older job saved it as blocked", () => {
  const value = report();
  value.recommendations = [];
  assert.equal(researchOutcome(job(value)), "empty");
  assert.equal(researchOutcome({ ...job(value), status: "blocked" }), "empty");
});

test("city warnings have a truthful fallback without classifying unknown cities as elsewhere", () => {
  const value = report();
  value.coverage!.shortfallReasons = [];
  const coverage = researchCoverage(value);
  assert.equal(coverage.shortfall, true);
  assert.deepEqual(coverage.reasons, [researchReason(cityReason)]);
  assert.equal(coverage.reasons.join(" ").includes("外地"), false);
  delete value.reason;
  assert.equal(researchCoverage(value).shortfall, false);
  value.recommendations = value.recommendations.slice(0, 2);
  assert.equal(
    researchCoverage(value).noticeTitle,
    "尚未达到 5 所，先保留已有建议",
  );
});

test("explicit city coverage gaps remain visible when another partial reason is retained, while unknown locations stay unknown", () => {
  const value = report();
  value.reason = "RESEARCH_PARTIAL_VALIDATION";
  Object.assign(value.coverage!, {
    preferredCities: ["杭州"],
    preferredCitySchoolCount: 0,
    unknownCitySchoolCount: 5,
    shortfallReasons: [],
  });
  const coverage = researchCoverage(value);
  assert.equal(coverage.shortfall, true);
  assert.match(coverage.noticeTitle, /意向城市覆盖/);
  assert.equal(coverage.reasons.join(" ").includes("外地"), false);
  value.coverage!.preferredCitySchoolCount = 1;
  assert.equal(researchCoverage(value).shortfall, false);
});

test("v7 Markdown retains decision basis without recommendations, including evidence versions and candidate gaps", () => {
  const value = report();
  value.reportVersion = "profile-research-v7";
  value.recommendations = [];
  value.decisionBasis = decisionDisplayFixture();
  value.candidateAudit = [
    {
      institutionName: "杭州电子科技大学",
      status: "awaiting_evidence",
      reasons: ["目录正文尚未读取，不按学科类别推定项目。"],
      sourceIds: ["research-hdu"],
    },
  ];
  const run = {
    inputSnapshot: { profile: { year: 2027 } },
    directions: [],
  } as unknown as GuidanceRun;
  const markdown = researchReportMarkdown(value, run, false);
  assert.match(markdown, /## 测评与学位路线依据/);
  assert.match(markdown, /示例练习观察/);
  assert.match(markdown, /练习范围：数学一/);
  assert.equal(markdown.includes("练习范围：math-one"), false);
  assert.match(markdown, /答对 1 题，答错 1 题，未答 1 题，共 3 题/);
  assert.match(markdown, /diagnosis-display-v1/);
  assert.match(markdown, /example-bank-v1/);
  assert.match(markdown, /专业学位不能据此认定必考数学二或英语二/);
  assert.match(markdown, /杭州电子科技大学 · 资料待补充/);
  assert.match(markdown, /目录正文尚未读取/);
  assert.match(markdown, /未用于本次判断的测评：old-display-1/);
  assert.equal(isLegacyResearchReport(value), false);
});

test("Markdown preserves real subject codes, historical alternatives and demand statuses separately from preparation advice", () => {
  const value = report();
  value.reportVersion = "profile-research-v7";
  value.recommendations = value.recommendations.slice(0, 1);
  const item = value.recommendations[0];
  item.match = {
    ruleVersion: "demand-match-v1",
    summary: "城市已有依据，学费尚未核验。",
    factors: [
      {
        field: "budget",
        label: "预算",
        status: "unknown",
        reason: "缺少精确项目学费原文。",
        sourceIds: [],
      },
    ],
  };
  item.exams = {
    status: "verified_current",
    year: 2027,
    subjects: [
      { code: "301", name: "数学一" },
      { code: "201", name: "英语一" },
    ],
    quote: "2027年教育学考试科目301数学一、201英语一。",
    sourceId: "exam-1",
    reason: "已读取具体项目的目录原文。",
  };
  item.preparation = ["示例练习提示复习导数，不能代填数学二科目。"];
  item.programAlternatives = [
    {
      programName: "应用心理",
      disciplineCode: "0454",
      degreeType: "professional",
      tier: "alternative",
      match: item.match,
      exams: {
        status: "historical",
        year: 2026,
        subjects: [{ code: "204", name: "英语二" }],
        reason: "仅取得2026年目录，2027年尚未核验。",
      },
      citations: ["exam-2"],
    },
  ];
  const run = {
    inputSnapshot: { profile: { year: 2027 } },
    directions: [],
  } as unknown as GuidanceRun;
  const markdown = researchReportMarkdown(value, run, false);
  assert.match(
    markdown,
    /#### 实际考试科目\n2027 年考试科目已有官网依据\n- 301 数学一\n- 201 英语一/,
  );
  assert.match(markdown, /#### 准备建议/);
  assert.match(markdown, /预算：尚未核实；缺少精确项目学费原文/);
  assert.match(markdown, /同校其他专业比较/);
  assert.match(
    markdown,
    /##### 应用心理 · 0454\n专业学位 · 第二级·适合备选\n###### 需求匹配依据/,
  );
  assert.match(markdown, /2026 年考试科目参考，目标年度待核验/);
  assert.match(markdown, /\[exam-1\]/);
  assert.equal(isLegacyResearchReport(value), false);
  delete item.match;
  assert.equal(isLegacyResearchReport(value), true);
  value.reportVersion = "profile-research-v6";
  assert.match(
    researchReportMarkdown(value, run, false),
    /尚未应用需求匹配与考试科目核验的新规则/,
  );
});

test("unknown and ambiguous exam statuses remain explicit and never receive a current-year label", () => {
  assert.equal(examDescription(), "考试科目尚未核验");
  assert.match(
    examDescription({
      status: "ambiguous",
      year: 2027,
      subjects: [],
      reason: "多个方向科目不同。",
    }),
    /存在歧义/,
  );
  assert.match(
    examDescription({
      status: "historical",
      subjects: [],
      reason: "年份尚待核对。",
    }),
    /历史年度/,
  );
});

test("Markdown preserves each programme's department, exact code and independent preparation without borrowing main-card facts", () => {
  const value = report();
  value.reportVersion = "profile-research-v7";
  value.recommendations = value.recommendations.slice(0, 1);
  const item = value.recommendations[0];
  item.collegeName = "主项目教育学院";
  item.majorCode = "040101";
  item.rationale = "主项目依据教育学背景比较。";
  item.preparation = ["主项目复习教育学基础。"];
  item.tradeoffs = ["主项目尚需确认教育实习安排。"];
  item.match = {
    ruleVersion: "demand-match-v1",
    summary: "主项目条件待核对。",
    factors: [],
  };
  item.programAlternatives = [
    {
      programName: "应用心理",
      disciplineCode: "0454",
      collegeName: "心理学院",
      majorCode: "045400",
      degreeType: "professional",
      tier: "alternative",
      rationale: "仅据心理学项目原文保留比较。",
      preparation: ["备选项目先补心理统计基础。"],
      tradeoffs: ["备选项目需要独立补充统计训练。"],
      uncertainties: ["备选项目目标年度科目仍需核对。"],
      match: {
        ruleVersion: "demand-match-v1",
        summary: "备选项目学费已有依据，培养城市存在差异。",
        factors: [
          {
            field: "budget",
            label: "预算",
            status: "match",
            reason: "仅该备选项目学费符合年度预算。",
            sourceIds: ["alt-fee"],
          },
          {
            field: "cities",
            label: "意向城市",
            status: "mismatch",
            reason: "仅该备选项目培养地点在意向城市之外。",
            sourceIds: ["alt-city"],
          },
        ],
      },
      exams: { status: "unknown", subjects: [], reason: "备选目录待补充。" },
      citations: ["alt-1"],
    },
    {
      programName: "心理学",
      disciplineCode: "0402",
      degreeType: "academic",
      tier: "exploratory",
      match: {
        ruleVersion: "demand-match-v1",
        summary: "资料不完整，待独立核对。",
        factors: [],
      },
      exams: {
        status: "unknown",
        subjects: [],
        reason: "该专业没有已核验科目。",
      },
      citations: [],
    },
  ];
  const run = {
    inputSnapshot: { profile: { year: 2027 } },
    directions: [],
  } as unknown as GuidanceRun;
  const markdown = researchReportMarkdown(value, run, false);
  assert.match(markdown, /招生院系：主项目教育学院\n专业代码：040101/);
  const ownAlternative = markdown
    .split("##### 应用心理 · 0454\n")[1]
    .split("##### 心理学 · 0402\n")[0];
  assert.match(ownAlternative, /招生院系：心理学院\n专业代码：045400/);
  assert.match(ownAlternative, /仅据心理学项目原文保留比较/);
  assert.match(
    ownAlternative,
    /预算：已有匹配依据；仅该备选项目学费符合年度预算/,
  );
  assert.match(
    ownAlternative,
    /意向城市：与需求有差异；仅该备选项目培养地点在意向城市之外/,
  );
  assert.match(
    ownAlternative,
    /###### 该专业的准备建议\n- 准备：备选项目先补心理统计基础/,
  );
  assert.match(
    ownAlternative,
    /###### 该专业需要权衡\n- 需要权衡：备选项目需要独立补充统计训练/,
  );
  assert.match(
    ownAlternative,
    /###### 该专业仍需确认\n- 待确认：备选项目目标年度科目仍需核对/,
  );
  assert.equal(ownAlternative.includes("主项目"), false);
  const sparseAlternative = markdown
    .split("##### 心理学 · 0402\n")[1]
    .split("## 候选院校覆盖与排除说明")[0];
  assert.equal(sparseAlternative.includes("招生院系："), false);
  assert.equal(sparseAlternative.includes("专业代码："), false);
  assert.equal(sparseAlternative.includes("该专业的准备建议"), false);
  assert.equal(sparseAlternative.includes("该专业需要权衡"), false);
  assert.equal(sparseAlternative.includes("主项目"), false);
  assert.equal(sparseAlternative.includes("心理统计"), false);
});

test("assessment scopes use Chinese labels and preserve descriptive legacy scopes", () => {
  for (const [scope, label] of Object.entries({
    "math-one": "数学一",
    "math-two": "数学二",
    "math-three": "数学三",
    "english-one": "英语一",
    "english-two": "英语二",
    "common-foundation": "公共基础",
  })) {
    assert.equal(assessmentScopeLabel(scope), label);
  }
  assert.equal(assessmentScopeLabel("函数与导数"), "函数与导数");
});

test("Markdown keeps programme-specific source coverage, missing fields, actual read failures and next actions separate from school coverage", () => {
  const value = withEvidenceCoverage(report());
  const run = {
    inputSnapshot: { profile: { year: 2027 } },
    directions: [],
  } as unknown as GuidanceRun;
  const markdown = researchReportMarkdown(value, run, false);
  assert.match(
    markdown,
    /本次调查 2 所学校、2 个专业；2 个专业已有项目原文，2 个专业仍有实质缺项/,
  );
  assert.match(markdown, /仅统计本次实际调查的学校与专业/);
  assert.match(
    markdown,
    /#### 机械工程 · 080200\n招生院系：机械工程学院\n学习形式：全日制\n项目原文年度：2026 年/,
  );
  const academic = markdown
    .split("#### 机械工程 · 080200")[1]
    .split("#### 机械 · 085500")[0];
  assert.match(academic, /具体专业与招生目录：已有历史参考原文/);
  assert.match(academic, /学费：尚缺原文；机械工程目录已有原文/);
  assert.match(academic, /报考资格：原文有歧义，待核对/);
  assert.match(academic, /课程与培养：此项不适用/);
  assert.match(
    academic,
    /初试科目 · 目标年度核对：已有2026年初试科目原文，2027年安排仍待核对/,
  );
  assert.match(academic, /下一步：继续读取机械工程学院的2026年收费附件/);
  assert.match(
    academic,
    /读取未成功：官网收费附件读取超时.*mechanical-fees-2026.pdf/,
  );
  assert.equal(
    academic.includes("36000"),
    false,
    "another programme's fee cannot fill this programme's missing field",
  );
  const professional = markdown
    .split("#### 机械 · 085500")[1]
    .split("### 杭州电子科技大学")[0];
  assert.match(professional, /培养城市与校区：目标年度已有原文/);
  assert.match(
    professional,
    /原文（2025年）：\[research-1\] 2025年机械非全日制学费36000元\/学年/,
  );
  assert.match(professional, /报考资格：原文不适用本项目/);
  assert.match(
    markdown,
    /具体专业与招生目录 · 优先补齐：招生目录附件读取未成功/,
  );
  assert.match(markdown, /官网返回403，当前入口无法读取/);
});

test("supplemented coverage replaces only the resolved gap, preserves other programme facts, and legacy reports need no new fields", () => {
  const original = withEvidenceCoverage(report());
  const next = withSupplementedTuition(original);
  const run = {
    inputSnapshot: { profile: { year: 2027 } },
    directions: [],
  } as unknown as GuidanceRun;
  const markdown = researchReportMarkdown(next, run, false);
  assert.match(markdown, /复用已有资料 2 条，本轮新增资料 1 条/);
  assert.match(
    markdown,
    /学费：已有历史参考原文；已补得机械工程全日制的2026年学年收费参考原文/,
  );
  assert.equal(
    markdown.includes("下一步：继续读取机械工程学院的2026年收费附件"),
    false,
  );
  assert.match(markdown, /尚缺机械工程学院对应的培养校区地址/);
  assert.match(markdown, /2025年机械非全日制学费36000/);
  assert.equal(
    original.evidenceCoverage?.gaps.length,
    5,
    "render and export helpers leave the saved baseline immutable",
  );
  const legacy = report();
  legacy.candidateAudit = [
    {
      institutionName: "旧资料大学",
      status: "awaiting_evidence",
      reasons: ["旧报告仅有概要记录。"],
      sourceIds: [],
    },
  ];
  const oldMarkdown = researchReportMarkdown(legacy, run, false);
  assert.match(oldMarkdown, /旧报告仅有概要记录/);
  assert.equal(oldMarkdown.includes("## 专业资料覆盖与缺项"), false);
});
