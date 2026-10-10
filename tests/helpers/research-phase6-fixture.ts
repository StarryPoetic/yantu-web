import type { ResearchReport } from "../../server/explanation/research.ts";
import { withEvidenceCoverage } from "./research-coverage-fixture.ts";

/** Fictional, offline data shared by browser assertions and the supervisor's screenshot capture. */
export function withPhase6Display(base: ResearchReport): ResearchReport {
  const report = withEvidenceCoverage(base);
  const item = base.recommendations[0];
  const pending = [2025, 2028, 2027, 2026].flatMap((year) =>
    (["exams", "tuition", "location"] as const).map((field) => ({
      field,
      year,
      sourceId: "phase6-http",
      quote: `${year} 年${{ exams: "初试科目", tuition: "学费", location: "培养校区" }[field]}连续原文，具体专业归属尚待核对。`,
      reason: "同名项目有不同学院或学习方式。",
    })),
  );
  return {
    ...report,
    evidenceCoverage: {
      ...report.evidenceCoverage!,
      librarySchoolCount: 12,
      libraryProgramCount: 34,
      reusedSourceCount: 2,
      supplementedSourceCount: 3,
    },
    readStatistics: {
      success: 3,
      failed: 2,
      failuresByCode: { HTTP_404: 1, WEB_TLS_CERT: 1 },
    },
    recommendations: [
      {
        ...item,
        institutionName: "已绑定测试大学",
        referenceBasis: {
          year: 2026,
          reason: "历史目录用于比较，目标年度另行核验。",
          sourceIds: ["phase6-http"],
        },
        exams: {
          status: "verified_current",
          year: 2027,
          subjects: [{ code: "201", name: "英语一" }],
          sourceId: "phase6-http",
          quote: "2027 年初试科目 201 英语一。",
          reason: "已绑定该项目初试科目。",
        },
        tuition: {
          amount: 8000,
          currency: "CNY",
          period: "academic_year",
          year: 2026,
          studyMode: "full_time",
          scope: "school_degree_type",
          quote: "学术学位学费8000元/年。",
          sourceId: "phase6-http",
        },
        location: {
          city: "杭州",
          year: 2027,
          quote: "该项目培养城市杭州。",
          sourceId: "phase6-http",
        },
        pendingEvidence: pending.filter((e) => e.field === "tuition"),
        citations: ["phase6-http"],
      },
      {
        ...item,
        institutionName: "待确认测试大学",
        exams: undefined,
        tuition: undefined,
        location: undefined,
        referenceBasis: undefined,
        pendingEvidence: pending,
        citations: ["phase6-platform"],
      },
      {
        ...item,
        institutionName: "未找到测试大学",
        exams: undefined,
        tuition: undefined,
        location: undefined,
        referenceBasis: undefined,
        pendingEvidence: [],
        citations: [],
      },
    ],
    sources: [
      ...report.sources,
      {
        id: "phase6-http",
        title: "模拟学费与目录原文",
        url: "http://graduate.phase6.edu.cn/" + "long-path-".repeat(25),
        excerpt: "已绑定测试大学模拟专业原文。",
        retrievedAt: "2026-09-01T01:02:03.000Z",
        kind: "official_page",
        verified: false,
        transport: "http",
        retrievalNote:
          "明文传输（HTTP）读取，内容可能被网络中间环节篡改，仅作待核验线索。",
        library: {
          status: "fresh",
          storedAt: base.generatedAt,
          expiresAt: "2027-01-01T00:00:00Z",
          version: 1,
        },
      },
      {
        id: "phase6-platform",
        title: "研招网平台模拟原文",
        url: "https://yz.chsi.com.cn/phase6",
        excerpt: "待确认测试大学平台原文。",
        retrievedAt: base.generatedAt,
        kind: "official_page",
        verified: false,
      },
      {
        id: "phase6-raw",
        title: "模拟已读未结构化页面",
        url: "http://graduate.phase6.edu.cn/raw",
        excerpt: "未结构化页面首段。" + "公开原文供用户核对。".repeat(650),
        retrievedAt: base.generatedAt,
        kind: "official_page",
        verified: false,
        transport: "http",
      },
    ],
    unstructuredSources: [
      {
        institutionName: "待确认测试大学",
        sourceId: "phase6-raw",
        excerpt: "未结构化页面首段。" + "公开原文供用户核对。".repeat(650),
        truncated: true,
      },
    ],
  };
}
