/** Public school-only copy benchmark. No environment or network access. */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";

const [database, output] = process.argv.slice(2);
if (!database || !output || /(?:^|[\\/])yantu\.sqlite$/i.test(database))
  throw new Error("An explicit DATABASE_COPY and OUTPUT are required");
const copy = new DatabaseSync(database, { readOnly: true });
const store = new Store();
try {
  const now = Date.parse("2026-10-11T23:00:00Z");
  const library = createResearchEvidenceLibrary(store, { now: () => now });
  const rows = copy
    .prepare("SELECT * FROM research_public_sources")
    .all()
    .filter((row) => {
      const host = new URL(JSON.parse(String(row.payload)).url).hostname;
      return host === "hdu.edu.cn" || host.endsWith(".hdu.edu.cn");
    });
  const facts = copy
    .prepare("SELECT * FROM research_program_facts WHERE school=?")
    .all("杭州电子科技大学");
  for (const [table, values] of [
    ["research_public_sources", rows],
    ["research_program_facts", facts],
  ] as const) {
    const columns = Object.keys(values[0]);
    const insert = store.db.prepare(
      `INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    );
    store.transaction(() => {
      for (const value of values) insert.run(...columns.map((c) => value[c]));
    });
  }
  const started = performance.now();
  await library.saveIncremental!({
    id: "offline-performance",
    url: "https://grs.hdu.edu.cn/rework-performance.html",
    title: "2026年硕士复试分数线",
    excerpt:
      "杭州电子科技大学2026年硕士研究生机械工程复试分数线为300分，总分满分500分。",
    kind: "official_page",
    verified: false,
    retrievedAt: new Date(now).toISOString(),
  });
  const result = {
    existingFacts: facts.length,
    existingPages: rows.length,
    singlePageMs: Math.round((performance.now() - started) * 10) / 10,
    httpRequests: 0,
    paidTokens: 0,
    paidCostCny: 0,
  };
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (facts.length < 2500 || result.singlePageMs >= 1000)
    throw new Error("Single-page performance requirement failed");
} finally {
  copy.close();
  store.close();
}
