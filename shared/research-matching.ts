import type {
  RecommendationConstraints,
  ResearchStudyMode,
} from "./research-recommendation.ts";

/** Transparent preference comparisons, never an admission probability or ability score. */
export interface DemandMatchFactor {
  field: string;
  label: string;
  status: "match" | "mismatch" | "unknown" | "not_requested";
  reason: string;
  sourceIds: string[];
}
export interface DemandMatch {
  ruleVersion: "demand-match-v1";
  factors: DemandMatchFactor[];
  summary: string;
}
export interface ResearchExamEvidence {
  status: "verified_current" | "historical" | "unknown" | "ambiguous";
  year?: number;
  subjects: { code: string; name: string }[];
  quote?: string;
  sourceId?: string;
  reason: string;
}
export interface ResearchCandidateAudit {
  institutionName: string;
  status: "recommended" | "excluded" | "awaiting_evidence" | "not_selected";
  reasons: string[];
  sourceIds: string[];
}
/** Each route retains its own evidence; school identity is the only inherited field. */
export interface ResearchProgramAlternative
  extends Partial<RecommendationConstraints> {
  programName: string;
  disciplineCode: string;
  majorCode?: string;
  collegeName?: string;
  degreeType: "academic" | "professional";
  studyMode?: ResearchStudyMode;
  fitReasons?: { profileField: string; profileValue: string; reason: string }[];
  rationale?: string;
  preparation?: string[];
  tradeoffs?: string[];
  uncertainties?: string[];
  admissionStatus?: "current_evidence" | "needs_verification";
  exams: ResearchExamEvidence;
  match: DemandMatch;
  tier: "preferred" | "alternative" | "exploratory";
  citations: string[];
}
