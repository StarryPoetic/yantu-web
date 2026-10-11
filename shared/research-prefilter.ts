export interface PrefilterScore {
  dimension:
    | "program"
    | "score"
    | "undergraduate"
    | "city"
    | "constraints"
    | "national";
  points: number;
  reasons: string[];
}

export interface PrefilterSchoolResult {
  institutionName: string;
  key: string;
  domain: string;
  city: string;
  feasibility?: {
    basis: "evidence" | "estimate";
    risk: "lower" | "unknown" | "high";
    reason: string;
  };
  score: number;
  scores: PrefilterScore[];
  excludedReasons: string[];
}

export interface ResearchPrefilter {
  version: "local-prefilter-v1";
  candidateCount: number;
  cities: string[];
  selected: PrefilterSchoolResult[];
  omitted: (PrefilterSchoolResult & { reason: string })[];
  limitations: string[];
}
