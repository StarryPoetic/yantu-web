import { createHash } from "node:crypto";
import type { ResearchSupplementScope } from "../../shared/research-supplement.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
import type { ResearchReport } from "./research.ts";
import type { Discipline } from "../disciplines/types.ts";
import { missingPriorityQueries } from "./research-targeted.ts";
import type { WebSource } from "./web.ts";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value?: string) =>
  (value ?? "").replace(/\s+/g, "").normalize("NFKC");

export function supplementProgramKey(value: Partial<ResearchSupplementScope>) {
  return [
    value.institutionName,
    value.disciplineCode,
    value.majorCode,
    value.collegeName,
    value.degreeType,
    value.studyMode,
  ]
    .map(normalized)
    .join("|");
}

/** Missing identity dimensions never authorize another programme/college/mode. */
export function matchesSupplementScope(
  value: Partial<ResearchSupplementScope>,
  scope: ResearchSupplementScope,
) {
  return (
    normalized(value.institutionName) === normalized(scope.institutionName) &&
    value.disciplineCode === scope.disciplineCode &&
    value.majorCode === scope.majorCode &&
    normalized(value.collegeName) === normalized(scope.collegeName) &&
    value.degreeType === scope.degreeType &&
    value.studyMode === scope.studyMode
  );
}

export interface SupplementTask {
  id: string;
  programKey: string;
  kind: "coverage" | "priority";
  gap: ResearchEvidenceGap;
  query: string;
}
export interface ResearchSupplementPlan {
  version: 1;
  baseGeneratedAt: string;
  scope: ResearchSupplementScope[];
  scopeVerified: boolean;
  tasks: SupplementTask[];
  limitations: string[];
}
export interface ResearchSupplementState {
  plan: ResearchSupplementPlan;
  /** Complete includes a checked query with no usable evidence, not a negative admission fact. */
  completedTaskIds: string[];
  baseReport: ResearchReport;
  workingSources?: WebSource[];
  failedTaskIds?: string[];
  /** IO exhaustion is not completion until its evidence has been merged into a report. */
  merged?: boolean;
}

const terms = {
  program: "硕士 招生专业目录",
  exams: "硕士 初试科目 招生专业目录",
  location: "研究生 培养地点 校区",
  tuition: "研究生 学费 收费标准",
  eligibility: "硕士 招生章程 报考条件",
  curriculum: "硕士 培养方案 研究方向",
};

/** Pure snapshot: no registry expansion, clock, IO, model, or guessed missing identities. */
export function createSupplementPlan(
  report: ResearchReport,
  disciplines: readonly Discipline[],
): ResearchSupplementPlan {
  const projects = report.recommendations.flatMap(
    ({ programAlternatives, ...main }) => [
      main,
      ...(programAlternatives ?? []).map((route) => ({
        ...route,
        institutionName: main.institutionName,
      })),
    ],
  );
  const scope: ResearchSupplementScope[] = [];
  let scopeVerified = projects.length > 0 && !!report.evidenceCoverage;
  for (const project of projects) {
    if (
      !project.institutionName ||
      !/^\d{4}$/.test(project.disciplineCode) ||
      !/^\d{6}$/.test(project.majorCode ?? "") ||
      !project.programName
    ) {
      scopeVerified = false;
      continue;
    }
    const item: ResearchSupplementScope = {
      institutionName: project.institutionName,
      disciplineCode: project.disciplineCode,
      majorCode: project.majorCode!,
      programName: project.programName,
      ...(project.collegeName ? { collegeName: project.collegeName } : {}),
      ...(project.degreeType ? { degreeType: project.degreeType } : {}),
      ...(project.studyMode ? { studyMode: project.studyMode } : {}),
    };
    if (
      !scope.some((s) => supplementProgramKey(s) === supplementProgramKey(item))
    )
      scope.push(item);
  }
  const tasks: SupplementTask[] = [];
  const add = (
    item: ResearchSupplementScope,
    gap: ResearchEvidenceGap,
    query: string,
    kind: SupplementTask["kind"],
  ) => {
    const programKey = supplementProgramKey(item);
    const id = digest([programKey, kind, gap.field, gap.requestedYear, query]);
    if (!tasks.some((task) => task.id === id))
      tasks.push({ id, programKey, kind, gap: structuredClone(gap), query });
  };
  // An incomplete legacy scope is deliberately all-or-nothing; no fallback to broad research.
  if (scopeVerified)
    for (const item of scope) {
      const gaps = (report.evidenceCoverage?.gaps ?? []).filter(
        (gap) =>
          normalized(gap.institutionName) ===
            normalized(item.institutionName) &&
          gap.majorCode === item.majorCode &&
          (!gap.disciplineCode || gap.disciplineCode === item.disciplineCode) &&
          (!gap.collegeName ||
            normalized(gap.collegeName) === normalized(item.collegeName)) &&
          (!gap.studyMode || gap.studyMode === item.studyMode),
      );
      for (const gap of gaps) {
        const year = gap.requestedYear ?? Number(gap.targetYear);
        if (!Number.isInteger(year) || year < 2000) continue;
        add(
          item,
          gap,
          [
            item.institutionName,
            item.collegeName,
            item.majorCode,
            item.programName,
            `${year}年`,
            terms[gap.field],
          ]
            .filter(Boolean)
            .join(" "),
          "coverage",
        );
      }
      // Only reports that already investigated priority fields continue that investigation.
      const discipline = disciplines.find(
        (d) => d.code === item.disciplineCode,
      );
      if (report.priorityCoverage && discipline) {
        const year = report.referencePolicy?.targetYear ?? gaps[0]?.targetYear;
        if (!year) continue;
        for (const query of missingPriorityQueries(
          item.institutionName,
          discipline,
          year,
          report.priorityFacts ?? [],
          item,
        )) {
          add(
            item,
            {
              id: digest([supplementProgramKey(item), query]),
              ...item,
              field: "program",
              targetYear: year,
              referenceYears: report.referencePolicy?.referenceYears ?? [],
              purpose: "missing_evidence",
              reason: "已展示项目仍缺少公开专项资料。",
              nextAction: query,
              sourceIds: [],
              references: [],
              priority: "normal",
              attempts: [],
            },
            query,
            "priority",
          );
        }
      }
    }
  return {
    version: 1,
    baseGeneratedAt: report.generatedAt,
    scope,
    scopeVerified,
    tasks,
    limitations: scopeVerified
      ? []
      : [
          "旧报告缺少可冻结的具体专业范围；本次未发起检索，请重新调研以建立明确范围。",
        ],
  };
}
