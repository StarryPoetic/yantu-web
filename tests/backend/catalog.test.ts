import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyCatalog,
  createSeedCatalog,
  getCatalogSnapshot,
  importCatalog,
  projectIdentityKey,
  publishCatalog,
  reviewRevision,
  validateCatalogImport,
  withdrawRevision,
} from "../../server/catalog/index.ts";
import type { CatalogImport } from "../../server/catalog/types.ts";

const at = "2026-09-27T10:00:00.000Z";
function draft(): CatalogImport {
  const snapshot = getCatalogSnapshot(createSeedCatalog());
  const program = structuredClone(snapshot.programs[0]);
  program.reviewStatus = "draft";
  program.publicationStatus = "unpublished";
  return {
    schemaVersion: 1,
    coverage: snapshot.coverage,
    sources: snapshot.sources,
    programs: [program],
  };
}
function approved() {
  const bundle = draft();
  const id = bundle.programs[0].programRevisionId;
  let state = importCatalog(createEmptyCatalog(), bundle, {
    actor: "editor",
    at,
  });
  state = reviewRevision(state, id, {
    reviewer: "editor",
    decision: "submit",
    reason: "提交规范化草稿",
    at,
  });
  state = reviewRevision(state, id, {
    reviewer: "reviewer",
    decision: "approve",
    reason: "审核通过，仍为示例",
    at,
  });
  return { state, id };
}

test("seed keeps example facts unverified and fabricated scores outside the trusted catalog", () => {
  const state = createSeedCatalog();
  const snapshot = getCatalogSnapshot(state);
  assert.equal(snapshot.programs.length, 8);
  assert.equal(snapshot.mode, "example");
  for (const program of snapshot.programs) {
    assert.equal(program.availability, "unverified");
    assert.equal(program.isExample, true);
    assert.deepEqual(program.historyScoreRecords, []);
    assert.equal(program.scoreRequirements.totalMaxScore, null);
    assert.ok(program.subjects.every((subject) => subject.maxScore === null));
  }
  snapshot.programs.length = 0;
  assert.equal(
    state.releases[0].programs.length,
    8,
    "read snapshot is detached from stored release",
  );
});

test("full annual identity separates degree, direction, year and college; names are not keys", () => {
  const program = draft().programs[0];
  const other = structuredClone(program);
  other.display.institutionName = "显示名称更新";
  assert.equal(projectIdentityKey(program), projectIdentityKey(other));
  for (const field of [
    "collegeId",
    "directionId",
    "targetAdmissionYear",
    "degreeType",
  ] as const) {
    const changed = structuredClone(program);
    if (field === "targetAdmissionYear") changed.identity[field]++;
    else if (field === "degreeType") changed.identity[field] = "professional";
    else changed.identity[field] += "-other";
    assert.notEqual(projectIdentityKey(program), projectIdentityKey(changed));
  }
});

test("import validation rejects duplicate identities, invalid facts and absent provenance", () => {
  const bundle = draft();
  assert.equal(validateCatalogImport(bundle).valid, true);
  bundle.programs.push({
    ...structuredClone(bundle.programs[0]),
    programId: "second",
    programRevisionId: "second:r1",
  });
  assert.match(validateCatalogImport(bundle).errors.join(" "), /身份冲突/);
  const invalid = draft();
  invalid.programs[0].isExample = false;
  invalid.programs[0].availability = "verified_current";
  assert.match(validateCatalogImport(invalid).errors.join(" "), /经过核验/);
  invalid.programs[0].subjects[0].maxScore = -1;
  assert.match(validateCatalogImport(invalid).errors.join(" "), /满分/);
  assert.equal(validateCatalogImport({}).valid, false);
});

test("import cannot bypass review and publication stages", () => {
  const bundle = draft();
  bundle.programs[0].reviewStatus = "approved";
  assert.throws(
    () => importCatalog(createEmptyCatalog(), bundle, { actor: "editor", at }),
    /未发布草稿/,
  );
});

test("review approval does not imply publication and does not convert availability", () => {
  const { state, id } = approved();
  assert.equal(state.revisions[0].reviewStatus, "approved");
  assert.equal(state.revisions[0].publicationStatus, "unpublished");
  assert.equal(state.revisions[0].availability, "unverified");
  const published = publishCatalog(state, {
    catalogVersion: "release-1",
    revisionIds: [id],
    at,
    reviewer: "publisher",
    summary: "示例发布",
  });
  assert.equal(
    getCatalogSnapshot(published).programs[0].publicationStatus,
    "published",
  );
  assert.equal(
    state.activeCatalogVersion,
    null,
    "functions do not mutate caller state",
  );
  assert.equal(published.audit.length, 4);
  assert.throws(
    () =>
      reviewRevision(published, id, {
        reviewer: "editor",
        decision: "submit",
        reason: "改已发布内容",
        at,
      }),
    /新修订/,
  );
});

test("new revision is append only; withdraw invalidates new reads without rewriting old releases", () => {
  const { state, id } = approved();
  let next = publishCatalog(state, {
    catalogVersion: "release-1",
    revisionIds: [id],
    at,
    reviewer: "publisher",
    summary: "第一版",
  });
  const oldJson = JSON.stringify(next.releases[0]);
  next = withdrawRevision(next, id, {
    reason: "资料错误",
    actor: "reviewer",
    at,
  });
  assert.equal(JSON.stringify(next.releases[0]), oldJson);
  assert.ok(
    getCatalogSnapshot(next, "release-1").withdrawnRevisionIds.includes(id),
  );
  assert.throws(
    () =>
      publishCatalog(next, {
        catalogVersion: "rollback",
        revisionIds: [id],
        at,
        reviewer: "publisher",
        summary: "回退",
      }),
    /未撤回/,
  );
  const replacement = draft();
  replacement.programs[0].programRevisionId += ":r2";
  replacement.programs[0].supersedesRevisionId = id;
  const newState = importCatalog(next, replacement, { actor: "editor", at });
  assert.equal(newState.revisions.length, 2);
  assert.equal(newState.revisions[1].reviewStatus, "draft");
});

test("a changed annual identity cannot silently reuse a program ID", () => {
  const state = createSeedCatalog();
  const bundle = draft();
  bundle.programs[0].identity.targetAdmissionYear = 2028;
  bundle.programs[0].programRevisionId += ":2028";
  assert.throws(
    () => importCatalog(state, bundle, { actor: "editor", at }),
    /项目 ID/,
  );
});

test("same identity requires original project ID and explicit revision lineage", () => {
  const state = createSeedCatalog();
  const bundle = draft();
  bundle.programs[0].programRevisionId += ":r2";
  assert.throws(
    () => importCatalog(state, bundle, { actor: "editor", at }),
    /引用同一项目/,
  );
  bundle.programs[0].programId = "invented-id";
  assert.throws(
    () => importCatalog(state, bundle, { actor: "editor", at }),
    /沿用已有项目/,
  );
});

test("risk review rejects duplicate reviewers and repeated evidence as independence", () => {
  const bundle = draft();
  bundle.programs[0].risks = [
    {
      riskId: "risk-1",
      summary: "未经独立验证的转载",
      severity: "severe",
      reviewStatus: "approved",
      reviewers: ["one", "one"],
      independentEvidenceClusters: ["copy", "copy"],
      sourceIds: bundle.programs[0].sourceIds,
      applicableYears: [2027],
      validUntil: null,
      status: "active",
    },
  ];
  assert.match(validateCatalogImport(bundle).errors.join(" "), /两名复核人/);
});

test("same release version cannot be overwritten; unknown versions never silently become latest", () => {
  const state = createSeedCatalog();
  assert.throws(() => getCatalogSnapshot(state, "gone"), /指定目录版本/);
  assert.throws(
    () =>
      publishCatalog(state, {
        catalogVersion: "catalog-example-v1",
        revisionIds: [],
        reviewer: "publisher",
        at,
        summary: "覆盖",
      }),
    /不可覆盖/,
  );
});

test("merged releases derive coverage years from all retained projects", () => {
  const bundle = draft();
  const program = bundle.programs[0];
  program.identity.targetAdmissionYear = 2028;
  program.programId += ":2028";
  program.programRevisionId += ":2028";
  bundle.coverage.years = [2028];
  bundle.coverage.description = "新增 2028 年度";
  let state = importCatalog(createSeedCatalog(), bundle, {
    actor: "editor",
    at,
  });
  state = reviewRevision(state, program.programRevisionId, {
    reviewer: "editor",
    decision: "submit",
    reason: "提交",
    at,
  });
  state = reviewRevision(state, program.programRevisionId, {
    reviewer: "reviewer",
    decision: "approve",
    reason: "示例复核",
    at,
  });
  state = publishCatalog(state, {
    catalogVersion: "merged",
    revisionIds: state.revisions.map((revision) => revision.programRevisionId),
    at,
    reviewer: "publisher",
    summary: "合并新年度",
  });
  assert.deepEqual(getCatalogSnapshot(state).coverage.years, [2027, 2028]);
  assert.match(getCatalogSnapshot(state).coverage.description, /9 个年度项目/);
});

test("malformed provenance and approved risk without sources are rejected", () => {
  const bundle = draft();
  bundle.sources[0].url = "javascript:alert(1)";
  bundle.sources[0].contentHash = "made-up-hash";
  const result = validateCatalogImport(bundle);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("http/https")));
  assert.ok(result.errors.some((error) => error.includes("SHA-256")));
  const risk = draft();
  risk.programs[0].risks = [
    {
      riskId: "risk",
      summary: "测试",
      severity: "notice",
      reviewStatus: "approved",
      reviewers: ["one", "two"],
      independentEvidenceClusters: ["first", "second"],
      sourceIds: [],
      applicableYears: [2027],
      validUntil: null,
      status: "active",
    },
  ];
  assert.match(validateCatalogImport(risk).errors.join(" "), /原始资料来源/);
});

test("a college ID has one institution owner within a batch; equal display names do not merge identities", () => {
  const bundle = draft();
  const second = structuredClone(bundle.programs[0]);
  second.programId = "second-institution-program";
  second.programRevisionId = "second-institution-program:r1";
  second.identity.institutionId = "another-institution";
  bundle.programs.push(second);
  assert.match(
    validateCatalogImport(bundle).errors.join(" "),
    /学院 ID.*已绑定其他学校/,
  );
  second.identity.collegeId = "another-institution:college";
  assert.equal(
    second.display.collegeName,
    bundle.programs[0].display.collegeName,
  );
  assert.equal(
    validateCatalogImport(bundle).valid,
    true,
    "different colleges may legitimately share a display name",
  );
  assert.equal(
    importCatalog(createEmptyCatalog(), bundle, { actor: "editor", at })
      .revisions.length,
    2,
  );
});

test("college ownership persists across prior and withdrawn revisions without mutating caller state", () => {
  const state = createSeedCatalog();
  const first = state.revisions[0];
  const withdrawn = withdrawRevision(state, first.programRevisionId, {
    at,
    reason: "测试撤回",
  });
  const before = JSON.stringify(withdrawn);
  const bundle = draft();
  bundle.programs[0].programId = "other-school:new-program";
  bundle.programs[0].programRevisionId = "other-school:new-program:r1";
  bundle.programs[0].identity.institutionId = "other-school";
  assert.equal(
    validateCatalogImport(bundle).valid,
    true,
    "the conflict is against existing state, not the isolated batch",
  );
  assert.throws(
    () => importCatalog(withdrawn, bundle, { actor: "editor", at }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "COLLEGE_INSTITUTION_CONFLICT",
  );
  assert.equal(JSON.stringify(withdrawn), before);
});

test("the same college may gain a new name and annual project without changing its owner", () => {
  const state = createSeedCatalog();
  const bundle = draft();
  const program = bundle.programs[0];
  program.programId += ":2028";
  program.programRevisionId += ":2028";
  program.identity.targetAdmissionYear = 2028;
  program.display.collegeName = "学院新名称（测试）";
  const result = importCatalog(state, bundle, { actor: "editor", at });
  const added = result.revisions[result.revisions.length - 1];
  assert.equal(added.identity.collegeId, state.revisions[0].identity.collegeId);
  assert.equal(
    added.identity.institutionId,
    state.revisions[0].identity.institutionId,
  );
  assert.equal(
    state.revisions[0].display.collegeName,
    "计算机科学与工程学院（演示项目）",
  );
});

test("nested evidence sources must be present in the project source manifest used by public detail", () => {
  const fixtures: Array<(bundle: CatalogImport) => void> = [
    (bundle) => {
      bundle.programs[0].subjects[0].sourceIds = ["nested-source"];
    },
    (bundle) => {
      bundle.programs[0].eligibility.conditions = [
        {
          conditionId: "test-condition",
          label: "测试条件",
          profileField: "graduation",
          operator: "present",
          expected: null,
          availability: "unverified",
          sourceIds: ["nested-source"],
        },
      ];
    },
    (bundle) => {
      bundle.programs[0].evidence = [
        {
          dimension: "employment",
          availability: "unverified",
          sourceIds: ["nested-source"],
          summary: "测试就业出处",
          value: null,
          ruleVersion: null,
        },
      ];
    },
    (bundle) => {
      bundle.programs[0].claims = [
        {
          claimId: "test-claim",
          field: "tuitionPerYear",
          value: null,
          unit: "CNY",
          targetAdmissionYear: 2027,
          scope: "测试项目",
          sourceId: "nested-source",
          locator: "测试条款",
          availability: "unverified",
          enteredBy: "test-editor",
          reviewedBy: null,
          supersedesClaimId: null,
        },
      ];
    },
  ];
  for (const modify of fixtures) {
    const bundle = draft();
    bundle.sources.push({ ...bundle.sources[0], sourceId: "nested-source" });
    modify(bundle);
    assert.match(
      validateCatalogImport(bundle).errors.join(" "),
      /来源引用必须登记在当前项目 sourceIds/,
    );
    bundle.programs[0].sourceIds.push("nested-source");
    assert.equal(validateCatalogImport(bundle).valid, true);
  }
});

test("verified aggregate eligibility and score requirements also require verified sources", () => {
  const eligibility = draft();
  eligibility.programs[0].eligibility.availability = "verified_current";
  assert.match(
    validateCatalogImport(eligibility).errors.join(" "),
    /eligibility.*经过核验的非示例来源/,
  );
  const scores = draft();
  scores.programs[0].scoreRequirements.availability = "verified_current";
  assert.match(
    validateCatalogImport(scores).errors.join(" "),
    /scoreRequirements.*经过核验的非示例来源/,
  );
});
