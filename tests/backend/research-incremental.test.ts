import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import { researchCompute } from "../../server/explanation/research-compute.ts";
import { researchDocumentPriority } from "../../server/explanation/research-document-priority.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const at = Date.parse("2026-10-11T00:00:00Z");
const page = (name: string, body: string): WebSource => ({
  id: name,
  url: `https://grs.hdu.edu.cn/${name}.html`,
  title: name,
  excerpt: `杭州电子科技大学\n2026年硕士研究生\n${body}`,
  kind: "official_page",
  verified: false,
  retrievedAt: new Date(at).toISOString(),
});
const pages = [
  page(
    "招生专业目录",
    "机械工程学院\n080200 机械工程 全日制学术学位 ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合",
  ),
  page("学费", "全日制学术学位硕士研究生学费为8000元/生·学年。"),
  page(
    "培养地点",
    "机械工程学院的新生所在校区为下沙校区。下沙校区位于杭州市。",
  ),
  page("招生信息", "请查看相关硕士专业招生安排。"),
  page("通知公告", "硕士招生信息请以官网原文为准。"),
];
const facts = (store: Store) =>
  (
    store.db
      .prepare("SELECT payload FROM research_program_facts ORDER BY payload")
      .all() as { payload: string }[]
  ).map((r) => r.payload);

test("incremental pages and deferred school binding exactly equal full rebuilding, including refreshed pages and restart", async () => {
  const baseline = new Store(),
    incremental = new Store();
  const full = createResearchEvidenceLibrary(baseline, { now: () => at });
  let library = createResearchEvidenceLibrary(incremental, { now: () => at });
  try {
    for (const p of pages) {
      full.save(p);
      await library.saveIncremental!(p);
    }
    // Recreate the service to prove the pending school survives interruption.
    library = createResearchEvidenceLibrary(incremental, { now: () => at });
    await library.flush!();
    assert.deepEqual(facts(incremental), facts(baseline));
    assert.ok(facts(incremental).length >= 3);
    const updated = {
      ...pages[1],
      excerpt: pages[1].excerpt.replace("8000", "9000"),
      retrievedAt: new Date(at + 1).toISOString(),
    };
    const fullLater = createResearchEvidenceLibrary(baseline, {
      now: () => at + 2,
    });
    const later = createResearchEvidenceLibrary(incremental, {
      now: () => at + 2,
    });
    fullLater.save(updated);
    await later.saveIncremental!(updated);
    await later.flush!();
    // Full-school rebuilding also updates extraction timestamps of untouched pages.
    const values = (store: Store) =>
      facts(store)
        .map((p) => {
          const value = JSON.parse(p);
          delete value.extractedAt;
          return JSON.stringify(value);
        })
        .sort();
    assert.deepEqual(values(incremental), values(baseline));
    assert.equal(
      incremental.db
        .prepare("SELECT count(*) AS n FROM research_pending_schools")
        .get()!.n,
      0,
    );
  } finally {
    baseline.close();
    incremental.close();
  }
});

test("a new page with 2500 existing school facts saves in under one second without scanning those facts", async (t) => {
  const store = new Store();
  const library = createResearchEvidenceLibrary(store, { now: () => at });
  try {
    library.save(pages[0]);
    const row = store.db
      .prepare("SELECT * FROM research_program_facts LIMIT 1")
      .get()!;
    store.transaction(() => {
      const insert = store.db.prepare(
        "INSERT INTO research_program_facts(identity,field,source_key,school,domain,code,year,payload) VALUES (?,?,?,?,?,?,?,?)",
      );
      for (let i = 0; i < 2500; i++)
        insert.run(
          `synthetic-${i}`,
          row.field,
          row.source_key,
          row.school,
          row.domain,
          row.code,
          row.year,
          row.payload,
        );
    });
    const start = performance.now();
    await library.saveIncremental!(
      page("复试分数线", "机械工程2026年复试分数线为300分，总分满分500分。"),
    );
    const elapsed = performance.now() - start;
    t.diagnostic(`2500-fact single-page save: ${elapsed.toFixed(1)} ms`);
    assert.ok(elapsed < 1000, `${elapsed} ms exceeds 1000 ms`);
    assert.ok(
      Number(
        store.db
          .prepare("SELECT count(*) AS n FROM research_program_facts")
          .get()!.n,
      ) >= 2500,
    );
  } finally {
    store.close();
  }
});

test("CPU extraction cancellation leaves the event loop and timeout responsive", async () => {
  const controller = new AbortController();
  const source = page("招生专业目录", pages[0].excerpt.repeat(3000));
  const started = performance.now();
  const timer = setTimeout(
    () => controller.abort(new Error("test deadline")),
    25,
  );
  try {
    await assert.rejects(
      researchCompute(
        "facts",
        [source, [source], new Date(at).toISOString()],
        controller.signal,
      ),
      /test deadline/,
    );
    assert.ok(performance.now() - started < 500);
  } finally {
    clearTimeout(timer);
  }
});

test("a concurrent new page cannot be lost when an older school snapshot finishes binding", async () => {
  const store = new Store();
  const library = createResearchEvidenceLibrary(store, { now: () => at });
  try {
    await library.saveIncremental!(pages[0]);
    assert.ok(
      library
        .queryFacts({ targetYear: "2027" })
        .every((f) => f.freshness === "stale"),
    );
    const binding = library.flush!();
    await library.saveIncremental!(pages[1]);
    await binding;
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM research_pending_schools")
        .get()!.n,
      1,
    );
    await library.flush!();
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM research_pending_schools")
        .get()!.n,
      0,
    );
    assert.ok(
      library
        .queryFacts({ targetYear: "2027" })
        .some((f) => f.field === "tuition" && f.freshness === "fresh"),
    );
  } finally {
    store.close();
  }
});

test("masters evidence outranks navigation and rejects doctoral and unrelated-faculty leads", () => {
  const core = [
    "硕士招生专业目录",
    "复试分数线",
    "拟录取名单",
    "报录统计",
    "硕士招生简章",
    "学科评估",
    "就业质量报告",
  ];
  for (const title of core)
    assert.ok(researchDocumentPriority(title, "机械工程") >= 70);
  assert.ok(researchDocumentPriority("招生信息首页") < 0);
  assert.ok(researchDocumentPriority("博士招生专业目录") < 0);
  assert.ok(
    researchDocumentPriority(
      "计算机科学与技术学院硕士招生专业目录",
      "机械工程",
    ) < 0,
  );
});
