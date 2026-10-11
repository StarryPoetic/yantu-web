/** Phase 5 single source of truth; docs/tests verify these exported values. */
export const RESEARCH_BUDGET = {
  reads: 60,
  schoolReads: 8,
  platformReads: 4,
  concurrency: 4,
  initialReads: 40,
  cityReads: 8,
  geographyReads: 2,
  searches: 24,
  initialSearches: 18,
  feeSearches: 6,
  repairSearches: 4,
  candidates: 80,
  librarySourcesPerSchool: 8,
  modelSources: 40,
  attachments: 24,
  attachmentLinks: 12,
  attachmentDepth: 3,
  registryReads: 6,
  cityCandidates: 12,
  pendingPerField: 2,
  thinkingChars: 40000,
  normalChars: 16000,
  repairHeadroom: 2000,
  requestBytes: 131072,
  pageTimeoutMs: 8000,
  normalTimeoutMs: 30000,
  thinkingIdleTimeoutMs: 45000,
  thinkingTimeoutMs: 300000,
  researchTotalTimeoutMs: 1800000,
  planningOutputTokens: 4096,
  finalOutputTokens: 16384,
  userDailyTokens: 300000,
  globalDailyTokens: 900000,
} as const;

export function researchReservation() {
  const planning =
    RESEARCH_BUDGET.normalChars + RESEARCH_BUDGET.planningOutputTokens;
  const final =
    RESEARCH_BUDGET.thinkingChars + RESEARCH_BUDGET.finalOutputTokens;
  return {
    planning,
    final,
    required: 2 * planning + 3 * final,
    withCoverage: 2 * planning + 4 * final,
  };
}
