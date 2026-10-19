import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  auditOutputs,
  buildEvidenceAudit,
  buildReviewCandidates,
  classifySlot,
  loadEvidenceCorpus,
  repositoryRoot,
  sourceReference,
} from "../../scripts/research-evidence-audit.ts";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import {
  deduplicatePriorityFacts,
  extractPriorityFacts,
  priorityCoverage,
} from "../../server/explanation/research-priority-facts.ts";

const corpus = loadEvidenceCorpus();
const audit = buildEvidenceAudit();
const pack = buildReviewCandidates();
const disciplines = getDisciplineCatalog().items.filter((d) =>
  ["0802", "0855"].includes(d.code),
);
const facts = deduplicatePriorityFacts(
  corpus.pages.flatMap((p) =>
    p.source ? extractPriorityFacts(p.source, disciplines, "2027") : [],
  ),
);

test("fixed latest-real identities retain 75 slots and separate the historical baseline from corrected evidence", () => {
  assert.deepEqual(audit.corpus, { urls: 1512, bodies: 404 });
  assert.equal(audit.rows.length, 75);
  assert.equal(new Set(audit.rows.map((r) => r.id)).size, 75);
  assert.equal(
    audit.rows.filter((r) => r.evidenceStatus === "captured_applicable").length,
    11,
  );
  assert.equal(audit.offlineCoverage.confirmed, 11);
  assert.equal(audit.offlineCoverage.pending, 64);
  assert.equal(
    audit.offlineCoverage.combined.partialAverage,
    0.09333333333333334,
  );
  assert.equal(audit.offlineCoverage.combined.completeAverage, 0);
  assert.equal(audit.baseline.coverage.confirmed, 9);
  assert.equal(audit.baseline.coverage.pending, 66);
  assert.equal(audit.baseline.coverage.confirmedCutoff.confirmed, 4);
  assert.equal(audit.baseline.coverage.confirmedAssessment.confirmed, 0);
  assert.match(audit.stageAcceptance, /不触发付费/);
});

test("every asserted passage resolves to literal saved text, its hash and UTF-16 offsets", () => {
  const refs = [
    ...audit.rows.flatMap((r) =>
      [...r.applicableEvidence, ...r.rejectedScopeEvidence].map(
        (e) => e.source,
      ),
    ),
    ...audit.rows.flatMap((r) =>
      [...r.applicableEvidence, ...r.rejectedScopeEvidence].flatMap(
        (e) => e.supportingEvidence,
      ),
    ),
    ...audit.associationEvidence.map((a) => a.source),
    ...pack.candidates.map((c) => c.source),
    ...audit.nationalLineChains.flatMap((c) => [
      ...c.evidence.map((e) => e.source),
      ...c.partialStatements,
    ]),
    ...audit.rows.flatMap((r) =>
      r.applicableEvidence.flatMap((e) =>
        e.associationChain.map((c) => c.source),
      ),
    ),
  ];
  assert.ok(refs.length > 20);
  for (const ref of refs) {
    const fixture = JSON.parse(
      readFileSync(resolve(repositoryRoot, ref.fixture), "utf8"),
    );
    const page = fixture.pages[ref.pageIndex];
    assert.equal(page.url, ref.url);
    assert.equal(
      page.source.excerpt.slice(ref.offset, ref.offset + ref.length),
      ref.quote,
    );
    assert.equal(
      createHash("sha256").update(page.source.excerpt).digest("hex"),
      ref.textSha256,
    );
    assert.equal(ref.verified, false);
    assert.equal(ref.hashScope, "saved-extracted-text-utf8");
  }
  assert.throws(
    () =>
      sourceReference(
        corpus.pages.find((p) => p.source)!,
        "不存在的合成事实999%",
      ),
    /not literal/,
  );
});

test("real admission-score positive extraction retains its population restriction", () => {
  const row = audit.rows.find(
    (r) =>
      r.institutionName === "杭州电子科技大学" &&
      r.field === "admissionScore" &&
      r.year === 2026,
  )!;
  assert.equal(row.evidenceStatus, "captured_applicable");
  assert.equal(row.applicableEvidence[0].value.number, 264);
  assert.match(row.applicableEvidence[0].value.population!, /含士兵计划/);
  assert.equal(row.confirmedByHuman, false);
  assert.equal(row.publicAvailability, "captured");
});

test("a real 085507 cutoff cannot fill the 085501 historical cutoff slot", () => {
  const row = audit.rows.find(
    (r) =>
      r.institutionName === "浙江理工大学" &&
      r.field === "cutoff" &&
      r.year === 2024,
  )!;
  assert.equal(row.evidenceStatus, "scope_not_applicable");
  assert.equal(row.applicableEvidence.length, 0);
  assert.ok(
    row.rejectedScopeEvidence.some(
      (e) => e.majorCode === "085507" && e.year === 2024,
    ),
  );
  assert.equal(row.publicAvailability, "unconfirmed");
});

test("national-line statements preserve the original 2022 caveat and missing year-specific chain", () => {
  const links = audit.associationEvidence.filter(
    (a) => a.kind === "national_line_applicability",
  );
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.match(link.source.title, /2022/);
    assert.match(link.source.quote, /部分.*高于/);
    assert.equal(link.status, "incomplete_chain");
    assert.ok(link.missing.some((m) => m.includes("2024/2025/2026")));
    assert.match(link.conclusion, /不构成/);
  }
});

test("archived authority entrances distinguish wrong rounds, other disciplines, speeches and unread matrix portal", () => {
  assert.equal(audit.authorityEntrances.length, 57);
  assert.equal(audit.authorityEntrances.filter((e) => e.captured).length, 2);
  assert.ok(
    audit.authorityEntrances.some(
      (e) => e.status === "wrong_assessment_round" && e.url.includes("a0802"),
    ),
  );
  assert.ok(
    audit.authorityEntrances.some((e) => e.status === "different_discipline"),
  );
  assert.ok(
    audit.authorityEntrances.some((e) => e.status === "speech_not_matrix"),
  );
  assert.ok(
    audit.authorityEntrances.some(
      (e) => e.status === "matrix_portal_body_not_captured",
    ),
  );
  for (const entrance of audit.authorityEntrances) {
    assert.equal(entrance.availabilityNow, "not_checked");
    assert.equal(entrance.verified, false);
    assert.equal(entrance.usablePriorityFacts, 0);
    const fixture = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, entrance.leadOrigin.fixture),
        "utf8",
      ),
    );
    assert.equal(
      fixture.pages[entrance.leadOrigin.pageIndex].url,
      entrance.url,
    );
  }
});

test("fourth-round B+ is positive evidence for 0802 and a negative for an unlinked 0855 programme", () => {
  const link = audit.associationEvidence.find(
    (a) => a.kind === "discipline_assessment_scope",
  )!;
  assert.match(link.source.quote, /机械工程.*B\+/);
  const academic = {
    institutionName: "浙江工业大学",
    disciplineCode: "0802",
    majorCode: "080200",
  };
  const professional = {
    institutionName: "浙江工业大学",
    disciplineCode: "0855",
    majorCode: "085500",
  };
  const positive = classifySlot({
    recommendation: academic,
    field: "disciplineAssessment",
    year: null,
    facts,
    pages: corpus.pages,
  });
  const negative = classifySlot({
    recommendation: professional,
    field: "disciplineAssessment",
    year: null,
    facts,
    pages: corpus.pages,
  });
  assert.equal(positive.exact.length, 1);
  assert.equal(positive.exact[0].value.grade, "B+");
  assert.equal(negative.exact.length, 0);
  assert.equal(negative.evidenceStatus, "scope_not_applicable");
  assert.equal(negative.excluded[0].disciplineCode, "0802");
});

test("actual saved estimated ratios and incomplete commercial articles contribute no exact statistics", () => {
  const references = corpus.latest.fixture.pages.filter(
    (p) => p.source?.kind === "reference_page",
  );
  assert.ok(references.length > 0);
  assert.ok(references.some((p) => /左右/.test(p.source!.excerpt)));
  for (const page of references)
    assert.equal(
      extractPriorityFacts(page.source!, disciplines, "2027").length,
      0,
    );
  const ratio = audit.rows.find(
    (r) =>
      r.institutionName === "杭州电子科技大学" &&
      r.field === "applicationAdmissionRatio",
  )!;
  assert.equal(ratio.applicableEvidence.length, 0);
  assert.match(ratio.nextAction, /分子、分母/);
});

test("unread leads and unresolved public availability remain distinct and never prove nondisclosure", () => {
  const unread = audit.rows.filter(
    (r) => r.evidenceStatus === "body_not_captured",
  );
  const unknown = audit.rows.filter(
    (r) => r.evidenceStatus === "public_availability_unconfirmed",
  );
  assert.ok(unread.length > 0 && unknown.length > 0);
  for (const row of unread) assert.ok(row.leads.some((l) => !l.captured));
  for (const row of [...unread, ...unknown]) {
    assert.equal(row.publicAvailability, "unconfirmed");
    assert.equal(row.applicableEvidence.length, 0);
    assert.equal(row.confirmedByHuman, false);
  }
});

test("small real-evidence profile matrix preserves school/degree/college scope and stable results", () => {
  const cases = [
    {
      institutionName: "杭州电子科技大学",
      disciplineCode: "0802",
      majorCode: "080200",
      collegeName: "机械工程学院",
      expected: 266,
    },
    {
      institutionName: "杭州电子科技大学",
      disciplineCode: "0855",
      majorCode: "085500",
      collegeName: "机械工程学院",
      expected: 264,
    },
    {
      institutionName: "杭州电子科技大学",
      disciplineCode: "0855",
      majorCode: "085500",
      collegeName: "其他学院",
      expected: null,
    },
    {
      institutionName: "浙江师范大学",
      disciplineCode: "0855",
      majorCode: "085500",
      collegeName: "工学院",
      expected: null,
    },
  ];
  for (const entry of cases) {
    const result = classifySlot({
      recommendation: entry,
      field: "admissionScore",
      year: 2026,
      facts,
      pages: corpus.pages,
    });
    assert.equal(result.exact[0]?.value.number ?? null, entry.expected);
    const normal = priorityCoverage(facts, [entry], "2027");
    const reversed = priorityCoverage([...facts].reverse(), [entry], "2027");
    assert.deepEqual(reversed, normal);
  }
  // The second-city source is a cutoff positive, not a fabricated admission score.
  assert.equal(
    classifySlot({
      recommendation: cases[3],
      field: "cutoff",
      year: 2025,
      facts,
      pages: corpus.pages,
    }).exact[0].value.number,
    292,
  );
});

test("real candidates cannot be mistaken for published imports, missing identities or current-year eligibility", () => {
  assert.equal(pack.importable, false);
  assert.equal(pack.verified, false);
  assert.deepEqual(pack.reviewers, []);
  assert.equal(pack.candidates.length, 8);
  assert.equal(new Set(pack.candidates.map((c) => c.institutionName)).size, 5);
  assert.equal(new Set(pack.candidates.map((c) => c.discoveryCity)).size, 2);
  assert.ok(pack.candidates.some((c) => c.collegeName === null));
  assert.ok(pack.candidates.some((c) => c.observedYear === null));
  for (const candidate of pack.candidates) {
    assert.equal(candidate.reviewStatus, "draft");
    assert.equal(candidate.publicationStatus, "unpublished");
    assert.equal(candidate.availability, "unverified");
    assert.equal(candidate.reviewedBy, null);
    assert.equal(candidate.approvedBy, null);
    assert.equal(candidate.publicationReady, false);
    assert.equal(candidate.eligibilityComplete, false);
    assert.equal(candidate.campus, null);
  }
  for (const candidate of pack.candidates.filter(
    (c) => c.institutionName === "杭州电子科技大学",
  )) {
    assert.equal(candidate.observedYear, 2027);
    assert.match(candidate.source.quote, /812机械工程综合/);
  }
});

test("committed audit, candidate pack and Chinese ledger reproduce exactly without network or environment loading", () => {
  for (const [file, expected] of auditOutputs())
    assert.equal(
      readFileSync(resolve(repositoryRoot, file), "utf8").replaceAll(
        "\r\n",
        "\n",
      ),
      expected,
      file,
    );
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["scripts/research-evidence-audit.ts", "--check"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          YANTU_SEARCH_ENABLED: "false",
          YANTU_MODEL_ENABLED: "false",
        },
      },
    ),
  );
  assert.equal(result.networkRequests, 0);
  assert.equal(result.paidCalls, 0);
  assert.equal(result.mode, "--check");
});

test("real spaced 2025 table headers recover only the exact ZSTU 085501 row and preserve literal provenance", () => {
  const page = corpus.pages.find(
    (p) => p.url === "https://gradadmission.zstu.edu.cn/info/1011/3206.htm",
  )!;
  const extracted = extractPriorityFacts(page.source!, disciplines, "2027");
  const cutoff = extracted.find(
    (f) => f.field === "cutoff" && f.majorCode === "085501",
  )!;
  assert.equal(cutoff.year, 2025);
  assert.equal(cutoff.collegeName, "机械工程学院");
  assert.equal(cutoff.value.number, 260);
  assert.deepEqual(cutoff.value.singleSubject, {
    maximum100: 34,
    above100: 51,
  });
  assert.equal(
    cutoff.value.maximum,
    undefined,
    "single-subject maxima do not establish the total maximum",
  );
  assert.equal(cutoff.value.targetGap, undefined);
  assert.ok(cutoff.evidenceQuotes!.some((q) => q.includes("专业 代码")));
  for (const quote of [cutoff.quote, ...cutoff.evidenceQuotes!])
    assert.ok(page.source!.excerpt.includes(quote));
  assert.equal(
    classifySlot({
      recommendation: {
        institutionName: "浙江理工大学",
        disciplineCode: "0855",
        majorCode: "085501",
        collegeName: "机械工程学院",
      },
      field: "cutoff",
      year: 2024,
      facts: extracted,
      pages: [page],
    }).exact.length,
    0,
  );
  assert.equal(
    classifySlot({
      recommendation: {
        institutionName: "浙江理工大学",
        disciplineCode: "0855",
        majorCode: "085507",
        collegeName: "机械工程学院",
      },
      field: "cutoff",
      year: 2025,
      facts: extracted,
      pages: [page],
    }).exact.length,
    0,
  );
});

test("review progress identifies the two promoted slots without changing the historical nine confirmations", () => {
  const progress = audit.reviewProgress;
  assert.equal(progress.baselineConfirmed, 9);
  assert.equal(progress.currentConfirmable, 11);
  assert.equal(progress.currentPending, 64);
  assert.equal(progress.confirmedDelta, 2);
  assert.equal(progress.pendingDelta, -2);
  assert.equal(progress.humanReviewed, 0);
  assert.equal(progress.demoted.length, 0);
  assert.equal(progress.promoted.length, 2);
  assert.equal(progress.promoted[0].school, "浙江理工大学");
  assert.equal(progress.promoted[0].majorCode, "085501");
  assert.equal(progress.promoted[0].year, 2025);
  assert.equal(progress.promoted[0].field, "cutoff");
  assert.ok(progress.promoted[0].evidence[0].supportingEvidence.length > 0);
});
