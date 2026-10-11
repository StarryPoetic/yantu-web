import type { ResearchPrefilter } from "../../shared/research-prefilter.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
import type { GuidanceRun, Discipline } from "../disciplines/types.ts";
import type { WebSource } from "./web.ts";
import { academicDomain } from "./research-pages.ts";
import { buildEvidenceCandidates } from "./research-matching.ts";
import { repairResearchEvidence } from "./research-repair.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";

export function selectedResearchSource(
  prefilter: ResearchPrefilter,
  source: WebSource,
) {
  return prefilter.selected.some(
    (s) => s.domain === academicDomain(source.url),
  );
}

/** Search and read interleaved in score order, sharing the original total budgets. */
export async function refineResearchSchools(
  input: Omit<
    Parameters<typeof repairResearchEvidence>[0],
    "gaps" | "maxRequests" | "maxReads"
  > & {
    prefilter: ResearchPrefilter;
    run: GuidanceRun;
    disciplines: Discipline[];
  },
) {
  let sources = [...input.sources].filter((s) =>
    selectedResearchSource(input.prefilter, s),
  );
  let requestCount = 0,
    readCount = 0;
  let lookupKeys = [...(input.lookupKeys ?? [])];
  const limitations: string[] = [];
  const cache = new Map<
    string,
    {
      signature: string;
      recommendations: ReturnType<
        typeof buildEvidenceCandidates
      >["recommendations"];
    }
  >();
  const counts = (
    current: readonly WebSource[],
    school: ResearchPrefilter["selected"][number],
  ) => {
    const own = current.filter((s) => academicDomain(s.url) === school.domain);
    // Run-local only. Exact source content and metadata changes invalidate the result;
    // unchanged large catalogues need not be parsed after every other school's read.
    const signature = JSON.stringify(own);
    const previous = cache.get(school.key);
    if (previous?.signature === signature) return previous.recommendations;
    const recommendations = buildEvidenceCandidates({
      run: input.run,
      disciplines: input.disciplines,
      targetYear: input.targetYear,
      sources: own,
      schoolNames: [school.institutionName],
    }).recommendations.filter(
      (r) =>
        school.institutionName === r.institutionName &&
        !(
          r.tuition?.year === Number(input.targetYear) &&
          r.constraintChecks?.some(
            (c) => c.field === "budget" && c.status === "mismatch",
          )
        ),
    );
    cache.set(school.key, { signature, recommendations });
    return recommendations;
  };
  const enough = (current: readonly WebSource[]) =>
    input.prefilter.selected.filter((s) => counts(current, s).length > 0)
      .length >= B.finalSchools;
  for (const school of input.prefilter.selected) {
    input.signal?.throwIfAborted();
    if (enough(sources) || readCount >= B.reads) break;
    const own = sources.filter((s) => academicDomain(s.url) === school.domain);
    const sufficient = (current: readonly WebSource[]) =>
      counts(current, school).some(
        (r) =>
          r.institutionName === school.institutionName &&
          r.tuition &&
          r.location &&
          r.exams?.status !== "unknown" &&
          !!r.exams,
      );
    if (sufficient(own)) continue;
    const gaps: ResearchEvidenceGap[] = (
      ["program", "exams", "location", "tuition"] as const
    ).map((field) => ({
      id: `prefilter:${school.key}:${field}`,
      institutionName: school.institutionName,
      programName: input.disciplines[0]?.name,
      disciplineCode: input.disciplines[0]?.code,
      field,
      targetYear: input.targetYear,
      referenceYears: historicalReferenceYears(input.targetYear),
      purpose: "missing_evidence",
      reason: "粗筛入选，按既有证据补充缺项",
      nextAction: "核对目标方向目录、科目、城市与学费",
      sourceIds: [],
      references: [],
      priority: field === "program" ? "high" : "normal",
      attempts: [],
    }));
    const result = await repairResearchEvidence({
      ...input,
      sources: own,
      gaps,
      maxRequests: Math.min(1, B.searches - requestCount),
      maxReads: Math.min(B.schoolReads, B.reads - readCount),
      lookupKeys,
      allowedDomains: [school.domain],
      stop: sufficient,
      needsEvidence: undefined,
    });
    requestCount += result.requestCount;
    readCount += result.readCount;
    lookupKeys = result.lookupKeys;
    limitations.push(...result.limitations);
    sources = [
      ...sources.filter((s) => academicDomain(s.url) !== school.domain),
      ...result.sources,
    ];
  }
  return {
    sources,
    requestCount,
    readCount,
    lookupKeys,
    limitations,
    searched: sources.length > 0 || requestCount > 0,
    paidRequests: requestCount,
    cacheHits: 0,
    stoppedReason: undefined as string | undefined,
    sourceDirections: new Map(
      sources.map((s) => [
        s.id,
        input.disciplines.find(
          (d) => s.excerpt.includes(d.code) || s.excerpt.includes(d.name),
        )?.code ??
          input.disciplines[0]?.code ??
          "",
      ]),
    ),
  };
}
