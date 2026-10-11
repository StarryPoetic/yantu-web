import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reportMessages,
  validateReport,
} from "../../server/explanation/research.ts";
import { planningMessages } from "../../server/explanation/research-planning.ts";
import { sourceCitationInstruction } from "../../server/explanation/source-citations.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import type { ProgramFact } from "../../server/explanation/research-facts.ts";

const run = generateGuidance({
  subjectId: "citation-test",
  guidanceRunId: "citation-test",
  generatedAt: "2026-10-11T00:00:00Z",
  profile: {
    ...blankProfile(),
    year: "2027",
    major: "机械工程",
    cities: ["杭州"],
  },
  profileVersion: 1,
  selectionVersion: 1,
  confirmedMajorId: "0802",
  excludedMajorIds: [],
  assessments: [],
});
const disciplines = getDisciplineCatalog().items.filter((d) =>
  ["0802", "0101", "0307"].includes(d.code),
);
const plan = { directions: [], followUpQuestions: [] };
const page = (i = 0): WebSource => ({
  id: `library-${i}`,
  url: `https://grs.hdu.edu.cn/page${i}`,
  title: "2027年硕士招生专业目录",
  excerpt:
    "杭州电子科技大学2027年硕士研究生招生专业目录\n010机械工程学院 080200机械工程 学术学位 全日制 初试101政治201英语一301数学一812机械工程综合",
  kind: "official_page",
  verified: false,
  retrievedAt: run.generatedAt,
});

test("all citation prompts use a descriptive placeholder and exact current source IDs", () => {
  const sent = reportMessages(run, plan, disciplines, [page()], "2027");
  assert.ok(sent[0].content.includes(sourceCitationInstruction));
  assert.ok(sent[0].content.includes('"citations":["<sources[].id 原值>"]'));
  assert.ok(
    planningMessages(run)[0].content.includes("不提供sources，不输出citations"),
  );
  for (const file of [
    "research.ts",
    "research-generation.ts",
    "research-planning.ts",
    "web.ts",
  ]) {
    const code = readFileSync(
      new URL(`../../server/explanation/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      code,
      /citations["']?\s*:\s*\[\s*["'](?:research-\d+|web-\d+|library-[\da-f]+)["']/,
    );
  }
});

test("an empty final source set stops before invoking the model with NO_WEB_EVIDENCE", async () => {
  let requests = 0;
  const runtime = createModelRuntime({
    adapter: {
      async complete() {
        requests++;
        throw new Error("must not invoke");
      },
    },
  });
  for (const sources of [
    [],
    [{ ...page(), kind: "search_snippet" as const }],
  ]) {
    await assert.rejects(
      async () =>
        runtime.run(
          "citation-test",
          "empty",
          reportMessages(run, plan, disciplines, sources, "2027"),
          (raw) => raw,
        ),
      { code: "NO_WEB_EVIDENCE" },
    );
  }
  assert.equal(requests, 0);
});

test("source caps, URL deduplication and character pruning never leave dangling fact references", () => {
  const sources = Array.from({ length: B.modelSources + 8 }, (_, i) => ({
    ...page(i),
    excerpt: page(i).excerpt + "公开长文。".repeat(500),
  }));
  sources.push({ ...sources[0], id: "alias" });
  const makeFact = (i: number): ProgramFact => ({
    schoolName: "杭州电子科技大学",
    registrableDomain: "hdu.edu.cn",
    majorCode: "080200",
    programName: "机械工程",
    disciplineCode: "0802",
    degreeType: "academic",
    collegeName: `机械${i}学院`,
    year: 2027,
    field: "campus",
    value: {
      city: "杭州",
      sourceId: sources[i % sources.length].id,
      quote: "公开地址",
      supportingEvidence: [
        {
          sourceId: sources[(i + 1) % sources.length].id,
          quote: "公开目录",
          role: "program_college",
        },
      ],
    },
    quote: "公开地址".repeat(50),
    sourceId: sources[i % sources.length].id,
    sourceUrl: sources[i % sources.length].url,
    status: "bound",
    verified: false,
    retrievedAt: run.generatedAt,
    extractedAt: run.generatedAt,
    extractor: "test",
  });
  const facts = Array.from({ length: 100 }, (_, i) => makeFact(i));
  const sent = reportMessages(run, plan, disciplines, sources, "2027", facts);
  const input = JSON.parse(sent[1].content);
  const ids = new Set(input.sources.map((s: { id: string }) => s.id));
  assert.ok(ids.size > 0 && ids.size <= B.modelSources);
  assert.ok(JSON.stringify(sent).length <= B.thinkingChars - B.repairHeadroom);
  assert.ok(input.structuredFacts.length < facts.length);
  assert.ok(input.structuredFacts.length > 0);
  for (const fact of input.structuredFacts) {
    assert.ok(ids.has(fact.sourceId));
    assert.ok(ids.has(fact.value.sourceId));
    for (const ref of fact.value.supportingEvidence ?? [])
      assert.ok(ids.has(ref.sourceId));
  }
  assert.equal(sources.length, B.modelSources + 9);
  assert.equal(facts.length, 100);
});

test("the saved response's four recommendations and three facts still reject nonexistent citation IDs", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/model-completion-invalid-citations.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // Only response structure, public identities and the defective ID are retained; no private prose.
  for (const recommendation of fixture.recommendations)
    Object.assign(recommendation, {
      rationale: "依据公开原文暂定比较。",
      fitReasons: [
        { profileField: "major", reason: "专业课程关联。" },
        { profileField: "cities", reason: "培养地仍待核对。" },
      ],
      tradeoffs: ["需要补充准备。"],
      preparation: ["核对目录。"],
      uncertainties: ["年度条件待核验。"],
    });
  const result = validateReport(
    JSON.stringify(fixture),
    run,
    [page()],
    disciplines,
    "2027",
  );
  assert.equal(result.facts.length, 0);
  assert.equal(result.recommendations.length, 0);
  assert.equal(
    result.rejected.filter((code) => code === "INVALID_RESEARCH_CITATION")
      .length,
    7,
  );
  assert.equal(result.rejectedRecommendations.length, 4);
  assert.ok(
    result.rejectedRecommendations.every(
      (r) => r.code === "INVALID_RESEARCH_CITATION" && r.removedSentences === 0,
    ),
  );
});
