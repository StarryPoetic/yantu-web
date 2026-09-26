import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import {
  createSeedCatalog,
  getCatalogSnapshot,
} from "../../server/catalog/index.ts";
import { recommend } from "../../server/recommendation/index.ts";
import type { RecommendationInput } from "../../server/recommendation/index.ts";
import { buildPlan } from "../../server/planning/index.ts";

function fixtureInput(): RecommendationInput {
  const catalog = getCatalogSnapshot(createSeedCatalog());
  const reference = catalog.programs[0];
  catalog.programs = [
    ["law-academic", "030100", "academic"],
    ["computing-academic", "081200", "academic"],
    ["law-professional", "035101", "professional"],
  ].map(([name, majorCode, degreeType]) => ({
    ...structuredClone(reference),
    programId: name,
    programRevisionId: `${name}-r1`,
    identity: {
      ...reference.identity,
      majorCode,
      degreeType: degreeType as "academic" | "professional",
    },
    majorDirectionIds: [name],
  }));
  return {
    recommendationRunId: "discipline-test",
    subjectId: "student",
    profileVersion: 0,
    selectionVersion: 0,
    targetAdmissionYear: 2027,
    profile: {},
    selection: {},
    catalog,
    generatedAt: "2026-09-27T00:00:00Z",
  };
}
const ids = (run: ReturnType<typeof recommend>) =>
  [
    ...run.ranked,
    ...run.eligibleUnranked,
    ...run.pendingVerification,
    ...run.historicalPreview,
  ].map((item) => item.programId);

test("national discipline filters use actual program code and degree type without a computing default", () => {
  const input = fixtureInput();
  assert.deepEqual(ids(recommend(input)).sort(), [
    "computing-academic",
    "law-academic",
    "law-professional",
  ]);
  assert.deepEqual(
    ids(recommend({ ...input, filters: { disciplineCodes: ["0301"] } })),
    ["law-academic"],
  );
  assert.deepEqual(
    ids(recommend({ ...input, filters: { disciplineCodes: ["0351"] } })),
    ["law-professional"],
  );
  assert.deepEqual(
    ids(recommend({ ...input, filters: { disciplineCodes: ["0812"] } })),
    ["computing-academic"],
  );
  assert.deepEqual(
    ids(recommend({ ...input, filters: { disciplineCodes: ["0501"] } })),
    [],
  );
  assert.deepEqual(
    ids(recommend({ ...input, selection: { confirmedMajorId: "0301" } })),
    ["law-academic"],
  );
  assert.equal(
    ids(
      recommend({ ...input, selection: { blockedMajorIds: ["0301"] } }),
    ).includes("law-academic"),
    false,
  );
  assert.throws(
    () => recommend({ ...input, filters: { disciplineCodes: ["research"] } }),
    /四位/,
  );
  const inconsistent = fixtureInput();
  inconsistent.catalog.programs[0].identity.degreeType = "professional";
  assert.deepEqual(
    ids(recommend({ ...inconsistent, filters: { disciplineCodes: ["0301"] } })),
    [],
  );
});

test("example visibility is explicit, validated, and explained in recommendation exclusions", () => {
  const input = fixtureInput();
  const hidden = recommend({ ...input, filters: { includeExamples: false } });
  assert.deepEqual(ids(hidden), []);
  assert.equal(hidden.excluded.length, input.catalog.programs.length);
  assert.ok(
    hidden.excluded.every((item) => item.reasons.includes("已隐藏示例项目")),
  );
  assert.equal(hidden.inputSnapshot.filters.includeExamples, false);
  assert.deepEqual(
    ids(recommend({ ...input, filters: { includeExamples: true } })),
    ids(recommend(input)),
  );
  input.catalog.programs[0].isExample = false;
  assert.deepEqual(
    ids(recommend({ ...input, filters: { includeExamples: false } })),
    ["law-academic"],
  );
  assert.throws(
    () =>
      recommend({
        ...input,
        filters: { includeExamples: "false" as unknown as boolean },
      }),
    /布尔值/,
  );
});

test("plan compatibility matches confirmed four-digit discipline to the actual six-digit program code", () => {
  const fixture = fixtureInput();
  const program = fixture.catalog.programs.find(
    (item) => item.programId === "computing-academic",
  )!;
  const input = {
    planId: "national-code-plan",
    planVersion: 1,
    subjectId: "student",
    program,
    catalogVersion: fixture.catalog.catalogVersion,
    generatedAt: fixture.generatedAt,
    confirmedMajorId: "0812",
  };
  const matched = buildPlan(input);
  assert.equal(matched.status, "pending_verification");
  assert.ok(matched.tasks.every((task) => !task.needsReconfirmation));
  assert.ok(!matched.pendingItems.some((item) => item.includes("不兼容")));
  const switched = buildPlan({
    ...input,
    planVersion: 2,
    previousPlan: matched,
    confirmedMajorId: "0301",
  });
  assert.equal(switched.status, "needs_review");
  assert.ok(switched.tasks.every((task) => task.needsReconfirmation));
  assert.deepEqual(
    switched.previousTaskIdsNeedingReconfirmation,
    matched.tasks.map((task) => task.taskId),
  );
  const wrongDegree = structuredClone(program);
  wrongDegree.identity.degreeType = "professional";
  assert.equal(
    buildPlan({ ...input, program: wrongDegree }).status,
    "needs_review",
  );
  assert.equal(
    buildPlan({ ...input, confirmedMajorId: "computing-academic" }).status,
    "pending_verification",
  );
});

test("HTTP recommendations preserve requested discipline and honestly return empty when yearly projects are absent", async (t) => {
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: undefined,
    rateLimit: 10000,
  });
  t.after(() => app.close());
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const response = await fetch(base + "/guest-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const session = await response.json();
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers: {
        cookie,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
        "idempotency-key": randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const profile = await request("/me/profile");
  const selections = await request("/me/selections");
  const input = {
    profileVersion: profile.body.profileVersion,
    selectionVersion: selections.body.selectionVersion,
    targetAdmissionYear: 2027,
    filters: { disciplineCodes: ["0301"] },
  };
  const result = await request("/recommendations", "POST", input);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.deepEqual(result.body.inputSnapshot.filters.disciplineCodes, ["0301"]);
  assert.equal(result.body.items.length, 0);
  assert.equal(result.body.pendingVerification.length, 0);
  assert.equal(result.body.historicalPreview.length, 0);
  assert.ok(
    result.body.exclusionReasons.every((item: { reasons: string[] }) =>
      item.reasons.includes("不符合学科目录筛选"),
    ),
  );
  assert.equal(
    (
      await request("/recommendations", "POST", {
        ...input,
        filters: { disciplineCodes: ["law"] },
      })
    ).status,
    422,
  );
  const hidden = await request("/recommendations", "POST", {
    ...input,
    filters: { includeExamples: false },
  });
  assert.equal(hidden.status, 201, JSON.stringify(hidden.body));
  assert.equal(hidden.body.inputSnapshot.filters.includeExamples, false);
  assert.equal(hidden.body.items.length, 0);
  assert.equal(hidden.body.pendingVerification.length, 0);
  assert.equal(hidden.body.historicalPreview.length, 0);
  assert.ok(hidden.body.exclusionReasons.length > 0);
  assert.ok(
    hidden.body.exclusionReasons.every((item: { reasons: string[] }) =>
      item.reasons.includes("已隐藏示例项目"),
    ),
  );
  const shown = await request("/recommendations", "POST", {
    ...input,
    filters: { includeExamples: true },
  });
  assert.equal(shown.status, 201, JSON.stringify(shown.body));
  assert.equal(
    shown.body.pendingVerification.length,
    hidden.body.exclusionReasons.length,
  );
  for (const includeExamples of ["false", 0, null])
    assert.equal(
      (
        await request("/recommendations", "POST", {
          ...input,
          filters: { includeExamples },
        })
      ).status,
      422,
    );
});
