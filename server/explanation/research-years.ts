import {
  explicitAdmissionsYears,
  officialSourceYear,
} from "../../shared/research-years.ts";
import type { WebSource } from "./web.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";
import { withoutSchoolLinks } from "./research-school.ts";

/** Body years win; only a validated anonymous attachment may inherit an explicit parent year. */
export function safeSourceYear(source: WebSource): number | undefined {
  const body = withoutSchoolLinks(source.excerpt);
  const year = officialSourceYear({ kind: source.kind, excerpt: body });
  if (year !== undefined) return year;
  if (source.kind !== "official_page" || explicitAdmissionsYears(body).length)
    return undefined;
  const inherited = validatedSourceProvenance(source)?.admissionYear;
  return inherited && /^20\d{2}$/.test(inherited)
    ? Number(inherited)
    : undefined;
}
