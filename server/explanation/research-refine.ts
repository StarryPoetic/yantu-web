import type { ResearchPrefilter } from "../../shared/research-prefilter.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
import type { GuidanceRun, Discipline } from "../disciplines/types.ts";
import type { WebSource } from "./web.ts";
import { academicDomain } from "./research-pages.ts";
import { repairResearchEvidence } from "./research-repair.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";
import { collectMissingPriorityEvidence } from "./research-targeted.ts";
import { schoolRegistry } from "../schools/index.ts";
import { researchCompute } from "./research-compute.ts";

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
    queryTerms?: readonly string[];
  },
) {
  let sources = [...input.sources].filter((s) =>
    selectedResearchSource(input.prefilter, s),
  );
  let requestCount = 0,
    readCount = 0;
  let lookupKeys = [...(input.lookupKeys ?? [])];
  const limitations: string[] = [];
  const usedReads = new Map<string, number>();
  // Reserve deterministic per-school shares before starting a wave. Completion
  // timing cannot let a fast school steal another school's search/read allowance.
  const selected = input.prefilter.selected;
  const groupSize = Math.max(
    1,
    Math.ceil(selected.length / (B.searches - B.prioritySearchReserve)),
  );
  const grouped = new Map<number, ReturnType<typeof input.web.answer>>();
  let groupedRequests = 0;
  const names = input.disciplines.map((d) => d.name).join(" ");
  const years = historicalReferenceYears(input.targetYear);

  const share = (total: number, index: number) =>
    Math.floor(total / Math.max(1, selected.length)) +
    Number(index < total % Math.max(1, selected.length));
  for (let offset = 0; offset < selected.length; offset += B.concurrency) {
    input.signal?.throwIfAborted();
    const wave = selected.slice(offset, offset + B.concurrency);
    const results = await Promise.allSettled(
      wave.map(async (school, localIndex) => {
        const index = offset + localIndex;
        const own = sources.filter(
          (s) => academicDomain(s.url) === school.domain,
        );
        const seed = schoolRegistry.byHost(
          school.domain,
        )?.graduateAdmissionsUrl;
        if (seed && !own.some((s) => s.url === seed))
          own.push({
            id: `seed:${school.domain}`,
            url: seed,
            title: `${school.institutionName}研究生院招生入口`,
            kind: "search_snippet",
            verified: false,
            excerpt: "官方入口线索，不证明招生事实。",
            retrievedAt: new Date(input.now?.() ?? Date.now()).toISOString(),
          });
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
        return repairResearchEvidence({
          ...input,
          sources: own,
          priorityDocuments: true,
          searchFirst: true,
          discoveryReadLimit:
            index < B.discoveryReads ? B.schoolDiscoveryReads : 0,
          gaps,
          maxRequests: 1,
          queryForGap: (gap) => [
            `${school.institutionName} ${years[0]}年 ${names} 硕士招生专业目录`,
          ],
          web:
            groupSize === 1
              ? input.web
              : {
                  ...input.web,
                  answer(request, options) {
                    const groupIndex = Math.floor(index / groupSize);
                    let result = grouped.get(groupIndex);
                    if (!result) {
                      const group = selected.slice(
                        groupIndex * groupSize,
                        (groupIndex + 1) * groupSize,
                      );
                      groupedRequests++;
                      result = input.web.answer(
                        {
                          ...request,
                          question:
                            `${group.map((s) => s.institutionName).join(" OR ")} ${names} ${years[0]}年 硕士招生目录`.slice(
                              0,
                              600,
                            ),
                        },
                        {
                          ...options,
                          search: {
                            count: 10,
                            includeDomains: group.map((s) => s.domain),
                          },
                        },
                      );
                      grouped.set(groupIndex, result);
                    }
                    return result.then((value) => structuredClone(value));
                  },
                },
          maxReads: Math.min(3, share(B.reads, index)),
          lookupKeys,
          allowedDomains: [school.domain],
          needsEvidence: undefined,
        });
      }),
    );
    for (let index = 0; index < results.length; index++) {
      const outcome = results[index];
      if (outcome.status === "rejected") throw outcome.reason;
      const result = outcome.value;
      const school = wave[index];
      requestCount += result.requestCount;
      readCount += result.readCount;
      usedReads.set(school.domain, result.readCount);
      lookupKeys = [...new Set([...lookupKeys, ...result.lookupKeys])];
      limitations.push(...result.limitations);
      sources = [
        ...sources.filter((s) => academicDomain(s.url) !== school.domain),
        ...result.sources,
      ];
    }
  }
  if (groupSize > 1) {
    requestCount = groupedRequests;
    limitations.push(
      `全国范围${selected.length}校均纳入分组定向查询，每组最多${groupSize}校；结果仍逐校核验，搜索未返回不表示学校没有该专业。`,
    );
  }
  const inventory = await researchCompute(
    "inventory",
    {
      run: input.run,
      disciplines: input.disciplines,
      sources,
      targetYear: input.targetYear,
      schoolNames: selected.map((s) => s.institutionName),
    },
    input.signal,
  );
  const targeted = await collectMissingPriorityEvidence({
    ...input,
    selected,
    sources,
    lookupKeys,
    usedReads,
    priorityPrograms: inventory.recommendations,
    maxRequests: Math.max(
      0,
      B.searches - requestCount - B.finalGapSearchReserve,
    ),
    maxReads: B.reads - readCount,
  });
  sources = targeted.sources;
  lookupKeys = targeted.lookupKeys;
  requestCount += targeted.requestCount;
  readCount += targeted.readCount;
  limitations.push(...targeted.limitations);
  // Rebuild the programme inventory after collection, then spend the reserved
  // queries on remaining gaps before final analysis (with the same read ledger).
  if (requestCount < B.searches && readCount < B.reads) {
    const refreshed = await researchCompute(
      "inventory",
      {
        run: input.run,
        disciplines: input.disciplines,
        sources,
        targetYear: input.targetYear,
        schoolNames: selected.map((s) => s.institutionName),
      },
      input.signal,
    );
    const extra = await collectMissingPriorityEvidence({
      ...input,
      selected,
      sources,
      lookupKeys,
      usedReads: targeted.usedReads,
      schoolSearchCounts: targeted.schoolSearchCounts,
      priorityPrograms: refreshed.recommendations,
      maxRequests: B.searches - requestCount,
      maxReads: B.reads - readCount,
    });
    sources = extra.sources;
    lookupKeys = extra.lookupKeys;
    requestCount += extra.requestCount;
    readCount += extra.readCount;
    limitations.push(...extra.limitations);
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
