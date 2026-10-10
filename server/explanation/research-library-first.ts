import type { ProgramFact } from "./research-facts.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
import type { WebSource } from "./web.ts";
import {
  researchSchoolPriorities,
  type ResearchSchoolPreferences,
} from "./research-school-priority.ts";

const fields = {
  program: "catalog",
  exams: "exams",
  location: "campus",
  tuition: "tuition",
} as const;

/** A fact only suppresses a lookup for its exact identity and fresh explicit target year. */
export function libraryMissingGaps(
  gaps: readonly ResearchEvidenceGap[],
  facts: readonly ProgramFact[],
  sources?: readonly WebSource[],
  preferences?: ResearchSchoolPreferences,
) {
  const priority = researchSchoolPriorities(preferences);
  const sourceIds = sources && new Set(sources.map((s) => s.id));
  return gaps
    .filter((gap) => {
      const field = fields[gap.field as keyof typeof fields];
      if (!field || gap.purpose === "resolve_ambiguity") return true;
      return !facts.some(
        (f) =>
          f.field === field &&
          f.schoolName === gap.institutionName &&
          f.targetYearApplicable &&
          (!sourceIds ||
            (sourceIds.has(f.sourceId) &&
              (!("supportingEvidence" in f.value) ||
                f.value.supportingEvidence?.every((e) =>
                  sourceIds.has(e.sourceId),
                )))) &&
          (!gap.disciplineCode || f.disciplineCode === gap.disciplineCode) &&
          (!gap.programName || f.programName === gap.programName) &&
          (!gap.majorCode || f.majorCode === gap.majorCode) &&
          (!gap.collegeName || f.collegeName === gap.collegeName) &&
          (!gap.studyMode || f.studyMode === gap.studyMode),
      );
    })
    .sort(
      (a, b) =>
        priority.priority(a.institutionName) -
        priority.priority(b.institutionName),
    );
}
