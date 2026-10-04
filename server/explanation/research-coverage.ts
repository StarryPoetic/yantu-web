import { createHash } from "node:crypto";
import {
  RESEARCH_EVIDENCE_FIELDS,
  type ResearchCoverageField,
  type ResearchCoverageSummary,
  type ResearchEvidenceField,
  type ResearchEvidenceGap,
  type ResearchEvidenceReference,
  type ResearchProgramCoverage,
  type ResearchReadAttempt,
} from "../../shared/research-coverage.ts";
import type { ResearchCandidateAudit } from "../../shared/research-matching.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";
import type { ResearchStudyMode } from "../../shared/research-recommendation.ts";
import type { Discipline, GuidanceRun } from "../disciplines/types.ts";
import type { ResearchReport } from "./research.ts";
import type { WebSource } from "./web.ts";
import { deriveRecommendationConstraints } from "./research-constraints.ts";
import {
  admissionEvidence,
  isSchoolPage,
  supportsProgram,
  scopedAdmissionEvidence,
  scopedKnownAdmissionConflict,
} from "./research-evidence.ts";
import { extractProgramExams } from "./research-matching.ts";
import {
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
} from "./research-school.ts";
import { safeSourceYear } from "./research-years.ts";

type Recommendation = ResearchReport["recommendations"][number];
type Program = Pick<
  Recommendation,
  | "institutionName"
  | "programName"
  | "disciplineCode"
  | "majorCode"
  | "collegeName"
  | "degreeType"
  | "studyMode"
> & { programName: string };
interface ProgramPassage {
  program: Program;
  source: WebSource;
  quote: string;
  ambiguousMode: boolean;
}

const normalized = (text: string | undefined) =>
  (text ?? "").normalize("NFKC").replace(/\s/g, "");
const digest = (values: unknown[]) =>
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 24);
const unique = (values: string[]) => [...new Set(values)].sort();

/** Year is intentionally absent: annual evidence belongs to the same programme identity. */
export function researchCoverageProgramIdentity(program: Program): string {
  return `program-${digest([
    normalized(program.institutionName),
    normalized(program.collegeName),
    program.majorCode ?? normalized(program.programName),
    program.disciplineCode,
    program.studyMode ?? "unspecified",
  ])}`;
}

function schoolPage(source: WebSource) {
  try {
    return isSchoolPage(source);
  } catch {
    return false;
  }
}

function reference(
  source: WebSource,
  quote: string,
): ResearchEvidenceReference | undefined {
  if (!schoolPage(source) || !quote || !source.excerpt.includes(quote))
    return undefined;
  const year = safeSourceYear(source);
  return {
    sourceId: source.id,
    quote,
    ...(year !== undefined ? { year } : {}),
  };
}

function referencesFor(passages: ProgramPassage[]) {
  const refs = passages.flatMap((item) => {
    const ref = reference(item.source, item.quote);
    return ref ? [ref] : [];
  });
  return refs
    .filter(
      (ref, index) =>
        refs.findIndex(
          (other) =>
            other.sourceId === ref.sourceId && other.quote === ref.quote,
        ) === index,
    )
    .sort(
      (a, b) =>
        (b.year ?? 0) - (a.year ?? 0) ||
        a.sourceId.localeCompare(b.sourceId) ||
        a.quote.localeCompare(b.quote),
    );
}

/** Enumerate actual programme rows, including programmes omitted by the final school card. */
function codedPassages(
  source: WebSource,
  institutionName: string,
  disciplines: Discipline[],
): ProgramPassage[] {
  if (!schoolPage(source) || !sourceHasSchoolIdentity(source, institutionName))
    return [];
  const body = withoutSchoolLinks(source.excerpt);
  const rows = [
    ...body.matchAll(
      /\b((?:0[1-9]|1[0-4])\d{4})\b[\s|:：()（）\[\]【】-]*([\p{Script=Han}]{2,30})/gu,
    ),
  ];
  return rows.flatMap((row, index) => {
    const discipline = disciplines.find((item) => row[1].startsWith(item.code));
    if (!discipline) return [];
    const programName = row[2].replace(
      /(?:专业学位|学术学位|全日制|非全日制|硕士|招生|初试|考试科目|学费).*$/,
      "",
    );
    if (!supportsProgram(source, institutionName, programName, discipline))
      return [];
    const lineStart = body.lastIndexOf("\n", row.index!);
    const prefix = body.slice(Math.max(0, lineStart + 1), row.index!);
    const previous =
      lineStart < 0
        ? ""
        : body.slice(body.lastIndexOf("\n", lineStart - 1) + 1, lineStart);
    const collegePattern =
      /(?:^|[|\s:：])\d{0,3}([\p{Script=Han}]{1,24}(?:学院|研究院|研究所|学部|中心))\s*\|?\s*$/u;
    const collegeName =
      prefix.match(collegePattern)?.[1] ??
      (prefix.trim() ? undefined : previous.trim().match(collegePattern)?.[1]);
    const rowText = body.slice(row.index!, rows[index + 1]?.index);
    const firstLine = rowText.split(
      /\n|复试|参考课程|参考书目|培养内容|课程设置/,
    )[0];
    const partTime = /非全日制/.test(firstLine);
    const fullTime = /全日制/.test(firstLine.replace(/非全日制/g, ""));
    const studyMode =
      partTime === fullTime
        ? undefined
        : partTime
          ? ("part_time" as const)
          : ("full_time" as const);
    const start =
      collegeName && prefix.includes(collegeName)
        ? row.index! - prefix.length + prefix.lastIndexOf(collegeName)
        : collegeName && !prefix.trim() && previous.includes(collegeName)
          ? Math.max(0, body.lastIndexOf("\n", lineStart - 1) + 1)
          : row.index!;
    // A field's quote must stay within its own row, even in a flattened one-line directory.
    const rowLineEnd = body.indexOf("\n", row.index!);
    const quoteEnd = Math.min(
      rowLineEnd < 0 ? body.length : rowLineEnd,
      rows[index + 1]?.index ?? body.length,
      start + 1800,
    );
    const quote = body.slice(start, quoteEnd).trim();
    return [
      {
        program: {
          institutionName,
          programName,
          disciplineCode: discipline.code,
          majorCode: row[1],
          collegeName,
          studyMode,
          degreeType: discipline.degreeType,
        },
        source,
        quote,
        ambiguousMode: partTime && fullTime,
      },
    ];
  });
}

function sameProgram(a: Program, b: Program) {
  return (
    researchCoverageProgramIdentity(a) === researchCoverageProgramIdentity(b)
  );
}

function passageExcluded(passage: ProgramPassage, targetYear: string) {
  return !!scopedAdmissionEvidence(passage.source, targetYear, passage.program)
    .excluded;
}

function completeExams(subjects: { code: string; name: string }[]) {
  const codes = new Set(subjects.map((subject) => subject.code));
  const foreign = ["201", "202", "203", "204"].some((code) => codes.has(code));
  return (
    foreign &&
    (codes.has("199") ? codes.size >= 2 : codes.has("101") && codes.size >= 4)
  );
}

function directConstraintScope(
  source: WebSource,
  quote: string,
  program: Program,
  allPassages: ProgramPassage[],
) {
  const modeText = quote.replace(/非全日制/g, "");
  if (
    program.studyMode === "full_time" &&
    /非全日制/.test(quote) &&
    !/全日制/.test(modeText)
  )
    return false;
  if (
    program.studyMode === "part_time" &&
    /全日制/.test(modeText) &&
    !/非全日制/.test(quote)
  )
    return false;
  const quotedCodes: string[] = Array.from(
    quote.match(/\b(?:0[1-9]|1[0-4])\d{4}\b/g) ?? [],
  );
  if (
    program.majorCode &&
    quotedCodes.length &&
    !quotedCodes.includes(program.majorCode)
  )
    return false;
  const quotedColleges =
    quote.match(/[\p{Script=Han}]{1,24}(?:学院|研究院|研究所|学部)/gu) ?? [];
  if (
    program.collegeName &&
    quotedColleges.length &&
    !quote.includes(program.collegeName)
  )
    return false;
  const variants = new Set(
    allPassages
      .filter(
        (item) =>
          item.program.majorCode === program.majorCode &&
          item.program.programName === program.programName,
      )
      .map((item) => normalized(item.program.collegeName)),
  );
  if (
    !program.collegeName ||
    variants.size <= 1 ||
    quote.includes(program.collegeName)
  )
    return true;
  // A school-wide, degree-wide rule can cover multiple colleges. A bare programme name cannot.
  if (/(?:全校|所有|本校全部)[^。；;\n]{0,30}(?:硕士|专业|学位)/.test(quote))
    return true;
  const before = source.excerpt.slice(0, source.excerpt.indexOf(quote));
  const headings = [
    ...before.matchAll(
      /(?:^|[\n|\s:：])\d{0,3}([\p{Script=Han}]{1,24}(?:学院|研究院|研究所|学部))(?=\s|\||\n|$)/gu,
    ),
  ];
  return headings.at(-1)?.[1] === program.collegeName;
}

function currentConflictForProgram(
  program: Program,
  discipline: Discipline,
  sources: WebSource[],
  profile: Record<string, unknown>,
  targetYear: string,
) {
  return sources.some((source) => {
    if (
      !schoolPage(source) ||
      !sourceHasSchoolIdentity(source, program.institutionName) ||
      safeSourceYear(source) !== Number(targetYear)
    )
      return false;
    if (admissionEvidence(source, targetYear).exclusionKind === "closure")
      return true;
    if (
      !supportsProgram(
        source,
        program.institutionName,
        program.programName,
        discipline,
      )
    )
      return false;
    return (
      scopedAdmissionEvidence(source, targetYear, program).exclusionKind ===
        "closure" ||
      scopedKnownAdmissionConflict(
        source,
        program,
        discipline,
        profile,
        targetYear,
      )
    );
  });
}

function bestField(
  refs: ResearchEvidenceReference[],
  targetYear: string,
  missingReason: string,
  noun: string,
): ResearchCoverageField {
  const eligible = refs.filter(
    (ref) => ref.year !== undefined && ref.year <= Number(targetYear),
  );
  const current = eligible.filter((ref) => ref.year === Number(targetYear));
  const historical = eligible.filter((ref) => ref.year! < Number(targetYear));
  const year = current.length ? Number(targetYear) : historical[0]?.year;
  return {
    status: current.length
      ? "supported_current"
      : historical.length
        ? "supported_reference"
        : "missing",
    reason: current.length
      ? `已取得${targetYear}年对应${noun}原文；资料覆盖不等于报考资格已通过。`
      : historical.length
        ? `已取得${year}年对应${noun}原文，可作历史参考；${targetYear}年安排仍需核对。`
        : missingReason,
    sourceIds: unique(refs.map((ref) => ref.sourceId)),
    references: refs,
    ...(year !== undefined ? { year } : {}),
  };
}

function scopeTextRefs(
  passages: ProgramPassage[],
  pattern: RegExp,
): ResearchEvidenceReference[] {
  return referencesFor(
    passages.filter(
      (item) =>
        !item.ambiguousMode &&
        !/港澳台|来华留学|国际学生|留学生|退役大学生士兵专项|少数民族骨干/.test(
          item.quote,
        ) &&
        pattern.test(item.quote),
    ),
  );
}

function relatedAttempts(
  attempts: ResearchReadAttempt[],
  sources: WebSource[],
): ResearchReadAttempt[] {
  const urls = new Set(sources.map((source) => source.url));
  for (const source of sources)
    for (const link of source.documentLinks ?? []) urls.add(link.url);
  return attempts
    .filter((attempt) => urls.has(attempt.url))
    .map((attempt) => ({ ...attempt }))
    .sort(
      (a, b) =>
        a.url.localeCompare(b.url) ||
        a.attemptedAt.localeCompare(b.attemptedAt),
    );
}

const actions: Record<ResearchEvidenceField, string> = {
  program:
    "补读该校研究生招生目录及链接附件，定位专业代码、学院、学位类型和学习方式；只读到摘要时继续取得官网正文。",
  exams:
    "定位同一专业代码、学院和学习方式的初试科目列及方向／考试组，补齐政治、外语、数学或业务课组合；复试与参考课程不能代替初试科目。",
  location:
    "补读对应年度的专业／学院培养校区政策和各候选校区官方地址，形成专业到学院、校区、城市的证据链；招生办地址不能代替培养地点。",
  tuition:
    "补读对应年度、专业和学习方式的官方收费表，确认金额、按年／全程／学期／学分计价及适用范围；不能把全程费用直接当作年学费。",
  eligibility:
    "补读该专业报考条件、专业目录备注及招生章程，定位本科专业、学历、跨专业、同等学力及专项要求；没有限制摘录不等于允许报考。",
  curriculum:
    "补读该专业硕士培养方案、课程设置或研究方向原文，核对学术训练、实践要求及课程基础；专业名称不能替代培养内容。",
};

function makeGap(input: {
  institutionName: string;
  program?: ResearchProgramCoverage;
  field: ResearchEvidenceField;
  evidence: ResearchCoverageField;
  targetYear: string;
  attempts: ResearchReadAttempt[];
}): ResearchEvidenceGap | undefined {
  const { program, field, evidence, targetYear } = input;
  if (
    evidence.status === "supported_current" ||
    evidence.status === "excluded" ||
    evidence.status === "not_applicable"
  )
    return undefined;
  const referenceYears = historicalReferenceYears(targetYear);
  const purpose =
    evidence.status === "supported_reference"
      ? ("target_year_check" as const)
      : evidence.status === "ambiguous"
        ? ("resolve_ambiguity" as const)
        : ("missing_evidence" as const);
  const requestedYear =
    purpose === "target_year_check"
      ? Number(targetYear)
      : (referenceYears[0] ?? Number(targetYear));
  const context = program
    ? `${program.collegeName ? `${program.collegeName} ` : ""}${program.majorCode ?? ""} ${program.programName}${program.studyMode === "full_time" ? " 全日制" : program.studyMode === "part_time" ? " 非全日制" : "（学习方式待核对）"}`
    : "相关硕士专业";
  return {
    id: `gap-${digest([
      normalized(input.institutionName),
      program?.identity ?? "school",
      field,
      targetYear,
      requestedYear,
    ])}`,
    institutionName: input.institutionName,
    ...(program
      ? {
          programIdentity: program.identity,
          programName: program.programName,
          majorCode: program.majorCode,
          disciplineCode: program.disciplineCode,
          collegeName: program.collegeName,
          studyMode: program.studyMode,
        }
      : {}),
    field,
    targetYear,
    referenceYears,
    requestedYear,
    purpose,
    reason: evidence.reason,
    nextAction: `针对${input.institutionName} ${context}：${purpose === "target_year_check" ? `核对${targetYear}年是否调整，保留${evidence.year}年历史参考。` : `优先补${referenceYears.join("／")}年对应资料，再核对${targetYear}年已公布变更。`}${actions[field]}`,
    sourceIds: evidence.sourceIds,
    references: evidence.references,
    priority:
      purpose === "target_year_check"
        ? "low"
        : field === "program"
          ? "high"
          : "normal",
    attempts: input.attempts,
  };
}

export interface DeriveResearchCoverageInput {
  run: GuidanceRun;
  disciplines: Discipline[];
  sources: WebSource[];
  recommendations: Recommendation[];
  inventoryRecommendations?: Recommendation[];
  candidateAudit: ResearchCandidateAudit[];
  targetYear: string;
  attempts?: ResearchReadAttempt[];
}

/** Pure derivation: no network, model, profile mutation or claims about unavailable documents. */
export function deriveResearchCoverage(input: DeriveResearchCoverageInput): {
  candidates: ResearchCandidateAudit[];
  gaps: ResearchEvidenceGap[];
  summary: ResearchCoverageSummary;
} {
  const profile = input.run.inputSnapshot.profile;
  const sources = [...input.sources].sort(
    (a, b) => a.id.localeCompare(b.id) || a.url.localeCompare(b.url),
  );
  const suggestions = [
    ...input.recommendations,
    ...(input.inventoryRecommendations ?? []),
  ]
    .flatMap((item) => [
      item,
      ...(item.programAlternatives ?? []).map((route) => ({
        ...route,
        institutionName: item.institutionName,
      })),
    ])
    .filter(
      (item): item is typeof item & { programName: string } =>
        !!item.programName,
    );
  const names = new Set([
    ...input.candidateAudit.map((candidate) => candidate.institutionName),
    ...suggestions.map((item) => item.institutionName),
  ]);
  for (const source of sources) {
    if (!schoolPage(source)) continue;
    for (const match of withoutSchoolLinks(source.excerpt).matchAll(
      /(?:^|[\s:：。；|｜])([\p{Script=Han}]{2,20}(?:大学|学院|研究院|研究所))(?=\s|\d|年|硕士|研究生|招生|专业|学科|版权所有|$)/gu,
    ))
      if (sourceHasSchoolIdentity(source, match[1])) names.add(match[1]);
    if (
      source.provenance?.institutionName &&
      sourceHasSchoolIdentity(source, source.provenance.institutionName)
    )
      names.add(source.provenance.institutionName);
  }
  const result: ResearchCandidateAudit[] = [];
  const gaps: ResearchEvidenceGap[] = [];
  const programs: ResearchProgramCoverage[] = [];
  for (const institutionName of [...names].sort()) {
    const original = input.candidateAudit.find(
      (item) => item.institutionName === institutionName,
    );
    const schoolSources = sources.filter((source) =>
      sourceHasSchoolIdentity(source, institutionName),
    );
    const attempts = relatedAttempts(input.attempts ?? [], schoolSources);
    const allPassages = schoolSources.flatMap((source) =>
      codedPassages(source, institutionName, input.disciplines),
    );
    // Uncoded programme introductions can support a named route, but cannot borrow a coded sibling's scope.
    for (const item of suggestions.filter(
      (item) => item.institutionName === institutionName,
    )) {
      const discipline = input.disciplines.find(
        (d) => d.code === item.disciplineCode,
      );
      if (
        !discipline ||
        allPassages.some((passage) => sameProgram(passage.program, item))
      )
        continue;
      for (const source of schoolSources) {
        if (
          !schoolPage(source) ||
          !supportsProgram(
            source,
            institutionName,
            item.programName,
            discipline,
          )
        )
          continue;
        const body = withoutSchoolLinks(source.excerpt);
        if (/\b(?:0[1-9]|1[0-4])\d{4}\b/.test(body)) continue;
        const clauses = body
          .split(/[。；;\n]/)
          .filter((clause) => clause.includes(item.programName));
        for (const quote of clauses) {
          if (item.collegeName && !quote.includes(item.collegeName)) continue;
          if (
            item.studyMode === "full_time" &&
            (!/全日制/.test(quote) || /非全日制/.test(quote))
          )
            continue;
          if (item.studyMode === "part_time" && !/非全日制/.test(quote))
            continue;
          // An uncoded introduction cannot validate a code supplied by the model.
          allPassages.push({
            program: { ...item, majorCode: undefined },
            source,
            quote,
            ambiguousMode: false,
          });
        }
      }
    }
    const grouped = new Map<string, ProgramPassage[]>();
    for (const passage of allPassages) {
      const id = researchCoverageProgramIdentity(passage.program);
      grouped.set(id, [...(grouped.get(id) ?? []), passage]);
    }
    const schoolPrograms: ResearchProgramCoverage[] = [];
    for (const [identity, passages] of [...grouped.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      passages.sort((a, b) => {
        const ay = safeSourceYear(a.source);
        const by = safeSourceYear(b.source);
        const ap =
          ay !== undefined && ay < Number(input.targetYear)
            ? ay + 10000
            : (ay ?? 0);
        const bp =
          by !== undefined && by < Number(input.targetYear)
            ? by + 10000
            : (by ?? 0);
        return (
          bp - ap ||
          a.source.id.localeCompare(b.source.id) ||
          a.program.programName.localeCompare(b.program.programName)
        );
      });
      const program = passages[0].program;
      const discipline = input.disciplines.find(
        (item) => item.code === program.disciplineCode,
      )!;
      const usable = passages.filter(
        (passage) => !passageExcluded(passage, input.targetYear),
      );
      const currentConflict =
        original?.status === "excluded" ||
        currentConflictForProgram(
          program,
          discipline,
          sources,
          profile,
          input.targetYear,
        );
      const refs = referencesFor(usable);
      const programField = bestField(
        refs,
        input.targetYear,
        "尚未取得可明确年度并绑定此专业、学院和学习方式的官网专业条目；没有年份的原文仅保留线索。",
        "专业条目",
      );
      if (passages.some((item) => item.ambiguousMode)) {
        programField.status = "ambiguous";
        programField.reason =
          "同一专业条目包含全日制与非全日制，尚未拆分到各学习方式，不能混用科目、校区或费用。";
      }
      const exam = extractProgramExams({
        ...program,
        discipline,
        sources,
        targetYear: input.targetYear,
        admissionScope: "program_row",
      });
      const examRecords = [exam, ...(exam.history ?? [])];
      const examRefs = examRecords.flatMap((item) => {
        const source = sources.find((source) => source.id === item.sourceId);
        const ref =
          source && item.quote ? reference(source, item.quote) : undefined;
        return ref ? [ref] : [];
      });
      const exams = bestField(
        examRefs,
        input.targetYear,
        exam.reason,
        "初试科目",
      );
      if (
        exam.status === "ambiguous" ||
        (exam.status === "historical" &&
          exam.historicalReference?.status === "ambiguous")
      ) {
        exams.status = "ambiguous";
        exams.reason = exam.reason;
      } else if (!completeExams(exam.subjects)) {
        exams.status = "missing";
        exams.reason =
          "当前只取得部分初试科目或未取得完整组合，仍需核对全部初试科目列，不能把单独的英语或数学摘录当作完整考试路线。";
      }
      const constraints = deriveRecommendationConstraints({
        profile: {
          budget: String(profile.budget ?? ""),
          cities: Array.isArray(profile.cities)
            ? (profile.cities as string[])
            : [],
        },
        ...program,
        targetYear: input.targetYear,
        sources,
        citations: unique(passages.map((item) => item.source.id)),
      });
      const locationSource = sources.find(
        (source) => source.id === constraints.location?.sourceId,
      );
      const scopedLocation =
        constraints.location &&
        locationSource &&
        (constraints.location.supportingEvidence?.length ||
          directConstraintScope(
            locationSource,
            constraints.location.quote,
            program,
            allPassages,
          ))
          ? constraints.location
          : undefined;
      const locationRefs = [
        scopedLocation,
        ...(scopedLocation?.supportingEvidence ?? []),
      ].flatMap((item) => {
        const source =
          item && sources.find((source) => source.id === item.sourceId);
        const ref = source && item ? reference(source, item.quote) : undefined;
        return ref ? [ref] : [];
      });
      const location = bestField(
        locationRefs.filter((ref) => ref.year !== undefined),
        input.targetYear,
        "尚未取得此专业／学院培养地点及所在城市的完整证据；学校名称和招生办地址不能补足校区证明。",
        "培养地点",
      );
      // Geography may be undated, but its exact supporting passage remains visible alongside the dated policy.
      location.references = locationRefs;
      location.sourceIds = unique(locationRefs.map((ref) => ref.sourceId));
      // A newer geography page does not upgrade an older cohort's campus policy.
      if (scopedLocation?.year !== undefined) {
        location.year = scopedLocation.year;
        location.status =
          scopedLocation.year === Number(input.targetYear)
            ? "supported_current"
            : "supported_reference";
        location.reason = `已取得${scopedLocation.year}年对应培养地点证据链；${scopedLocation.year < Number(input.targetYear) ? `${input.targetYear}年安排仍须核对。` : "实际报考与培养安排仍以完整官方政策为准。"}`;
      }
      const tuitionSource = sources.find(
        (source) => source.id === constraints.tuition?.sourceId,
      );
      const scopedTuition =
        constraints.tuition &&
        tuitionSource &&
        directConstraintScope(
          tuitionSource,
          constraints.tuition.quote,
          program,
          allPassages,
        )
          ? constraints.tuition
          : undefined;
      const tuitionRef =
        tuitionSource && scopedTuition
          ? reference(tuitionSource, scopedTuition.quote)
          : undefined;
      const tuition = bestField(
        tuitionRef ? [tuitionRef] : [],
        input.targetYear,
        "尚未取得能对应此专业及学习方式的官方收费原文，需明确收费金额、单位和适用年度。",
        "收费标准",
      );
      if (scopedTuition?.studyMode === "unspecified") {
        tuition.status = "ambiguous";
        tuition.reason =
          "已读到收费原文，但适用学习方式尚未明确，不能把不同学习方式的费用混为同一预算依据。";
      } else if (scopedTuition && scopedTuition.period !== "academic_year") {
        tuition.reason += "该条按全程、学期或学分计价，不能直接当作年度学费。";
      }
      const eligibility = bestField(
        scopeTextRefs(
          usable,
          /报考(?:条件|要求)|仅限|只招收|限招|跨专业|同等学力|本科(?:专业|背景)|学历|学位(?:要求|条件)/,
        ),
        input.targetYear,
        "尚未取得此专业对应的报考条件或目录备注；未发现限制不能当作允许报考。",
        "报考条件摘录",
      );
      const curriculum = bestField(
        scopeTextRefs(
          usable,
          /培养(?:方案|目标|要求)|课程设置|(?:必修|选修|核心)课程|研究方向|实践(?:训练|要求|环节)|学术训练/,
        ),
        input.targetYear,
        "尚未取得能对应此专业的培养方案、课程或研究方向原文，名称关联尚不能证明培养内容符合目标。",
        "培养内容",
      );
      const fields = {
        program: programField,
        exams,
        location,
        tuition,
        eligibility,
        curriculum,
      };
      if (currentConflict || (!usable.length && passages.length)) {
        for (const field of RESEARCH_EVIDENCE_FIELDS)
          fields[field] = {
            status: "excluded",
            reason:
              "已读到明确停招、示例或当前年度资格冲突；不能把已知不适用事实改成缺证重试。",
            sourceIds: unique(passages.map((item) => item.source.id)),
            references: referencesFor(passages),
          };
      }
      const historyYear = refs.find(
        (ref) => ref.year !== undefined && ref.year < Number(input.targetYear),
      )?.year;
      const coverage: ResearchProgramCoverage = {
        ...program,
        identity,
        ...(historyYear !== undefined ? { referenceYear: historyYear } : {}),
        sourceIds: unique(
          Object.values(fields).flatMap((field) => field.sourceIds),
        ),
        fields,
        missing: [],
      };
      coverage.missing = RESEARCH_EVIDENCE_FIELDS.flatMap((field) => {
        const gap = makeGap({
          institutionName,
          program: coverage,
          field,
          evidence: fields[field],
          targetYear: input.targetYear,
          attempts,
        });
        return gap ? [gap] : [];
      });
      schoolPrograms.push(coverage);
    }
    const schoolGaps = schoolPrograms.flatMap((program) => program.missing);
    if (!schoolPrograms.length && original?.status !== "excluded") {
      const sourceIds = unique(schoolSources.map((source) => source.id));
      const gap = makeGap({
        institutionName,
        field: "program",
        targetYear: input.targetYear,
        attempts,
        evidence: {
          status: "missing",
          reason: schoolSources.some(schoolPage)
            ? "已读该校官网，但尚未解析到与本次方向对应的可核验硕士专业条目；可能缺目录附件或完整表格，不能据此排除学校。"
            : "尚未读到该校可核验的具体硕士专业正文；搜索摘要只能提供待查链接。",
          sourceIds,
          references: [],
        },
      });
      if (gap) schoolGaps.push(gap);
    }
    result.push({
      ...(original ?? {
        institutionName,
        status: schoolPrograms.length
          ? ("not_selected" as const)
          : ("awaiting_evidence" as const),
        reasons: [],
        sourceIds: [],
      }),
      sourceIds: unique([
        ...(original?.sourceIds ?? []),
        ...schoolSources.map((source) => source.id),
      ]),
      coverage: { programs: schoolPrograms, missing: schoolGaps },
    });
    gaps.push(...schoolGaps);
    programs.push(...schoolPrograms);
  }
  const priority = { high: 0, normal: 1, low: 2 };
  gaps.sort(
    (a, b) =>
      priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id),
  );
  return {
    candidates: result,
    gaps,
    summary: {
      schoolCount: result.length,
      programCount: programs.length,
      supportedProgramCount: programs.filter((program) =>
        /supported_/.test(program.fields.program.status),
      ).length,
      pendingProgramCount: programs.filter((program) =>
        program.missing.some((gap) => gap.purpose !== "target_year_check"),
      ).length,
    },
  };
}
