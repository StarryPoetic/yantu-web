import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RESEARCH_BUDGET as budget,
  researchReservation,
} from "../../server/explanation/research-budget.ts";
import {
  createSearchBudget,
  searchConfigFromEnvironment,
} from "../../server/explanation/search.ts";
import { RESEARCH_SCHOOL_POLICY } from "../../shared/research-policy.ts";

const documents = [
  "README.md",
  "docs/长期部署.md",
  "knowledge/schools/README.md",
  "server/explanation/README.md",
];
const read = (name: string) =>
  readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
function currentTable(content: string) {
  const start = "<!-- current-research-budget:start -->";
  const end = "<!-- current-research-budget:end -->";
  assert.equal(content.split(start).length, 2, "one current budget table");
  assert.equal(content.split(end).length, 2, "one current budget table end");
  return Object.fromEntries(
    [
      ...content
        .split(start)[1]
        .split(end)[0]
        .matchAll(/\|\s*`(\w+)`\s*\|\s*(\d+)\s*\|/g),
    ].map(([, key, value]) => [key, Number(value)]),
  );
}

test("current budget tables agree with imported runtime values, including the school-policy alias", () => {
  for (const name of documents) {
    const table = currentTable(read(name));
    assert.ok(Object.keys(table).length >= 8, name);
    for (const [key, value] of Object.entries(table)) {
      assert.ok(Object.hasOwn(budget, key), `${name}: unknown ${key}`);
      assert.equal(
        value,
        budget[key as keyof typeof budget],
        `${name}: ${key}`,
      );
    }
    if (name === "server/explanation/README.md")
      assert.deepEqual(table, budget);
  }
  assert.equal(budget.finalSchools, RESEARCH_SCHOOL_POLICY.target);
  const range = `${RESEARCH_SCHOOL_POLICY.minimum}–${RESEARCH_SCHOOL_POLICY.maximum}`;
  assert.ok(read("README.md").includes(`以${range}所不同学校为目标`));
  assert.ok(
    read("server/explanation/README.md").includes(
      `新报告以${range}所不同学校为目标`,
    ),
  );
});

test("documented reservation includes collection and matches the executable reservation function", () => {
  const text = read("server/explanation/README.md");
  const table = Object.fromEntries(
    [...text.matchAll(/\|\s*`reservation\.(\w+)`\s*\|\s*(\d+)\s*\|/g)].map(
      ([, key, value]) => [key, Number(value)],
    ),
  );
  assert.deepEqual(table, researchReservation());
});

test("historical defaults are separated from current guidance instead of satisfying current assertions", () => {
  for (const name of documents) {
    const current = read(name).split(/^## 历史(?:预算|发现)/m)[0];
    assert.ok(current.includes("current-research-budget:end"), name);
    for (const obsolete of [
      "最多24次搜索",
      "60次官网读取",
      "每校累计最多8次",
      "默认每账号每日300000",
      "应用每账号100000token",
      "初期每校4次",
      "现行城市恢复最多120次读取",
    ])
      assert.ok(!current.includes(obsolete), `${name}: obsolete ${obsolete}`);
  }
});

test("documented search defaults and positive allowance alignment match offline budget enforcement", () => {
  const table = currentTable(read("docs/长期部署.md"));
  const defaults = searchConfigFromEnvironment({});
  assert.equal(defaults.searchEnabled, false);
  assert.equal(defaults.searchKey, undefined);
  assert.equal(
    defaults.searchDailyRequestsPerUser,
    table.searchDailyRequestsPerUser,
  );
  assert.equal(
    defaults.searchDailyRequestsGlobal,
    table.searchDailyRequestsGlobal,
  );
  const limited = createSearchBudget(defaults);
  for (let used = 0; used < table.searchDailyRequestsPerUser; used++)
    assert.equal(limited.claim("student", "2026-10-20"), true);
  assert.equal(limited.claim("student", "2026-10-20"), false);
  for (const configured of [0, 60, table.searches + 1]) {
    const config = searchConfigFromEnvironment({
      YANTU_SEARCH_USER_DAILY_REQUESTS: String(configured),
      YANTU_SEARCH_DAILY_REQUESTS: String(configured),
    });
    const effective =
      configured === 0 ? 0 : Math.max(table.searches, configured);
    assert.equal(config.searchDailyRequestsPerUser, effective);
    assert.equal(config.searchDailyRequestsGlobal, effective);
    const ledger = createSearchBudget(config);
    for (let used = 0; used < effective; used++)
      assert.equal(ledger.claim(`student-${used}`, "2026-10-20"), true);
    assert.equal(ledger.claim("another-student", "2026-10-20"), false);
  }
});
