import type { WebSource } from "./web.ts";
import { extractProgramFacts } from "./research-facts.ts";
import {
  resolveInstitutionFromPages,
  schoolRegistrableDomain,
  sourceHasSchoolIdentity,
} from "./research-school.ts";

export interface ResearchUnstructuredSource {
  institutionName: string;
  sourceId: string;
  /** Literal text, bounded for the private report; never model-generated. */
  excerpt: string;
  truncated: boolean;
}

/** Successful reads without any bound field. Pending facts remain available for manual checking. */
export function unstructuredResearchSources(
  sources: WebSource[],
  newlyReadUrls: ReadonlySet<string>,
  generatedAt: string,
): ResearchUnstructuredSource[] {
  const seen = new Set<string>();
  const locationCache: NonNullable<Parameters<typeof extractProgramFacts>[4]> =
    new Map();
  return sources.flatMap((source) => {
    if (
      source.kind !== "official_page" ||
      !newlyReadUrls.has(source.url) ||
      seen.has(source.url)
    )
      return [];
    seen.add(source.url);
    const domain = schoolRegistrableDomain(source.url);
    const institutionName =
      domain && resolveInstitutionFromPages(domain, sources);
    if (
      !institutionName ||
      !sourceHasSchoolIdentity(source, institutionName, sources)
    )
      return [];
    if (
      extractProgramFacts(
        source,
        sources,
        generatedAt,
        undefined,
        locationCache,
      ).some((fact) => fact.status === "bound")
    )
      return [];
    return [
      {
        institutionName,
        sourceId: source.id,
        excerpt: source.excerpt.slice(0, 6000),
        truncated: source.excerpt.length > 6000,
      },
    ];
  });
}
