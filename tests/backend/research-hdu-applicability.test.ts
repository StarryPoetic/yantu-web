import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { webPageText } from "../../server/explanation/web.ts";
import { nationalAssociationAudit } from "../../scripts/research-association-audit.ts";
import {
  buildEvidenceAudit,
  loadEvidenceCorpus,
} from "../../scripts/research-evidence-audit.ts";
import {
  resolveNationalLineChain,
  type NationalLineChain,
} from "../../server/explanation/research-national-line-chain.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const file = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url));
const json = (path: string) => JSON.parse(file(path).toString("utf8"));
const supplement = json("tests/fixtures/research-a-hdu-applicability.json");
const national = json("tests/fixtures/research-a-national-lines.json");
const corpus = loadEvidenceCorpus();
const sources: WebSource[] = [
  ...corpus.pages,
  ...supplement.pages,
  ...national.pages,
].flatMap((p) => (p.source ? [p.source] : []));
const target = corpus.latest.fixture.runs[0].recommendations.find(
  (r) => r.institutionName === "杭州电子科技大学",
)!;
const chains = nationalAssociationAudit([target], sources);
const complete = chains.find((c) => c.year === 2026)!;
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

test("four public originals retain bytes, hashes, true acquisition time and deterministic text", () => {
  const capture = json("tests/fixtures/source-evidence-20261111/capture.json");
  assert.equal(capture.newUniqueEntrances, 10);
  assert.equal(capture.paidCalls, 0);
  assert.equal(capture.humanReviewed, false);
  assert.equal(supplement.pages.length, 4);
  for (const page of supplement.pages) {
    const bytes = file(page.rawFile);
    const record = capture.records.find(
      (r: { url: string }) => r.url === page.url,
    );
    assert.equal(record.status, 200);
    assert.equal(bytes.length, record.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      record.sha256,
    );
    assert.equal(page.rawBytesSha256, record.sha256);
    assert.match(record.attemptedAt, /^2026-11-11T13:59:/);
    assert.equal(page.source.retrievedAt, record.attemptedAt);
    assert.equal(page.source.excerpt, webPageText(bytes.toString("utf8")));
    assert.equal(page.source.verified, false);
  }
  const matrix = capture.records.at(-1);
  assert.equal(matrix.status, 302);
  assert.equal(
    matrix.file,
    null,
    "redirect does not fabricate an original PDF",
  );
});

test("HDU2026 closes the exact ordinary professional A-line chain; prior years keep missing identity", () => {
  assert.equal(complete.status, "complete_chain");
  assert.equal(complete.fact!.value.number, 264);
  assert.deepEqual(complete.fact!.value.singleSubject, {
    maximum100: 35,
    above100: 53,
  });
  assert.equal(complete.fact!.majorCode, "085500");
  assert.equal(complete.fact!.verified, false);
  assert.equal(complete.passages.length, 9);
  for (const chain of chains.filter((c) => c.year !== 2026)) {
    assert.equal(chain.status, "incomplete_chain");
    assert.ok(chain.passages.some((p) => p.role === "applicability"));
    assert.ok(chain.missing.some((reason) => reason.includes("专业代码身份")));
    assert.equal(chain.fact, undefined);
  }
  const audit = buildEvidenceAudit();
  assert.equal(audit.reviewProgress.currentConfirmable, 12);
  assert.equal(audit.reviewProgress.currentPending, 63);
  assert.equal(audit.reviewProgress.humanReviewed, 0);
  assert.deepEqual(audit.corpus, { urls: 1512, bodies: 404 });
  assert.equal(audit.rows.length, 75);
  assert.equal(audit.baseline.coverage.confirmed, 9);
});

test("HDU chain refuses removed passages, wrong college/year/degree/columns and academic rows", () => {
  for (const passage of complete.passages)
    assert.equal(
      resolveNationalLineChain({ ...input, [passage.role]: undefined }).fact,
      undefined,
      passage.role,
    );
  for (const change of [
    { year: 2025 },
    { collegeName: "电子信息学院" },
    { majorCode: "080200" },
    { schoolName: "浙江科技大学" },
  ])
    assert.equal(
      resolveNationalLineChain({ ...input, ...change }).fact,
      undefined,
    );
  for (const replacement of ["非全日制", "学术学位"]) {
    const old = input.identity!;
    const quote = old.quote.replace(
      replacement === "非全日制" ? "全日制" : "专业学位",
      replacement,
    );
    const source = {
      ...old.source,
      excerpt: old.source.excerpt.replace(old.quote, quote),
    };
    assert.equal(
      resolveNationalLineChain({
        ...input,
        identity: { source, quote },
        degree: { source, quote },
        identityColumns: { ...input.identityColumns!, source },
      }).fact,
      undefined,
    );
  }
  const old = input.identityColumns!;
  const quote = old.quote.replace("学位类型 | 学习方式", "学习方式 | 学位类型");
  const source = {
    ...old.source,
    excerpt: old.source.excerpt.replace(old.quote, quote),
  };
  assert.equal(
    resolveNationalLineChain({
      ...input,
      identity: { ...input.identity!, source },
      degree: { ...input.degree!, source },
      identityColumns: { source, quote },
    }).fact,
    undefined,
  );
  const wrongHeaderSource = {
    ...input.identity!.source,
    excerpt: input.identity!.source.excerpt.replace(
      input.identity!.quote,
      `${quote}\n${input.identity!.quote}`,
    ),
  };
  assert.equal(
    resolveNationalLineChain({
      ...input,
      identity: { ...input.identity!, source: wrongHeaderSource },
      degree: { ...input.degree!, source: wrongHeaderSource },
      identityColumns: { ...input.identityColumns!, source: wrongHeaderSource },
    }).fact,
    undefined,
    "later table columns cannot borrow an earlier matching header",
  );
  for (const replacement of ["330", "自划线"]) {
    const oldRow = input.identity!;
    const quote = oldRow.quote.replace(
      replacement === "330" ? "264" : "国家线",
      replacement,
    );
    const source = {
      ...oldRow.source,
      excerpt: oldRow.source.excerpt.replace(oldRow.quote, quote),
    };
    assert.equal(
      resolveNationalLineChain({
        ...input,
        identity: { source, quote },
        degree: { source, quote },
        identityColumns: { ...input.identityColumns!, source },
      }).fact,
      undefined,
      "contradictory school cutoffs cannot become a national-line chain",
    );
  }
});

test("a national-column statistic, navigation reference, floor or special exception cannot substitute for execution", () => {
  const historical = nationalAssociationAudit(
    [target],
    corpus.pages.flatMap((p) => (p.source ? [p.source] : [])),
  );
  assert.ok(historical.every((c) => c.status === "incomplete_chain"));
  const original = input.applicability!;
  for (const replacement of [
    "专业型硕士研究生复试分数线不低于国家 A 类复试线要求",
    "专业型硕士研究生复试分数线为国家 B 类复试线要求",
    "学术型硕士研究生复试分数线为国家 A 类复试线要求",
  ]) {
    const source = {
      ...original.source,
      excerpt: original.source.excerpt.replace(original.quote, replacement),
    };
    assert.equal(
      resolveNationalLineChain({
        ...input,
        applicability: { source, quote: replacement },
      }).fact,
      undefined,
    );
  }
  for (const extra of [
    "机械专业另行划线。",
    "退役大学生士兵专项计划复试规则",
    "机械专业分数线高于国家线。",
  ])
    assert.equal(
      resolveNationalLineChain({
        ...input,
        applicability: {
          ...original,
          source: {
            ...original.source,
            excerpt: `${original.source.excerpt}\n${extra}`,
          },
        },
      }).fact,
      undefined,
    );
  assert.equal(
    resolveNationalLineChain({
      ...input,
      applicability: {
        ...original,
        source: { ...original.source, title: "招生导航" },
      },
    }).fact,
    undefined,
  );
});
