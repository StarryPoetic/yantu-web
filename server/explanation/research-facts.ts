import {
  getDisciplineCatalog,
  generateGuidance,
} from "../disciplines/index.ts";
import { blankProfile } from "../profile.ts";
import { normalizeCollegeName, schoolRegistry } from "../schools/index.ts";
import { bindRecommendationEvidence } from "./research-binding.ts";
import { programEntries } from "./research-matching.ts";
import { isSchoolPage, scopedAdmissionEvidence } from "./research-evidence.ts";
import {
  resolveInstitutionFromPages,
  sourceHasSchoolIdentity,
  schoolRegistrableDomain,
} from "./research-school.ts";
import { safeSourceYear } from "./research-years.ts";
import type { WebSource } from "./web.ts";
import type {
  TuitionEvidence,
  LocationEvidence,
  ResearchStudyMode,
} from "../../shared/research-recommendation.ts";
import type { ResearchExamEvidence } from "../../shared/research-matching.ts";

export interface ProgramFact {
  schoolName: string;
  registrableDomain: string;
  collegeName?: string;
  majorCode: string;
  programName: string;
  disciplineCode: string;
  degreeType: "academic" | "professional";
  studyMode?: ResearchStudyMode;
  year?: number;
  field: "catalog" | "exams" | "tuition" | "campus";
  value:
    | TuitionEvidence
    | LocationEvidence
    | ResearchExamEvidence
    | { exists: true }
    | { reason: string };
  quote: string;
  sourceUrl: string;
  sourceId: string;
  retrievedAt: string;
  extractedAt: string;
  extractor: string;
  status: "bound" | "pending";
  verified: false;
  freshness?: "fresh" | "stale";
  targetYearApplicable?: boolean;
}

const disciplines = getDisciplineCatalog().items;
const neutralRuns = new Map<string, ReturnType<typeof generateGuidance>>();
function bindingContext(year: string, extractedAt: string) {
  let run = neutralRuns.get(year);
  if (!run) {
    run = generateGuidance({
      subjectId: "public-fact-extractor",
      guidanceRunId: "public-fact-extractor",
      generatedAt: extractedAt,
      profile: { ...blankProfile(), year },
      profileVersion: 0,
      selectionVersion: 0,
      confirmedMajorId: null,
      excludedMajorIds: [],
      assessments: [],
    });
    if (neutralRuns.size >= 20) neutralRuns.clear();
    neutralRuns.set(year, run);
  }
  return run;
}

/** No recommendation/model input is accepted. Only the phase-2 deterministic binder supplies values. */
export function extractProgramFacts(
  source: WebSource,
  sources: WebSource[],
  extractedAt: string,
  /** Model-input extraction may focus on the displayed identities; library extraction stays exhaustive. */
  focus?: readonly {
    institutionName: string;
    programName?: string;
    majorCode?: string;
    collegeName?: string;
    studyMode?: string;
  }[],
  /** One immutable school snapshot only; never reused across source refreshes. */
  locationCache?: Map<string, LocationEvidence | undefined>,
): ProgramFact[] {
  if (!isSchoolPage(source)) return []; // CHSI dynamic catalogue safely falls back to school originals.
  const domain = schoolRegistrableDomain(source.url)!;
  const seed = schoolRegistry.byHost(domain);
  const schoolName = seed?.name ?? resolveInstitutionFromPages(domain, sources);
  if (!schoolName || !sourceHasSchoolIdentity(source, schoolName, sources))
    return [];
  const own = sources.filter(
    (s) =>
      isSchoolPage(s) &&
      schoolRegistrableDomain(s.url) === domain &&
      sourceHasSchoolIdentity(s, schoolName, sources),
  );
  const facts: ProgramFact[] = [];
  const entries = new Map<
    string,
    { anchor: WebSource; entry: ReturnType<typeof programEntries>[number] }
  >();
  for (const anchor of [source, ...own.filter((s) => s !== source)])
    for (const entry of programEntries(anchor, disciplines)) {
      const key = JSON.stringify([
        entry.majorCode,
        entry.programName,
        entry.collegeName,
        entry.studyMode,
      ]);
      if (!entries.has(key)) entries.set(key, { anchor, entry });
    }
  for (const { anchor, entry } of entries.values()) {
    if (
      focus?.length &&
      !focus.some(
        (item) =>
          item.institutionName === schoolName &&
          (item.majorCode
            ? item.majorCode === entry.majorCode
            : item.programName === entry.programName) &&
          (!item.collegeName ||
            normalizeCollegeName(schoolName, item.collegeName) ===
              normalizeCollegeName(schoolName, entry.collegeName)) &&
          (!item.studyMode || item.studyMode === entry.studyMode),
      )
    )
      continue;
    const { discipline, catalogQuote, ...identity } = entry;
    identity.collegeName = normalizeCollegeName(
      schoolName,
      identity.collegeName,
    );
    const targetYear = String(
      Math.max(safeSourceYear(anchor) ?? 2000, safeSourceYear(source) ?? 2000),
    );
    const scope = {
      institutionName: schoolName,
      ...identity,
      disciplineCode: discipline.code,
    };
    const context = anchor === source ? [source] : [anchor, source];
    const admission = scopedAdmissionEvidence(anchor, targetYear, scope, own);
    if (!admission.scopeMatched || admission.excluded) continue;
    const run = bindingContext(targetYear, extractedAt);
    const bound = bindRecommendationEvidence(
      {
        ...scope,
        degreeType: discipline.degreeType,
        citations: [anchor.id],
        rationale: "",
        preparation: [],
        uncertainties: [],
      },
      run,
      discipline,
      context,
      targetYear,
    );
    // A campus policy can need a third page for geography. Keep the same phase-2
    // chain validator; isolated per-source tuition/exam conflicts remain preserved.
    if (
      !bound.location &&
      !programEntries(source, disciplines).length &&
      own.length > context.length
    ) {
      const key = JSON.stringify([
        bound.institutionName,
        bound.programName,
        bound.majorCode,
        bound.collegeName,
        bound.degreeType,
        bound.studyMode,
        discipline.code,
        targetYear,
      ]);
      if (locationCache?.has(key)) bound.location = locationCache.get(key);
      else {
        const chained = bindRecommendationEvidence(
          bound,
          run,
          discipline,
          own,
          targetYear,
        );
        bound.location = chained.location;
        locationCache?.set(key, chained.location);
      }
    }
    const add = (
      field: ProgramFact["field"],
      value: ProgramFact["value"],
      quote: string | undefined,
      year: number | undefined,
      status: ProgramFact["status"] = "bound",
    ) => {
      if (!quote || !source.excerpt.includes(quote)) return;
      facts.push({
        schoolName,
        registrableDomain: domain,
        ...identity,
        disciplineCode: discipline.code,
        degreeType: discipline.degreeType,
        year,
        field,
        value,
        quote,
        sourceUrl: source.url,
        sourceId: source.id,
        retrievedAt: source.retrievedAt,
        extractedAt,
        extractor: "phase2-program-binding@3",
        status,
        verified: false,
      });
    };
    if (anchor === source) {
      const quote = catalogQuote;
      add(
        "catalog",
        { exists: true },
        quote,
        safeSourceYear(source),
        safeSourceYear(source) === undefined ? "pending" : "bound",
      );
    }
    if (
      bound.exams?.sourceId === source.id &&
      ["verified_current", "historical"].includes(bound.exams.status)
    )
      add("exams", bound.exams, bound.exams.quote, bound.exams.year);
    if (bound.tuition?.sourceId === source.id)
      add("tuition", bound.tuition, bound.tuition.quote, bound.tuition.year);
    if (bound.location?.sourceId === source.id)
      add("campus", bound.location, bound.location.quote, bound.location.year);
    for (const pending of bound.pendingEvidence ?? [])
      if (
        pending.sourceId === source.id &&
        !(
          pending.field === "location" && bound.location?.sourceId === source.id
        )
      )
        add(
          pending.field === "location" ? "campus" : pending.field,
          { reason: pending.reason },
          pending.quote,
          pending.year,
          "pending",
        );
  }
  return [
    ...new Map(
      facts.map((f) => [
        JSON.stringify([
          f.schoolName,
          f.collegeName,
          f.majorCode,
          f.programName,
          f.degreeType,
          f.studyMode,
          f.year,
          f.field,
          f.quote,
        ]),
        f,
      ]),
    ).values(),
  ];
}
