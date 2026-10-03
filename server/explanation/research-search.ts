import type { Discipline } from "../disciplines/types.ts";
import { researchReason } from "../../shared/research-status.ts";
import type { createWebAnswerModule, WebSource } from "./web.ts";
import { sourcePriority } from "./research-evidence.ts";

// Only public query results are cached. No profile, account or model output is retained here.
const caches = new WeakMap<
  object,
  Map<
    string,
    {
      expires: number;
      value: Awaited<
        ReturnType<ReturnType<typeof createWebAnswerModule>["answer"]>
      >;
    }
  >
>();

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
    if (!host || seen.has(host) || sourcePriority(source, discipline) < 100)
      rest.push(source);
    else {
      seen.add(host);
      first.push(source);
    }
  }
  const fees = rest.filter(
    (source) =>
      /学费|收费标准/.test(source.title) &&
      sourcePriority(source, discipline) >= 100,
  );
  return [
    ...first,
    ...fees,
    ...rest.filter((source) => !fees.includes(source)),
  ];
}

/** Discover schools broadly, then search their observed domains without inventing URLs. */
export async function searchResearchSources(input: {
  web: ReturnType<typeof createWebAnswerModule>;
  subjectId: string;
  disciplines: Discipline[];
  regions: string[];
  schoolHints?: ReadonlyMap<string, readonly string[]>;
  selectedSchool?: string;
  targetYear?: string;
  maxRequests?: number;
  maxSources?: number;
  onProgress: (detail?: string) => Promise<void>;
}) {
  const maxRequests = Math.min(24, Math.max(1, input.maxRequests ?? 6));
  const maxSources = Math.min(40, Math.max(1, input.maxSources ?? 12));
  let cache = caches.get(input.web);
  if (!cache) {
    cache = new Map();
    caches.set(input.web, cache);
  }
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
  const discoveryHints = Array.from({ length: 6 }, (_, index) =>
    states.flatMap((state) =>
      state.hints[index] ? [{ school: state.hints[index], state }] : [],
    ),
  )
    .flat()
    .filter(
      (item, index, all) =>
        all.findIndex((other) => other.school === item.school) === index,
    )
    .slice(0, 10);
  const feeHints = discoveryHints.slice(0, 6);
  let feeIndex = 0;
  let discoveryAttempt = 0;
  let iterations = 0;
  let stoppedReason: string | undefined;
  // Discovery and fee lookups share one ceiling; duplicate queries cannot spin forever.
  while (
    requests.size < maxRequests &&
    states.length &&
    iterations++ < maxRequests * 3 &&
    !stoppedReason
  ) {
    for (const state of states) {
      if (requests.size >= maxRequests || stoppedReason) break;
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
      const recoverFirstSchool =
        state.attempts === 1 && !pool.length && state.hintIndex === 1;
      const broadenSchool =
        !recoverFirstSchool &&
        !!nextHint &&
        (!state.attempts ||
          hasGraduateLead(pool, discipline) ||
          !availableDomains.length);
      let domains =
        broadenSchool || recoverFirstSchool ? [] : availableDomains.slice(0, 2);
      let question: string;
      let resultPool = pool;
      if (
        maxRequests > 6 &&
        requests.size >= maxRequests - feeHints.length &&
        feeIndex < feeHints.length
      ) {
        const hint = feeHints[feeIndex++];
        question = `${hint.school} 硕士 研究生 学费 收费标准`;
        resultPool = hint.state.pool;
        domains = [];
      } else if (maxRequests > 6 && discoveryHints.length) {
        // Spend discovery slots across distinct schools before revisiting a popular one.
        const attempt = discoveryAttempt++;
        const hint = discoveryHints[attempt % discoveryHints.length];
        const pass = Math.floor(attempt / discoveryHints.length);
        const firstPass = pass === 0;
        const related = hint.state.pool.filter((source) =>
          `${source.title} ${source.excerpt}`.includes(hint.school),
        );
        domains = firstPass
          ? []
          : [
              ...new Set([
                ...related
                  .map(schoolDomain)
                  .filter((host): host is string => !!host),
                ...mentionedSchoolDomains(hint.state.pool, hint.school),
              ]),
            ].slice(0, 2);
        const year =
          firstPass && /^20\d{2}$/.test(input.targetYear ?? "")
            ? ` ${input.targetYear}`
            : "";
        question = `${hint.school}${year} ${hint.state.discipline.name} 硕士 ${firstPass ? "招生专业目录" : pass === 1 ? "研究生培养 专业介绍" : "学位授权点 招生计划"}`;
        resultPool = hint.state.pool;
      } else if (recoverFirstSchool) {
        question = `${state.hints[0]} ${discipline.name} 硕士 培养方案`;
      } else if (broadenSchool) {
        state.hintIndex++;
        question = `${nextHint} ${discipline.name} 硕士${maxRequests > 6 ? " 招生专业目录" : ""}`;
      } else if (domains.length) {
        domains.forEach((domain) => state.usedDomains.add(domain));
        question = `${discipline.name} 硕士 培养 招生`;
      } else {
        const index = state.broadIndex++;
        // Also explore outside preferred cities for explicitly labelled alternatives.
        const region =
          index >= input.regions.length * 2
            ? ""
            : (input.regions[(state.index + index) % input.regions.length] ??
              "");
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
      await input.onProgress(
        `正在检索学校及费用资料：第 ${requests.size}/${maxRequests} 次`,
      );
      const saved = cache.get(key);
      const cached =
        saved && saved.expires > Date.now() ? saved.value : undefined;
      const result = cached
        ? structuredClone(cached)
        : await input.web.answer(
            { subjectId: input.subjectId, question, search: true },
            {
              sourcesOnly: true,
              upgradeAcademicHttp: true,
              search: {
                count: 10,
                ...(domains.length ? { includeDomains: domains } : {}),
              },
            },
          );
      if (
        !cached &&
        result.searched &&
        result.sources.length &&
        !result.reason
      ) {
        if (cache.size >= 240) cache.delete(cache.keys().next().value!);
        cache.set(key, {
          expires: Date.now() + 15 * 60000,
          value: structuredClone(result),
        });
      }
      searched ||= result.searched;
      if (result.reason)
        limitations.push(`部分检索未完成：${researchReason(result.reason)}`);
      if (
        [
          "SEARCH_BUDGET_EXHAUSTED",
          "SEARCH_NOT_CONFIGURED",
          "SEARCH_DISABLED",
          "SEARCH_PROVIDER_ERROR",
        ].includes(result.reason ?? "")
      )
        stoppedReason = result.reason;
      for (const source of result.sources) {
        if (!resultPool.some((item) => item.url === source.url))
          resultPool.push(source);
      }
      await input.onProgress(
        `${cached ? "已复用近期公开检索资料" : "已取得检索结果"}（${requests.size}/${maxRequests}），正在整理院校线索`,
      );
    }
  }
  const queues = states.map(({ discipline, pool }) => ({
    code: discipline.code,
    sources: diverseSources(pool, discipline),
  }));
  const sources: WebSource[] = [];
  const sourceDirections = new Map<string, string>();
  // Round-robin keeps a popular discipline from consuming the whole evidence budget.
  while (
    sources.length < maxSources &&
    queues.some((queue) => queue.sources.length)
  ) {
    for (const queue of queues) {
      if (sources.length >= maxSources) break;
      const source = queue.sources.shift();
      if (!source || sources.some((item) => item.url === source.url)) continue;
      const id = `research-${sources.length + 1}`;
      sources.push({ ...source, id, excerpt: source.excerpt.slice(0, 1800) });
      sourceDirections.set(id, queue.code);
    }
  }
  return {
    sources,
    sourceDirections,
    searched,
    limitations,
    stoppedReason,
    requestCount: requests.size,
  };
}
