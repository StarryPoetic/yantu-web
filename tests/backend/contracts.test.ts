import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import {
  createSeedCatalog,
  withdrawRevision,
} from "../../server/catalog/index.ts";
import type { CatalogState } from "../../server/catalog/types.ts";

test("catalog pagination can pin the first response version while a new release becomes active", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const first = await f.request("/programs?limit=2");
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.nextCursor);
  const state = f.app.store.get<CatalogState>("public", "catalog")!.value;
  const next = structuredClone(state.releases[0]);
  next.catalogVersion = "newer-catalog-for-pagination";
  state.releases.push(next);
  state.activeCatalogVersion = next.catalogVersion;
  f.app.store.put("public", "catalog", "current", state);
  const cursor = encodeURIComponent(first.body.nextCursor);
  assert.equal(
    (await f.request(`/programs?limit=2&cursor=${cursor}`)).status,
    400,
  );
  const second = await f.request(
    `/programs?limit=2&catalogVersion=${first.body.catalogVersion}&cursor=${cursor}`,
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.catalogVersion, first.body.catalogVersion);
  assert.equal(
    new Set(
      [...first.body.items, ...second.body.items].map(
        (item: { programId: string }) => item.programId,
      ),
    ).size,
    4,
  );
});

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
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": session.csrfToken,
        "idempotency-key": randomUUID(),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get("etag") ?? "",
    };
  };
  const profile = await request("/me/profile");
  const selections = await request("/me/selections");
  const runInput = {
    profileVersion: profile.body.profileVersion,
    selectionVersion: selections.body.selectionVersion,
    targetAdmissionYear: 2027,
    filters: {},
    assessmentRefs: [],
  };
  return { app, request, profile, selections, runInput };
}

test("HTTP rejects unsupported filters, stale versions and malformed source references", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  for (const filters of [
    { degreeTypes: ["unsupported"] },
    { studyModes: ["unsupported"] },
    { cities: "杭州" },
    { cities: [null] },
  ]) {
    const response = await f.request("/recommendations", "POST", {
      ...f.runInput,
      filters,
    });
    assert.equal(response.status, 422, JSON.stringify(response.body));
  }
  assert.equal(
    (
      await f.request("/recommendations", "POST", {
        ...f.runInput,
        profileVersion: 999,
      })
    ).status,
    412,
  );
  assert.equal(
    (
      await f.request("/recommendations", "POST", {
        ...f.runInput,
        selectionVersion: 999,
      })
    ).status,
    412,
  );
  assert.equal(
    (
      await f.request("/recommendations", "POST", {
        ...f.runInput,
        assessmentRefs: {},
      })
    ).status,
    422,
  );
  assert.equal(
    (await f.request("/programs?cursor=not-a-valid-cursor")).status,
    400,
  );
  assert.equal(
    (await f.request("/programs?catalogVersion=missing-version")).status,
    422,
  );
});

test("annual project IDs work through percent-encoded detail, favorites and exclusion paths", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const programs = await f.request("/programs");
  const target = programs.body.items[0];
  const encoded = encodeURIComponent(target.programId);
  assert.equal(
    (await f.request(`/programs/${encoded}`)).body.programId,
    target.programId,
  );
  const saved = await f.request(
    `/me/saved-programs/${encoded}`,
    "PUT",
    {},
    { "if-match": f.selections.etag },
  );
  assert.equal(saved.status, 200);
  assert.ok(saved.body.savedProgramIds.includes(target.programId));
  const blocked = await f.request(
    `/me/exclusions/program/${encoded}`,
    "PUT",
    {},
    { "if-match": saved.etag },
  );
  assert.equal(blocked.status, 200);
  const run = await f.request("/recommendations", "POST", {
    ...f.runInput,
    selectionVersion: blocked.body.selectionVersion,
  });
  assert.ok(
    run.body.excluded.some(
      (item: { programId: string }) => item.programId === target.programId,
    ),
  );
  const restored = await f.request(
    `/me/exclusions/program/${encoded}`,
    "DELETE",
    {},
    { "if-match": blocked.etag },
  );
  assert.equal(restored.status, 200);
  const rerun = await f.request("/recommendations", "POST", {
    ...f.runInput,
    selectionVersion: restored.body.selectionVersion,
  });
  assert.ok(
    rerun.body.pendingVerification.some(
      (item: { programId: string }) => item.programId === target.programId,
    ),
  );
});

test("an ineligible project cannot become a valid target by omitting the recommendation reference", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  // Deliberately synthetic in-memory facts exercise the HTTP seam, never the shipped knowledge base.
  const state = createSeedCatalog();
  const target = structuredClone(state.revisions[0]);
  target.isExample = false;
  target.availability = "verified_current";
  target.eligibility = {
    availability: "verified_current",
    complete: true,
    reason: null,
    conditions: [
      {
        conditionId: "fixture-year",
        label: "测试已知不符条件",
        profileField: "year",
        operator: "equals",
        expected: "2026",
        availability: "verified_current",
        sourceIds: ["test-only-source"],
      },
    ],
  };
  target.subjects = target.subjects.map((subject, index) => ({
    ...subject,
    maxScore: index < 2 ? 100 : 150,
    minimumScore: index < 2 ? 40 : 60,
    availability: "verified_current",
  }));
  target.scoreRequirements = {
    totalMaxScore: 500,
    totalMinimumScore: 300,
    interviewRequirement: "测试复试条件",
    availability: "verified_current",
  };
  state.revisions[0] = target;
  state.releases[0].programs[0] = target;
  f.app.store.put("public", "catalog", "current", state);
  const currentPlan = await f.request("/me/plan");
  const subjectTargets = Object.fromEntries(
    target.subjects.map((subject, index) => [
      subject.subjectId,
      index < 2 ? 60 : 100,
    ]),
  );
  const response = await f.request(
    "/me/plan",
    "PUT",
    {
      selectionVersion: 0,
      programId: target.programId,
      programRevisionId: target.programRevisionId,
      subjectTargets,
    },
    { "if-match": currentPlan.etag },
  );
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.ok(
    response.body.details.errors.some((message: string) =>
      message.includes("报考资格不满足"),
    ),
  );
  assert.equal((await f.request("/me/plan")).body.plan, null);
  assert.equal((await f.request("/me/selections")).body.selectionVersion, 0);
  assert.equal((await f.request("/me/tasks")).body.items.length, 0);
});

test("professional assessment requires explicitly confirmed target major", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const response = await f.request("/assessment-attempts", "POST", {
    stage: "professional",
    modules: ["professional"],
  });
  assert.ok(
    response.status === 409 || response.status === 422,
    JSON.stringify(response.body),
  );
  assert.equal((await f.request("/assessment-attempts")).body.items.length, 0);
});

test("source withdrawal blocks new reports but preserves old report bytes and permits target reconsideration", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const run = await f.request("/recommendations", "POST", f.runInput);
  assert.equal(run.status, 201);
  const candidate = run.body.pendingVerification[0];
  const initialPlan = await f.request("/me/plan");
  const createdPlan = await f.request(
    "/me/plan",
    "PUT",
    {
      selectionVersion: 0,
      programId: candidate.programId,
      programRevisionId: candidate.programRevisionId,
      recommendationRunId: run.body.recommendationRunId,
    },
    { "if-match": initialPlan.etag },
  );
  assert.equal(createdPlan.status, 200);
  const payload = {
    recommendationRunId: run.body.recommendationRunId,
    planId: createdPlan.body.plan.planId,
    planVersion: createdPlan.body.plan.planVersion,
    format: "markdown",
  };
  const generated = await f.request("/reports", "POST", payload);
  assert.equal(generated.status, 202);
  const old = await f.request(`/reports/${generated.body.reportId}`);
  const state = f.app.store.get<CatalogState>("public", "catalog")!.value;
  f.app.store.put(
    "public",
    "catalog",
    "current",
    withdrawRevision(state, candidate.programRevisionId, {
      at: "2026-09-27T12:00:00.000Z",
      reason: "测试撤回",
    }),
  );
  const blocked = await f.request("/reports", "POST", payload);
  assert.equal(blocked.status, 409);
  const retained = await f.request(`/reports/${generated.body.reportId}`);
  assert.equal(retained.body.markdown, old.body.markdown);
  assert.equal(retained.body.withdrawn, true);
  assert.match(retained.body.warning, /撤回/);
  const runAfter = await f.request(
    `/recommendations/${run.body.recommendationRunId}`,
  );
  assert.equal(runAfter.body.needsRefresh, true);
  const selections = await f.request("/me/selections");
  const otherMajor = candidate.program.majorDirectionIds.includes("research")
    ? "practice"
    : "research";
  const changed = await f.request(
    "/me/confirmed-major",
    "PUT",
    { majorDirectionId: otherMajor },
    { "if-match": selections.etag },
  );
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const changedPlan = await f.request("/me/plan");
  assert.equal(changedPlan.body.plan.status, "needs_review");
  assert.equal(changedPlan.body.plan.valid, false);
});

test("report creation rejects a fixed plan from a different recommendation run", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const first = await f.request("/recommendations", "POST", f.runInput);
  const second = await f.request("/recommendations", "POST", f.runInput);
  const candidate = first.body.pendingVerification[0];
  const current = await f.request("/me/plan");
  const planned = await f.request(
    "/me/plan",
    "PUT",
    {
      selectionVersion: 0,
      programId: candidate.programId,
      programRevisionId: candidate.programRevisionId,
      recommendationRunId: first.body.recommendationRunId,
    },
    { "if-match": current.etag },
  );
  const response = await f.request("/reports", "POST", {
    recommendationRunId: second.body.recommendationRunId,
    planId: planned.body.plan.planId,
    planVersion: planned.body.plan.planVersion,
    format: "markdown",
  });
  assert.equal(response.status, 409);
  assert.equal((await f.request("/reports")).body.items.length, 0);
});

test("profile changes invalidate associated plans and unfinished tasks without rewriting history", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const run = await f.request("/recommendations", "POST", f.runInput);
  assert.equal(run.body.needsRefresh, false);
  const candidate = run.body.pendingVerification[0];
  const emptyPlan = await f.request("/me/plan");
  const created = await f.request(
    "/me/plan",
    "PUT",
    {
      selectionVersion: 0,
      programId: candidate.programId,
      programRevisionId: candidate.programRevisionId,
      recommendationRunId: run.body.recommendationRunId,
    },
    { "if-match": emptyPlan.etag },
  );
  assert.equal(created.status, 200);
  const tasks = await f.request("/me/tasks");
  const finished = tasks.body.items[0];
  await f.request(
    `/me/tasks/${encodeURIComponent(finished.taskId)}`,
    "PATCH",
    { completed: true },
    { "if-match": finished.etag },
  );
  const reportPayload = {
    recommendationRunId: run.body.recommendationRunId,
    planId: created.body.plan.planId,
    planVersion: 1,
    format: "markdown",
  };
  const existingReport = await f.request("/reports", "POST", reportPayload);
  assert.equal(existingReport.status, 202);
  const oldMarkdown = (
    await f.request(`/reports/${existingReport.body.reportId}`)
  ).body.markdown;
  const profile = { ...f.profile.body.profile, graduation: "2030" };
  const updated = await f.request("/me/profile", "PUT", profile, {
    "if-match": f.profile.etag,
  });
  assert.equal(updated.status, 200);
  const current = await f.request("/me/plan");
  assert.equal(current.body.plan.status, "needs_review");
  assert.equal(current.body.plan.valid, false);
  assert.equal(current.body.planVersion, 2);
  const history = await f.request(
    `/me/plans/${created.body.plan.planId}/versions/1`,
  );
  assert.equal(history.body.plan.status, "pending_verification");
  assert.equal(history.body.plan.planVersion, 1);
  const afterTasks = await f.request("/me/tasks");
  assert.equal(
    afterTasks.body.items.find(
      (item: { taskId: string }) => item.taskId === finished.taskId,
    ).completed,
    true,
  );
  assert.ok(
    afterTasks.body.items
      .filter((item: { completed: boolean }) => !item.completed)
      .every((item: { needsConfirmation: boolean }) => item.needsConfirmation),
  );
  assert.equal(
    (await f.request(`/recommendations/${run.body.recommendationRunId}`)).body
      .needsRefresh,
    true,
  );
  const newReport = await f.request("/reports", "POST", reportPayload);
  assert.equal(newReport.status, 409);
  assert.equal(newReport.body.code, "plan_needs_review");
  const retained = await f.request(`/reports/${existingReport.body.reportId}`);
  assert.equal(retained.body.markdown, oldMarkdown);
  assert.equal(retained.body.needsRefresh, true);
  const repeatedProfile = await f.request("/me/profile", "PUT", profile, {
    "if-match": updated.etag,
  });
  assert.equal(repeatedProfile.etag, updated.etag);
  assert.equal((await f.request("/me/plan")).body.planVersion, 2);
});

test("same complete plan PUT retains versions, ETags and task progress", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const run = await f.request("/recommendations", "POST", f.runInput);
  const candidate = run.body.pendingVerification[0];
  const emptyPlan = await f.request("/me/plan");
  const payload = {
    selectionVersion: 0,
    programId: candidate.programId,
    programRevisionId: candidate.programRevisionId,
    recommendationRunId: run.body.recommendationRunId,
    subjectTargets: {},
  };
  const first = await f.request("/me/plan", "PUT", payload, {
    "if-match": emptyPlan.etag,
  });
  assert.equal(first.status, 200);
  const tasks = await f.request("/me/tasks");
  const firstTask = tasks.body.items[0];
  await f.request(
    `/me/tasks/${encodeURIComponent(firstTask.taskId)}`,
    "PATCH",
    { completed: true },
    { "if-match": firstTask.etag },
  );
  const selection = await f.request("/me/selections");
  const again = await f.request(
    "/me/plan",
    "PUT",
    { ...payload, selectionVersion: selection.body.selectionVersion },
    { "if-match": first.etag },
  );
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.plan, first.body.plan);
  assert.equal(again.etag, first.etag);
  assert.equal(again.body.selectionVersion, selection.body.selectionVersion);
  assert.equal((await f.request("/me/selections")).etag, selection.etag);
  const repeatedTasks = await f.request("/me/tasks");
  assert.equal(repeatedTasks.body.items.length, tasks.body.items.length);
  assert.equal(
    repeatedTasks.body.items.find(
      (item: { taskId: string }) => item.taskId === firstTask.taskId,
    ).completed,
    true,
  );
  assert.equal(
    (await f.request(`/me/plans/${first.body.plan.planId}/versions/2`)).status,
    404,
  );
});

test("old plan version cannot be reused for a new report after confirming an incompatible major", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const run = await f.request("/recommendations", "POST", f.runInput);
  const candidate = run.body.pendingVerification[0];
  const empty = await f.request("/me/plan");
  const planned = await f.request(
    "/me/plan",
    "PUT",
    {
      selectionVersion: 0,
      programId: candidate.programId,
      programRevisionId: candidate.programRevisionId,
      recommendationRunId: run.body.recommendationRunId,
    },
    { "if-match": empty.etag },
  );
  const selection = await f.request("/me/selections");
  const otherMajor = candidate.program.majorDirectionIds.includes("research")
    ? "practice"
    : "research";
  await f.request(
    "/me/confirmed-major",
    "PUT",
    { majorDirectionId: otherMajor },
    { "if-match": selection.etag },
  );
  const report = await f.request("/reports", "POST", {
    recommendationRunId: run.body.recommendationRunId,
    planId: planned.body.plan.planId,
    planVersion: 1,
    format: "markdown",
  });
  assert.equal(report.status, 409);
  assert.equal(report.body.code, "plan_needs_review");
});

test("selection changes mark fixed recommendation runs stale without rewriting their input", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const run = await f.request("/recommendations", "POST", f.runInput);
  assert.equal(run.body.needsRefresh, false);
  const candidate = run.body.pendingVerification[0];
  const excluded = await f.request(
    `/me/exclusions/program/${encodeURIComponent(candidate.programId)}`,
    "PUT",
    {},
    { "if-match": f.selections.etag },
  );
  assert.equal(excluded.status, 200);
  const fixed = await f.request(
    `/recommendations/${run.body.recommendationRunId}`,
  );
  assert.equal(fixed.body.needsRefresh, true);
  assert.equal(fixed.body.selectionVersion, run.body.selectionVersion);
  assert.equal(
    fixed.body.pendingVerification.length,
    run.body.pendingVerification.length,
  );
});
