import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CatalogError,
  createEmptyCatalog,
  importCatalog,
  projectIdentityKey,
  publishCatalog,
  validateCatalogImport,
} from "../../server/catalog/index.ts";
import type {
  CatalogImport,
  SourceRecord,
} from "../../server/catalog/types.ts";
import { evaluateEligibility } from "../../server/recommendation/index.ts";

const bundlePath = new URL(
  "../../knowledge/catalog/review-candidates/import-hdu-2027-mechanical-draft.json",
  import.meta.url,
);
const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as CatalogImport;
const source = bundle.sources[0];
function archivedSource(record: SourceRecord) {
  const match = record.fileReference!.match(
    /^repository:(tests\/fixtures\/research-v3a6-run\d+\.json)#\/pages\/(\d+)\/source\/excerpt$/,
  );
  assert.ok(match, "must reference saved public text, not invented XLS bytes");
  const fixture = JSON.parse(
    readFileSync(new URL(`../../${match[1]}`, import.meta.url), "utf8"),
  );
  assert.match(fixture.policy, /no synthetic answers/);
  return fixture.pages[Number(match[2])].source;
}
const original = archivedSource(source);
const at = "2026-10-23T00:00:00.000Z";
const textHash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

// This test-only copy exercises the import seam in memory. It does not assert
// that the actual predecessor exists or that this review bundle was imported.
function isolatedImportFixture() {
  const isolated = structuredClone(bundle);
  for (const program of isolated.programs) program.supersedesRevisionId = null;
  return isolated;
}

const columns = [
  ["collegeIdentity", "院系所"],
  ["majorIdentity", "专业"],
  ["degreeType", "学位类型"],
  ["researchDirection", "研究方向"],
  ["studyMode", "学习方式"],
  ["acceptsRetiredSpecialPlan", "是否接收退役专项"],
  ["acceptsMinoritySpecialPlan", "是否接收少骨专项"],
  ["acceptsCounterpartSupport", "是否接收对口支援"],
  ["plannedAdmissionCount", "拟招生人数"],
  ["examSubjects", "考试科目"],
  ["interviewKnowledgeScope", "复试专业知识考查范围"],
  ["equivalentEducationAdditionalSubjects", "同等学力复试加试科目"],
] as const;
const cells = (line: string) => line.replace(/^第\d+行：/, "").split(" | ");
function cellOffset(text: string, line: string, column: number) {
  return (
    text.indexOf(line) +
    line.indexOf("：") +
    1 +
    cells(line)
      .slice(0, column)
      .reduce((offset, cell) => offset + cell.length + 3, 0)
  );
}

// Check semantic row/column binding as well as literal quotes. A valid hash and
// a matching "是/否" elsewhere in the sheet are not enough to support a claim.
function assertArchivedClaims(candidate: CatalogImport) {
  const catalogueSource = candidate.sources[0];
  const text: string = archivedSource(catalogueSource).excerpt;
  const lines = text.split("\n");
  const titleLine = lines.find((line) => line.startsWith("第1行："));
  assert.ok(titleLine, "目录标题行");
  assert.equal(cells(titleLine)[0], "2027年硕士研究生招生专业目录", "目录年度");
  assert.equal(lines[0], "工作表：rep_print_kskm3");
  assert.deepEqual(
    cells(lines[3]),
    columns.map(([, header]) => header),
    "完整表头",
  );
  for (const program of candidate.programs) {
    assert.equal(program.identity.targetAdmissionYear, 2027);
    const row = lines.findIndex((line) =>
      line.includes(`010机械工程学院 | ${program.identity.majorCode}`),
    );
    assert.ok(row >= 4, "所属专业行必须存在");
    assert.deepEqual(
      program.claims.map((claim) => claim.field).sort(),
      ["admissionYear", ...columns.map(([field]) => field)].sort(),
      "only literal catalogue fields, not actual admissions or inferred ratios",
    );
    for (const claim of program.claims) {
      assert.equal(claim.sourceId, catalogueSource.sourceId);
      assert.ok(claim.locator.startsWith(`${catalogueSource.fileReference}; `));
      assert.ok(
        claim.locator.includes(`sha256(extracted-text-utf8)=${textHash(text)}`),
      );
      const quote = claim.locator.match(
        /; UTF16-offset=(\d+); quote=([\s\S]*)$/,
      );
      assert.ok(quote, "literal text locator");
      assert.equal(
        text.slice(Number(quote[1]), Number(quote[1]) + quote[2].length),
        quote[2],
      );
      const cell = claim.locator.match(
        /; sheet=rep_print_kskm3; row=(\d+); column=(\d+);/,
      );
      assert.ok(cell, "sheet and cell locator");
      if (claim.field === "admissionYear") {
        assert.equal(claim.value, 2027);
        assert.equal(Number(cell[1]), 1);
        assert.equal(Number(cell[2]), 1);
        assert.equal(Number(quote[1]), cellOffset(text, lines[1], 0));
        assert.equal(quote[2], cells(lines[1])[0]);
        continue;
      }
      const column = columns.findIndex(([field]) => field === claim.field);
      assert.equal(Number(cell[1]), row, "所属专业行");
      assert.equal(Number(cell[2]), column + 1, "字段列");
      const header = claim.locator.match(
        /; header-UTF16-offset=(\d+); header-quote=([^;]+);/,
      );
      assert.ok(header, "missing literal header locator");
      assert.equal(header[2], columns[column][1], "字段表头");
      assert.equal(Number(header[1]), cellOffset(text, lines[3], column));
      assert.equal(
        text.slice(Number(header[1]), Number(header[1]) + header[2].length),
        header[2],
      );
      assert.equal(
        Number(quote[1]),
        cellOffset(text, lines[row], column),
        "列偏移",
      );
      assert.equal(quote[2], cells(lines[row])[column], "列原文");
      assert.equal(String(claim.value), quote[2], "列值");
      if (claim.field === "plannedAdmissionCount") {
        assert.equal(typeof claim.value, "number");
        assert.equal(claim.unit, "人");
        const note = claim.locator.match(
          /; note-UTF16-offset=(\d+); note-quote=([^;]+);/,
        );
        assert.ok(note, "拟计划必须保留人数说明");
        assert.equal(Number(note[1]), cellOffset(text, lines[2], 0));
        assert.equal(note[2], cells(lines[2])[0]);
        assert.match(note[2], /含拟接收推免生人数.*调整招生计划.*仅供参考/);
        assert.match(claim.scope, /拟招生人数.*含拟接收推免.*非实际录取/);
      } else assert.equal(claim.unit, null);
    }
  }
}

test("review revision passes schema but cannot import without its actual predecessor", () => {
  assert.deepEqual(validateCatalogImport(bundle), { valid: true, errors: [] });
  const before = structuredClone(bundle);
  const empty = createEmptyCatalog();
  assert.throws(
    () => importCatalog(empty, bundle, { actor: "test-only", at }),
    (error) =>
      error instanceof CatalogError && error.code === "REVISION_LINK_INVALID",
  );
  assert.deepEqual(empty, createEmptyCatalog());
  assert.deepEqual(bundle, before);
  for (const p of bundle.programs) {
    assert.equal(p.programRevisionId, `${p.programId}:draft-20261023-2`);
    assert.equal(p.supersedesRevisionId, `${p.programId}:draft-20261020-1`);
    for (const claim of p.claims) {
      assert.equal(claim.claimId, `${p.programRevisionId}:${claim.field}`);
      const previousFields = [
        "admissionYear",
        "collegeIdentity",
        "majorIdentity",
        "degreeType",
        "researchDirection",
        "studyMode",
        "examSubjects",
      ];
      assert.equal(
        claim.supersedesClaimId,
        previousFields.includes(claim.field)
          ? `${p.programId}:${claim.field}`
          : null,
      );
    }
  }
});

test("test-only isolated memory copy stays draft and cannot publish", () => {
  const isolated = isolatedImportFixture();
  const empty = createEmptyCatalog();
  const state = importCatalog(empty, isolated, {
    actor: "test-only 内存副本（非人工复核）",
    at,
  });
  assert.equal(state.revisions.length, 2);
  assert.deepEqual(state.releases, []);
  assert.equal(state.activeCatalogVersion, null);
  assert.equal(empty.revisions.length, 0);
  assert.ok(
    state.audit.every(
      (a) => a.action === "import" && a.actor.includes("非人工复核"),
    ),
  );
  for (const p of state.revisions) {
    assert.equal(p.reviewStatus, "draft");
    assert.equal(p.publicationStatus, "unpublished");
    assert.equal(p.availability, "unverified");
    assert.equal(p.isExample, false);
  }
  assert.throws(
    () =>
      publishCatalog(state, {
        catalogVersion: "must-not-publish-drafts",
        revisionIds: state.revisions.map((p) => p.programRevisionId),
        reviewer: "test-only-no-real-review",
        at,
        summary: "negative test",
      }),
    /只可发布已审核/,
  );
});

test("annual identities match the original coded college, direction, degree and study mode", () => {
  assert.equal(new Set(bundle.programs.map(projectIdentityKey)).size, 2);
  assert.deepEqual(
    bundle.programs.map((p) => p.identity.majorCode),
    ["080200", "085500"],
  );
  assert.deepEqual(
    bundle.programs.map((p) => p.identity.degreeType),
    ["academic", "professional"],
  );
  for (const p of bundle.programs) {
    assert.equal(p.identity.targetAdmissionYear, 2027);
    assert.equal(p.identity.collegeId, "college:hdu.edu.cn:010");
    assert.equal(p.identity.directionId, "direction:00");
    assert.equal(p.identity.studyMode, "full_time");
    assert.equal(p.identity.campusId, null);
    assert.equal(p.identity.admissionUnitId, null);
    assert.equal(p.identity.examGroupId, null);
    const row = original.excerpt
      .split("\n")
      .find((line: string) =>
        line.includes(`010机械工程学院 | ${p.identity.majorCode}`),
      );
    assert.ok(row);
    assert.ok(
      row.includes(
        p.identity.degreeType === "academic" ? "学术学位" : "专业学位",
      ),
    );
    assert.match(row, /00不区分研究方向 \| \(1\)全日制/);
  }
});

test("all 26 claims preserve exact year, row, column and header provenance without human review", () => {
  assertArchivedClaims(bundle);
  assert.equal(bundle.programs.flatMap((p) => p.claims).length, 26);
  assert.equal(original.verified, false);
  assert.equal(source.verifiedAt, null);
  assert.equal(
    source.contentHash,
    null,
    "saved text must not impersonate original XLS bytes",
  );
  assert.equal(source.publishedAt, null);
  assert.equal(source.url, original.url);
  assert.equal(source.collectedAt, original.retrievedAt);
  assert.match(source.usageRestrictions, /不代替原件哈希/);
  for (const p of bundle.programs)
    for (const claim of p.claims) {
      assert.equal(claim.availability, "unverified");
      assert.equal(claim.reviewedBy, null);
      assert.equal(claim.enteredBy, "Codex（自动整理，非人工复核）");
      assert.equal(claim.targetAdmissionYear, 2027);
      assert.equal(claim.sourceId, source.sourceId);
      assert.ok(
        claim.locator.includes(
          `sha256(extracted-text-utf8)=${textHash(original.excerpt)}`,
        ),
      );
      const location = claim.locator.match(
        /; UTF16-offset=(\d+); quote=([\s\S]*)$/,
      )!;
      assert.ok(location);
      assert.equal(
        original.excerpt.slice(
          Number(location[1]),
          Number(location[1]) + location[2].length,
        ),
        location[2],
      );
      assert.ok(location[2].includes(String(claim.value)));
    }
});

test("actual archived announcement links the XLS without promoting a navigation page or copying its publication date", () => {
  assert.equal(bundle.sources.length, 2);
  const parentRecord = bundle.sources[1];
  const parent = archivedSource(parentRecord);
  const linkReference =
    "repository:tests/fixtures/research-v3a6-run9.json#/pages/278/source/documentLinks/0";
  assert.equal(parentRecord.url, original.provenance.parentUrl);
  assert.equal(parent.url, parentRecord.url);
  assert.deepEqual(parent.documentLinks[0], {
    url: source.url,
    title: source.title,
  });
  assert.ok(parent.excerpt.includes(source.title));
  assert.ok(
    !original.provenance.identityExcerpt.includes(source.title),
    "the original identity excerpt is only navigation",
  );
  assert.ok(source.usageRestrictions.includes(linkReference));
  assert.ok(parentRecord.usageRestrictions.includes(linkReference));
  assert.equal(parentRecord.collectedAt, parent.retrievedAt);
  assert.equal(parentRecord.publishedAt, "2026-09-29");
  assert.ok(parent.excerpt.includes(`发布时间：${parentRecord.publishedAt}`));
  assert.equal(
    source.publishedAt,
    null,
    "announcement date is not an XLS version date",
  );
  assert.equal(parentRecord.contentHash, null);
  assert.equal(parentRecord.verifiedAt, null);
  assert.equal(parent.verified, false);
  assert.ok(
    parentRecord.usageRestrictions.includes(
      `sha256(extracted-text-utf8)=${textHash(parent.excerpt)}`,
    ),
  );
  const titleLocator = parentRecord.usageRestrictions.match(
    /附件标题UTF16-offset=(\d+); quote=([^；]+)/,
  );
  assert.ok(titleLocator);
  assert.equal(
    parent.excerpt.slice(
      Number(titleLocator[1]),
      Number(titleLocator[1]) + titleLocator[2].length,
    ),
    source.title,
  );
  assert.equal(original.library.status, "stale");
  const limitations = bundle.coverage.limitations.join("\n");
  assert.ok(limitations.includes(original.retrievedAt));
  assert.ok(limitations.includes(original.library.expiresAt));
  assert.match(limitations, /stale.*本次未重新读取官网/);
  assert.match(limitations, /原XLS字节.*独立审核.*再分发许可仍缺/);
  for (const p of bundle.programs)
    assert.deepEqual(
      p.sourceIds,
      bundle.sources.map((s) => s.sourceId),
    );
});

test("special-plan flags, tentative headcounts, interview scope and additional exams retain separate populations", () => {
  for (const p of bundle.programs) {
    const claims = new Map(p.claims.map((c) => [c.field, c]));
    const planned = claims.get("plannedAdmissionCount")!;
    assert.equal(planned.value, p.identity.majorCode === "080200" ? 37 : 130);
    assert.match(planned.scope, /不作比率分母/);
    for (const [field, value] of [
      ["acceptsRetiredSpecialPlan", "是"],
      ["acceptsMinoritySpecialPlan", "否"],
      ["acceptsCounterpartSupport", "否"],
    ]) {
      assert.equal(claims.get(field)!.value, value);
      assert.match(
        claims.get(field)!.scope,
        /非个人资格判定、非名额、非联合培养结论/,
      );
    }
    const interview = claims.get("interviewKnowledgeScope")!;
    assert.equal(
      interview.value,
      "机械制造工程原理,理论力学,材料力学,机械设计,机械工程控制基础,机械工程图学,机械原理",
    );
    assert.match(interview.scope, /复试.*非初试科目、非任选组/);
    const additional = claims.get("equivalentEducationAdditionalSubjects")!;
    assert.equal(additional.value, "微机原理及应用,机械设计");
    assert.match(
      additional.scope,
      /仅同等学力考生复试加试科目.*不代表报考资格已满足/,
    );
    assert.equal(p.subjects.length, 4);
    assert.ok(!p.subjects.some((s) => /微机原理|^机械设计$/.test(s.name)));
    assert.deepEqual(p.eligibility.conditions, []);
    assert.equal(p.eligibility.complete, false);
    assert.deepEqual(p.historyScoreRecords, []);
  }
});

test("archive checks reject cross-program locators even when both cells have the same literal value", () => {
  const wrongRow = structuredClone(bundle);
  const academic = wrongRow.programs[0].claims.find(
    (c) => c.field === "collegeIdentity",
  )!;
  academic.locator = wrongRow.programs[1].claims.find(
    (c) => c.field === "collegeIdentity",
  )!.locator;
  assert.throws(() => assertArchivedClaims(wrongRow), /所属专业行/);

  const wrongColumn = structuredClone(bundle);
  const minority = wrongColumn.programs[0].claims.find(
    (c) => c.field === "acceptsMinoritySpecialPlan",
  )!;
  minority.locator = wrongColumn.programs[0].claims.find(
    (c) => c.field === "acceptsCounterpartSupport",
  )!.locator;
  assert.throws(() => assertArchivedClaims(wrongColumn), /字段列/);

  const missingHeader = structuredClone(bundle);
  missingHeader.programs[0].claims[1].locator =
    missingHeader.programs[0].claims[1].locator.replace(
      /header-UTF16-offset=\d+; header-quote=[^;]+; /,
      "",
    );
  assert.throws(() => assertArchivedClaims(missingHeader), /header locator/);
});

test("real historical 811 and archived navigation cannot stand in for the 2027 catalogue", () => {
  const historical = structuredClone(bundle);
  historical.sources[0].fileReference =
    "repository:tests/fixtures/research-v3a6-run11.json#/pages/241/source/excerpt";
  const oldText = archivedSource(historical.sources[0]).excerpt;
  assert.match(oldText, /2026年硕士研究生招生专业目录/);
  const oldRow = oldText
    .split("\n")
    .find((line: string) => line.includes("010机械工程学院 | 080200机械工程"));
  assert.ok(oldRow);
  assert.match(oldRow, /811\s+机械原理/);
  const oldNote = oldText
    .split("\n")
    .find((line: string) => line.startsWith("第2行："));
  assert.match(oldNote, /不含拟接收推免生人数/);
  assert.throws(() => assertArchivedClaims(historical), /目录年度/);

  const oldSubject = structuredClone(bundle);
  oldSubject.programs[0].claims.find((c) => c.field === "examSubjects")!.value =
    "①101思想政治理论②201英语（一）③301数学（一）④811机械原理";
  assert.throws(() => assertArchivedClaims(oldSubject), /列值/);

  const navigation = structuredClone(bundle);
  navigation.sources[0] = { ...bundle.sources[1], sourceId: source.sourceId };
  assert.throws(() => assertArchivedClaims(navigation));
});

test("tentative counts cannot lose their qualifier or become actual admissions", () => {
  const missingNote = structuredClone(bundle);
  const planned = missingNote.programs[0].claims.find(
    (c) => c.field === "plannedAdmissionCount",
  )!;
  planned.locator = planned.locator.replace(
    /note-UTF16-offset=\d+; note-quote=[^;]+; /,
    "",
  );
  assert.throws(
    () => assertArchivedClaims(missingNote),
    /拟计划必须保留人数说明/,
  );

  const actual = structuredClone(bundle);
  actual.programs[0].claims.find(
    (c) => c.field === "plannedAdmissionCount",
  )!.field = "actualAdmissionCount";
  assert.throws(
    () => assertArchivedClaims(actual),
    /only literal catalogue fields/,
  );

  const otherProgramCount = structuredClone(bundle);
  otherProgramCount.programs[0].claims.find(
    (c) => c.field === "plannedAdmissionCount",
  )!.value = 130;
  assert.throws(() => assertArchivedClaims(otherProgramCount), /列值/);
});

test("2027 subjects use 812 and cannot silently inherit the historical 811 or default score maxima", () => {
  for (const p of bundle.programs) {
    assert.deepEqual(
      p.subjects.map((s) => s.subjectId.split(":").at(-1)),
      ["101", "201", "301", "812"],
    );
    assert.deepEqual(
      p.subjects.map((s) => s.name),
      ["思想政治理论", "英语（一）", "数学（一）", "机械工程综合"],
    );
    for (const s of p.subjects) {
      assert.equal(s.maxScore, null);
      assert.equal(s.minimumScore, null);
      assert.equal(s.optionGroupId, null);
      assert.equal(s.availability, "unverified");
      assert.deepEqual(s.sourceIds, [source.sourceId]);
    }
    assert.equal(p.scoreRequirements.totalMaxScore, null);
    assert.equal(p.scoreRequirements.totalMinimumScore, null);
    assert.equal(p.scoreRequirements.interviewRequirement, null);
    assert.equal(p.scoreRequirements.availability, "missing");
    assert.equal(p.tuitionPerYear, null);
    assert.equal(p.durationYears, null);
  }
});

test("missing eligibility and location stay unknown across profile choices rather than making a recommendation", () => {
  for (const p of bundle.programs) {
    assert.equal(p.eligibility.complete, false);
    assert.equal(p.eligibility.availability, "missing");
    assert.deepEqual(p.eligibility.conditions, []);
    assert.equal(p.display.city, "培养地点待核验");
    assert.deepEqual(p.majorDirectionIds, []);
    assert.deepEqual(p.historyScoreRecords, []);
    assert.deepEqual(p.evidence, []);
    assert.deepEqual(p.risks, []);
    for (const profile of [
      {},
      { city: "杭州", degree: "bachelor" },
      { city: "上海", crossMajor: true },
    ])
      assert.equal(evaluateEligibility(p, profile, 2027).status, "unknown");
  }
});

for (const level of ["program", "claim", "source-only"] as const)
  test(`unreviewed ${level} cannot silently promote availability`, () => {
    const promoted = structuredClone(bundle);
    if (level === "program")
      promoted.programs[0].availability = "verified_current";
    else promoted.programs[0].claims[0].availability = "verified_current";
    if (level === "source-only") promoted.sources[0].verifiedAt = at;
    assert.equal(validateCatalogImport(promoted).valid, false);
    assert.match(validateCatalogImport(promoted).errors.join(" "), /核验|复核/);
  });

test("a test reviewer cannot promote a claim backed by an unverified source", () => {
  const promoted = structuredClone(bundle);
  promoted.programs[0].claims[0].availability = "verified_current";
  promoted.programs[0].claims[0].reviewedBy = "test-only reviewer";
  assert.equal(promoted.sources[0].verifiedAt, null);
  const validation = validateCatalogImport(promoted);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /必须引用经过核验的非示例来源/);
});

test("test-only isolated annual identity cannot be reused for another year", () => {
  const isolated = isolatedImportFixture();
  const state = importCatalog(createEmptyCatalog(), isolated, {
    actor: "test-only 内存副本（非人工复核）",
    at,
  });
  const wrongYear = structuredClone(isolated);
  wrongYear.coverage.years = [2028];
  for (const p of wrongYear.programs) {
    p.programRevisionId += "-wrong-year";
    p.identity.targetAdmissionYear = 2028;
    for (const claim of p.claims) claim.targetAdmissionYear = 2028;
  }
  assert.throws(
    () => importCatalog(state, wrongYear, { actor: "test", at }),
    /项目 ID 不得复用/,
  );
});
