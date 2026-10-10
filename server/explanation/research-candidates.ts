import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { schoolRegistry } from "../schools/index.ts";
import { normalizeCityName } from "../../shared/cities.ts";
import type { Discipline } from "../disciplines/types.ts";

/** Public discovery metadata. None of these fields establishes programme facts. */
export interface CityCandidateLead {
  city: string;
  school: string;
  officialDomain: string;
  discoveryUrl?: string;
  discoveryUrls?: readonly string[];
  cityMatch?: "main" | "campus_hint";
  /** Optional public geography leads; addresses still need actual safe reads. */
  locationDiscoveryUrls?: readonly string[];
  provenanceUrl: string;
  checkedAt: string;
  disciplineCodes: string[];
  discoveryOnly: true;
}

export const MAX_CITY_CANDIDATE_LEADS = B.cityCandidates;
export const MAX_REGISTRY_NAVIGATION_READS = B.registryReads;

export function normalizeDiscoveryCity(city: string) {
  return normalizeCityName(city);
}

/** Stable investigation leads independent of whatever schools an LLM names. */
export function preferredCityCandidateLeads(
  cities: readonly string[],
  disciplines: readonly Discipline[],
): CityCandidateLead[] {
  const codes = [...new Set(disciplines.map((item) => item.code))].sort();
  return [...new Set(cities.map(normalizeDiscoveryCity))].flatMap((city) =>
    schoolRegistry
      .byCity(city)
      .sort(
        (a, b) =>
          Number(b.school.tags.includes("双一流")) -
            Number(a.school.tags.includes("双一流")) ||
          a.school.name.localeCompare(b.school.name, "zh-CN"),
      )
      .slice(0, MAX_CITY_CANDIDATE_LEADS)
      .map(({ school, cityMatch }) => ({
        city,
        cityMatch,
        school: school.name,
        officialDomain: school.registrableDomain,
        discoveryUrl: schoolRegistry.discoveryUrls(school)[0],
        discoveryUrls: schoolRegistry.discoveryUrls(school),
        locationDiscoveryUrls: school.locationDiscoveryUrls?.filter(
          (url) => school.verification.urls?.[url] !== false,
        ),
        provenanceUrl: school.provenanceUrl ?? school.homepage,
        checkedAt: school.verification.checkedAt,
        disciplineCodes: codes,
        discoveryOnly: true,
      })),
  );
}

/** All cities get a live inventory lookup, even when no registry seed exists. */
export function preferredCityInventoryQueries(cities: readonly string[]) {
  return [...new Set(cities.map(normalizeDiscoveryCity))]
    .filter((city) => city.length >= 2)
    .map((city) => ({
      city,
      question: `${city} 硕士研究生 招生单位 招生专业目录`,
    }));
}
