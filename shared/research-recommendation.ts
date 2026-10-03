/** Evidence-backed recommendation details shared by the server, report UI and export. */
export type TuitionPeriod = "academic_year" | "program" | "semester" | "credit";
export type ResearchStudyMode = "full_time" | "part_time" | "unspecified";

export interface TuitionEvidence {
  amount: number;
  currency: "CNY";
  period: TuitionPeriod;
  year: number;
  studyMode: ResearchStudyMode;
  quote: string;
  sourceId: string;
}

export interface LocationEvidence {
  city: string;
  quote: string;
  sourceId: string;
  /** Multiple literal passages can bind a coded programme to a college, campus policy and city. */
  supportingEvidence?: {
    sourceId: string;
    quote: string;
    role: "program_college" | "campus_policy" | "campus_city";
  }[];
}

export interface RecommendationConstraintCheck {
  field: "budget" | "cities";
  status: "match" | "mismatch" | "unknown";
  reason: string;
  sourceIds: string[];
}

export interface RecommendationConstraints {
  /** Overall suitability is independent of individual budget/city checks and admission eligibility. */
  tier: "preferred" | "alternative" | "exploratory";
  tierReasons: string[];
  constraintChecks: RecommendationConstraintCheck[];
  tuition?: TuitionEvidence;
  location?: LocationEvidence;
}
