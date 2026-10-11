import type { ResearchReport } from "../server/explanation/research.ts";
import type { ProgramRevision } from "../server/catalog/types.ts";

/** A private intention, never a catalogue revision or an admissions assertion. */
export interface ResearchInterest {
  interestId: string;
  jobId: string;
  recommendationIndex: number;
  targetYear: number;
  referenceYear: number | null;
  createdAt: string;
  verified: false;
  reviewStatus: "unreviewed";
  status: "pending_verification";
  recommendation: ResearchReport["recommendations"][number];
  sources: ResearchReport["sources"];
  linkedProgram: { programId: string; programRevisionId: string } | null;
  favorite: boolean;
  target: boolean;
  tasks: { title: string; completed: boolean }[];
}

export function matchResearchProgram(
  item: ResearchInterest["recommendation"],
  year: number,
  programs: ProgramRevision[],
) {
  if (
    !item.majorCode ||
    !item.collegeName ||
    !item.programName ||
    !item.degreeType ||
    !item.studyMode
  )
    return null;
  const matches = programs.filter(
    (program) =>
      !program.isExample &&
      program.publicationStatus === "published" &&
      program.reviewStatus === "approved" &&
      program.availability === "verified_current" &&
      program.identity.targetAdmissionYear === year &&
      program.display.institutionName === item.institutionName &&
      program.display.collegeName === item.collegeName &&
      program.identity.majorCode === item.majorCode &&
      program.display.majorName === item.programName &&
      program.identity.degreeType === item.degreeType &&
      program.identity.studyMode === item.studyMode,
  );
  return matches.length === 1
    ? {
        programId: matches[0].programId,
        programRevisionId: matches[0].programRevisionId,
      }
    : null;
}
