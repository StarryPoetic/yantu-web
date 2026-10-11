import { Worker } from "node:worker_threads";
import type { extractProgramFacts } from "./research-facts.ts";
import type { buildEvidenceCandidates } from "./research-matching.ts";
import type { deriveResearchCoverage } from "./research-coverage.ts";
import type { WebSource } from "./web.ts";
import { setImmediate } from "node:timers/promises";

export interface ResearchComputations {
  reportFacts: {
    input: {
      sources: WebSource[];
      at: string;
      focus: Parameters<typeof extractProgramFacts>[3];
    };
    output: ReturnType<typeof extractProgramFacts>;
  };
  schoolFacts: {
    input: { rows: { key: string; source: WebSource }[]; at: string };
    output: { key: string; facts: ReturnType<typeof extractProgramFacts> }[];
  };
  facts: {
    input: Parameters<typeof extractProgramFacts>;
    output: ReturnType<typeof extractProgramFacts>;
  };
  inventory: {
    input: Parameters<typeof buildEvidenceCandidates>[0];
    output: ReturnType<typeof buildEvidenceCandidates>;
  };
  coverage: {
    input: Parameters<typeof deriveResearchCoverage>[0];
    output: ReturnType<typeof deriveResearchCoverage>;
  };
}

/** Pure CPU jobs have no database, credentials or network access. Cancellation
 * terminates the worker, so late results cannot publish facts after deletion. */
export async function researchCompute<K extends keyof ResearchComputations>(
  kind: K,
  input: ResearchComputations[K]["input"],
  signal?: AbortSignal,
): Promise<ResearchComputations[K]["output"]> {
  signal?.throwIfAborted();
  // Tiny reports cost less than worker startup. Bound their entire input and
  // yield first; school rebinding and page ingestion always stay in workers.
  if (kind === "inventory" || kind === "coverage" || kind === "reportFacts") {
    const sources = (input as ResearchComputations["reportFacts"]["input"])
      .sources;
    if (
      sources.length <= 8 &&
      sources.reduce((n, s) => n + s.excerpt.length, 0) <= 6000
    ) {
      await setImmediate(undefined, { signal });
      signal?.throwIfAborted();
      if (kind === "inventory")
        return (await import("./research-matching.ts")).buildEvidenceCandidates(
          input as ResearchComputations["inventory"]["input"],
        ) as ResearchComputations[K]["output"];
      if (kind === "coverage")
        return (await import("./research-coverage.ts")).deriveResearchCoverage(
          input as ResearchComputations["coverage"]["input"],
        ) as ResearchComputations[K]["output"];
      const { at, focus } =
        input as ResearchComputations["reportFacts"]["input"];
      const { extractProgramFacts } = await import("./research-facts.ts");
      const facts = [];
      for (const source of sources.filter(
        (s) => s.kind === "official_page" && !s.library,
      )) {
        await setImmediate(undefined, { signal });
        facts.push(...extractProgramFacts(source, sources, at, focus));
      }
      return facts as ResearchComputations[K]["output"];
    }
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./research-compute-worker.ts", import.meta.url),
      {
        workerData: { kind, input },
        env: {},
        execArgv: [],
      },
    );
    const abort = () => {
      void worker.terminate();
      reject(signal!.reason);
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (value) => {
      cleanup();
      resolve(value);
    });
    worker.once("error", (error) => {
      cleanup();
      reject(error);
    });
    worker.once("exit", (code) => {
      cleanup();
      if (code) reject(new Error(`Research worker exited: ${code}`));
    });
  });
}
