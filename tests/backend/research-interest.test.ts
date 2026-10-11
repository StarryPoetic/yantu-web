import test from "node:test";
import assert from "node:assert/strict";
import { createSeedCatalog } from "../../server/catalog/index.ts";
import { matchResearchProgram } from "../../shared/research-interest.ts";

test("T3-01 link only unique exact reviewed current identities, never examples or ambiguous years/colleges/modes", () => {
  const program = structuredClone(createSeedCatalog().revisions[0]);
  program.isExample = false;
  program.reviewStatus = "approved";
  program.publicationStatus = "published";
  program.availability = "verified_current";
  const item = {
    institutionName: program.display.institutionName,
    collegeName: program.display.collegeName,
    programName: program.display.majorName,
    majorCode: program.identity.majorCode,
    disciplineCode: program.identity.majorCode.slice(0, 4),
    degreeType: program.identity.degreeType,
    studyMode: program.identity.studyMode,
    rationale: "待核验",
    preparation: [],
    uncertainties: [],
    citations: [],
  };
  const year = program.identity.targetAdmissionYear;
  assert.deepEqual(matchResearchProgram(item, year, [program]), {
    programId: program.programId,
    programRevisionId: program.programRevisionId,
  });
  assert.equal(
    matchResearchProgram(item, year, [
      program,
      { ...program, programId: "other-direction" },
    ]),
    null,
  );
  for (const change of [
    { collegeName: undefined },
    { majorCode: undefined },
    { studyMode: undefined },
    { degreeType: undefined },
    { collegeName: "其他学院" },
    { programName: "其他专业" },
  ])
    assert.equal(
      matchResearchProgram({ ...item, ...change }, year, [program]),
      null,
    );
  assert.equal(matchResearchProgram(item, year + 1, [program]), null);
  for (const change of [
    { isExample: true },
    { reviewStatus: "pending_review" as const },
    { publicationStatus: "withdrawn" as const },
  ])
    assert.equal(
      matchResearchProgram(item, year, [{ ...program, ...change }]),
      null,
    );
});
