import { createHash } from "node:crypto";
import type { repairResearchEvidence } from "./research-repair.ts";
import { publicEvidenceId } from "./research-repair.ts";
import type { Discipline } from "../disciplines/types.ts";
import type { ResearchPriorityField } from "../../shared/research-priority-facts.ts";
import { researchExternalPolicy } from "./research-source-policy.ts";
import {
  extractPriorityFacts,
  preferredPriorityFacts,
} from "./research-priority-facts.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { webPageText, type WebSource } from "./web.ts";
import { schoolRegistry } from "../schools/index.ts";
import {
  externalPagePriority,
  externalSearchHosts,
} from "./research-external-ranking.ts";
import { publicExternalText } from "./research-external-text.ts";

type Program = {
  institutionName: string;
  disciplineCode: string;
  majorCode?: string;
  programName?: string;
  collegeName?: string;
};
/** The official collection precedes this pass; authority turns precede commercial reference turns. */
export async function collectExternalEvidence(
  input: Omit<Parameters<typeof repairResearchEvidence>[0], "gaps"> & {
    disciplines: Discipline[];
    programs: Program[];
    usedReads: Map<string, number>;
  },
) {
  const sources = [...input.sources],
    keys = new Set(input.lookupKeys ?? []);
  const usedReads = new Map(input.usedReads);
  const limitations: string[] = [];
  let requestCount = 0,
    readCount = 0;
  const schools = [
    ...new Map(input.programs.map((r) => [r.institutionName, r])).values(),
  ];
  const tasks: {
    tier: "authority" | "reference";
    fields: ResearchPriorityField[];
    terms: string;
  }[] = [
    {
      tier: "authority",
      fields: ["disciplineAssessment"],
      terms: "第四轮学科评估 结果",
    },
    {
      tier: "authority",
      fields: ["cutoff"],
      terms: `${Number(input.targetYear) - 1}年 硕士研究生 复试分数线`,
    },
    {
      tier: "authority",
      fields: [
        "applicationAdmissionRatio",
        "undergraduateAdmission",
        "crossMajorAdmission",
        "employment",
      ],
      terms: "研究生 报录比 生源质量 就业质量",
    },
    {
      tier: "reference",
      fields: ["applicationAdmissionRatio"],
      terms: "研究生 报录比",
    },
    {
      tier: "reference",
      fields: ["undergraduateAdmission", "crossMajorAdmission"],
      terms: "研究生 双非 跨专业 录取统计",
    },
    {
      tier: "reference",
      fields: ["employment"],
      terms: "硕士毕业生 就业去向 就业率",
    },
    {
      tier: "reference",
      fields: ["cutoff"],
      terms: `${Number(input.targetYear) - 1}年 硕士研究生 复试分数线`,
    },
  ];
  const attempted = new Set<string>();
  const factCache = new WeakMap<
    WebSource,
    ReturnType<typeof extractPriorityFacts>
  >();
  const factsFor = (s: WebSource) => {
    let facts = factCache.get(s);
    if (!facts) {
      facts = extractPriorityFacts(s, input.disciplines, input.targetYear);
      factCache.set(s, facts);
    }
    return facts;
  };
  for (const task of tasks)
    for (const program of schools) {
      input.signal?.throwIfAborted();
      if (requestCount >= input.maxRequests || readCount >= input.maxReads)
        break;
      const domain = schoolRegistry.byName(
        program.institutionName,
      )?.registrableDomain;
      if (!domain || (usedReads.get(domain) ?? 0) >= B.schoolReads) continue;
      const facts = sources.flatMap(factsFor);
      const sameSchool = input.programs.filter(
        (p) => p.institutionName === program.institutionName,
      );
      if (
        sameSchool.every((candidate) =>
          task.fields.every((f) =>
            preferredPriorityFacts(facts, candidate).some(
              (v) =>
                v.field === f &&
                (f !== "cutoff" || v.year === +input.targetYear - 1),
            ),
          ),
        )
      )
        continue;
      const hosts = externalSearchHosts(task.tier, task.fields);
      const assessmentDiscipline = task.fields.includes("disciplineAssessment")
        ? (input.disciplines.find((d) => d.degreeType === "academic") ??
          input.disciplines.find((d) => d.code === program.disciplineCode))
        : undefined;
      const subject = task.fields.includes("disciplineAssessment")
        ? (input.disciplines.find((d) => d.degreeType === "academic")?.name ??
          program.programName)
        : task.fields.includes("cutoff") ||
            task.fields.includes("applicationAdmissionRatio")
          ? [
              ...new Set(
                sameSchool.map(
                  (p) =>
                    `${p.majorCode ?? p.disciplineCode} ${p.programName ?? input.disciplines.find((d) => d.code === p.disciplineCode)?.name ?? ""}`,
                ),
              ),
            ]
              .join(" OR ")
              .slice(0, 200)
          : "";
      // The evaluator publishes one nationwide matrix per discipline. Search it
      // once and share its literal rows; do not repeat a school-filtered query.
      const question = assessmentDiscipline
        ? `${assessmentDiscipline.code} ${assessmentDiscipline.name} ${task.terms}`
        : `${program.institutionName} ${subject ?? ""} ${task.terms}`;
      const key = createHash("sha256")
        .update(JSON.stringify([question, hosts]))
        .digest("hex");
      if (keys.has(key)) continue;
      keys.add(key);
      await input.onProgress(
        `补查${program.institutionName}${task.tier === "authority" ? "权威官方" : "非官方参考"}资料`,
      );
      requestCount++;
      const found = await input.web.answer(
        { subjectId: input.subjectId, question, search: true },
        { sourcesOnly: true, search: { count: 10, includeDomains: hosts } },
      );
      if (found.reason)
        limitations.push(
          `${program.institutionName}${task.tier}补查：${found.reason}`,
        );
      if (found.reason === "SEARCH_BUDGET_EXHAUSTED")
        return {
          sources,
          lookupKeys: [...keys],
          requestCount,
          readCount,
          usedReads,
          limitations,
        };
      let turnReads = 0;
      const candidates = found.sources
        .map((source, index) => ({
          source,
          index,
          score: externalPagePriority(
            source,
            program.institutionName,
            assessmentDiscipline
              ? [
                  {
                    disciplineCode: assessmentDiscipline.code,
                    programName: assessmentDiscipline.name,
                  },
                ]
              : sameSchool,
            task.fields,
            input.targetYear,
          ),
        }))
        .filter((v) => v.score >= 0)
        .sort((a, b) => b.score - a.score || a.index - b.index);
      for (const { source: foundSource } of candidates) {
        const candidate = {
          ...foundSource,
          id: publicEvidenceId(foundSource.url),
        };
        if (turnReads >= B.priorityReadsPerTurn) break;
        if (
          readCount >= input.maxReads ||
          (usedReads.get(domain) ?? 0) >= B.schoolReads
        )
          break;
        const policy = researchExternalPolicy(candidate.url);
        if (
          !policy ||
          policy.tier !== task.tier ||
          attempted.has(candidate.url) ||
          sources.some(
            (s) => s.url === candidate.url && s.kind !== "search_snippet",
          )
        )
          continue;
        if (!sources.some((s) => s.url === candidate.url))
          sources.push(candidate);
        attempted.add(candidate.url);
        readCount++;
        turnReads++;
        usedReads.set(domain, (usedReads.get(domain) ?? 0) + 1);
        try {
          const page = await input.readPage(candidate.url);
          const finalPolicy = researchExternalPolicy(
            page.finalUrl ?? candidate.url,
          );
          if (finalPolicy?.tier !== task.tier)
            throw new Error("SOURCE_POLICY_REDIRECT");
          const text = publicExternalText(webPageText(page.text));
          const source: WebSource = {
            ...candidate,
            sourceTier: policy.tier,
            kind:
              policy.tier === "authority" ? "authority_page" : "reference_page",
            excerpt: text,
            finalUrl: page.finalUrl,
            verified: false,
            retrievedAt: new Date(input.now?.() ?? Date.now()).toISOString(),
          };
          sources.splice(
            sources.findIndex((s) => s.url === candidate.url),
            1,
            source,
          );
          await input.onSource?.(source);
          input.onAttempt?.({
            url: candidate.url,
            status: "success",
            attemptedAt: source.retrievedAt,
          });
        } catch (error) {
          input.signal?.throwIfAborted();
          const reason =
            (error as { code?: string }).code ?? "EXTERNAL_READ_FAILED";
          limitations.push(`${program.institutionName}补充来源读取：${reason}`);
          input.onAttempt?.({
            url: candidate.url,
            status: "failed",
            reason,
            attemptedAt: new Date(input.now?.() ?? Date.now()).toISOString(),
          });
        }
      }
    }
  return {
    sources,
    lookupKeys: [...keys],
    requestCount,
    readCount,
    usedReads,
    limitations,
  };
}
