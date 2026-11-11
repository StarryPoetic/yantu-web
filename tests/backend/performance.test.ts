import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { performanceFixture } from "../helpers/performance-fixture.ts";
import type { PerformanceRecord } from "../../server/performance/index.ts";
import { stalePlanPerformance } from "../../server/performance/index.ts";

test("performance API keeps pending scores out, requires actual independent checks, persists approved comparable gaps", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yantu-performance-"));
  const f = await performanceFixture({
    databasePath: join(directory, "test.sqlite"),
  });
  t.after(async () => {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  });
  const created = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, "pending");
  let plan = await f.savePlan();
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(
    plan.body.plan.subjects.find(
      (row: { subjectId: string }) => row.subjectId === "english",
    ).gap,
    null,
  );
  const noChecks = await f.admin(
    `/admin/performance/${created.body.performanceId}/decision`,
    "POST",
    { decision: "approved", reason: "审核测试说明足够长但没有检查项" },
    { "if-match": created.etag },
  );
  assert.equal(noChecks.status, 422);
  assert.equal((await f.approve(created.body)).status, 200);
  plan = await f.savePlan();
  const english = plan.body.plan.subjects.find(
    (row: { subjectId: string }) => row.subjectId === "english",
  );
  assert.equal(english.currentScore, 61);
  assert.equal(english.gap, 19);
  assert.equal(
    english.currentEvidence.performanceId,
    created.body.performanceId,
  );
  await f.restart();
  const restored = await f.student.request("/me/plan");
  assert.equal(restored.status, 200);
  assert.equal(
    restored.body.plan.subjects.find(
      (row: { subjectId: string }) => row.subjectId === "english",
    ).gap,
    19,
  );
  assert.equal(
    (await f.student.request("/me/performance")).body.items[0].status,
    "approved",
  );
});

test("performance rejects self review, cross-account access, privilege injection and stale decisions", async (t) => {
  const f = await performanceFixture();
  t.after(f.close);
  assert.equal(
    (
      await f.student.request("/me/performance", "POST", {
        ...f.submission,
        reviewed: true,
      })
    ).status,
    400,
  );
  const created = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
  );
  const other = f.client();
  await other.request("/auth/register", "POST", {
    username: `other_${randomUUID().slice(0, 8)}`,
    password: "Another-Test-Password-2026!",
  });
  assert.equal(
    (await other.request(`/me/performance/${created.body.performanceId}`))
      .status,
    404,
  );
  assert.equal(
    (
      await other.request(
        `/me/performance/${created.body.performanceId}/withdraw`,
        "POST",
        { reason: "not my record" },
        { "if-match": created.etag },
      )
    ).status,
    404,
  );
  assert.equal((await f.student.request("/admin/performance")).status, 403);
  assert.equal(
    (await f.admin("/admin/performance", "GET", undefined, {}, 1)).status,
    403,
  );
  f.app.config.admins[0].actorId = f.owner;
  assert.equal((await f.approve(created.body)).status, 403);
  f.app.config.admins[0].actorId = "independent-reviewer";
  assert.equal((await f.approve(created.body)).status, 200);
  assert.equal((await f.approve(created.body)).status, 412);
});

test("performance bounds reject estimates, incompatible years/revisions/subjects/maxima and non-current evidence", async (t) => {
  const f = await performanceFixture();
  t.after(f.close);
  for (const patch of [
    { kind: "self_report" },
    { kind: "five_question_screening" },
    { programRevisionId: "other-revision" },
    { targetAdmissionYear: 2024 },
    { examGroupId: "other-exam" },
    { subjectId: "other-subject" },
    { maxScore: 150 },
    { score: 101 },
    { score: -1 },
    { measuredAt: "2099-01-01" },
    { measuredAt: "2020-01-01" },
    { measuredAt: "2026-02-30" },
    { source: "" },
    { evidenceReference: "" },
  ]) {
    const result = await f.student.request("/me/performance", "POST", {
      ...f.submission,
      ...patch,
    });
    assert.equal(
      result.status,
      422,
      JSON.stringify({ patch, body: result.body }),
    );
  }
  f.target.identity.examGroupId = null;
  f.app.store.put("public", "catalog", "current", f.state);
  assert.equal(
    (await f.student.request("/me/performance", "POST", f.submission)).status,
    422,
  );
  assert.equal(
    (await f.student.request("/me/performance")).body.items.length,
    0,
  );
});

test("student withdrawal invalidates current scores, tasks and historical report eligibility, and replay cannot revive approval", async (t) => {
  const f = await performanceFixture();
  t.after(f.close);
  const key = randomUUID();
  const created = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
    { "idempotency-key": key },
  );
  await f.approve(created.body);
  const saved = await f.savePlan();
  const row = (await f.student.request("/me/performance")).body.items[0];
  const withdrawal = await f.student.request(
    `/me/performance/${row.performanceId}/withdraw`,
    "POST",
    { reason: "原成绩证明口径需修正，主动撤回" },
    { "if-match": row.etag },
  );
  assert.equal(withdrawal.status, 200);
  const current = (await f.student.request("/me/plan")).body.plan;
  assert.equal(current.status, "needs_review");
  assert.ok(
    current.subjects.every(
      (item: { currentScore: number | null; gap: number | null }) =>
        item.currentScore === null && item.gap === null,
    ),
  );
  assert.equal(
    stalePlanPerformance(f.app.store, f.owner, saved.body.plan),
    true,
  );
  const historical = await f.student.request(
    `/me/plans/${saved.body.plan.planId}/versions/${saved.body.plan.planVersion}`,
  );
  assert.equal(historical.body.plan.status, "needs_review");
  assert.ok(
    historical.body.plan.subjects.every(
      (item: { currentScore: number | null }) => item.currentScore === null,
    ),
  );
  const tasks = await f.student.request("/me/tasks");
  assert.ok(tasks.body.items.length > 0);
  const task = tasks.body.items[0];
  assert.equal(
    (
      await f.student.request(
        `/me/tasks/${task.taskId}`,
        "PATCH",
        { completed: true },
        { "if-match": task.etag },
      )
    ).status,
    409,
  );
  assert.ok(
    f.app.store
      .list<{ needsReconfirmation: boolean }>(f.owner, "task")
      .every((item) => item.value.needsReconfirmation),
  );
  const replay = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
    { "idempotency-key": key },
  );
  assert.equal(replay.body.status, "withdrawn");
  assert.equal(
    (await f.student.request("/me/performance")).body.items.length,
    1,
  );
});

test("expiry and catalog revision changes invalidate saved plans on read without treating a prior review as current", async (t) => {
  const f = await performanceFixture();
  t.after(f.close);
  const created = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
  );
  await f.approve(created.body);
  await f.savePlan();
  const item = f.app.store.get<PerformanceRecord>(
    f.owner,
    "performance",
    created.body.performanceId,
  )!;
  f.app.store.put(f.owner, "performance", created.body.performanceId, {
    ...item.value,
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(
    (await f.student.request("/me/plan")).body.plan.status,
    "needs_review",
  );
  f.app.store.put(
    f.owner,
    "performance",
    created.body.performanceId,
    item.value,
  );
  await f.savePlan();
  f.target.programRevisionId += "-changed";
  f.app.store.put("public", "catalog", "current", f.state);
  assert.equal(
    (await f.student.request("/me/plan")).body.plan.status,
    "needs_review",
  );
  assert.equal(
    (await f.student.request("/me/performance")).body.items[0].applicable,
    false,
  );
});

test("subject alternatives never borrow approved scores from another language", async (t) => {
  const f = await performanceFixture();
  t.after(f.close);
  const created = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
  );
  await f.approve(created.body);
  const result = await f.savePlan("japanese");
  assert.equal(result.status, 200);
  const japanese = result.body.plan.subjects.find(
    (row: { subjectId: string }) => row.subjectId === "japanese",
  );
  assert.equal(japanese.currentScore, null);
  assert.equal(japanese.gap, null);
});

test("reviewer can reject or revoke, deleted personal records disappear from the queue and admin replays", async (t) => {
  const f = await performanceFixture();
  t.after(f.close);
  const created = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
  );
  const key = randomUUID();
  await f.approve(created.body, { "idempotency-key": key });
  await f.savePlan();
  let item = (await f.admin("/admin/performance")).body.items[0];
  const revoked = await f.admin(
    `/admin/performance/${item.performanceId}/withdraw`,
    "POST",
    { reason: "复核发现证明不再有效，按规则撤回此成绩" },
    { "if-match": item.etag },
  );
  assert.equal(revoked.status, 200);
  assert.equal(
    (await f.student.request("/me/plan")).body.plan.status,
    "needs_review",
  );
  const second = await f.student.request(
    "/me/performance",
    "POST",
    f.submission,
  );
  assert.equal(
    (
      await f.admin(
        `/admin/performance/${second.body.performanceId}/decision`,
        "POST",
        {
          decision: "rejected",
          reason: "原始证明无法核验，本次拒绝并等待补充资料",
        },
        { "if-match": second.etag },
      )
    ).status,
    200,
  );
  item = (await f.student.request("/me/performance")).body.items.find(
    (row: PerformanceRecord) => row.performanceId === second.body.performanceId,
  );
  assert.equal(item.status, "rejected");
  assert.equal(item.applicable, false);
  const profile = await f.student.request("/me/profile");
  const scope = await f.student.request("/me/profile/deletion-preview");
  assert.ok(scope.body.required.includes("成绩、证明定位及审核记录"));
  assert.equal(
    (
      await f.student.request(
        "/me/profile",
        "DELETE",
        {},
        {
          "if-match": profile.etag,
          "deletion-scope-version": scope.body.deletionScopeVersion,
        },
      )
    ).status,
    202,
  );
  assert.equal((await f.admin("/admin/performance")).body.items.length, 0);
  const replay = await f.approve(created.body, { "idempotency-key": key });
  assert.equal(replay.status, 404);
  const stored = JSON.stringify(
    f.app.store.db
      .prepare(
        "SELECT value FROM resources UNION ALL SELECT response FROM idempotency",
      )
      .all(),
  );
  assert.equal(stored.includes(f.submission.evidenceReference), false);
  assert.equal(stored.includes(f.submission.source), false);
});
