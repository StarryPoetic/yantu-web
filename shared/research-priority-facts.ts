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
  value: {
    text: string;
    number?: number;
    maximum?: number;
    targetGap?: number;
  };
  status: "bound";
  verified: false;
}
