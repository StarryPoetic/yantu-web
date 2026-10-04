import type { ResearchReport } from "../../server/explanation/research.ts";
import type {
  ResearchEvidenceGap,
  ResearchProgramCoverage,
} from "../../shared/research-coverage.ts";

export function withEvidenceCoverage(report: ResearchReport): ResearchReport {
  const institutionName =
    report.recommendations[0]?.institutionName ?? "浏览器测试大学";
  const tuitionGap: ResearchEvidenceGap = {
    id: "academic-tuition",
    institutionName,
    programIdentity: "academic-route",
    programName: "机械工程",
    majorCode: "080200",
    disciplineCode: "0802",
    collegeName: "机械工程学院",
    studyMode: "full_time",
    field: "tuition",
    targetYear: "2027",
    referenceYears: [2026, 2025, 2024],
    requestedYear: 2026,
    purpose: "missing_evidence",
    priority: "normal",
    reason: "机械工程目录已有原文，尚缺该全日制项目的学年收费原文。",
    nextAction:
      "继续读取机械工程学院的2026年收费附件，并核对学习形式与计费单位。",
    sourceIds: ["research-1"],
    references: [],
    attempts: [
      {
        url: "https://grad.example.edu.cn/mechanical-fees-2026.pdf",
        status: "failed",
        reason: "官网收费附件读取超时。",
        attemptedAt: report.generatedAt,
      },
    ],
  };
  const examGap: ResearchEvidenceGap = {
    ...tuitionGap,
    id: "academic-exams-current",
    field: "exams",
    requestedYear: 2027,
    purpose: "target_year_check",
    priority: "low",
    reason: "已有2026年初试科目原文，2027年安排仍待核对。",
    nextAction: "核对2027年该学院同一专业的初试科目。",
    attempts: [],
    references: [
      {
        sourceId: "research-1",
        year: 2026,
        quote: "080200机械工程，2026年初试科目301数学一、201英语一。",
      },
    ],
  };
  const locationGap: ResearchEvidenceGap = {
    ...tuitionGap,
    id: "academic-location",
    field: "location",
    reason: "尚缺机械工程学院对应的培养校区地址。",
    nextAction: "读取同年度学院校区安排及明确校区地址。",
    attempts: [],
  };
  const academic: ResearchProgramCoverage = {
    identity: "academic-route",
    institutionName,
    programName: "机械工程",
    majorCode: "080200",
    disciplineCode: "0802",
    collegeName: "机械工程学院",
    studyMode: "full_time",
    degreeType: "academic",
    referenceYear: 2026,
    sourceIds: ["research-1"],
    fields: {
      program: {
        status: "supported_reference",
        year: 2026,
        reason: "已取得2026年机械工程学院的具体专业目录原文。",
        sourceIds: ["research-1"],
        references: [
          {
            sourceId: "research-1",
            year: 2026,
            quote: "机械工程学院 | 080200机械工程 | 全日制学术学位。",
          },
        ],
      },
      exams: {
        status: "supported_reference",
        year: 2026,
        reason: "2026年该专业初试科目已有原文，目标年度待核对。",
        sourceIds: ["research-1"],
        references: examGap.references,
      },
      location: {
        status: "missing",
        reason: locationGap.reason,
        sourceIds: [],
        references: [],
      },
      tuition: {
        status: "missing",
        reason: tuitionGap.reason,
        sourceIds: [],
        references: [],
      },
      eligibility: {
        status: "ambiguous",
        reason: "目录使用相近专业表述，具体课程条件尚未明确。",
        sourceIds: ["research-1"],
        references: [
          {
            sourceId: "research-1",
            year: 2026,
            quote: "报考背景为相近专业，具体条件咨询院系。",
          },
        ],
      },
      curriculum: {
        status: "not_applicable",
        reason: "该项尚未列入本轮优先核验范围。",
        sourceIds: [],
        references: [],
      },
    },
    missing: [tuitionGap, examGap, locationGap],
  };
  const professionalExamGap: ResearchEvidenceGap = {
    ...tuitionGap,
    id: "professional-exams",
    programIdentity: "professional-route",
    programName: "机械",
    majorCode: "085500",
    disciplineCode: "0855",
    collegeName: "先进制造学院",
    studyMode: "part_time",
    field: "exams",
    requestedYear: 2025,
    purpose: "resolve_ambiguity",
    reason: "同一专业存在两个考试组，尚未确认报考组。",
    nextAction: "核对先进制造学院机械专业的考试组与研究方向。",
    attempts: [],
  };
  const professional: ResearchProgramCoverage = {
    identity: "professional-route",
    institutionName,
    programName: "机械",
    majorCode: "085500",
    disciplineCode: "0855",
    collegeName: "先进制造学院",
    studyMode: "part_time",
    degreeType: "professional",
    referenceYear: 2025,
    sourceIds: ["research-1"],
    fields: {
      program: {
        status: "supported_reference",
        year: 2025,
        reason: "已取得2025年先进制造学院机械专业目录。",
        sourceIds: ["research-1"],
        references: [
          {
            sourceId: "research-1",
            year: 2025,
            quote: "先进制造学院 | 085500机械 | 非全日制专业学位。",
          },
        ],
      },
      exams: {
        status: "ambiguous",
        year: 2025,
        reason: professionalExamGap.reason,
        sourceIds: ["research-1"],
        references: [],
      },
      location: {
        status: "supported_current",
        year: 2027,
        reason: "该专业2027年培养地址已有独立原文。",
        sourceIds: ["research-1"],
        references: [
          {
            sourceId: "research-1",
            year: 2027,
            quote: "先进制造学院机械专业培养地点：上海市示例路1号。",
          },
        ],
      },
      tuition: {
        status: "supported_reference",
        year: 2025,
        reason: "仅该非全日制机械专业有2025年学年收费参考。",
        sourceIds: ["research-1"],
        references: [
          {
            sourceId: "research-1",
            year: 2025,
            quote: "2025年机械非全日制学费36000元/学年。",
          },
        ],
      },
      eligibility: {
        status: "excluded",
        reason: "这段资格条款适用于另一专业，未套用到该项目。",
        sourceIds: ["research-1"],
        references: [],
      },
      curriculum: {
        status: "missing",
        reason: "尚未取得该学院课程与培养方案原文。",
        sourceIds: [],
        references: [],
      },
    },
    missing: [professionalExamGap],
  };
  const directoryGap: ResearchEvidenceGap = {
    ...tuitionGap,
    id: "hdu-directory",
    institutionName: "杭州电子科技大学",
    programIdentity: undefined,
    programName: undefined,
    majorCode: undefined,
    disciplineCode: undefined,
    collegeName: undefined,
    studyMode: undefined,
    field: "program",
    priority: "high",
    reason: "招生目录附件读取未成功，尚未列出该校具体项目。",
    nextAction: "继续读取该校2026年招生目录的另一个已发现入口。",
    sourceIds: ["coverage-hdu"],
    attempts: [
      {
        url: "https://grs.hdu.edu.cn/catalog-2026.xlsx",
        status: "failed",
        reason: "官网返回403，当前入口无法读取。",
        attemptedAt: report.generatedAt,
      },
    ],
  };
  const gaps = [...academic.missing, ...professional.missing, directoryGap];
  return {
    ...report,
    evidenceCoverage: {
      strategy: "program-evidence-v1",
      mode: "generate",
      schoolCount: 2,
      programCount: 2,
      supportedProgramCount: 2,
      pendingProgramCount: 2,
      gaps,
      summary:
        "两个专业已有独立目录原文，仍需分别补学费、校区与考试组；杭电目录入口读取未成功。",
      reusedSourceCount: 2,
      supplementedSourceCount: 0,
      lookupKeys: [],
      attempts: gaps.flatMap((gap) => gap.attempts),
    },
    candidateAudit: [
      {
        institutionName,
        status: "recommended",
        reasons: ["两个具体专业已有目录依据，分开比较。"],
        sourceIds: ["research-1"],
        coverage: {
          programs: [academic, professional],
          missing: [...academic.missing, ...professional.missing],
        },
      },
      {
        institutionName: "杭州电子科技大学",
        status: "awaiting_evidence",
        reasons: [directoryGap.reason],
        sourceIds: ["coverage-hdu"],
        coverage: { programs: [], missing: [directoryGap] },
      },
    ],
    sources: [
      ...report.sources,
      {
        id: "coverage-hdu",
        title: "杭州电子科技大学2026年硕士招生目录入口",
        url: "https://grs.hdu.edu.cn/catalog.htm",
        excerpt: "该入口提供硕士招生专业目录附件。",
        kind: "official_page",
        retrievedAt: report.generatedAt,
        verified: false,
      },
    ],
  };
}

export function withSupplementedTuition(
  report: ResearchReport,
): ResearchReport {
  const sourceId = "coverage-fee";
  const quote = "2026年机械工程全日制学费8000元/学年。";
  return {
    ...report,
    evidenceCoverage: {
      ...report.evidenceCoverage!,
      mode: "supplement",
      summary: "已补入机械工程2026年学费原文，其他资料缺项仍逐项保留。",
      gaps: report.evidenceCoverage!.gaps.filter(
        (gap) => gap.id !== "academic-tuition",
      ),
      supplementedSourceCount: 1,
    },
    candidateAudit: report.candidateAudit!.map((candidate) =>
      candidate.coverage
        ? {
            ...candidate,
            coverage: {
              ...candidate.coverage,
              missing: candidate.coverage.missing.filter(
                (gap) => gap.id !== "academic-tuition",
              ),
              programs: candidate.coverage.programs.map((program) =>
                program.identity !== "academic-route"
                  ? program
                  : {
                      ...program,
                      fields: {
                        ...program.fields,
                        tuition: {
                          status: "supported_reference",
                          year: 2026,
                          reason:
                            "已补得机械工程全日制的2026年学年收费参考原文。",
                          sourceIds: [sourceId],
                          references: [{ sourceId, year: 2026, quote }],
                        },
                      },
                      missing: program.missing.filter(
                        (gap) => gap.id !== "academic-tuition",
                      ),
                    },
              ),
            },
          }
        : candidate,
    ),
    sources: [
      ...report.sources,
      {
        id: sourceId,
        kind: "official_page",
        title: "机械工程2026年收费附件",
        url: "https://grad.example.edu.cn/mechanical-fees-2026.pdf",
        excerpt: quote,
        retrievedAt: report.generatedAt,
        verified: false,
      },
    ],
  };
}
