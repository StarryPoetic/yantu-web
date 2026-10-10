import type { ProgramFact } from "./research-facts.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";

const identity = (fact: ProgramFact) =>
  JSON.stringify([
    fact.schoolName,
    fact.collegeName ?? "",
    fact.majorCode,
    fact.programName,
    fact.degreeType,
    fact.studyMode ?? "",
    fact.field,
  ]);

/** Input pruning only. Never mutates or removes facts from the public library. */
export function selectModelFacts(
  facts: readonly ProgramFact[],
  disciplineCodes: readonly string[],
  targetYear: string,
) {
  const groups = new Map<string, ProgramFact[]>();
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!disciplineCodes.includes(fact.disciplineCode)) continue;
    const key = identity(fact);
    const semanticValue = Object.fromEntries(
      Object.entries(fact.value).filter(
        ([name]) => !["sourceId", "quote", "supportingEvidence"].includes(name),
      ),
    );
    const duplicate = JSON.stringify([
      key,
      fact.year,
      fact.status,
      semanticValue,
      fact.status === "pending" ? fact.quote : undefined,
    ]);
    if (seen.has(duplicate)) continue;
    seen.add(duplicate);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  const rank = (fact: ProgramFact) =>
    fact.year === Number(targetYear) ? 10000 : (fact.year ?? 0);
  const selected: ProgramFact[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) => rank(b) - rank(a) || a.sourceId.localeCompare(b.sourceId),
    );
    const bound = group.filter((fact) => fact.status === "bound");
    const applicable = bound.filter(
      (fact) =>
        fact.targetYearApplicable ||
        fact.year === Number(targetYear) ||
        fact.year ===
          Math.max(
            ...bound
              .filter(
                (f) => f.year !== undefined && f.year <= Number(targetYear),
              )
              .map((f) => f.year!),
          ),
    );
    const newestBound = Math.max(...applicable.map((fact) => fact.year ?? 0));
    selected.push(
      ...bound,
      ...group
        .filter(
          (fact) =>
            fact.status === "pending" &&
            (!applicable.length || (fact.year ?? 0) > newestBound),
        )
        .slice(0, B.pendingPerField),
    );
  }
  return selected
    .sort(
      (a, b) =>
        Number(a.status === "pending") - Number(b.status === "pending") ||
        rank(b) - rank(a) ||
        identity(a).localeCompare(identity(b)),
    )
    .map((fact) => ({
      schoolName: fact.schoolName,
      registrableDomain: fact.registrableDomain,
      collegeName: fact.collegeName,
      majorCode: fact.majorCode,
      programName: fact.programName,
      disciplineCode: fact.disciplineCode,
      degreeType: fact.degreeType,
      studyMode: fact.studyMode,
      year: fact.year,
      field: fact.field,
      value: {
        ...fact.value,
        ...("quote" in fact.value
          ? { quote: fact.value.quote?.slice(0, 240) }
          : {}),
        ...("supportingEvidence" in fact.value
          ? {
              supportingEvidence: fact.value.supportingEvidence?.map((ref) => ({
                ...ref,
                quote: ref.quote.slice(0, 240),
              })),
            }
          : {}),
      },
      sourceUrl: fact.sourceUrl,
      sourceId: fact.sourceId,
      status: fact.status,
      verified: fact.verified,
      quote: fact.quote.slice(0, 240),
      confirmation:
        fact.status === "pending"
          ? "待确认：不能作为已绑定专业事实"
          : "已绑定公开原文，未经人工审核",
      scopeNote:
        fact.field === "tuition" && "scope" in fact.value
          ? fact.value.scope
          : fact.field === "campus"
            ? "仅城市级核验，具体校区待确认"
            : "保留value内适用范围，不能扩大为专业级事实",
    }));
}
