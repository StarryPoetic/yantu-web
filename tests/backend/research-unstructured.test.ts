import test from "node:test";
import assert from "node:assert/strict";
import type { WebSource } from "../../server/explanation/web.ts";
import { unstructuredResearchSources } from "../../server/explanation/research-unstructured.ts";
import { researchCompute } from "../../server/explanation/research-compute.ts";
import { extractProgramFacts } from "../../server/explanation/research-facts.ts";

const source = (
  id: string,
  excerpt: string,
  kind: WebSource["kind"] = "official_page",
): WebSource => ({
  id,
  url: `https://grs.hdu.edu.cn/${id}`,
  title: "杭州电子科技大学资料",
  excerpt,
  retrievedAt: "2026-10-11T00:00:00Z",
  kind,
  verified: false,
});

test("unstructured sources include only new successful school reads without a bound field, preserving bounded literal text", () => {
  const raw = source(
    "raw",
    "杭州电子科技大学硕士研究生招生说明。" + "学校公开说明。".repeat(1000),
  );
  const snippet = source("snippet", raw.excerpt, "search_snippet");
  const reused = source("reused", raw.excerpt);
  const directory = source(
    "directory",
    "杭州电子科技大学2027年硕士研究生招生专业目录。\n001管理学院 | 120100 管理科学与工程 学术学位 全日制 ①101思想政治理论 ②201英语一 ③303数学三 ④811管理学",
  );
  const unrelated = source(
    "unrelated",
    "来自另一所学校的新闻与友情链接。无本校归属。",
  );
  const sources = [
    raw,
    snippet,
    reused,
    directory,
    unrelated,
    { ...raw, id: "duplicate" },
  ];
  const original = structuredClone(sources);
  const entries = unstructuredResearchSources(
    sources,
    new Set([raw.url, snippet.url, directory.url, unrelated.url]),
    raw.retrievedAt,
  );
  assert.deepEqual(entries, [
    {
      institutionName: "杭州电子科技大学",
      sourceId: "raw",
      excerpt: raw.excerpt.slice(0, 6000),
      truncated: true,
    },
  ]);
  assert.deepEqual(sources, original);
});

test("pending-only raw reads remain inspectable and unknown owners never inherit a school from a link", () => {
  const pending = source(
    "pending",
    "杭州电子科技大学硕士招生信息。专业收费档次与学院待确认。",
  );
  const unknown = {
    ...source("unknown", "友情链接：杭州电子科技大学。"),
    url: "https://unknown.edu.cn/news",
  };
  assert.equal(
    unstructuredResearchSources(
      [pending, unknown],
      new Set([pending.url, unknown.url]),
      pending.retrievedAt,
    ).length,
    1,
  );
  assert.deepEqual(
    unstructuredResearchSources([pending], new Set(), pending.retrievedAt),
    [],
  );
});

test("unstructured worker preserves literal output and yields to cancellation timers", async () => {
  const pages = [
    source(
      "pending",
      "杭州电子科技大学硕士招生信息。专业收费档次与学院待确认。",
    ),
  ];
  const args: Parameters<typeof unstructuredResearchSources> = [
    pages,
    new Set(pages.map((p) => p.url)),
    pages[0].retrievedAt,
  ];
  assert.deepEqual(
    await researchCompute("unstructured", args),
    unstructuredResearchSources(...args),
  );
  const controller = new AbortController();
  const reason = new Error("offline timer cancellation");
  const timer = setTimeout(() => controller.abort(reason), 1);
  try {
    await assert.rejects(
      researchCompute(
        "unstructured",
        [
          [{ ...pages[0], excerpt: pages[0].excerpt.repeat(1000) }],
          args[1],
          args[2],
        ],
        controller.signal,
      ),
      (error) => error === reason,
    );
  } finally {
    clearTimeout(timer);
  }
});

test("shared snapshot binding cache preserves full extraction across catalogue and uncoded pages", () => {
  const pages = [
    source(
      "catalog",
      "杭州电子科技大学2027年硕士研究生招生专业目录。\n001机械工程学院 | 085500 机械 专业学位 全日制 ①101思想政治理论 ②204英语二 ③302数学二 ④811机械原理",
    ),
    source(
      "campus",
      "杭州电子科技大学2027年硕士研究生机械工程学院全日制在下沙校区培养。",
    ),
    source(
      "location",
      "杭州电子科技大学下沙校区地址：浙江省杭州市钱塘区白杨街道2号大街1158号。",
    ),
    source("pending", "杭州电子科技大学研究生公开说明。"),
  ];
  const cache: NonNullable<Parameters<typeof extractProgramFacts>[4]> =
    new Map();
  for (const p of pages)
    assert.deepEqual(
      extractProgramFacts(p, pages, p.retrievedAt, undefined, cache),
      extractProgramFacts(p, pages, p.retrievedAt),
    );
});
