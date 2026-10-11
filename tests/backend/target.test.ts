import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import {
  createSeedCatalog,
  withdrawRevision,
} from "../../server/catalog/index.ts";
import type { CatalogState } from "../../server/catalog/types.ts";

async function fixture() {
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    rateLimit: 10000,
    admins: [],
    staticDirectory: undefined,
  });
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
  const state = app.store.get<CatalogState>("public", "catalog")!.value;
  return { app, request, state };
}

test("target persists before a plan, binds the actual national category and repeats without version changes", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const target = f.state.revisions.find(
    (program) => program.identity.degreeType === "professional",
  )!;
  const current = await f.request("/me/selections");
  const body = {
    programId: target.programId,
    programRevisionId: target.programRevisionId,
  };
  const chosen = await f.request("/me/target", "PUT", body, current.etag);
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
  assert.equal(chosen.body.targetProgramId, target.programId);
  assert.equal(chosen.body.confirmedMajorId, "0854");
  assert.equal(chosen.body.selectionVersion, 1);
  assert.equal((await f.request("/me/plan")).body.plan, null);
  const repeated = await f.request("/me/target", "PUT", body, chosen.etag);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.etag, chosen.etag);
  assert.equal(repeated.body.selectionVersion, 1);
  const read = await f.request("/me/selections");
  assert.equal(read.body.targetProgramId, target.programId);
  assert.equal(read.body.confirmedMajorId, "0854");
});

test("target method, fields, ETag and revision are validated without changing saved choices", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const target = f.state.revisions[0];
  const current = await f.request("/me/selections");
  const body = {
    programId: target.programId,
    programRevisionId: target.programRevisionId,
  };
  assert.equal(
    (await f.request("/me/target", "POST", body, current.etag)).status,
    404,
  );
  assert.equal((await f.request("/me/target", "GET")).status, 404);
  assert.equal(
    (
      await f.request(
        "/me/target",
        "PUT",
        { ...body, confirmedMajorId: "0301" },
        current.etag,
      )
    ).status,
    400,
  );
  assert.equal((await f.request("/me/target", "PUT", body)).status, 428);
  assert.equal(
    (await f.request("/me/target", "PUT", body, '"old"')).status,
    412,
  );
  assert.equal(
    (
      await f.request(
        "/me/target",
        "PUT",
        { ...body, programRevisionId: "old" },
        current.etag,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        "/me/target",
        "PUT",
        { programId: null, programRevisionId: target.programRevisionId },
        current.etag,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await f.request(
        "/me/target",
        "PUT",
        { ...body, programId: "missing" },
        current.etag,
      )
    ).status,
    404,
  );
  const read = await f.request("/me/selections");
  assert.equal(read.etag, current.etag);
  assert.equal(read.body.targetProgramId, null);
});

test("changing and cancelling a saved target invalidates its plan and unfinished tasks", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const [first, second] = f.state.revisions;
  const initial = await f.request("/me/selections");
  const chosen = await f.request(
    "/me/target",
    "PUT",
    { programId: first.programId, programRevisionId: first.programRevisionId },
    initial.etag,
  );
  const blankPlan = await f.request("/me/plan");
  const plan = await f.request(
    "/me/plan",
    "PUT",
    {
      programId: first.programId,
      programRevisionId: first.programRevisionId,
      selectionVersion: chosen.body.selectionVersion,
      subjectTargets: {},
    },
    blankPlan.etag,
  );
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  const selections = await f.request("/me/selections");
  const changed = await f.request(
    "/me/target",
    "PUT",
    {
      programId: second.programId,
      programRevisionId: second.programRevisionId,
    },
    selections.etag,
  );
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const oldPlan = (await f.request("/me/plan")).body.plan;
  assert.equal(oldPlan.programId, first.programId);
  assert.equal(oldPlan.status, "needs_review");
  assert.equal(oldPlan.valid, false);
  assert.equal(oldPlan.planVersion, plan.body.planVersion + 1);
  const tasks = (await f.request("/me/tasks")).body.items;
  assert.ok(tasks.length > 0);
  assert.ok(
    tasks.every(
      (item: { needsReconfirmation: boolean }) => item.needsReconfirmation,
    ),
  );
  const cancelled = await f.request(
    "/me/target",
    "PUT",
    { programId: null },
    changed.etag,
  );
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.targetProgramId, null);
  assert.equal(
    cancelled.body.confirmedMajorId,
    second.identity.majorCode.slice(0, 4),
  );
  const historical = (await f.request("/me/plan")).body.plan;
  assert.equal(historical.status, "needs_review");
  assert.equal(historical.planVersion, oldPlan.planVersion + 1);
  const repeated = await f.request(
    "/me/target",
    "PUT",
    { programId: null },
    cancelled.etag,
  );
  assert.equal(repeated.etag, cancelled.etag);
  assert.equal(
    (await f.request("/me/plan")).body.plan.planVersion,
    historical.planVersion,
  );
});

test("targets reject withdrawn revisions, wrong degree mappings and ambiguous legacy directions", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const current = await f.request("/me/selections");
  const target = f.state.revisions[0];
  const body = {
    programId: target.programId,
    programRevisionId: target.programRevisionId,
  };
  const withdrawn = withdrawRevision(f.state, target.programRevisionId, {
    actor: "test-reviewer",
    reason: "测试撤回",
    at: "2026-09-27T00:00:00.000Z",
  });
  f.app.store.put("public", "catalog", "current", withdrawn);
  assert.equal(
    (await f.request("/me/target", "PUT", body, current.etag)).status,
    409,
  );
  const invalid = createSeedCatalog();
  invalid.releases[0].programs[0].identity.degreeType = "professional";
  f.app.store.put("public", "catalog", "current", invalid);
  assert.equal(
    (await f.request("/me/target", "PUT", body, current.etag)).body.code,
    "discipline_mismatch",
  );
  const legacy = createSeedCatalog();
  legacy.releases[0].programs[0].identity.majorCode = "999999";
  legacy.releases[0].programs[0].majorDirectionIds = ["research", "practice"];
  f.app.store.put("public", "catalog", "current", legacy);
  assert.equal(
    (await f.request("/me/target", "PUT", body, current.etag)).body.code,
    "ambiguous_target_major",
  );
  legacy.releases[0].programs[0].majorDirectionIds = ["research"];
  f.app.store.put("public", "catalog", "current", legacy);
  const explicit = await f.request("/me/target", "PUT", body, current.etag);
  assert.equal(explicit.status, 200);
  assert.equal(explicit.body.confirmedMajorId, "research");
});

test("T3-07 unknown maximum rejects numeric targets and accepts clearing to null", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const target = f.state.revisions[0];
  const selection = await f.request("/me/selections");
  const chosen = await f.request(
    "/me/target",
    "PUT",
    {
      programId: target.programId,
      programRevisionId: target.programRevisionId,
    },
    selection.etag,
  );
  const initial = await f.request("/me/plan");
  const body = {
    selectionVersion: chosen.body.selectionVersion,
    programId: target.programId,
    programRevisionId: target.programRevisionId,
    subjectTargets: { [target.subjects[0].subjectId]: 99999 },
  };
  const rejected = await f.request("/me/plan", "PUT", body, initial.etag);
  assert.equal(rejected.status, 422);
  assert.equal((await f.request("/me/plan")).body.plan, null);
  const cleared = await f.request(
    "/me/plan",
    "PUT",
    { ...body, subjectTargets: { [target.subjects[0].subjectId]: null } },
    initial.etag,
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.plan.subjects[0].targetScore, null);
});
