import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEvidenceAudit,
  loadEvidenceCorpus,
  repositoryRoot,
} from "../../scripts/research-evidence-audit.ts";
import { nationalAssociationAudit } from "../../scripts/research-association-audit.ts";
import {
  resolveNationalLineChain,
  type NationalLineChain,
} from "../../server/explanation/research-national-line-chain.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import { resolve } from "node:path";
import { extractPriorityFacts } from "../../server/explanation/research-priority-facts.ts";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";

const corpus = loadEvidenceCorpus();
const supplement = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "tests/fixtures/research-a-national-lines.json"),
    "utf8",
  ),
) as { pages: { source: WebSource }[] };
const chains = nationalAssociationAudit(
  corpus.latest.fixture.runs[0].recommendations,
  [...corpus.pages, ...supplement.pages].flatMap((p) =>
    p.source ? [p.source] : [],
  ),
);
const complete = chains.find((c) => c.status === "complete_chain")!;
const input: NationalLineChain = {
  schoolName: complete.schoolName,
  collegeName: complete.collegeName!,
  majorCode: complete.majorCode!,
  year: complete.year,
  ...Object.fromEntries(
    complete.passages.map((p) => [
      p.role,
      { source: p.source, quote: p.quote },
    ]),
  ),
};

test("real ZAFU 2026 chain binds the ordinary A-region engineering row, never B/care/special columns", () => {
  assert.equal(chains.length, 15);
  assert.equal(chains.filter((c) => c.status === "complete_chain").length, 1);
  const { fact } = resolveNationalLineChain(input);
  assert.equal(fact!.schoolName, "浙江农林大学");
  assert.equal(fact!.collegeName, "光机电工程学院");
  assert.equal(fact!.majorCode, "085500");
  assert.equal(fact!.value.number, 264);
  assert.deepEqual(fact!.value.singleSubject, { maximum100: 35, above100: 53 });
  assert.equal(fact!.value.maximum, undefined);
  assert.match(fact!.value.population!, /普通考生.*不延伸专项/);
  assert.ok(input.applicability!.source.excerpt.includes(fact!.quote));
  assert.equal(fact!.quote.includes("264"), false, "no synthetic school quote");
});

test("removing any original or using another year/college/programme keeps the chain pending", () => {
  for (const p of complete.passages)
    assert.equal(
      resolveNationalLineChain({ ...input, [p.role]: undefined }).fact,
      undefined,
      p.role,
    );
  for (const change of [
    { year: 2025 },
    { collegeName: "艺术设计学院" },
    { majorCode: "080200" },
    { schoolName: "浙江理工大学" },
  ])
    assert.equal(
      resolveNationalLineChain({ ...input, ...change }).fact,
      undefined,
    );
  const wrongYearRow = supplement.pages[0].source;
  assert.equal(
    resolveNationalLineChain({
      ...input,
      nationalRow: {
        source: wrongYearRow,
        quote: wrongYearRow.excerpt
          .split("\n")
          .find((l) => /^工学\[08\].*其他学科/.test(l))!,
      },
    }).fact,
    undefined,
  );
  const care = input
    .nationalRow!.source.excerpt.split("\n")
    .find((l) => /^工学\[08\].*工学照顾/.test(l))!;
  assert.equal(
    resolveNationalLineChain({
      ...input,
      nationalRow: { ...input.nationalRow!, quote: care },
    }).fact,
    undefined,
  );
});

test("an execution sentence cannot hide a later programme exception or a special-plan section", () => {
  for (const boundary of [
    "机械专业另行划线。",
    "机械专业分数线高于国家线。",
    "退役大学生士兵专项计划复试规则",
  ]) {
    const original = input.applicability!;
    const source = {
      ...original.source,
      excerpt: original.source.excerpt.replace(
        original.quote,
        `${boundary}\n${original.quote}`,
      ),
    };
    assert.equal(
      resolveNationalLineChain({
        ...input,
        applicability: { ...original, source },
      }).fact,
      undefined,
    );
    const later = {
      ...original.source,
      excerpt: `${original.source.excerpt}\n${boundary}`,
    };
    assert.equal(
      resolveNationalLineChain({
        ...input,
        applicability: { ...original, source: later },
      }).fact,
      undefined,
    );
  }
});

test("real general floors, older exceptions and HDU national-line columns never become execution chains", () => {
  for (const chain of chains.filter((c) => c.schoolName !== "浙江农林大学"))
    assert.equal(chain.fact, undefined);
  const audit = buildEvidenceAudit();
  assert.equal(audit.assessmentChains.length, 5);
  assert.ok(
    audit.assessmentChains.every(
      (c) => c.status === "incomplete_chain" && c.missing.length === 2,
    ),
  );
  const row = audit.rows.find(
    (r) =>
      r.institutionName === "浙江农林大学" &&
      r.year === 2026 &&
      r.field === "cutoff",
  )!;
  assert.equal(row.applicableEvidence[0].associationChain.length, 8);
  assert.equal(
    new Set(row.applicableEvidence[0].associationChain.map((c) => c.source.url))
      .size,
    3,
  );
  assert.equal(audit.reviewProgress.currentConfirmable, 11);
  assert.equal(audit.reviewProgress.currentPending, 64);
});

test("assessment results with a missing or different round never acquire fourth-round status", () => {
  const source = corpus.pages.find((p) =>
    p.source?.excerpt.includes(
      "在教育部第四轮学科评估中，化学工程与技术学科获得 A-",
    ),
  )!.source!;
  const disciplines = getDisciplineCatalog().items.filter((d) =>
    ["0802", "0855"].includes(d.code),
  );
  assert.ok(
    extractPriorityFacts(source, disciplines, "2027").some(
      (f) => f.field === "disciplineAssessment",
    ),
  );
  // Counterfactual mutations of a real original test the round guard; not new evidence.
  for (const replacement of ["第五轮", "第三轮", ""]) {
    const changed = {
      ...source,
      title: source.title.replaceAll("第四轮", replacement),
      excerpt: source.excerpt.replaceAll("第四轮", replacement),
    };
    assert.equal(
      extractPriorityFacts(changed, disciplines, "2027").filter(
        (f) => f.field === "disciplineAssessment",
      ).length,
      0,
    );
  }
});
