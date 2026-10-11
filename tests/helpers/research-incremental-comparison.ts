/** Offline only: frozen public pages from an explicitly named COPY. No env,
 * HTTP adapters, credentials, user records or original application database. */
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import {
  registrableDomain,
  type WebSource,
} from "../../server/explanation/web.ts";
import type { extractProgramFacts } from "../../server/explanation/research-facts.ts";

const [database, originalRoot, output] = process.argv.slice(2);
if (
  !database ||
  !originalRoot ||
  !output ||
  /(?:^|[\\/])yantu\.sqlite$/i.test(database)
)
  throw new Error(
    "Usage: node tests/helpers/research-incremental-comparison.ts DATABASE_COPY ORIGINAL_ROOT OUTPUT",
  );
const copy = new DatabaseSync(resolve(database), { readOnly: true });
const pages = (
  copy
    .prepare("SELECT payload FROM research_public_sources ORDER BY rowid")
    .all() as { payload: string }[]
).map((r) => JSON.parse(r.payload) as WebSource);
copy.close();
const at = "2026-10-11T10:00:00.000Z";
const store = new Store();
const library = createResearchEvidenceLibrary(store, {
  now: () => Date.parse(at),
});
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((k) => [k, item[k]]),
        )
      : item,
  );
try {
  const started = performance.now();
  for (let offset = 0; offset < pages.length; offset += 4) {
    await Promise.all(
      pages.slice(offset, offset + 4).map((p) => library.saveIncremental!(p)),
    );
    if (offset % 100 === 0)
      console.log(
        JSON.stringify({
          incrementalPages: Math.min(offset + 4, pages.length),
        }),
      );
  }
  await library.flush!();
  const incrementalMs = Math.round(performance.now() - started);
  const originals = (
    store.db
      .prepare("SELECT payload FROM research_public_sources ORDER BY rowid")
      .all() as { payload: string }[]
  ).map((r) => JSON.parse(r.payload) as WebSource);
  const groups = Map.groupBy(originals, (p) =>
    registrableDomain(new URL(p.url).hostname),
  );
  const expected = new Set<string>();
  const fullStarted = performance.now();
  const jobs = [...groups.values()].flatMap((own) =>
    own.map((source) => ({ source, own })),
  );
  for (let offset = 0; offset < jobs.length; offset += 8) {
    const results = await Promise.all(
      jobs.slice(offset, offset + 8).map(
        (job) =>
          new Promise<ReturnType<typeof extractProgramFacts>>(
            (resolveJob, reject) => {
              const worker = new Worker(
                `const {parentPort,workerData}=require("node:worker_threads"); import(workerData.module).then(m => parentPort.postMessage(m.extractProgramFacts(workerData.source,workerData.own,workerData.at)));`,
                {
                  eval: true,
                  env: {},
                  execArgv: [],
                  workerData: {
                    ...job,
                    at,
                    module: pathToFileURL(
                      resolve(
                        originalRoot,
                        "server/explanation/research-facts.ts",
                      ),
                    ).href,
                  },
                },
              );
              worker.once("message", (value) => {
                void worker.terminate();
                resolveJob(value);
              });
              worker.once("error", reject);
            },
          ),
      ),
    );
    for (const result of results)
      for (const fact of result) expected.add(canonical(fact));
    console.log(
      JSON.stringify({
        fullPages: Math.min(offset + 8, jobs.length),
        facts: expected.size,
      }),
    );
  }
  const actual = new Set(
    (
      store.db.prepare("SELECT payload FROM research_program_facts").all() as {
        payload: string;
      }[]
    ).map((r) => canonical(JSON.parse(r.payload))),
  );
  const missing = [...expected].filter((f) => !actual.has(f)).length;
  const extra = [...actual].filter((f) => !expected.has(f)).length;
  const result = {
    pages: pages.length,
    normalizedPages: originals.length,
    schools: groups.size,
    expectedFacts: expected.size,
    incrementalFacts: actual.size,
    missing,
    extra,
    incrementalMs,
    fullMs: Math.round(performance.now() - fullStarted),
    httpRequests: 0,
    paidTokens: 0,
    paidCostCny: 0,
  };
  writeFileSync(resolve(output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.equal(missing, 0);
  assert.equal(extra, 0);
} finally {
  store.close();
}
