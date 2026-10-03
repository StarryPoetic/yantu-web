import type { Discipline } from "../disciplines/types.ts";

/** Public discovery metadata. None of these fields establishes programme facts. */
export interface CityCandidateLead {
  city: string;
  school: string;
  officialDomain: string;
  discoveryUrl?: string;
  /** Optional public geography leads; addresses still need actual safe reads. */
  locationDiscoveryUrls?: readonly string[];
  provenanceUrl: string;
  checkedAt: string;
  disciplineCodes: string[];
  discoveryOnly: true;
}

// This intentionally small registry supplements live city inventory searches;
// it is not an exhaustive city list, a programme catalog or a recommendation.
// To update a lead, check the official site and record its provenance/date.
const registry = [
  {
    city: "杭州",
    school: "杭州电子科技大学",
    officialDomain: "hdu.edu.cn",
    discoveryUrl: "https://grs.hdu.edu.cn/13497/list.htm",
    locationDiscoveryUrls: ["https://xxhzk.hdu.edu.cn/main.htm"],
    provenanceUrl: "https://grs.hdu.edu.cn/2026/0928/c13497a300811/page.htm",
    checkedAt: "2026-10-04",
  },
  {
    city: "杭州",
    school: "浙江工业大学",
    officialDomain: "zjut.edu.cn",
    provenanceUrl: "https://zs.zjut.edu.cn/jsp/",
    checkedAt: "2026-10-04",
  },
  {
    city: "杭州",
    school: "浙江理工大学",
    officialDomain: "zstu.edu.cn",
    discoveryUrl: "https://gradadmission.zstu.edu.cn/index.htm",
    provenanceUrl: "https://gradadmission.zstu.edu.cn/index.htm",
    checkedAt: "2026-10-04",
  },
  {
    city: "杭州",
    school: "浙江大学",
    officialDomain: "zju.edu.cn",
    discoveryUrl: "https://www.grs.zju.edu.cn/yjszs/main.htm",
    provenanceUrl: "https://www.zju.edu.cn/xxgk/17953/list.htm",
    checkedAt: "2026-10-04",
  },
  {
    city: "杭州",
    school: "杭州师范大学",
    officialDomain: "hznu.edu.cn",
    discoveryUrl: "https://yjs.hznu.edu.cn/yjszs/",
    provenanceUrl: "https://yjs.hznu.edu.cn/yjszs/",
    checkedAt: "2026-10-04",
  },
] as const;

export function normalizeDiscoveryCity(city: string) {
  return city.trim().replace(/市$/, "");
}

/** Stable investigation leads independent of whatever schools an LLM names. */
export function preferredCityCandidateLeads(
  cities: readonly string[],
  disciplines: readonly Discipline[],
): CityCandidateLead[] {
  const codes = [...new Set(disciplines.map((item) => item.code))].sort();
  return [...new Set(cities.map(normalizeDiscoveryCity))].flatMap((city) =>
    registry
      .filter((lead) => lead.city === city)
      .map((lead) => ({
        ...lead,
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
