import type { ResearchSupplementResult } from "../../shared/research-supplement.ts";
import type { GuidanceRun, Discipline } from "../disciplines/types.ts";
import type { ResearchReport } from "./research.ts";
import {
  createSupplementPlan,
  matchesSupplementScope,
  supplementProgramKey,
  type ResearchSupplementPlan,
  type ResearchSupplementState,
} from "./research-supplement-plan.ts";
import { repairResearchEvidence } from "./research-repair.ts";
import { researchCompute } from "./research-compute.ts";
import { rankDemandCandidates } from "./research-matching.ts";
import {
  extractPriorityFacts,
  preferredPriorityFacts,
  priorityCoverage,
} from "./research-priority-facts.ts";
import { academicDomain } from "./research-pages.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import type { WebSource } from "./web.ts";

export function supplementResult(
  plan: ResearchSupplementPlan,
  outcome: ResearchSupplementResult["outcome"],
): ResearchSupplementResult {
  return {
    version: 1,
    baseGeneratedAt: plan.baseGeneratedAt,
    outcome,
    scope: structuredClone(plan.scope),
    changes: [],
    reusedSourceCount: 0,
    newSourceCount: 0,
    newSearchCount: 0,
    newReadCount: 0,
    remainingTaskCount: 0,
  };
}

type RepairInput = Parameters<typeof repairResearchEvidence>[0];
type Recommendation = ResearchReport["recommendations"][number];
const routes = (report: ResearchReport) =>
  report.recommendations.flatMap(({ programAlternatives, ...main }) => [
    main,
    ...(programAlternatives ?? []).map((route) => ({
      ...route,
      institutionName: main.institutionName,
    })),
  ]);
const semanticFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(semanticFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "id",
            "sourceId",
            "sourceIds",
            "citations",
            "retrievedAt",
            "storedAt",
            "expiresAt",
            "attempts",
            "missing",
          ].includes(key),
      )
      .map(([key, item]) => [key, semanticFields(item)]),
  );
};
const fingerprint = (value: unknown) => JSON.stringify(semanticFields(value));

/** Supplemental IO has no entry into prefilter, collector model, expansion or final model paths. */
export async function executeSupplement(
  input: Pick<
    RepairInput,
    | "subjectId"
    | "signal"
    | "web"
    | "readPage"
    | "onSource"
    | "onAttempt"
    | "onProgress"
    | "now"
  > & {
    state: ResearchSupplementState;
    report: ResearchReport;
    run: GuidanceRun;
    disciplines: Discipline[];
    targetYear: string;
    attempts: NonNullable<RepairInput["attempts"]>;
    lookupKeys: string[];
    persist: () => Promise<void>;
    counts: () => { searches: number; reads: number };
  },
) {
  const { state, report, run, disciplines, targetYear, signal } = input;
  const { plan, baseReport: base } = state;
  state.merged = false;
  await input.persist();
  const schools = [...new Set(plan.scope.map((s) => s.institutionName))];
  const inScope = (item: Partial<Recommendation>) =>
    plan.scope.some((scope) => matchesSupplementScope(item, scope));
  // Preserve citation identities in an unchanged report, even if a reread uses canonical evidence IDs.
  const stableSources = (sources: readonly WebSource[]) => {
    const ids = new Map(
      sources.map((source) => [
        source.id,
        base.sources.find((old) => old.url === source.url)?.id ?? source.id,
      ]),
    );
    return sources.map((source) => ({
      ...source,
      id: ids.get(source.id)!,
      ...(source.parentSourceId
        ? {
            parentSourceId:
              ids.get(source.parentSourceId) ?? source.parentSourceId,
          }
        : {}),
      ...(source.provenance
        ? {
            provenance: {
              ...source.provenance,
              parentSourceId:
                ids.get(source.provenance.parentSourceId) ??
                source.provenance.parentSourceId,
            },
          }
        : {}),
    }));
  };
  let sources = stableSources(report.sources);
  let lookupKeys = [...input.lookupKeys];
  const attempts = [...input.attempts];
  const limitations: string[] = [];
  const snapshot = async (current: WebSource[]) => {
    const inventory = await researchCompute(
      "inventory",
      {
        run,
        disciplines,
        sources: current,
        targetYear,
        schoolNamesOnly: true,
        schoolNames: schools,
      },
      signal,
    );
    const recommendations = inventory.recommendations.filter(inScope);
    const coverage = await researchCompute(
      "coverage",
      {
        run,
        disciplines,
        sources: current,
        recommendations: [
          ...routes(base),
          ...recommendations,
        ] as Recommendation[],
        candidateAudit: inventory.audit,
        schoolNames: schools,
        targetYear,
        attempts,
      },
      signal,
    );
    for (const candidate of coverage.candidates)
      if (candidate.coverage) {
        candidate.coverage.programs =
          candidate.coverage.programs.filter(inScope);
        candidate.coverage.missing = candidate.coverage.programs.flatMap(
          (p) => p.missing,
        );
      }
    const programs = coverage.candidates.flatMap(
      (c) => c.coverage?.programs ?? [],
    );
    const facts = current.flatMap((s) =>
      extractPriorityFacts(s, disciplines, targetYear, base.targetScore),
    );
    facts.push(
      ...(base.priorityFacts ?? []).filter((fact) =>
        current.some(
          (source) =>
            source.id === fact.sourceId && source.excerpt.includes(fact.quote),
        ),
      ),
    );
    const priorityFacts = [
      ...new Map(
        plan.scope
          .flatMap((scope) => preferredPriorityFacts(facts, scope))
          .map((f) => [f.id, f]),
      ).values(),
    ];
    return { inventory, recommendations, coverage, programs, priorityFacts };
  };
  const before = await snapshot(base.sources);
  let current = await snapshot(sources);
  const pending = () =>
    state.plan.tasks.filter((t) => !state.completedTaskIds.includes(t.id));
  await input.onProgress(
    `复用原报告${base.sources.length}份来源；仅补查${schools.length}所学校已展示项目的记录缺项`,
  );
  for (const task of pending()) {
    signal?.throwIfAborted();
    const counts = input.counts();
    if (counts.searches >= B.searches || counts.reads >= B.reads) {
      limitations.push(
        "本次达到现有搜索或读取预算，未执行任务保留在原补查计划中。",
      );
      break;
    }
    const project = plan.scope.find(
      (scope) => supplementProgramKey(scope) === task.programKey,
    )!;
    const currentProgram = current.programs.find((program) =>
      matchesSupplementScope(program, project),
    );
    const stillNeeded =
      !currentProgram ||
      createSupplementPlan(
        {
          ...base,
          priorityFacts: current.priorityFacts,
          evidenceCoverage: {
            ...base.evidenceCoverage!,
            gaps: current.programs.flatMap((p) => p.missing),
          },
        },
        disciplines,
      ).tasks.some((item) => item.id === task.id);
    if (!stillNeeded) {
      state.completedTaskIds.push(task.id);
      await input.onProgress(
        `已复用现有依据，跳过${task.gap.institutionName}${task.gap.programName ?? ""}已解决缺项`,
      );
      await input.persist();
      continue;
    }
    const domains = [
      ...new Set(
        sources
          .filter((source) =>
            sourceHasSchoolIdentity(source, task.gap.institutionName),
          )
          .map((source) => academicDomain(source.url)),
      ),
    ].filter(Boolean);
    const readAllowance = Math.min(B.schoolReads, B.reads - counts.reads);
    const repaired = await repairResearchEvidence({
      ...input,
      gaps: [task.gap],
      sources,
      targetYear,
      maxRequests: 1,
      maxReads: readAllowance,
      lookupKeys,
      attempts,
      ...(domains.length ? { allowedDomains: domains } : {}),
      priorityDocuments: task.kind === "priority",
      queryForGap: () => [task.query],
      onSource: async (source) => {
        signal?.throwIfAborted();
        await input.onSource?.(source);
        sources = stableSources([
          ...sources.filter((old) => old.url !== source.url),
          source,
        ]);
        report.sources = sources;
        state.workingSources = sources;
        await input.persist();
      },
      onAttempt: (attempt) => {
        attempts.push(attempt);
        input.onAttempt?.(attempt);
      },
    });
    sources = stableSources(repaired.sources);
    report.sources = sources;
    state.workingSources = sources;
    lookupKeys = repaired.searchFailures ? lookupKeys : repaired.lookupKeys;
    limitations.push(...repaired.limitations);
    // Interrupted/limited work is not marked exhausted; completed empty searches are recorded.
    state.failedTaskIds ??= [];
    const failed =
      repaired.attempts.some((attempt) => attempt.status === "failed") ||
      repaired.searchFailures > 0;
    if (failed && !state.failedTaskIds.includes(task.id))
      state.failedTaskIds.push(task.id);
    else if (repaired.attempts.some((attempt) => attempt.status === "success"))
      state.failedTaskIds = state.failedTaskIds.filter((id) => id !== task.id);
    if (
      !failed &&
      !state.failedTaskIds.includes(task.id) &&
      !repaired.stoppedReason &&
      repaired.readCount < readAllowance &&
      !repaired.pendingReadUrls.length
    )
      state.completedTaskIds.push(task.id);
    current = await snapshot(sources);
    await input.persist();
    if (repaired.stoppedReason) break;
  }
  signal?.throwIfAborted();
  const changed = new Map<string, string[]>();
  for (const scope of plan.scope) {
    const old = before.programs.find((p) => matchesSupplementScope(p, scope));
    const next = current.programs.find((p) => matchesSupplementScope(p, scope));
    const fields = [
      ...new Set([
        ...Object.keys(old?.fields ?? {}),
        ...Object.keys(next?.fields ?? {}),
      ]),
    ].filter(
      (field) =>
        fingerprint(old?.fields[field as keyof typeof old.fields]) !==
        fingerprint(next?.fields[field as keyof typeof next.fields]),
    );
    const oldFacts = before.priorityFacts.filter(
      (f) => preferredPriorityFacts([f], scope).length,
    );
    const nextFacts = current.priorityFacts.filter(
      (f) => preferredPriorityFacts([f], scope).length,
    );
    if (fingerprint(oldFacts) !== fingerprint(nextFacts))
      fields.push("priorityFacts");
    if (fields.length) changed.set(supplementProgramKey(scope), fields);
  }
  const summary = supplementResult(
    plan,
    changed.size ? "updated" : "no_change",
  );
  summary.reusedSourceCount = base.sources.length;
  summary.newSourceCount = sources.filter(
    (s) =>
      s.kind === "official_page" &&
      !base.sources.some(
        (old) => old.url === s.url && old.excerpt === s.excerpt,
      ),
  ).length;
  summary.newSearchCount = input.counts().searches;
  summary.newReadCount = input.counts().reads;
  summary.remainingTaskCount = pending().length;
  const result = structuredClone(base);
  result.supplement = summary;
  result.usage = report.usage;
  result.readStatistics = {
    success: report.usage?.reads.success ?? 0,
    failed: report.usage?.reads.failed ?? 0,
    failuresByCode: report.usage?.reads.failuresByCode ?? {},
  };
  result.limitations = [...new Set([...base.limitations, ...limitations])];
  if (changed.size) {
    const oldRoutes = routes(base);
    const candidates = plan.scope.flatMap((scope) => {
      const old = oldRoutes.find((item) => matchesSupplementScope(item, scope));
      if (!old) return [];
      if (!changed.has(supplementProgramKey(scope)))
        return [old as Recommendation];
      const next = current.recommendations.find((item) =>
        matchesSupplementScope(item, scope),
      );
      const program = current.programs.find((item) =>
        matchesSupplementScope(item, scope),
      );
      if (
        program &&
        Object.values(program.fields).some(
          (field) => field.status === "excluded",
        )
      )
        return [];
      // An extraction miss is not an exclusion. Invalidate prior prose while retaining the project.
      return next
        ? [
            {
              ...next,
              rationale: `${next.rationale} 本次补查已更新相关依据；原说明已按当前原文重新核对。`,
            },
          ]
        : [
            {
              ...old,
              rationale:
                "本次取得新资料，但尚未将变化完整绑定到此项目；原匹配说明需重新评估。",
              fitReasons: [],
              tradeoffs: [],
              preparation: [],
              uncertainties: [
                "保留原项目作为待核验对照；当前资料不足以重新确认原匹配结论。",
              ],
              admissionStatus: "needs_verification" as const,
            } as Recommendation,
          ];
    });
    result.recommendations = rankDemandCandidates(
      candidates.map((candidate) => ({
        ...candidate,
        rationale: candidate.rationale ?? "保留已展示项目，匹配说明待核验。",
        preparation: candidate.preparation ?? [],
        uncertainties: candidate.uncertainties ?? [],
      })),
      run,
      disciplines,
      sources,
      targetYear,
      schools.length,
    );
    result.recommendations = result.recommendations.map((item) => {
      const schoolChanged = plan.scope.some(
        (scope) =>
          scope.institutionName === item.institutionName &&
          changed.has(supplementProgramKey(scope)),
      );
      if (!schoolChanged)
        return structuredClone(
          base.recommendations.find(
            (old) => old.institutionName === item.institutionName,
          ) ?? item,
        );
      const key = supplementProgramKey(item);
      const old = oldRoutes.find(
        (route) => supplementProgramKey(route) === key,
      );
      const alternatives = item.programAlternatives?.map((route) => {
        const routeKey = supplementProgramKey({
          ...route,
          institutionName: item.institutionName,
        });
        const prior = oldRoutes.find(
          (value) => supplementProgramKey(value) === routeKey,
        );
        if (!changed.has(routeKey) && prior) {
          const { institutionName: _school, ...originalRoute } =
            structuredClone(prior);
          return originalRoute as typeof route;
        }
        return route;
      });
      return {
        ...item,
        ...(!changed.has(key) && old ? structuredClone(old) : {}),
        programAlternatives: alternatives,
      } as Recommendation;
    });
    result.sources = sources;
    result.candidateAudit = current.coverage.candidates;
    result.priorityFacts = current.priorityFacts;
    if (base.priorityCoverage)
      result.priorityCoverage = priorityCoverage(
        current.priorityFacts,
        result.recommendations,
        targetYear,
      );
    result.generatedAt = new Date(input.now?.() ?? Date.now()).toISOString();
    result.status = "partial";
    delete result.failureStage;
    delete result.reason;
    delete result.validationIssues;
    result.summary = `已在原报告${schools.length}所学校的项目范围内更新依据，当前保留${result.recommendations.length}所；缺少公开原文的字段继续待补。`;
    // Old model prose can contain superseded facts. Updated reports expose only the current rule-bound facts.
    result.facts = current.priorityFacts.map((f) => ({
      text: f.value.text,
      citations: [f.sourceId],
      year: f.year,
    }));
    if (result.coverage)
      result.coverage = {
        ...result.coverage,
        schoolCount: result.recommendations.length,
        preferredCount: result.recommendations.filter(
          (r) => r.tier === "preferred",
        ).length,
        alternativeCount: result.recommendations.filter(
          (r) => r.tier === "alternative",
        ).length,
        exploratoryCount: result.recommendations.filter(
          (r) => r.tier === "exploratory",
        ).length,
        shortfallReasons:
          result.recommendations.length < result.coverage.targetMin
            ? ["仅在原报告项目范围内更新；停招或资格冲突不以其他学校补位。"]
            : [],
      };
  }
  // Attempts and lookup outcomes are operational records, never new admissions conclusions.
  if (result.evidenceCoverage)
    result.evidenceCoverage = {
      ...result.evidenceCoverage,
      ...(changed.size
        ? {
            gaps: current.programs.flatMap((p) => p.missing),
            programCount: current.programs.length,
            supportedProgramCount: current.programs.filter((p) =>
              ["supported_current", "supported_reference"].includes(
                p.fields.program.status,
              ),
            ).length,
            pendingProgramCount: current.programs.filter((p) =>
              p.missing.some((g) => g.purpose !== "target_year_check"),
            ).length,
          }
        : {}),
      mode: "supplement",
      reusedSourceCount: summary.reusedSourceCount,
      supplementedSourceCount: summary.newSourceCount,
      lookupKeys,
      attempts: attempts.slice(-240),
    };
  const newRoutes = routes(result);
  for (const scope of plan.scope) {
    const beforeRank =
      base.recommendations.findIndex(
        (r) => r.institutionName === scope.institutionName,
      ) + 1;
    const afterRank =
      result.recommendations.findIndex(
        (r) => r.institutionName === scope.institutionName,
      ) + 1;
    const old = routes(base).find((r) => matchesSupplementScope(r, scope));
    const next = newRoutes.find((r) => matchesSupplementScope(r, scope));
    const fields = [...(changed.get(supplementProgramKey(scope)) ?? [])];
    if (!!old !== !!next) fields.push("eligibility");
    if (beforeRank !== afterRank || old?.tier !== next?.tier)
      fields.push("ranking");
    if (fields.length)
      summary.changes.push({
        institutionName: scope.institutionName,
        programKey: supplementProgramKey(scope),
        programName: scope.programName,
        majorCode: scope.majorCode,
        beforeRank: old ? beforeRank || null : null,
        afterRank: next ? afterRank || null : null,
        beforeTier: old?.tier,
        afterTier: next?.tier,
        changedFields: [...new Set(fields)],
      });
  }
  state.merged = true;
  return result;
}
