import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveModelRequest } from "../../server/explanation/deepseek.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import { collectionModelOptions } from "../../server/explanation/research-collection.ts";
import { extractPriorityFacts } from "../../server/explanation/research-priority-facts.ts";
import { webPageText, type WebSource } from "../../server/explanation/web.ts";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import {
  expandResearchTableSpans,
  researchTextRows,
} from "../../server/explanation/research-table-text.ts";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";

test("low daily quota stops Flash before spending the final Pro token headroom, including concurrent calls", async () => {
  let flash = 0,
    pro = 0;
  const runtime = createModelRuntime({
    userDailyTokens: 80000,
    globalDailyTokens: 80000,
    adapter: {
      async complete(_m, options) {
        if (options?.thinking) pro++;
        else flash++;
        return {
          model: options?.model ?? "deepseek-flash",
          content: "{}",
          inputTokens: 8000,
          outputTokens: 1000,
        };
      },
    },
  });
  const messages = [{ role: "user" as const, content: "a".repeat(10000) }];
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, (_, n) =>
      runtime.run("u", n, messages, JSON.parse, collectionModelOptions()),
    ),
  );
  assert.equal(flash, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 3);
  await runtime.run(
    "u",
    "final",
    [{ role: "user", content: "a".repeat(39000) }],
    JSON.parse,
    { model: "deepseek-v4-pro", thinking: true, maxOutputTokens: 16384 },
  );
  assert.equal(pro, 1);
});

test("saved real cutoff pages bind explicit HTML rowspans and old vertical cells without guessing maximum scores", () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL("./fixtures/acceptance-cutoff-pages.json", import.meta.url),
      "utf8",
    ),
  ) as (WebSource & { fixtureHtml?: boolean })[];
  const disciplines = getDisciplineCatalog().items.filter((d) =>
    ["0802", "0855"].includes(d.code),
  );
  for (const source of fixtures) {
    const page = source.fixtureHtml
      ? { ...source, excerpt: webPageText(source.excerpt) }
      : source;
    const facts = extractPriorityFacts(page, disciplines, "2027", {
      total: 350,
      maximum: 500,
    });
    const cutoff = facts.find(
      (f) => f.field === "cutoff" && f.majorCode === "080200",
    );
    assert.ok(cutoff, page.title);
    assert.equal(cutoff.value.number, 264);
    assert.equal(cutoff.value.maximum, undefined);
    assert.equal(cutoff.value.targetGap, undefined);
    assert.ok(page.excerpt.includes(cutoff.quote));
    if (source.fixtureHtml) assert.equal(cutoff.collegeName, "工学院");
    else
      assert.deepEqual(cutoff.value.singleSubject, {
        maximum100: 35,
        above100: 53,
      });
  }
});

test("sparse evidence cannot let one school monopolize targeted searches and initial queries stay focused", async () => {
  const f = prefilterFixture({
    cities: ["杭州"],
    schoolNames: ["杭州电子科技大学"],
  });
  const report = await f.create().generate({
    subjectId: f.run.subjectId,
    run: f.run,
    strategy: "two-stage",
  });
  const targeted = f.questions.filter(
    (q) => q.startsWith("杭州电子科技大学") && !q.includes("招生专业目录"),
  );
  const officialTargeted = targeted.filter((q) =>
    q.includes("site:hdu.edu.cn"),
  );
  const externalTargeted = targeted.filter(
    (q) => !q.includes("site:hdu.edu.cn"),
  );
  assert.ok(
    officialTargeted.length > 0 &&
      officialTargeted.length <= B.prioritySchoolSearches,
  );
  assert.ok(externalTargeted.length > 0 && externalTargeted.length <= 7);
  assert.ok(f.questions.length <= B.searches);
  const initial = f.questions.filter((q) => q.includes("招生专业目录"));
  assert.ok(
    initial.length > 0 &&
      initial.every((q) => q.length < 100 && !q.includes("报录比")),
  );
  assert.ok(
    initial.some((q) => q.includes(`${f.run.inputSnapshot.profile.year}年`)),
    "the first catalogue query must include the target year; recovery retains historical years",
  );
  assert.ok(
    f.questions.some(
      (q) =>
        !q.startsWith("杭州电子科技大学") &&
        q.includes("硕士招生专业目录 site:"),
    ),
  );
  assert.ok(
    f.questions.every(
      (q) => q.startsWith("杭州电子科技大学") || !q.includes("复试基本分数线"),
    ),
    "unknown programmes must recover a catalog instead of assuming score evidence exists",
  );
  assert.equal(report.recommendations.length, 1);
});

test("table spans are local, bounded, and never inferred for undeclared missing cells", () => {
  const body =
    '<table><tr><td rowspan="2">工学院</td><td>080200</td></tr><tr><td>085500</td></tr></table>';
  assert.equal(
    (expandResearchTableSpans(body).match(/工学院/g) ?? []).length,
    2,
  );
  assert.equal(
    (
      expandResearchTableSpans(
        "<table><tr><td>" + body + "</td></tr></table>",
      ).match(/工学院/g) ?? []
    ).length,
    2,
  );
  const next = "<table><tr><td>085500</td></tr></table>";
  assert.ok(expandResearchTableSpans(body + next).endsWith(next));
  const absent = body.replace(' rowspan="2"', "");
  assert.equal(expandResearchTableSpans(absent), absent);
  const malformed = body.replace('rowspan="2"', 'rowspan="1001"');
  assert.equal(expandResearchTableSpans(malformed), malformed);
  assert.deepEqual(
    researchTextRows("学院 |\n代码 |\n\n工学院 |\n080200 |").map(
      (r) => r.cells,
    ),
    [["学院", "代码"], undefined, ["工学院", "080200"]],
  );
});

test("final token headroom is bounded internal configuration", () => {
  for (const finalTokenHeadroom of [-1, 0.5, 56385, Infinity])
    assert.throws(() => resolveModelRequest({ finalTokenHeadroom }));
  const selected = resolveModelRequest({ finalTokenHeadroom: 56384 });
  assert.equal("finalTokenHeadroom" in selected, false);
});
