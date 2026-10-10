/** Evidence-backed recommendation details shared by the server, report UI and export. */
export type TuitionPeriod = "academic_year" | "program" | "semester" | "credit";
export type ResearchStudyMode = "full_time" | "part_time" | "unspecified";

/** Literal read evidence whose programme/year scope could not be uniquely resolved. */
export interface PendingResearchEvidence {
  field: "exams" | "tuition" | "location";
  quote: string;
  sourceId: string;
  year?: number;
  reason: string;
}

export interface RejectedResearchRecommendation {
  institutionName: string;
  programName: string;
  code: string;
  /** Zero denotes a rejected card; positive counts denote deleted sentences on a retained card. */
  removedSentences: number;
}

export interface ResearchReadStatistics {
  success: number;
  failed: number;
  failuresByCode: Record<string, number>;
}

export interface TuitionEvidence {
  amount: number;
  currency: "CNY";
  period: TuitionPeriod;
  /** Missing only for an explicitly scoped school tariff with no policy year. */
  year?: number;
  studyMode: ResearchStudyMode;
  scope?: "school_wide" | "school_wide_mode" | "school_degree_type";
  quote: string;
  sourceId: string;
}

export interface LocationEvidence {
  city: string;
  /** Explicit cohort year; earlier years describe reference arrangements, not target-year proof. */
  year?: number;
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
  pendingEvidence?: PendingResearchEvidence[];
}
