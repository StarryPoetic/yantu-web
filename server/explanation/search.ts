import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { ModelError } from "./deepseek.ts";
import { isIP } from "node:net";

export type SearchProvider = "bocha" | "brave";
/** Internal research controls; never copied from browser request bodies. */
export interface SearchOptions {
  includeDomains?: string[];
  count?: number;
}

export function validateSearchOptions(options: SearchOptions = {}): {
  count: number;
  includeDomains: string[];
} {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !["includeDomains", "count"].includes(key),
    )
  )
    throw new ModelError("SEARCH_OPTIONS_INVALID");
  const count = options.count === undefined ? 5 : options.count;
  if (!Number.isSafeInteger(count) || count < 1 || count > 10)
    throw new ModelError("SEARCH_OPTIONS_INVALID");
  const domains = options.includeDomains;
  if (
    domains !== undefined &&
    (!Array.isArray(domains) || !domains.length || domains.length > 10)
  )
    throw new ModelError("SEARCH_OPTIONS_INVALID");
  const includeDomains = (domains ?? []).map((value) => {
    if (typeof value !== "string")
      throw new ModelError("SEARCH_OPTIONS_INVALID");
    const domain = value.trim().toLowerCase();
    const labels = domain.split(".");
    if (
      domain.length > 253 ||
      labels.length < 2 ||
      isIP(domain) ||
      !/^[a-z]{2,63}$/.test(labels.at(-1)!) ||
      labels.some(
        (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
      ) ||
      /\.(?:localhost|local|internal|invalid|test)$/.test(domain) ||
      /^(?:edu|com|org|net|gov|ac)\.cn$/.test(domain) ||
      /^(?:co|org|ac|gov)\.uk$/.test(domain)
    )
      throw new ModelError("SEARCH_OPTIONS_INVALID");
    return domain;
  });
  return { count, includeDomains: [...new Set(includeDomains)] };
}

export interface SearchConfig {
  searchEnabled?: boolean;
  /** Direct module callers retain Brave compatibility; the application selects Bocha explicitly. */
  searchProvider?: SearchProvider;
  searchKey?: string;
  searchDailyRequestsPerUser?: number;
  searchDailyRequestsGlobal?: number;
  searchBudget?: SearchBudget;
}
export interface SearchBudget {
  claim(subjectId: string, day: string): boolean;
}
export function searchConfigFromEnvironment(
  env: Record<string, string | undefined>,
): SearchConfig {
  const provider = env.YANTU_SEARCH_PROVIDER?.trim() || "bocha";
  if (provider !== "bocha" && provider !== "brave")
    throw new ModelError("SEARCH_PROVIDER_INVALID");
  return {
    searchEnabled: env.YANTU_SEARCH_ENABLED === "true",
    searchProvider: provider,
    searchKey:
      (provider === "bocha"
        ? env.BOCHA_API_KEY
        : env.BRAVE_SEARCH_API_KEY
      )?.trim() || undefined,
    searchDailyRequestsPerUser: alignedSearchLimit(
      Number(
        env.YANTU_SEARCH_USER_DAILY_REQUESTS ?? B.searchDailyRequestsPerUser,
      ),
    ),
    searchDailyRequestsGlobal: alignedSearchLimit(
      Number(env.YANTU_SEARCH_DAILY_REQUESTS ?? B.searchDailyRequestsGlobal),
    ),
  };
}

/** A positive deployment allowance must support one configured research run.
 * Zero still disables spending; invalid values still fail validation. */
export function alignedSearchLimit(value: number) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.max(B.searches, value)
    : value;
}

/** Reserve before sending; failed requests may still be billed and clearing chat does not refund them. */
export function createSearchBudget(config: SearchConfig = {}): SearchBudget {
  const userLimit =
    config.searchDailyRequestsPerUser ?? B.searchDailyRequestsPerUser;
  const globalLimit =
    config.searchDailyRequestsGlobal ?? B.searchDailyRequestsGlobal;
  if (
    [userLimit, globalLimit].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new ModelError("INVALID_BUDGET_CONFIG");
  const counts = new Map<string, number>();
  let date = "",
    total = 0;
  return {
    claim(subjectId, day) {
      if (day !== date) {
        date = day;
        total = 0;
        counts.clear();
      }
      const count = counts.get(subjectId) ?? 0;
      if (count >= userLimit || total >= globalLimit) return false;
      counts.set(subjectId, count + 1);
      total++;
      return true;
    },
  };
}

export function searchRequest(
  provider: SearchProvider,
  key: string,
  query: string,
  options: SearchOptions = {},
): {
  url: string;
  options: {
    method: "GET" | "POST";
    allowedHosts: string[];
    headers: Record<string, string>;
    body?: string;
    maxBytes: number;
  };
} {
  const { count, includeDomains } = validateSearchOptions(options);
  if (provider === "bocha")
    return {
      url: "https://api.bocha.cn/v1/web-search",
      options: {
        method: "POST" as const,
        allowedHosts: ["api.bocha.cn"],
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query,
          freshness: "noLimit",
          summary: true,
          count,
          ...(includeDomains.length
            ? { include: includeDomains.join("|") }
            : {}),
        }),
        maxBytes: 100000,
      },
    };
  if (provider !== "brave") throw new ModelError("SEARCH_PROVIDER_INVALID");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  const domainQuery = includeDomains
    .map((domain) => `site:${domain}`)
    .join(" OR ");
  url.searchParams.set("q", domainQuery ? `${query} (${domainQuery})` : query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("safesearch", "strict");
  url.searchParams.set("search_lang", "zh-hans");
  return {
    url: url.href,
    options: {
      method: "GET" as const,
      allowedHosts: ["api.search.brave.com"],
      headers: { "X-Subscription-Token": key, Accept: "application/json" },
      maxBytes: 100000,
    },
  };
}

export interface SearchHit {
  title: string;
  url: string;
  excerpt: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function normalizeSearchResponse(
  provider: SearchProvider,
  raw: string,
  options: SearchOptions = {},
): SearchHit[] {
  const { count, includeDomains } = validateSearchOptions(options);
  let response: unknown;
  try {
    response = JSON.parse(raw);
  } catch {
    throw new ModelError("SEARCH_INVALID_RESPONSE");
  }
  if (!record(response)) throw new ModelError("SEARCH_INVALID_RESPONSE");
  let items: unknown;
  if (provider === "bocha") {
    if (response.code !== 200 && response.code !== "200")
      throw new ModelError("SEARCH_PROVIDER_ERROR");
    const data = response.data;
    items =
      record(data) && record(data.webPages) ? data.webPages.value : undefined;
  } else if (provider === "brave") {
    items = record(response.web) ? response.web.results : undefined;
  } else throw new ModelError("SEARCH_PROVIDER_INVALID");
  if (!Array.isArray(items)) throw new ModelError("SEARCH_INVALID_RESPONSE");
  return items.slice(0, count).flatMap((item) => {
    if (!record(item)) return [];
    if (includeDomains.length) {
      try {
        const host = new URL(String(item.url)).hostname;
        if (
          !includeDomains.some(
            (domain) => host === domain || host.endsWith(`.${domain}`),
          )
        )
          return [];
      } catch {
        return [];
      }
    }
    const title = provider === "bocha" ? item.name : item.title;
    const excerpt =
      provider === "bocha"
        ? typeof item.summary === "string" && item.summary.trim()
          ? item.summary
          : item.snippet
        : item.description;
    return typeof item.url === "string" &&
      typeof title === "string" &&
      typeof excerpt === "string"
      ? [{ title, url: item.url, excerpt }]
      : [];
  });
}
