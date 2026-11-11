import type { ResearchStudyMode } from "./research-recommendation.ts";

/** The displayed projects are the entire scope of a supplemental investigation. */
export interface ResearchSupplementScope {
  institutionName: string;
  disciplineCode: string;
  majorCode: string;
  programName: string;
  collegeName?: string;
  degreeType?: "academic" | "professional";
  studyMode?: ResearchStudyMode;
}

export interface ResearchSupplementResult {
  version: 1;
  baseGeneratedAt: string;
  outcome: "updated" | "no_change" | "no_pending_work" | "scope_unverified";
  scope: ResearchSupplementScope[];
  changes: {
    institutionName: string;
    programKey: string;
    /** One-based school ranks; null means absent from that result. */
    beforeRank: number | null;
    afterRank: number | null;
    beforeTier?: string;
    afterTier?: string;
    changedFields: string[];
  }[];
  reusedSourceCount: number;
  newSourceCount: number;
  /** Actual calls dispatched during this invocation, excluding checkpoint/cache hits. */
  newSearchCount: number;
  newReadCount: number;
  remainingTaskCount: number;
}
