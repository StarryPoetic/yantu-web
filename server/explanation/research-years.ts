import { explicitAdmissionsYears } from "../../shared/research-years.ts";
import { researchTextCache } from "./research-cache.ts";
import type { WebSource } from "./web.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";
import { withoutSchoolLinks } from "./research-school.ts";

const bodyYears = researchTextCache(explicitAdmissionsYears);

/** Body years win; only a validated anonymous attachment may inherit an explicit parent year. */
export function safeSourceYear(source: WebSource): number | undefined {
  if (source.kind !== "official_page") return undefined;
  const years = bodyYears(withoutSchoolLinks(source.excerpt));
  if (years.length === 1) return years[0];
  if (years.length) return undefined;
  const inherited = validatedSourceProvenance(source)?.admissionYear;
  return inherited && /^20\d{2}$/.test(inherited)
    ? Number(inherited)
    : undefined;
}
