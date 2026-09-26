import type { ProgramRevision } from "../server/catalog/types.ts";

/** A national four-digit category matches the program's actual code and degree type. */
export function programMatchesDiscipline(
  program: Pick<ProgramRevision, "identity" | "majorDirectionIds">,
  disciplineId: string | null | undefined,
): boolean {
  if (!disciplineId) return true;
  if (/^\d{4}$/.test(disciplineId)) {
    const degreeType =
      Number(disciplineId[2]) >= 5 ? "professional" : "academic";
    return (
      program.identity.majorCode.slice(0, 4) === disciplineId &&
      program.identity.degreeType === degreeType
    );
  }
  // Legacy saved choices remain readable; they never expand to an entire degree type.
  return program.majorDirectionIds.includes(disciplineId);
}
