import type { Discipline, GuidanceRun } from "../disciplines/types.ts";
import type { ResearchReport } from "./research.ts";
import type { PendingResearchEvidence } from "../../shared/research-recommendation.ts";
import type { WebSource } from "./web.ts";
import { deriveRecommendationConstraints } from "./research-constraints.ts";
import { extractProgramExams, programRowScope } from "./research-matching.ts";
import { isSchoolPage } from "./research-evidence.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";
import { researchContext } from "./research-planning.ts";
import { safeSourceYear } from "./research-years.ts";
import {
  schoolRegistrableDomain,
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
} from "./research-school.ts";

type Recommendation = ResearchReport["recommendations"][number];

/** A cited identity anchors the domain; unrelated schools and unvalidated attachments are excluded. */
export function sameSchoolReadSources(
  item: Pick<Recommendation, "institutionName" | "citations">,
  sources: WebSource[],
) {
  const domains = new Set(
    sources
      .filter(
        (s) =>
          item.citations.includes(s.id) &&
          isSchoolPage(s) &&
          sourceHasSchoolIdentity(s, item.institutionName, sources),
      )
      .map((s) => schoolRegistrableDomain(s.url)),
  );
  return sources.filter(
    (s) =>
      isSchoolPage(s) &&
      domains.has(schoolRegistrableDomain(s.url)) &&
      sourceHasSchoolIdentity(s, item.institutionName, sources) &&
      (!(s.parentSourceId || s.provenance) ||
        validatedSourceProvenance(s)?.institutionName === item.institutionName),
  );
}

/** Bind with the existing scope/year/population validators; pending text never supplies a constraint. */
export function bindRecommendationEvidence(
  item: Recommendation,
  run: GuidanceRun,
  discipline: Discipline,
  sources: WebSource[],
  targetYear: string,
): Recommendation {
  const own = sameSchoolReadSources(item, sources);
  const profile = researchContext(run).profile;
  const scopes = own
    .flatMap((source) => {
      const body = withoutSchoolLinks(source.excerpt);
      const rows = [...body.matchAll(/\b(?:0[1-9]|1[0-4])\d{4}\b/g)];
      return rows.flatMap((row, index) => {
        if (
          !(item.majorCode
            ? row[0] === item.majorCode
            : row[0].startsWith(item.disciplineCode))
        )
          return [];
        const passage = body
          .slice(row.index! + row[0].length, rows[index + 1]?.index)
          .trim();
        if (!passage.startsWith(item.programName!)) return [];
        return [
          {
            ...programRowScope(body, row.index!, rows[index + 1]?.index),
            majorCode: row[0],
          },
        ];
      });
    })
    .filter(
      (scope) =>
        (!item.collegeName ||
          !scope.collegeName ||
          scope.collegeName === item.collegeName) &&
        (!item.studyMode ||
          item.studyMode === "unspecified" ||
          !scope.studyMode ||
          scope.studyMode === item.studyMode),
    );
  const ambiguousIdentity =
    (!item.majorCode && new Set(scopes.map((s) => s.majorCode)).size > 1) ||
    (!item.collegeName &&
      new Set(scopes.map((s) => s.collegeName).filter(Boolean)).size > 1) ||
    ((!item.studyMode || item.studyMode === "unspecified") &&
      new Set(scopes.map((s) => s.studyMode).filter(Boolean)).size > 1);
  // A unique coded row may supply missing identity even when the model omitted it.
  // Multiple faculties/modes stay unresolved instead of picking the first page.
  if (!ambiguousIdentity) {
    for (const field of ["majorCode", "collegeName", "studyMode"] as const) {
      const values = [...new Set(scopes.map((s) => s[field]).filter(Boolean))];
      if (
        (!item[field] || item[field] === "unspecified") &&
        values.length === 1
      )
        item = { ...item, [field]: values[0] };
    }
  }
  const applicable = ambiguousIdentity ? [] : own;
  const constraints = deriveRecommendationConstraints({
    institutionName: item.institutionName,
    programName: item.programName!,
    majorCode: item.majorCode,
    collegeName: item.collegeName,
    studyMode: item.studyMode,
    degreeType: item.degreeType,
    profile: {
      budget: String(profile.budget ?? ""),
      cities: Array.isArray(profile.cities) ? (profile.cities as string[]) : [],
    },
    targetYear,
    sources: applicable,
    citations: own.map((s) => s.id),
  });
  const exams = extractProgramExams({
    institutionName: item.institutionName,
    programName: item.programName!,
    majorCode: item.majorCode,
    collegeName: item.collegeName,
    studyMode: item.studyMode,
    discipline,
    sources: applicable,
    targetYear,
    admissionScope: "program_row",
  });
  if (ambiguousIdentity) {
    exams.status = "ambiguous";
    exams.reason = "同名专业存在多个代码、学院或学习方式，尚未唯一归属。";
  }
  const pendingEvidence: PendingResearchEvidence[] = [];
  const bound = {
    tuition: !!constraints.tuition,
    location: !!constraints.location,
    exams:
      ["verified_current", "historical"].includes(exams.status) &&
      !!exams.subjects.length,
  };
  for (const source of own) {
    const body = withoutSchoolLinks(source.excerpt);
    // Keep literal continuous passages. Neither concatenated rows nor shortened ellipses are quotes.
    for (const match of body.matchAll(/[^。；;\n]+/g)) {
      const passage = match[0].trim();
      const projectAt = item.majorCode
        ? passage.indexOf(item.majorCode)
        : passage.indexOf(item.programName!);
      const related = projectAt >= 0 || passage.includes(item.programName!);
      if (
        !related &&
        (!/硕士|研究生/.test(body) ||
          /\b(?:0[1-9]|1[0-4])\d{4}\b/.test(passage))
      )
        continue;
      for (const field of ["exams", "tuition", "location"] as const) {
        if (bound[field]) continue;
        const marker = {
          exams: /初试|考试科目|①|②|③|④/,
          tuition: /学费|收费|\d\s*元/,
          location: /校区|地址|培养地点|办学地点|教学地点/,
        }[field].exec(passage);
        if (!marker) continue;
        if (!related && field === "exams") continue;
        const start = Math.max(0, marker.index - 140);
        const quote = passage.slice(start, start + 300);
        if (!quote || quote.includes(" … ")) continue;
        const year = safeSourceYear(source);
        pendingEvidence.push({
          field,
          quote,
          sourceId: source.id,
          ...(year ? { year } : {}),
          reason:
            field === "exams" && exams.status === "ambiguous"
              ? exams.reason
              : "原文涉及该专业，但学院、学习方式、年度、适用人群或字段值尚不能唯一对应；需核对完整条目及冲突来源。",
        });
      }
    }
  }
  const unique = [
    ...new Map(
      pendingEvidence.map((e) => [`${e.field}:${e.sourceId}:${e.quote}`, e]),
    ).values(),
  ];
  const citations = [
    ...new Set([
      ...item.citations,
      ...[
        constraints.tuition?.sourceId,
        constraints.location?.sourceId,
        ...(constraints.location?.supportingEvidence ?? []).map(
          (e) => e.sourceId,
        ),
        exams.sourceId,
        ...(exams.history ?? []).map((e) => e.sourceId),
        ...unique.map((e) => e.sourceId),
      ].filter((id): id is string => !!id),
    ]),
  ];
  // Recompute instead of retaining stale model/inventory fields when a target-year conflict appears.
  const {
    tuition: _tuition,
    location: _location,
    pendingEvidence: _pending,
    ...rest
  } = item;
  return { ...rest, ...constraints, exams, pendingEvidence: unique, citations };
}
