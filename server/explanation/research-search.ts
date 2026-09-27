import type { Discipline } from "../disciplines/types.ts";
import { researchReason } from "../../shared/research-status.ts";
import type { createWebAnswerModule, WebSource } from "./web.ts";
import { sourcePriority } from "./research-evidence.ts";

function schoolDomain(source: WebSource): string | undefined {
  const host = new URL(source.url).hostname;
  return /^[a-z0-9.-]+\.edu\.cn$/.test(host)
    ? host.split(".").slice(-3).join(".")
    : undefined;
}

function mentionedSchoolDomains(sources: WebSource[], school?: string) {
  if (!school) return [];
  return sources.flatMap((source) => {
    const text = `${source.title} ${source.excerpt}`;
    if (!text.includes(school)) return [];
    // A public search snippet can identify a domain to search. It is never
    // promoted to school evidence, and no URL is fetched from this text.
    return [...text.matchAll(/\b(?:[a-z0-9-]+\.)+edu\.cn\b/gi)].map(([host]) =>
      host.toLowerCase().split(".").slice(-3).join("."),
    );
  });
}

/** Discover schools broadly, then search their observed domains without inventing URLs. */
export async function searchResearchSources(input: {
  web: ReturnType<typeof createWebAnswerModule>;
  subjectId: string;
  disciplines: Discipline[];
  regions: string[];
  schoolHints?: ReadonlyMap<string, readonly string[]>;
  selectedSchool?: string;
  onProgress: () => Promise<void>;
}) {
  const directions = input.disciplines.slice(0, 3);
  const pools = new Map<string, WebSource[]>(
    directions.map((item) => [item.code, []]),
  );
  let searched = false;
  const limitations: string[] = [];
  for (let round = 0; round < 2; round++) {
    for (const [index, discipline] of directions.entries()) {
      const pool = pools.get(discipline.code)!;
      const ranked = () =>
        [...pool].sort(
          (a, b) =>
            sourcePriority(b, discipline) - sourcePriority(a, discipline),
        );
      const hints = input.schoolHints?.get(discipline.code) ?? [];
      const domains = round
        ? [
            ...new Set([
              ...ranked()
                .map(schoolDomain)
                .filter((host): host is string => !!host),
              ...mentionedSchoolDomains(
                pool,
                index === 0 ? input.selectedSchool || hints[0] : hints[0],
              ),
            ]),
          ].slice(0, 2)
        : [];
      const region =
        input.regions[(index + round) % input.regions.length] ?? "";
      const schoolHint =
        (!round && index === 0 ? input.selectedSchool : undefined) ||
        hints[round] ||
        hints[0];
      const question =
        !round && schoolHint
          ? `${schoolHint} 官网`
          : [
              domains.length ? "" : schoolHint || region,
              discipline.name,
              "硕士",
              round ? "培养 招生" : "",
            ]
              .filter(Boolean)
              .join(" ");
      await input.onProgress();
      const result = await input.web.answer(
        { subjectId: input.subjectId, question, search: true },
        {
          sourcesOnly: true,
          search: {
            count: 10,
            ...(domains.length ? { includeDomains: domains } : {}),
          },
        },
      );
      searched ||= result.searched;
      if (result.reason)
        limitations.push(`部分检索未完成：${researchReason(result.reason)}`);
      for (const source of result.sources) {
        if (!pool.some((item) => item.url === source.url)) pool.push(source);
      }
      await input.onProgress();
    }
  }
  const queues = directions.map((discipline) => ({
    code: discipline.code,
    sources: pools
      .get(discipline.code)!
      .sort(
        (a, b) => sourcePriority(b, discipline) - sourcePriority(a, discipline),
      ),
  }));
  const sources: WebSource[] = [];
  const sourceDirections = new Map<string, string>();
  // Round-robin keeps a popular discipline from consuming the whole evidence budget.
  while (sources.length < 12 && queues.some((queue) => queue.sources.length)) {
    for (const queue of queues) {
      if (sources.length >= 12) break;
      const source = queue.sources.shift();
      if (!source || sources.some((item) => item.url === source.url)) continue;
      const id = `research-${sources.length + 1}`;
      sources.push({ ...source, id, excerpt: source.excerpt.slice(0, 1800) });
      sourceDirections.set(id, queue.code);
    }
  }
  return { sources, sourceDirections, searched, limitations };
}
