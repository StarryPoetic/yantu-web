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

function hasGraduateLead(sources: WebSource[], discipline: Discipline) {
  return sources.some((source) => {
    const text = `${source.title} ${source.excerpt}`;
    return (
      !!schoolDomain(source) &&
      /硕士|研究生(?:培养|招生|专业)/.test(text) &&
      (text.includes(discipline.name) || text.includes(discipline.code)) &&
      !/本科|拟录取|录取名单|博士(?:招生|专业|目录)/.test(source.title)
    );
  });
}

function diverseSources(sources: WebSource[], discipline: Discipline) {
  const ranked = [...sources].sort(
    (a, b) => sourcePriority(b, discipline) - sourcePriority(a, discipline),
  );
  const seen = new Set<string>();
  const first: WebSource[] = [];
  const rest: WebSource[] = [];
  for (const source of ranked) {
    const host = schoolDomain(source);
    if (!host || seen.has(host)) rest.push(source);
    else {
      seen.add(host);
      first.push(source);
    }
  }
  return [...first, ...rest];
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
  const states = directions.map((discipline, index) => ({
    discipline,
    index,
    pool: [] as WebSource[],
    hints: [
      ...new Set([
        ...(index === 0 && input.selectedSchool ? [input.selectedSchool] : []),
        ...(input.schoolHints?.get(discipline.code) ?? []),
      ]),
    ],
    hintIndex: 0,
    usedDomains: new Set<string>(),
    broadIndex: 0,
    attempts: 0,
  }));
  let searched = false;
  const limitations: string[] = [];
  const requests = new Set<string>();
  // A global ceiling lets one or two directions use the remaining discovery
  // slots without raising the six-request budget or repeating failed queries.
  while (requests.size < 6 && states.length) {
    for (const state of states) {
      if (requests.size >= 6) break;
      const { discipline, pool } = state;
      const availableDomains = [
        ...new Set([
          ...diverseSources(pool, discipline)
            .map(schoolDomain)
            .filter((host): host is string => !!host),
          ...state.hints.flatMap((hint) => mentionedSchoolDomains(pool, hint)),
        ]),
      ].filter((domain) => !state.usedDomains.has(domain));
      const nextHint = state.hints[state.hintIndex];
      const broadenSchool =
        !!nextHint &&
        (!state.attempts ||
          hasGraduateLead(pool, discipline) ||
          !availableDomains.length);
      const domains = broadenSchool ? [] : availableDomains.slice(0, 2);
      let question: string;
      if (broadenSchool) {
        state.hintIndex++;
        question = `${nextHint} ${discipline.name} 硕士`;
      } else if (domains.length) {
        domains.forEach((domain) => state.usedDomains.add(domain));
        question = `${discipline.name} 硕士 培养 招生`;
      } else {
        const index = state.broadIndex++;
        const region =
          input.regions[(state.index + index) % input.regions.length] ?? "";
        const focus = [
          "",
          "招生专业目录",
          "培养方案",
          "硕士点",
          "专业介绍",
          "招生简章",
        ][index % 6];
        question = [region, discipline.name, "硕士", focus]
          .filter(Boolean)
          .join(" ");
      }
      const key = JSON.stringify([question, [...domains].sort()]);
      if (requests.has(key)) continue;
      requests.add(key);
      state.attempts++;
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
  const queues = states.map(({ discipline, pool }) => ({
    code: discipline.code,
    sources: diverseSources(pool, discipline),
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
