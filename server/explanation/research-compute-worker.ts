import { parentPort, workerData } from "node:worker_threads";
import { extractProgramFacts } from "./research-facts.ts";
import { buildEvidenceCandidates } from "./research-matching.ts";
import { deriveResearchCoverage } from "./research-coverage.ts";
import type { ResearchComputations } from "./research-compute.ts";

if (workerData.kind === "reportFacts") {
  const { sources, at, focus } =
    workerData.input as ResearchComputations["reportFacts"]["input"];
  parentPort!.postMessage(
    sources
      .filter((s) => s.kind === "official_page" && !s.library)
      .flatMap((source) => extractProgramFacts(source, sources, at, focus)),
  );
} else if (workerData.kind === "schoolFacts") {
  const { rows, at } =
    workerData.input as ResearchComputations["schoolFacts"]["input"];
  const sources = rows.map((row) => row.source);
  const locationCache = new Map();
  parentPort!.postMessage(
    rows.map((row) => ({
      key: row.key,
      facts: extractProgramFacts(
        row.source,
        sources,
        at,
        undefined,
        locationCache,
      ),
    })),
  );
} else if (workerData.kind === "facts")
  parentPort!.postMessage(
    extractProgramFacts(
      ...(workerData.input as ResearchComputations["facts"]["input"]),
    ),
  );
else if (workerData.kind === "inventory")
  parentPort!.postMessage(buildEvidenceCandidates(workerData.input));
else if (workerData.kind === "coverage")
  parentPort!.postMessage(deriveResearchCoverage(workerData.input));
