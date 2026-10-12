export const RESEARCH_PRIORITY_FIELDS = [
  "cutoff",
  "admissionScore",
  "applicationAdmissionRatio",
  "admittedCount",
  "recommendationShare",
  "undergraduateAdmission",
  "crossMajorAdmission",
  "disciplineAssessment",
  "programRanking",
  "employment",
  "cityDevelopment",
] as const;
export type ResearchPriorityField = (typeof RESEARCH_PRIORITY_FIELDS)[number];
export const RESEARCH_PRIORITY_GROUPS = {
  scores: ["cutoff", "admissionScore"],
  competition: [
    "applicationAdmissionRatio",
    "admittedCount",
    "recommendationShare",
  ],
  background: ["undergraduateAdmission", "crossMajorAdmission"],
  academic: ["disciplineAssessment", "programRanking"],
  employment: ["employment", "cityDevelopment"],
} as const;
export interface ResearchTargetScore {
  total: number;
  maximum: number;
}
export interface ResearchPriorityFact {
  /** Missing only in reports saved before source-policy-v1. */
  sourceTier?: import("./research-source-tier.ts").ResearchSourceTier;
  id: string;
  schoolName: string;
  disciplineCode?: string;
  programName?: string;
  majorCode?: string;
  scope: "program" | "school";
  field: ResearchPriorityField;
  year: number;
  quote: string;
  sourceId: string;
  sourceUrl: string;
  collegeName?: string;
  /** Literal, non-personal table header/identity fragments, never model prose. */
  evidenceQuotes?: string[];
  value: {
    text: string;
    number?: number;
    maximum?: number;
    targetGap?: number;
    singleSubject?: { maximum100?: number; above100?: number };
    grade?: string;
    employmentRate?: number;
    destinations?: string;
    /** Statistical population/limits are preserved, never used as ordinary cutoff. */
    population?: string;
    applicants?: number;
    statistics?: {
      rows: number;
      examination: number;
      recommended: number;
      method: "published_roster_rows";
    };
  };
  status: "bound";
  verified: false;
}
