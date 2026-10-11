import { RESEARCH_TARGET_SCHOOLS } from "../../shared/research-policy.ts";
/** Phase 5 single source of truth; docs/tests verify these exported values. */
export const RESEARCH_BUDGET = {
  prefilterSchools: 240,
  prefilterCitySchools: 15,
  searchDailyRequestsPerUser: 180,
  searchDailyRequestsGlobal: 900,
  collectionTargetMs: 300000,
  finalReserveMs: 150000,
  collectionPages: 180,
  collectionSummaryCalls: 36,
  collectionConcurrency: 4,
  priorityReadsPerTurn: 3,
  collectionInputChars: 12000,
  collectionOutputTokens: 2048,
  defaultResearchTotalTimeoutMs: 600000,
  finalSchools: RESEARCH_TARGET_SCHOOLS,
  reads: 180,
  schoolReads: 16,
  schoolDiscoveryReads: 1,
  discoveryReads: 8,
  platformReads: 4,
  concurrency: 8,
  initialReads: 120,
  cityReads: 24,
  geographyReads: 2,
  searches: 72,
  prioritySearchReserve: 48,
  initialSearches: 54,
  feeSearches: 18,
  repairSearches: 4,
  candidates: 240,
  librarySourcesPerSchool: 8,
  modelSources: 40,
  attachments: 72,
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
  pageRetryTimeoutMs: 10000,
  pageRetries: 8,
  normalTimeoutMs: 30000,
  thinkingIdleTimeoutMs: 45000,
  thinkingTimeoutMs: 300000,
  researchTotalTimeoutMs: 1800000,
  planningOutputTokens: 4096,
  finalOutputTokens: 16384,
  userDailyTokens: 4000000,
  globalDailyTokens: 12000000,
} as const;

export const RESEARCH_FLASH_ENABLED = true;

export function researchReservation() {
  const planning =
    RESEARCH_BUDGET.normalChars + RESEARCH_BUDGET.planningOutputTokens;
  const final =
    RESEARCH_BUDGET.thinkingChars + RESEARCH_BUDGET.finalOutputTokens;
  const collection =
    (RESEARCH_BUDGET.collectionPages +
      RESEARCH_BUDGET.collectionSummaryCalls +
      2) *
    (RESEARCH_BUDGET.collectionInputChars +
      RESEARCH_BUDGET.collectionOutputTokens);
  return {
    collection,
    planning,
    final,
    required: collection + 2 * planning + 3 * final,
    withCoverage: collection + 2 * planning + 4 * final,
  };
}
