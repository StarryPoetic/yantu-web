import type { ResearchStudyMode } from "./research-recommendation.ts";

/** Document coverage is independent of preference matching and admission eligibility. */
export type ResearchEvidenceField =
  | "program"
  | "exams"
  | "location"
  | "tuition"
  | "eligibility"
  | "curriculum";

export type ResearchEvidenceStatus =
  | "supported_current"
  | "supported_reference"
  | "missing"
  | "ambiguous"
  | "not_applicable"
  | "excluded";

export interface ResearchEvidenceReference {
  sourceId: string;
  /** A literal passage from this source, never words inherited from its parent. */
  quote: string;
  year?: number;
}

export interface ResearchReadAttempt {
  url: string;
  status: "success" | "failed";
  reason?: string;
  attemptedAt: string;
}

export interface ResearchCoverageField {
  status: ResearchEvidenceStatus;
  reason: string;
  sourceIds: string[];
  references: ResearchEvidenceReference[];
  year?: number;
}

export interface ResearchEvidenceGap {
  /** Stable across report regeneration and source order; identifies one scoped field/year task. */
  id: string;
  institutionName: string;
  programIdentity?: string;
  programName?: string;
  majorCode?: string;
  disciplineCode?: string;
  collegeName?: string;
  studyMode?: ResearchStudyMode;
  field: ResearchEvidenceField;
  targetYear: string;
  referenceYears: number[];
  requestedYear?: number;
  purpose: "missing_evidence" | "target_year_check" | "resolve_ambiguity";
  reason: string;
  nextAction: string;
  sourceIds: string[];
  references: ResearchEvidenceReference[];
  priority: "high" | "normal" | "low";
  attempts: ResearchReadAttempt[];
}

export interface ResearchProgramCoverage {
  identity: string;
  institutionName: string;
  programName: string;
  majorCode?: string;
  disciplineCode: string;
  collegeName?: string;
  studyMode?: ResearchStudyMode;
  degreeType?: "academic" | "professional";
  referenceYear?: number;
  sourceIds: string[];
  fields: Record<ResearchEvidenceField, ResearchCoverageField>;
  missing: ResearchEvidenceGap[];
}

export interface ResearchCandidateCoverage {
  programs: ResearchProgramCoverage[];
  /** Includes school-level directory gaps and the independent gaps of every programme. */
  missing: ResearchEvidenceGap[];
}

export interface ResearchCoverageSummary {
  schoolCount: number;
  programCount: number;
  /** Programmes with a dated, applicable official programme passage. Other fields can be missing. */
  supportedProgramCount: number;
  /** Programmes with substantive missing or ambiguous fields, excluding routine target-year checks. */
  pendingProgramCount: number;
}

export const RESEARCH_EVIDENCE_FIELDS: readonly ResearchEvidenceField[] = [
  "program",
  "exams",
  "location",
  "tuition",
  "eligibility",
  "curriculum",
];
