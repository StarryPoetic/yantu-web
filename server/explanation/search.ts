import { ModelError } from "./deepseek.ts";

export type SearchProvider = "bocha" | "brave";
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
    searchDailyRequestsPerUser: Number(
      env.YANTU_SEARCH_USER_DAILY_REQUESTS ?? 10,
    ),
    searchDailyRequestsGlobal: Number(env.YANTU_SEARCH_DAILY_REQUESTS ?? 100),
  };
}

/** Reserve before sending; failed requests may still be billed and clearing chat does not refund them. */
export function createSearchBudget(config: SearchConfig = {}): SearchBudget {
  const userLimit = config.searchDailyRequestsPerUser ?? 10;
  const globalLimit = config.searchDailyRequestsGlobal ?? 100;
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
          count: 5,
        }),
        maxBytes: 100000,
      },
    };
  if (provider !== "brave") throw new ModelError("SEARCH_PROVIDER_INVALID");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
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
): SearchHit[] {
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
  return items.slice(0, 5).flatMap((item) => {
    if (!record(item)) return [];
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
