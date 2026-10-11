import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import type { Discipline } from "../disciplines/types.ts";
import { schoolRegistry } from "../schools/index.ts";
import { registrableDomain } from "./web.ts";
import { researchReason } from "../../shared/research-status.ts";
import type { createWebAnswerModule, WebSource } from "./web.ts";
import { sourcePriority } from "./research-evidence.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";
import {
  MAX_REGISTRY_NAVIGATION_READS,
  preferredCityInventoryQueries,
  type CityCandidateLead,
} from "./research-candidates.ts";
import {
  historicalReferenceYears,
  explicitAdmissionsYears,
  researchYearPriority,
  isTargetYearChange,
} from "../../shared/research-years.ts";
export { sourceHasSchoolIdentity } from "./research-school.ts";

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
  return (
    schoolRegistry.byHost(host)?.registrableDomain ??
    (/^[a-z0-9.-]+\.edu\.cn$/.test(host) ? registrableDomain(host) : undefined)
  );
}

function mentionedSchoolDomains(sources: WebSource[], school?: string) {
  if (!school) return [];
  return sources.flatMap((source) => {
    const text = `${source.title} ${source.excerpt}`;
    if (!sourceHasSchoolIdentity(source, school)) return [];
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

function hintedSchoolDomains(sources: WebSource[], school: string) {
  const seed = schoolRegistry.byName(school);
  if (seed) return [seed.registrableDomain];
  // A result for one school can mention other institutions. Prefer the school
  // identified in the title, then use its own description or an explicit URL clue.
  const related = sources.filter((source) =>
    sourceHasSchoolIdentity(source, school),
  );
  const titled = related.filter((source) => source.title.includes(school));
  return [
    ...new Set([
      ...titled.map(schoolDomain).filter((host): host is string => !!host),
      ...related.map(schoolDomain).filter((host): host is string => !!host),
      ...mentionedSchoolDomains(sources, school),
    ]),
  ].slice(0, 2);
}

function diverseSources(
  sources: WebSource[],
  discipline: Discipline,
  targetYear?: string,
) {
  const ranked = [...sources].sort((a, b) => {
    const score = (source: WebSource) =>
      sourcePriority(source, discipline) +
      (targetYear
        ? researchYearPriority(
            explicitAdmissionsYears(source.title).length === 1
              ? explicitAdmissionsYears(source.title)[0]
              : undefined,
            targetYear,
          ) *
            100 +
          (isTargetYearChange(`${source.title}\n${source.excerpt}`, targetYear)
            ? 20000
            : 0)
        : 0);
    return score(b) - score(a);
  });
  const schools = new Map<string, WebSource[]>();
  const rest: WebSource[] = [];
  for (const source of ranked) {
    const host = schoolDomain(source);
    if (!host || sourcePriority(source, discipline) < 100) rest.push(source);
    else {
      const pages = schools.get(host) ?? [];
      pages.push(source);
      schools.set(host, pages);
    }
  }
  if (targetYear)
    for (const pages of schools.values()) {
      const years = [
        ...historicalReferenceYears(targetYear),
        Number(targetYear),
      ];
      const primary: WebSource[] = pages.filter((source) =>
        isTargetYearChange(`${source.title}\n${source.excerpt}`, targetYear),
      );
      for (const year of years) {
        const page = pages.find(
          (source) =>
            !primary.includes(source) &&
            explicitAdmissionsYears(source.title).length === 1 &&
            explicitAdmissionsYears(source.title)[0] === year,
        );
        if (page) primary.push(page);
      }
      pages.splice(
        0,
        pages.length,
        ...primary,
        ...pages.filter((source) => !primary.includes(source)),
      );
    }
  const first = [...schools.values()].map((pages) => pages.shift()!);
  const fees = targetYear
    ? []
    : [...schools.values()]
        .map((pages) =>
          pages.find((source) =>
            /学费|收费(?:标准|项目)|教育收费/.test(source.title),
          ),
        )
        .filter((source): source is WebSource => !!source);
  const remaining = [...schools.values()].map((pages) =>
    pages.filter((source) => !fees.includes(source)),
  );
  const additional: WebSource[] = [];
  // A second school's useful follow-up must survive a large first school's many
  // similar pages, even when the candidate list is truncated to forty sources.
  while (remaining.some((pages) => pages.length))
    for (const pages of remaining) {
      const source = pages.shift();
      if (source) additional.push(source);
    }
  return [...first, ...fees, ...additional, ...rest];
}

/** Discover schools broadly, then search their observed domains without inventing URLs. */
export async function searchResearchSources(input: {
  web: ReturnType<typeof createWebAnswerModule>;
  subjectId: string;
  cacheOwner?: object;
  disciplines: Discipline[];
  regions: string[];
  schoolHints?: ReadonlyMap<string, readonly string[]>;
  /** City inventory is independent of model school hints. An empty array still enables city lookups. */
  candidateLeads?: readonly CityCandidateLead[];
  selectedSchool?: string;
  targetYear?: string;
  maxRequests?: number;
  maxSources?: number;
  includeFeeSearch?: boolean;
  onProgress: (detail?: string) => Promise<void>;
}) {
  const maxRequests = Math.min(
    B.searches,
    Math.max(1, input.maxRequests ?? B.feeSearches),
  );
  const maxSources = Math.min(
    B.candidates,
    Math.max(1, input.maxSources ?? B.candidates),
  );
  let cacheHits = 0,
    paidRequests = 0;
  let cache = caches.get(input.cacheOwner ?? input.web);
  if (!cache) {
    cache = new Map();
    caches.set(input.cacheOwner ?? input.web, cache);
  }
  const directions = input.disciplines.slice(0, 6);
  const referenceYears = historicalReferenceYears(input.targetYear ?? "");
  const states = directions.map((discipline, index) => ({
    discipline,
    index,
    pool: [] as WebSource[],
    hints: [
      ...new Set([
        ...(index === 0 && input.selectedSchool ? [input.selectedSchool] : []),
        ...(input.schoolHints?.get(discipline.code) ?? []),
      ]),
    ].map((name) => schoolRegistry.byName(name)?.name ?? name),
    hintIndex: 0,
    usedDomains: new Set<string>(),
    broadIndex: 0,
    attempts: 0,
  }));
  const candidateAttempts = new Set<string>();
  const inventoryAttempts = new Set<string>();
  const candidateQueries = [
    ...(input.candidateLeads === undefined
      ? []
      : [
          ...preferredCityInventoryQueries(input.regions).map((item) => ({
            question: item.question,
            city: item.city,
            state: states[0],
            domains: [] as string[],
            lead: undefined as CityCandidateLead | undefined,
          })),
          // Every demand direction gets a broad catalogue lookup before model
          // school hints can consume the remaining discovery budget.
          ...states.map((state) => ({
            question: [
              input.regions[state.index % input.regions.length],
              referenceYears[0],
              state.discipline.name,
              "硕士 招生专业目录",
            ]
              .filter(Boolean)
              .join(" "),
            city: input.regions[state.index % input.regions.length] ?? "",
            state,
            domains: [] as string[],
            lead: undefined as CityCandidateLead | undefined,
            directionOnly: true,
          })),
        ]),
    // Distinct annual queries give all three reference years a bounded
    // discovery opportunity. The target intake has its own change check.
    ...(referenceYears.length
      ? [
          ...(input.candidateLeads === undefined
            ? referenceYears
            : referenceYears.slice(1)),
          Number(input.targetYear),
        ].map((year) => ({
          question: [
            input.regions[0],
            year,
            "硕士 招生专业目录 招生章程",
            year === Number(input.targetYear) ? "专业调整 停招" : "初试科目",
          ]
            .filter(Boolean)
            .join(" "),
          city: input.regions[0] ?? "",
          state: states[0],
          domains: [] as string[],
          lead: undefined as CityCandidateLead | undefined,
          yearOnly: true,
        }))
      : []),
    ...(input.candidateLeads ?? []).map((lead) => ({
      question: [
        lead.school,
        referenceYears[0] ?? input.targetYear,
        "硕士 招生专业目录 招生章程",
      ]
        .filter(Boolean)
        .join(" "),
      city: lead.city,
      state:
        states.find((state) =>
          lead.disciplineCodes.includes(state.discipline.code),
        ) ?? states[0],
      domains: [lead.officialDomain],
      lead,
    })),
    // Leave room for observed-school followups and fee lookups after city discovery.
  ].slice(
    0,
    maxRequests > B.feeSearches ? Math.max(1, maxRequests - 8) : maxRequests,
  );
  // Official navigation URLs are public investigation leads, not read evidence.
  // They survive a search provider indexing miss and still require a safe read.
  const navigationSources: { source: WebSource; direction: string }[] = [];
  const seedLeads = [...(input.candidateLeads ?? [])];
  for (const state of states)
    for (const name of state.hints) {
      const seed = schoolRegistry.byName(name);
      if (!seed || seedLeads.some((lead) => lead.school === seed.name))
        continue;
      seedLeads.push({
        city: seed.city,
        school: seed.name,
        officialDomain: seed.registrableDomain,
        discoveryUrls: schoolRegistry.discoveryUrls(seed),
        provenanceUrl: seed.provenanceUrl ?? seed.homepage,
        checkedAt: seed.verification.checkedAt,
        disciplineCodes: [state.discipline.code],
        discoveryOnly: true,
      });
    }
  for (const lead of seedLeads) {
    if (!states[0]) continue;
    const state =
      states.find((item) =>
        lead.disciplineCodes.includes(item.discipline.code),
      ) ?? states[0];
    for (const url of lead.discoveryUrls ??
      (lead.discoveryUrl ? [lead.discoveryUrl] : [])) {
      if (navigationSources.some((item) => item.source.url === url)) continue;
      navigationSources.push({
        direction: state.discipline.code,
        source: {
          id: "candidate-navigation",
          title: `${lead.school} 硕士研究生招生专业目录查询入口`,
          url,
          excerpt: `${lead.school}官方公开招生入口，仅作为待调查线索；学校具体专业、校区、考试科目及资格仍须读取正文核验。`,
          retrievedAt: new Date().toISOString(),
          kind: "search_snippet",
          verified: false,
          retrievalNote: `公开学校发现目录；登记依据 ${lead.provenanceUrl}，检查日期 ${lead.checkedAt}。不代表已取得专业证据。`,
        },
      });
    }
  }
  let candidateQueryIndex = 0;
  let searched = false;
  const limitations: string[] = [];
  const requests = new Set<string>();
  const schoolDirections = Array.from({ length: 6 }, (_, index) =>
    states.flatMap((state) =>
      state.hints[index]
        ? [{ school: state.hints[index], state, retries: 0 }]
        : [],
    ),
  )
    .flat()
    .filter(
      (item, index, all) =>
        all.findIndex(
          (other) =>
            other.school === item.school &&
            other.state.discipline.code === item.state.discipline.code,
        ) === index,
    );
  const distinctSchools = schoolDirections.filter(
    (item, index, all) =>
      all.findIndex((other) => other.school === item.school) === index,
  );
  const maxDiscoveryHints = Math.min(
    10,
    Math.max(0, maxRequests - states.length),
  );
  const discoveryHints = [
    ...distinctSchools,
    ...schoolDirections.filter((item) => !distinctSchools.includes(item)),
  ].slice(0, maxDiscoveryHints);
  const feeBudget =
    input.includeFeeSearch === false
      ? 0
      : Math.min(B.feeSearches, Math.max(1, Math.floor(maxRequests / 4)));
  let feeHints:
    | { school?: string; state: (typeof states)[number]; domains: string[] }[]
    | undefined;
  const resolveFeeHints = () => {
    const known = discoveryHints.map((hint) => ({
      ...hint,
      domains: hintedSchoolDomains(hint.state.pool, hint.school),
      lead: hasGraduateLead(
        hint.state.pool.filter((source) =>
          sourceHasSchoolIdentity(source, hint.school),
        ),
        hint.state.discipline,
      ),
    }));
    const preferred = known.filter(
      (hint, index, all) =>
        hint.lead &&
        all.findIndex((other) => other.lead && other.school === hint.school) ===
          index,
    );
    const domains = new Set(preferred.flatMap((hint) => hint.domains));
    const observed: {
      state: (typeof states)[number];
      domains: string[];
    }[] = [];
    // An actual graduate programme on another observed school domain is a
    // stronger fee lead than an unverified model name. Search its domain without
    // inventing a school name, URL or programme fact.
    for (const state of states)
      for (const source of diverseSources(
        state.pool,
        state.discipline,
        input.targetYear,
      )) {
        const domain = schoolDomain(source);
        if (
          !domain ||
          domains.has(domain) ||
          !hasGraduateLead([source], state.discipline)
        )
          continue;
        domains.add(domain);
        observed.push({ state, domains: [domain] });
      }
    return [
      ...preferred,
      ...observed,
      ...known.filter(
        (hint) =>
          !hint.lead && !hint.domains.some((domain) => domains.has(domain)),
      ),
    ].slice(0, feeBudget);
  };
  let feeIndex = 0;
  let discoveryAttempt = 0;
  let discoverySlots = 0;
  let broadDiscovery = 0;
  const broadDiscoveryCount = Math.min(
    states.length,
    Math.max(0, maxRequests - feeBudget - discoveryHints.length),
  );
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
          ...diverseSources(pool, discipline, input.targetYear)
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
      const candidateQuery = candidateQueries[candidateQueryIndex];
      if (
        maxRequests > B.feeSearches &&
        !discoveryHints.length &&
        !candidateQuery
      )
        discoverySlots++;
      const feeTime =
        requests.size >= maxRequests - feeBudget ||
        discoverySlots >= maxRequests - feeBudget;
      if (maxRequests > B.feeSearches && feeTime && !feeHints)
        feeHints = resolveFeeHints();
      if (candidateQuery) {
        candidateQueryIndex++;
        question = candidateQuery.question;
        resultPool = candidateQuery.state.pool;
        domains = candidateQuery.domains;
        if (candidateQuery.lead)
          candidateAttempts.add(candidateQuery.lead.school);
        else if (
          !("directionOnly" in candidateQuery) &&
          !("yearOnly" in candidateQuery)
        )
          inventoryAttempts.add(candidateQuery.city);
      } else if (
        maxRequests > B.feeSearches &&
        feeTime &&
        feeHints &&
        feeIndex < feeHints.length
      ) {
        const hint = feeHints[feeIndex++];
        question = [
          hint.school ?? hint.state.discipline.name,
          referenceYears[0],
          "硕士 研究生 学费 收费标准",
        ]
          .filter(Boolean)
          .join(" ");
        resultPool = hint.state.pool;
        // These domains came from actual results for this school, never from a
        // model's memory. Fees should not be left to third-party search snippets.
        domains = hint.domains;
      } else if (maxRequests > B.feeSearches && discoveryHints.length) {
        discoverySlots++;
        if (discoveryAttempt < discoveryHints.length) {
          const hint = discoveryHints[discoveryAttempt++];
          // First establish the real master's programme independently of whether
          // the target year's directory has been indexed by the search provider.
          question = [
            hint.school,
            referenceYears[0],
            hint.state.discipline.name,
            "硕士 培养方案",
          ]
            .filter(Boolean)
            .join(" ");
          resultPool = hint.state.pool;
          domains = hintedSchoolDomains(hint.state.pool, hint.school);
        } else if (broadDiscovery < broadDiscoveryCount) {
          const discovered = states[broadDiscovery++];
          const region =
            input.regions[discovered.index % input.regions.length] ?? "";
          question = [
            region,
            discovered.discipline.name,
            "硕士",
            "招生专业目录",
          ]
            .filter(Boolean)
            .join(" ");
          resultPool = discovered.pool;
          domains = [];
        } else {
          const hint = [...discoveryHints].sort((a, b) => {
            const lead = (item: (typeof discoveryHints)[number]) =>
              hasGraduateLead(
                item.state.pool.filter((source) =>
                  sourceHasSchoolIdentity(source, item.school),
                ),
                item.state.discipline,
              );
            return a.retries - b.retries || Number(lead(a)) - Number(lead(b));
          })[0];
          const pass = hint.retries++;
          if (pass < (referenceYears.length ? 4 : 2)) {
            domains = hintedSchoolDomains(hint.state.pool, hint.school);
            const related = hint.state.pool.filter((source) =>
              sourceHasSchoolIdentity(source, hint.school),
            );
            const year = referenceYears.length
              ? ` ${[...referenceYears, Number(input.targetYear)][pass]}`
              : hasGraduateLead(related, hint.state.discipline) &&
                  /^20\d{2}$/.test(input.targetYear ?? "")
                ? ` ${input.targetYear}`
                : "";
            question = `${hint.school}${year} ${hint.state.discipline.name} 硕士 ${referenceYears.length ? "招生专业目录 招生章程" : ["招生专业目录", "专业介绍"][pass]}`;
            resultPool = hint.state.pool;
          } else {
            // Exhausted model hints must not lock out schools discovered on the
            // public web. Explore nationally and follow newly observed domains.
            const discovered =
              states[(pass + hint.state.index) % states.length];
            const nextDomain = diverseSources(
              discovered.pool,
              discovered.discipline,
              input.targetYear,
            )
              .map(schoolDomain)
              .find((host) => host && !discovered.usedDomains.has(host));
            if (nextDomain) {
              discovered.usedDomains.add(nextDomain);
              domains = [nextDomain];
              question = `${discovered.discipline.name} 硕士 招生专业目录`;
            } else {
              domains = [];
              const focus = ["培养方案", "学位授权点", "专业介绍", "招生简章"][
                discovered.broadIndex++ % 4
              ];
              question = `${discovered.discipline.code} ${discovered.discipline.name} 硕士 ${focus}`;
            }
            resultPool = discovered.pool;
          }
        }
      } else if (recoverFirstSchool) {
        question = `${state.hints[0]} ${discipline.name} 硕士 培养方案`;
        domains = hintedSchoolDomains(pool, state.hints[0]);
      } else if (broadenSchool) {
        state.hintIndex++;
        question = `${nextHint} ${discipline.name} 硕士${maxRequests > B.feeSearches ? " 招生专业目录" : ""}`;
        domains = hintedSchoolDomains(pool, nextHint);
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
      if (cached) cacheHits++;
      else paidRequests++;
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
    sources: diverseSources(pool, discipline, input.targetYear),
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
  // Direct registry navigation follows observed results; it cannot reorder their
  // citation IDs or masquerade as a provider hit when a search yields nothing.
  const bySchool = new Map<string, typeof navigationSources>();
  for (const item of navigationSources) {
    const key = registrableDomain(new URL(item.source.url).hostname);
    const group = bySchool.get(key) ?? [];
    group.push(item);
    bySchool.set(key, group);
  }
  let navigationCount = 0;
  for (
    let round = 0;
    round < navigationSources.length &&
    sources.length < maxSources &&
    navigationCount < MAX_REGISTRY_NAVIGATION_READS;
    round++
  ) {
    for (const group of bySchool.values()) {
      const item = group[round];
      if (
        !item ||
        sources.length >= maxSources ||
        navigationCount >= MAX_REGISTRY_NAVIGATION_READS ||
        sources.some((s) => s.url === item.source.url)
      )
        continue;
      const id = `research-${sources.length + 1}`;
      sources.push({ ...item.source, id });
      navigationCount++;
      sourceDirections.set(id, item.direction);
    }
  }
  return {
    sources,
    sourceDirections,
    searched,
    limitations,
    stoppedReason,
    requestCount: requests.size,
    paidRequests,
    cacheHits,
    candidateAttempts: [...candidateAttempts],
    inventoryAttempts: [...inventoryAttempts],
  };
}
