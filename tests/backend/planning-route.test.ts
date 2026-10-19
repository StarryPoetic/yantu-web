import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import { createSeedCatalog } from "../../server/catalog/index.ts";

async function fixture(t: test.TestContext) {
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    rateLimit: 10000,
    admins: [],
    bootstrapAdmins: [],
    staticDirectory: undefined,
  });
  t.after(() => app.close());
  const catalog = createSeedCatalog();
  const target = catalog.releases[0].programs[0];
  // Deliberately synthetic local fixture; no production catalog is changed or published.
  target.subjects = [
    {
      subjectId: "politics",
      name: "思想政治理论",
      maxScore: 100,
      optionGroupId: null,
    },
    {
      subjectId: "english",
      name: "英语一",
      maxScore: 100,
      optionGroupId: "foreign-language",
    },
    {
      subjectId: "japanese",
      name: "日语",
      maxScore: 100,
      optionGroupId: "foreign-language",
    },
    { subjectId: "math", name: "数学一", maxScore: 150, optionGroupId: null },
    {
      subjectId: "major",
      name: "专业基础",
      maxScore: 150,
      optionGroupId: null,
    },
  ].map((subject) => ({
    ...subject,
    availability: "verified_current" as const,
    minimumScore: 0,
    sourceIds: ["synthetic-planning-test"],
  }));
  target.scoreRequirements = {
    totalMaxScore: 500,
    totalMinimumScore: 0,
    interviewRequirement: "仅供离线路由测试",
    availability: "verified_current",
  };
  app.store.put("public", "catalog", "current", catalog);
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const guest = await fetch(`${base}/guest-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const session = await guest.json();
  const cookie = guest.headers.get("set-cookie")!.split(";")[0];
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    etag?: string,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        cookie,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
        "idempotency-key": randomUUID(),
        ...(etag ? { "if-match": etag } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get("etag")!,
    };
  }
  const selection = await request("/me/selections");
  const chosen = await request(
    "/me/target",
    "PUT",
    {
      programId: target.programId,
      programRevisionId: target.programRevisionId,
    },
    selection.etag,
  );
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
  return { request, target, selectionVersion: chosen.body.selectionVersion };
}

test("planning route persists one official alternative and its score, then switches without the old score", async (t) => {
  const f = await fixture(t);
  const initial = await f.request("/me/plan");
  const body = {
    programId: f.target.programId,
    programRevisionId: f.target.programRevisionId,
    selectionVersion: f.selectionVersion,
    selectedSubjectIds: ["politics", "english", "math", "major"],
    subjectTargets: { politics: 70, english: 80, math: 85, major: 85 },
  };
  const saved = await f.request("/me/plan", "PUT", body, initial.etag);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.plan.totalTargetScore, 320);
  assert.equal(saved.body.plan.totalMaxScore, 500);
  const restored = await f.request("/me/plan");
  assert.deepEqual(
    restored.body.plan.subjects.map(
      (subject: { subjectId: string }) => subject.subjectId,
    ),
    ["politics", "math", "major", "english"],
  );
  assert.equal(
    restored.body.plan.subjects.find(
      (subject: { subjectId: string }) => subject.subjectId === "english",
    ).targetScore,
    80,
  );
  const selection = await f.request("/me/selections");
  const switched = await f.request(
    "/me/plan",
    "PUT",
    {
      ...body,
      selectionVersion: selection.body.selectionVersion,
      selectedSubjectIds: ["politics", "japanese", "math", "major"],
      subjectTargets: { politics: 70, japanese: 75, math: 85, major: 85 },
    },
    restored.etag,
  );
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  assert.equal(switched.body.plan.totalTargetScore, 315);
  assert.equal(
    switched.body.plan.subjects.some(
      (subject: { subjectId: string }) => subject.subjectId === "english",
    ),
    false,
  );
  assert.equal(
    switched.body.plan.subjects.find(
      (subject: { subjectId: string }) => subject.subjectId === "japanese",
    ).targetScore,
    75,
  );
});

test("planning route rejects missing, multiple, foreign and stale alternative selections without saving", async (t) => {
  const f = await fixture(t);
  const initial = await f.request("/me/plan");
  const base = {
    programId: f.target.programId,
    programRevisionId: f.target.programRevisionId,
    selectionVersion: f.selectionVersion,
    subjectTargets: { english: 80 },
  };
  for (const patch of [
    {},
    { selectedSubjectIds: ["english", "japanese"] },
    { selectedSubjectIds: ["not-in-this-program"] },
    { selectedSubjectIds: ["japanese"] },
  ]) {
    const response = await f.request(
      "/me/plan",
      "PUT",
      { ...base, ...patch },
      initial.etag,
    );
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.equal(response.body.code, "invalid_plan");
    assert.equal((await f.request("/me/plan")).body.plan, null);
  }
});
