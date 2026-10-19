export interface ResearchSchoolPolicy {
  version: "schools-4-to-5-v1" | "legacy-ten" | "legacy-five-to-ten";
  minimum: 4 | 5 | 10;
  target: 5 | 10;
  maximum: 5 | 10;
}

/** Display quantity is independent of discovery scope and evidence sufficiency. */
export const RESEARCH_SCHOOL_POLICY: Readonly<ResearchSchoolPolicy> =
  Object.freeze({
    version: "schools-4-to-5-v1",
    minimum: 4,
    target: 5,
    maximum: 5,
  });
export const RESEARCH_TARGET_SCHOOLS = RESEARCH_SCHOOL_POLICY.target;

/** Only use this for a saved job/report. Absence of a snapshot means legacy. */
export function savedResearchSchoolPolicy(saved: {
  schoolPolicy?: ResearchSchoolPolicy;
  coverage?: { targetMin: number; targetMax: number };
  prefilter?: unknown;
}): ResearchSchoolPolicy {
  if (saved.schoolPolicy) return { ...saved.schoolPolicy };
  const ten = saved.coverage
    ? saved.coverage.targetMin === 10
    : !!saved.prefilter;
  return {
    version: ten ? "legacy-ten" : "legacy-five-to-ten",
    minimum: ten ? 10 : 5,
    target: 10,
    maximum: 10,
  };
}

export function researchSchoolRange(policy: ResearchSchoolPolicy) {
  return policy.minimum === policy.maximum
    ? String(policy.maximum)
    : `${policy.minimum}–${policy.maximum}`;
}
