import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../../server/app.ts";
import { blankProfile } from "../../server/profile.ts";
import type { AdminIdentity } from "../../server/config.ts";
import {
  createSeedCatalog,
  withdrawRevision,
} from "../../server/catalog/index.ts";
import type { CatalogState } from "../../server/catalog/types.ts";
import { exampleRule } from "../../server/recommendation/index.ts";

async function setup(sampleData = true, databasePath = ":memory:") {
  const admins: AdminIdentity[] = [
    { actorId: "author", token: randomUUID(), roles: ["editor", "reviewer"] },
    { actorId: "reviewer-a", token: randomUUID(), roles: ["reviewer"] },
    { actorId: "reviewer-b", token: randomUUID(), roles: ["reviewer"] },
    {
      actorId: "publisher",
      token: randomUUID(),
      roles: ["publisher", "auditor"],
    },
  ];
  const app = await createApplication({
    databasePath,
    sampleData,
    admins,
    rateLimit: 10000,
    staticDirectory: undefined,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  async function client() {
    const response = await fetch(`${base}/guest-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    return {
      cookie,
      csrf: body.csrfToken as string,
      async request(
        path: string,
        method = "GET",
        data?: unknown,
        headers: Record<string, string> = {},
      ) {
        const res = await fetch(base + path, {
          method,
          headers: {
            "content-type": "application/json",
            cookie,
            "x-csrf-token": body.csrfToken,
            "idempotency-key": randomUUID(),
            ...headers,
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return {
          status: res.status,
          body: await res.json(),
          etag: res.headers.get("etag") ?? "",
          headers: res.headers,
        };
      },
    };
  }
  async function admin(
    index: number,
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${admins[index].token}`,
        "idempotency-key": randomUUID(),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get("etag") ?? "",
    };
  }
  return { app, base, client, admin };
}

test("T-05/T-06 session, CSRF, ETag, identity isolation and idempotency contracts", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = await f.client();
  const b = await f.client();
  const original = await a.request("/me/profile");
  assert.equal(original.status, 200);
  assert.equal(original.body.profile.name, "");
  assert.equal(
    (await a.request("/me/profile", "PUT", blankProfile())).status,
    428,
  );
  assert.equal(
    (
      await a.request("/me/profile", "PUT", blankProfile(), {
        "if-match": '"wrong"',
      })
    ).status,
    412,
  );
  assert.equal(
    (
      await a.request("/me/profile", "PUT", blankProfile(), {
        "if-match": original.etag,
        "x-csrf-token": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await a.request("/me/profile", "PUT", blankProfile(), {
        "if-match": original.etag,
        origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  const changed = { ...blankProfile(), name: "仅属于甲" };
  const saved = await a.request("/me/profile", "PUT", changed, {
    "if-match": original.etag,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profileVersion, 1);
  assert.equal((await b.request("/me/profile")).body.profile.name, "");
  assert.equal(
    (
      await a.request(
        "/me/profile",
        "PUT",
        { ...changed, subjectId: "injected" },
        { "if-match": saved.etag },
      )
    ).status,
    400,
  );
  const sel = await a.request("/me/selections");
  const request = {
    profileVersion: 1,
    selectionVersion: sel.body.selectionVersion,
    targetAdmissionYear: 2027,
    filters: {},
    assessmentRefs: [],
  };
  const key = randomUUID();
  const first = await a.request("/recommendations", "POST", request, {
    "idempotency-key": key,
  });
  assert.equal(first.status, 201);
  const replay = await a.request("/recommendations", "POST", request, {
    "idempotency-key": key,
  });
  assert.equal(replay.body.recommendationRunId, first.body.recommendationRunId);
  assert.equal(
    (
      await a.request(
        "/recommendations",
        "POST",
        { ...request, targetAdmissionYear: 2028 },
        { "idempotency-key": key },
      )
    ).status,
    409,
  );
  assert.equal(
    (await b.request(`/recommendations/${first.body.recommendationRunId}`))
      .status,
    404,
  );
  assert.equal(first.body.items.length, 0);
  assert.ok(first.body.pendingVerification.length > 0);
});

test("T-03/T-05 assessment hides keys, persists drafts, requires explicit unanswered submission, submits once", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = await f.client();
  const b = await f.client();
  const created = await a.request("/assessment-attempts", "POST", {
    modules: ["english"],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.questions.length, 5);
  assert.equal(created.body.questions[0].correct, undefined);
  assert.equal(created.body.questions[0].explanation, undefined);
  const path = `/assessment-attempts/${created.body.assessmentAttemptId}`;
  const draft = await a.request(
    path,
    "PATCH",
    {
      answers: [
        {
          questionId: created.body.questions[0].id,
          selectedOption: 0,
          reasoning: "按句意判断",
        },
      ],
      currentIndex: 1,
    },
    { "if-match": created.etag },
  );
  assert.equal(draft.status, 200);
  assert.equal(draft.body.currentIndex, 1);
  assert.equal((await a.request(path + "/result")).status, 409);
  assert.equal((await b.request(path)).status, 404);
  const denied = await a.request(
    path + "/submit",
    "POST",
    {},
    { "if-match": draft.etag },
  );
  assert.equal(denied.status, 422);
  const key = randomUUID();
  const submitted = await a.request(
    path + "/submit",
    "POST",
    { confirmUnanswered: true },
    { "if-match": draft.etag, "idempotency-key": key },
  );
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.status, "submitted");
  assert.equal(submitted.body.diagnosis.counts.total, 5);
  assert.equal(submitted.body.diagnosis.counts.unanswered, 4);
  const duplicate = await a.request(
    path + "/submit",
    "POST",
    { confirmUnanswered: true },
    { "if-match": draft.etag, "idempotency-key": key },
  );
  assert.deepEqual(duplicate.body.diagnosis, submitted.body.diagnosis);
  assert.equal(
    (
      await a.request(
        path,
        "PATCH",
        { answers: [] },
        { "if-match": submitted.etag },
      )
    ).status,
    409,
  );
  const explanation = await a.request(path + "/explanations", "POST", {});
  assert.equal(explanation.status, 200);
  assert.equal(explanation.body.explanationStatus, "template");
  const newAttempt = await a.request("/assessment-attempts", "POST", {
    modules: ["english"],
  });
  assert.notEqual(
    newAttempt.body.assessmentAttemptId,
    created.body.assessmentAttemptId,
  );
  assert.equal(
    (
      await a.request(
        `/assessment-attempts/${newAttempt.body.assessmentAttemptId}/explanations`,
        "POST",
        {},
      )
    ).status,
    409,
  );
});

test("T-07 complete persisted choice-plan-task-report flow and T-06 deletion invalidates every private copy", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = await f.client();
  const profile = await a.request("/me/profile");
  const selection = await a.request("/me/selections");
  const programs = await a.request("/programs");
  const target = programs.body.items[0];
  const saved = await a.request(
    "/me/selections",
    "PUT",
    {
      confirmedMajorId: null,
      savedProgramIds: [target.programId],
      exclusions: [],
    },
    { "if-match": selection.etag },
  );
  assert.equal(saved.status, 200);
  const run = await a.request("/recommendations", "POST", {
    profileVersion: profile.body.profileVersion,
    selectionVersion: saved.body.selectionVersion,
    targetAdmissionYear: 2027,
    filters: {},
    assessmentRefs: [],
  });
  const initial = await a.request("/me/plan");
  const plan = await a.request(
    "/me/plan",
    "PUT",
    {
      selectionVersion: saved.body.selectionVersion,
      programId: target.programId,
      programRevisionId: target.programRevisionId,
      recommendationRunId: run.body.recommendationRunId,
    },
    { "if-match": initial.etag },
  );
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(plan.body.plan.status, "pending_verification");
  assert.equal(plan.body.plan.totalTargetScore, null);
  const tasks = await a.request("/me/tasks");
  const task = tasks.body.items[0];
  assert.equal(
    (
      await a.request(
        `/me/tasks/${encodeURIComponent(task.taskId)}`,
        "PATCH",
        { completed: true },
        { "if-match": task.etag },
      )
    ).status,
    200,
  );
  assert.equal(
    (await a.request("/me/tasks")).body.items.find(
      (item: { taskId: string }) => item.taskId === task.taskId,
    ).completed,
    true,
  );
  const report = await a.request("/reports", "POST", {
    recommendationRunId: run.body.recommendationRunId,
    planId: plan.body.plan.planId,
    planVersion: plan.body.plan.planVersion,
    format: "markdown",
  });
  assert.equal(report.status, 202, JSON.stringify(report.body));
  const content = await a.request(`/reports/${report.body.reportId}`);
  assert.match(content.body.markdown, /五题测评不换算/);
  assert.match(content.body.markdown, /待核验/);
  const correction = await a.request("/corrections", "POST", {
    programId: target.programId,
    programRevisionId: target.programRevisionId,
    field: "资格",
    description: "请核验当年目录",
  });
  assert.equal(correction.status, 201);
  assert.equal((await f.admin(1, "/admin/corrections")).body.items.length, 1);
  const assistant = await a.request("/assistant/questions", "POST", {
    question: "如何核对招生目录？",
    allowSearch: false,
  });
  assert.equal(assistant.status, 200);
  assert.equal(assistant.body.explanationStatus, "template");
  const preview = await a.request("/me/profile/deletion-preview");
  const key = randomUUID();
  const deleted = await a.request(
    "/me/profile",
    "DELETE",
    {},
    {
      "if-match": profile.etag,
      "deletion-scope-version": preview.body.deletionScopeVersion,
      "idempotency-key": key,
    },
  );
  assert.equal(deleted.status, 202);
  assert.equal(
    (await a.request(`/me/jobs/${deleted.body.jobId}`)).body.status,
    "succeeded",
  );
  assert.equal(
    (await a.request(`/reports/${report.body.reportId}`)).status,
    404,
  );
  assert.equal(
    (await a.request(`/recommendations/${run.body.recommendationRunId}`))
      .status,
    404,
  );
  assert.equal((await a.request("/me/tasks")).body.items.length, 0);
  assert.equal(
    (await a.request("/me/selections")).body.savedProgramIds.length,
    0,
  );
  assert.equal((await f.admin(1, "/admin/corrections")).body.items.length, 0);
  const again = await a.request(
    "/me/profile",
    "DELETE",
    {},
    {
      "if-match": profile.etag,
      "deletion-scope-version": preview.body.deletionScopeVersion,
      "idempotency-key": key,
    },
  );
  assert.equal(again.body.jobId, deleted.body.jobId);
  assert.notEqual((await a.request("/me/profile")).etag, profile.etag);
});

test("T-06/T-09 administrative independent review, publish, immutable history and withdrawal", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = await f.client();
  assert.equal((await a.request("/admin/drafts/program")).status, 401);
  const state = createSeedCatalog();
  const release = state.releases[0];
  const original = release.programs[0];
  const revised = {
    ...original,
    programRevisionId: original.programRevisionId + "-corrected",
    supersedesRevisionId: original.programRevisionId,
    reviewStatus: "draft",
    publicationStatus: "unpublished",
  };
  const content = {
    schemaVersion: 1,
    coverage: release.coverage,
    sources: release.sources,
    programs: [revised],
  };
  const draft = await f.admin(0, "/admin/drafts/program", "POST", { content });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const pending = await f.admin(
    0,
    `/admin/drafts/program/${draft.body.draftId}/submit-review`,
    "POST",
    {},
    { "if-match": draft.etag },
  );
  assert.equal(pending.status, 200);
  assert.equal(
    (
      await f.admin(
        0,
        `/admin/reviews/${pending.body.reviewId}/decision`,
        "POST",
        { decision: "approved", reason: "自审" },
        { "if-match": pending.etag },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.admin(3, "/admin/publications", "POST", {
        kind: "catalog",
        draftIds: [draft.body.draftId],
        summary: "未获批",
      })
    ).status,
    409,
  );
  const approved = await f.admin(
    1,
    `/admin/reviews/${pending.body.reviewId}/decision`,
    "POST",
    { decision: "approved", reason: "独立核验来源和年度口径" },
    { "if-match": pending.etag },
  );
  assert.equal(approved.body.reviewStatus, "approved");
  const published = await f.admin(3, "/admin/publications", "POST", {
    kind: "catalog",
    draftIds: [draft.body.draftId],
    summary: "修订示例记录",
  });
  assert.equal(published.status, 202, JSON.stringify(published.body));
  const current = await a.request(`/programs/${original.programId}`);
  assert.equal(current.body.programRevisionId, revised.programRevisionId);
  const old = await a.request(
    `/programs/${original.programId}?catalogVersion=${release.catalogVersion}`,
  );
  assert.equal(old.body.programRevisionId, original.programRevisionId);
  const withdrawn = await f.admin(
    3,
    `/admin/publications/${published.body.publicationId}/withdraw`,
    "POST",
    { revisionIds: [revised.programRevisionId], reason: "资料需重新核验" },
  );
  assert.equal(withdrawn.status, 200);
  assert.equal(
    (await a.request(`/programs/${original.programId}`)).status,
    409,
  );
  const ruleDraft = await f.admin(0, "/admin/drafts/rule", "POST", {
    content: { ...exampleRule, ruleVersion: "rules-reviewed-test" },
  });
  assert.equal(ruleDraft.status, 201);
  const rulePending = await f.admin(
    0,
    `/admin/drafts/rule/${ruleDraft.body.draftId}/submit-review`,
    "POST",
    {},
    { "if-match": ruleDraft.etag },
  );
  const one = await f.admin(
    1,
    `/admin/reviews/${rulePending.body.reviewId}/decision`,
    "POST",
    { decision: "approved", reason: "第一人复核" },
    { "if-match": rulePending.etag },
  );
  assert.equal(one.body.reviewStatus, "pending_review");
  const two = await f.admin(
    2,
    `/admin/reviews/${rulePending.body.reviewId}/decision`,
    "POST",
    { decision: "approved", reason: "第二人复核" },
    { "if-match": one.etag },
  );
  assert.equal(two.body.reviewStatus, "approved");
  assert.ok((await f.admin(3, "/admin/audit-events")).body.items.length >= 8);
});

test("T-09 production configuration never silently substitutes demo facts or demo question bank", async (t) => {
  const f = await setup(false);
  t.after(() => f.app.close());
  const a = await f.client();
  const profile = await a.request("/me/profile");
  const selection = await a.request("/me/selections");
  assert.equal((await a.request("/programs")).body.items.length, 0);
  assert.equal(
    (await a.request("/assessment-attempts", "POST", { modules: ["math"] }))
      .status,
    503,
  );
  assert.equal(
    (
      await a.request("/recommendations", "POST", {
        profileVersion: profile.body.profileVersion,
        selectionVersion: selection.body.selectionVersion,
        targetAdmissionYear: 2027,
      })
    ).status,
    503,
  );
});

test("T-05/T-09 idempotent recommendation replay preserves the run and reapplies withdrawals", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = await f.client();
  const profile = await a.request("/me/profile");
  const selection = await a.request("/me/selections");
  const input = {
    profileVersion: profile.body.profileVersion,
    selectionVersion: selection.body.selectionVersion,
    targetAdmissionYear: 2027,
  };
  const key = randomUUID();
  const first = await a.request("/recommendations", "POST", input, {
    "idempotency-key": key,
  });
  const state = f.app.store.get<CatalogState>("public", "catalog")!.value;
  f.app.store.put(
    "public",
    "catalog",
    "current",
    withdrawRevision(
      state,
      first.body.pendingVerification[0].programRevisionId,
      { reason: "测试撤回屏障", at: new Date().toISOString() },
    ),
  );
  const replay = await a.request("/recommendations", "POST", input, {
    "idempotency-key": key,
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.recommendationRunId, first.body.recommendationRunId);
  assert.equal(replay.body.needsRefresh, true);
});

test("T-06 a program batch cannot smuggle a risk conclusion past two independent reviewers", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = await f.client();
  const release = createSeedCatalog().releases[0];
  const previous = release.programs[0];
  const revised = {
    ...previous,
    programRevisionId: previous.programRevisionId + "-risk",
    supersedesRevisionId: previous.programRevisionId,
    reviewStatus: "draft",
    publicationStatus: "unpublished",
    risks: [
      {
        riskId: "risk-test",
        summary: "独立证据审查测试",
        severity: "severe",
        reviewStatus: "approved",
        reviewers: ["claimed-reviewer-1", "claimed-reviewer-2"],
        independentEvidenceClusters: ["source-cluster-a", "source-cluster-b"],
        sourceIds: previous.sourceIds,
        applicableYears: [2027],
        validUntil: null,
        status: "active",
      },
    ],
  };
  const draft = await f.admin(0, "/admin/drafts/program", "POST", {
    content: {
      schemaVersion: 1,
      coverage: release.coverage,
      sources: release.sources,
      programs: [revised],
    },
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const pending = await f.admin(
    0,
    `/admin/drafts/program/${draft.body.draftId}/submit-review`,
    "POST",
    {},
    { "if-match": draft.etag },
  );
  const first = await f.admin(
    1,
    `/admin/reviews/${pending.body.reviewId}/decision`,
    "POST",
    { decision: "approved", reason: "独立核验第一组材料" },
    { "if-match": pending.etag },
  );
  assert.equal(first.body.reviewStatus, "pending_review");
  assert.equal(
    (
      await f.admin(3, "/admin/publications", "POST", {
        kind: "catalog",
        draftIds: [draft.body.draftId],
        summary: "必须等待第二人",
      })
    ).status,
    409,
  );
  const second = await f.admin(
    2,
    `/admin/reviews/${pending.body.reviewId}/decision`,
    "POST",
    { decision: "approved", reason: "独立核验第二组材料" },
    { "if-match": first.etag },
  );
  assert.equal(second.body.reviewStatus, "approved");
  assert.equal(
    (
      await f.admin(3, "/admin/publications", "POST", {
        kind: "catalog",
        draftIds: [draft.body.draftId],
        summary: "两人复核已满足",
      })
    ).status,
    202,
  );
  const published = await a.request(
    `/programs/${encodeURIComponent(previous.programId)}`,
  );
  assert.deepEqual(published.body.risks[0].reviewers, [
    "reviewer-a",
    "reviewer-b",
  ]);
});

test("T-01/T-09 database survives restart with session and version intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yantu-api-"));
  let f: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    const database = join(directory, "test.sqlite");
    f = await setup(true, database);
    const a = await f.client();
    const current = await a.request("/me/profile");
    const saved = await a.request(
      "/me/profile",
      "PUT",
      { ...blankProfile(), name: "重启后保存" },
      { "if-match": current.etag },
    );
    assert.equal(saved.status, 200);
    await f.app.close();
    f = await setup(true, database);
    const response = await fetch(f.base + "/me/profile", {
      headers: { cookie: a.cookie },
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.profile.name, "重启后保存");
    assert.equal(response.headers.get("etag"), saved.etag);
  } finally {
    if (f) await f.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
