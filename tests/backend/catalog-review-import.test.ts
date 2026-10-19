import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createEmptyCatalog,
  importCatalog,
  projectIdentityKey,
  publishCatalog,
  validateCatalogImport,
} from "../../server/catalog/index.ts";
import type { CatalogImport } from "../../server/catalog/types.ts";
import { evaluateEligibility } from "../../server/recommendation/index.ts";

const bundlePath = new URL(
  "../../knowledge/catalog/review-candidates/import-hdu-2027-mechanical-draft.json",
  import.meta.url,
);
const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as CatalogImport;
const source = bundle.sources[0];
const match = source.fileReference!.match(
  /^repository:(.+)#\/pages\/(\d+)\/source\/excerpt$/,
)!;
const fixture = JSON.parse(
  readFileSync(new URL(`../../${match[1]}`, import.meta.url), "utf8"),
);
const original = fixture.pages[Number(match[2])].source;
const at = "2026-10-20T00:00:00.000Z";

test("real 2027 two-program batch passes the actual catalog validator and only imports drafts", () => {
  assert.deepEqual(validateCatalogImport(bundle), { valid: true, errors: [] });
  const empty = createEmptyCatalog();
  const state = importCatalog(empty, bundle, {
    actor: "Codex（自动整理，非人工复核）",
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

test("all claims preserve literal row provenance and clearly identify Codex as the unreviewed recorder", () => {
  const textHash = createHash("sha256").update(original.excerpt).digest("hex");
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
        claim.locator.includes(`sha256(extracted-text-utf8)=${textHash}`),
      );
      const location = claim.locator.match(
        /UTF16-offset=(\d+); quote=([\s\S]*)$/,
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

test("unreviewed source cannot be promoted by changing availability labels or reusing another year's identity", () => {
  const promoted = structuredClone(bundle);
  promoted.programs[0].availability = "verified_current";
  promoted.programs[0].claims[0].availability = "verified_current";
  assert.equal(validateCatalogImport(promoted).valid, false);
  assert.match(validateCatalogImport(promoted).errors.join(" "), /核验|复核/);
  const state = importCatalog(createEmptyCatalog(), bundle, {
    actor: "Codex（自动整理，非人工复核）",
    at,
  });
  const wrongYear = structuredClone(bundle);
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
