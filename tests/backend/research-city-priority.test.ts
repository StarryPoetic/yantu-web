import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import { researchSchoolPriorities } from "../../server/explanation/research-school-priority.ts";
import type { WebSource } from "../../server/explanation/web.ts";

function seed(
  store: Store,
  school: string,
  domain: string,
  count: number,
  at: string,
) {
  for (let i = 0; i < count; i++) {
    const url = `https://${domain}/catalog-${i}.htm`;
    const source: WebSource = {
      id: `${domain}-${i}`,
      url,
      title: `${school}硕士招生目录`,
      excerpt: `${school}2026年硕士招生专业目录\n080200 机械工程 全日制`,
      retrievedAt: at,
      kind: "official_page",
      verified: false,
    };
    store.db
      .prepare(
        "INSERT INTO research_public_sources(url,payload,content_hash,retrieved_at,stored_at,version,evidence_year) VALUES (?,?,?,?,?,1,2026)",
      )
      .run(url, JSON.stringify(source), `hash-${i}`, at, at);
    store.db
      .prepare("INSERT INTO research_public_schools(url,name) VALUES (?,?)")
      .run(url, school);
    store.db
      .prepare("INSERT INTO research_public_disciplines(url,code) VALUES (?,?)")
      .run(url, "0802");
  }
}
const request = { disciplineCodes: ["0802"], targetYear: "2027" };

test("older preferred-city schools survive over 200 newer outside rows, rotate and obey school cap", () => {
  const store = new Store();
  try {
    const library = createResearchEvidenceLibrary(store, {
      now: () => Date.parse("2026-10-11T00:00:00Z"),
    });
    seed(store, "西北大学", "nwu.edu.cn", 220, "2026-10-10T00:00:00Z");
    seed(store, "杭州电子科技大学", "hdu.edu.cn", 24, "2026-10-01T00:00:00Z");
    seed(store, "浙江工商大学", "zjgsu.edu.cn", 3, "2026-10-01T00:00:00Z");
    const recalled = library.load({ ...request, cities: ["杭州"] });
    assert.ok(
      recalled[0].url.includes("hdu.edu.cn") ||
        recalled[0].url.includes("zjgsu.edu.cn"),
    );
    assert.ok(
      recalled.slice(0, 2).some((source) => source.url.includes("hdu.edu.cn")),
    );
    assert.ok(
      recalled
        .slice(0, 2)
        .some((source) => source.url.includes("zjgsu.edu.cn")),
    );
    assert.equal(
      recalled.filter((source) => source.url.includes("hdu.edu.cn")).length,
      B.librarySourcesPerSchool,
    );
    assert.equal(
      recalled.filter((source) => source.url.includes("zjgsu.edu.cn")).length,
      3,
    );
    assert.ok(
      recalled.findIndex((source) => source.url.includes("nwu.edu.cn")) >= 11,
    );
    for (const host of ["nwu.edu.cn", "hdu.edu.cn", "zjgsu.edu.cn"])
      assert.ok(
        recalled.filter((source) => source.url.includes(host)).length <=
          B.librarySourcesPerSchool,
      );
    const unchanged = library.load(request);
    assert.equal(unchanged.length, B.candidates);
    assert.ok(unchanged.every((source) => source.url.includes("nwu.edu.cn")));
    assert.deepEqual(
      library.load({ ...request, cities: ["不确定"] }),
      unchanged,
    );
  } finally {
    store.close();
  }
});

test("selected school then city then plan school then others; unknown geography never matches", () => {
  const order = researchSchoolPriorities({
    cities: ["杭州"],
    selectedSchool: "西北大学",
    schoolHints: ["南京大学", "未知大学"],
  });
  assert.equal(order.priority("西北大学"), 0);
  assert.equal(order.priority("杭州电子科技大学"), 1);
  assert.equal(order.priority("南京大学"), 2);
  assert.equal(order.priority("未知大学"), 2);
  assert.equal(order.priority("未知杭州学校"), 3);
  assert.equal(order.priority("西安交通大学"), 3);
  assert.equal(
    researchSchoolPriorities({ cities: [] }).priority("杭州电子科技大学"),
    3,
  );
});
