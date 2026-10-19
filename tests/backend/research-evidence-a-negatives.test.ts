import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import {
  extractPriorityFacts,
  priorityFactMatches,
} from "../../server/explanation/research-priority-facts.ts";
import type { WebSource } from "../../server/explanation/web.ts";
const pages = JSON.parse(
  readFileSync("tests/fixtures/research-v3a6-run11.json", "utf8"),
).pages as { source: WebSource }[];
const disciplines = getDisciplineCatalog().items.filter((d) =>
  ["0802", "0855"].includes(d.code),
);
const extract = (index: number) =>
  extractPriorityFacts(pages[index].source, disciplines, "2027");

test("real ZJNU planned seats and excluded recommended students cannot become actual admitted counts", () => {
  for (const index of [298, 302]) {
    assert.match(
      pages[index].source.excerpt,
      /计划数（不含已录取的推免生人数）/,
    );
    assert.match(pages[index].source.excerpt, /085500/);
    assert.equal(
      extract(index).filter(
        (fact) =>
          fact.field === "admittedCount" ||
          fact.field === "recommendationShare",
      ).length,
      0,
    );
  }
});

test("real ZAFU interview pass mark 60 is not an initial-examination cutoff or a national-line number", () => {
  assert.match(
    pages[702].source.excerpt,
    /复试总成绩（按百分制折算）低于60分考生/,
  );
  assert.equal(
    extract(702).filter((fact) => fact.field === "cutoff").length,
    0,
  );
});

test("real ZUST first transfer batch at another college cannot fill the target project's admissions slots", () => {
  assert.match(pages[558].source.excerpt, /生物与化学工程学院/);
  assert.match(pages[558].source.excerpt, /调剂/);
  const target = {
    institutionName: "浙江科技大学",
    disciplineCode: "0855",
    majorCode: "085500",
    collegeName: "艺术设计与服装学院",
  };
  assert.equal(
    extract(558).filter(
      (fact) =>
        priorityFactMatches(fact, target) &&
        ["cutoff", "admissionScore", "admittedCount"].includes(fact.field),
    ).length,
    0,
  );
});
