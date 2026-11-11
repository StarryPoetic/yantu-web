import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createEmptyCatalog,
  importCatalog,
  type CatalogImport,
} from "../server/catalog/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const predecessorPath =
  "knowledge/catalog/review-candidates/predecessors/hdu-2027-mechanical-draft-20261020.json";
export const currentPath =
  "knowledge/catalog/review-candidates/import-hdu-2027-mechanical-draft.json";
export const predecessorSha256 =
  "cfa9897c8a7f690919021d5d40ae395fd6e1d22e019a4e711ca0abacc2b1420c";

/** Pure in-memory sequencing only: no database, network, review or publication. */
export function verifyReviewChain(
  predecessor: CatalogImport,
  current: CatalogImport,
) {
  for (const bundle of [predecessor, current]) {
    if (bundle.programs.length !== 2)
      throw new Error("Expected two HDU drafts");
    for (const program of bundle.programs) {
      if (
        program.reviewStatus !== "draft" ||
        program.publicationStatus !== "unpublished" ||
        program.availability !== "unverified" ||
        program.claims.some(
          (claim) => claim.availability !== "unverified" || claim.reviewedBy,
        ) ||
        bundle.sources.some((source) => source.verifiedAt)
      )
        throw new Error("Offline sequencing cannot approve or verify drafts");
    }
  }
  for (const program of current.programs) {
    const previous = predecessor.programs.find(
      (candidate) => candidate.programId === program.programId,
    );
    if (
      !previous ||
      program.supersedesRevisionId !== previous.programRevisionId ||
      previous.supersedesRevisionId !== null
    )
      throw new Error("Actual predecessor required; do not clear the link");
  }
  const context = {
    actor: "offline-structure-check:not-human-review",
    at: "2026-11-11T00:00:00.000Z",
  };
  const state = importCatalog(
    importCatalog(createEmptyCatalog(), predecessor, context),
    current,
    context,
  );
  return {
    revisions: state.revisions.length,
    releases: state.releases.length,
    activeCatalogVersion: state.activeCatalogVersion,
    persisted: false,
    humanReviewed: false,
  };
}

export function checkSavedReviewChain() {
  const bytes = readFileSync(resolve(root, predecessorPath));
  if (createHash("sha256").update(bytes).digest("hex") !== predecessorSha256)
    throw new Error("Archived predecessor differs from Git b27efd3 bytes");
  return verifyReviewChain(
    JSON.parse(bytes.toString("utf8")),
    JSON.parse(readFileSync(resolve(root, currentPath), "utf8")),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 2)
    throw new Error("Usage: node scripts/verify-hdu-review-chain.ts");
  console.log(JSON.stringify(checkSavedReviewChain()));
}
