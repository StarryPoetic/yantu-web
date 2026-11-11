import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import {
  loadQuestionBank,
  QUESTION_REVIEW_CHECKS,
} from "../../server/assessment/index.ts";
import type { QuestionBank } from "../../server/assessment/types.ts";
import type { AdminIdentity } from "../../server/config.ts";

async function setup() {
  const admins: AdminIdentity[] = [
    { actorId: "author", token: randomUUID(), roles: ["editor", "reviewer"] },
    { actorId: "reviewer", token: randomUUID(), roles: ["reviewer"] },
    { actorId: "publisher", token: randomUUID(), roles: ["publisher"] },
  ];
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    admins,
    staticDirectory: undefined,
    rateLimit: 10000,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  async function send(
    path: string,
    method: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get("etag") ?? "",
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const session = await send("/guest-sessions", "POST", {});
  const user = (path: string, method = "GET", body?: unknown, etag?: string) =>
    send(path, method, body, {
      cookie: session.cookie,
      "x-csrf-token": session.body.csrfToken,
      ...(etag ? { "if-match": etag } : {}),
    });
  const admin = (
    index: number,
    path: string,
    method = "POST",
    body?: unknown,
    etag?: string,
  ) =>
    send(path, method, body, {
      authorization: `Bearer ${admins[index].token}`,
      ...(etag ? { "if-match": etag } : {}),
    });
  async function prepare(content: QuestionBank) {
    const created = await admin(0, "/admin/drafts/question", "POST", {
      content,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const pending = await admin(
      0,
      `/admin/drafts/question/${created.body.draftId}/submit-review`,
      "POST",
      {},
      created.etag,
    );
    assert.equal(pending.status, 200);
    return pending;
  }
  return { app, user, admin, prepare };
}

test("question publishing requires explicit independent checks, preserves revisions and invalidates withdrawn drafts", async (t) => {
  const fixture = await setup();
  t.after(() => fixture.app.close());
  const bank = await loadQuestionBank();
  bank.mode = "reviewed";
  bank.questionBankVersion = "candidate-fixture";
  bank.questions.forEach((question) => {
    question.revisionId += "-api-fixture";
  });
  const pending = await fixture.prepare(bank);
  const decisionPath = `/admin/reviews/${pending.body.reviewId}/decision`;
  const noChecks = await fixture.admin(
    1,
    decisionPath,
    "POST",
    { decision: "approved", reason: "Fixture review" },
    pending.etag,
  );
  assert.equal(noChecks.status, 422);
  assert.equal(noChecks.body.code, "question_checks_required");
  const partial = await fixture.admin(
    1,
    decisionPath,
    "POST",
    {
      decision: "approved",
      reason: "Fixture review",
      checks: ["answer_unique"],
    },
    pending.etag,
  );
  assert.equal(partial.status, 422);
  const self = await fixture.admin(
    0,
    decisionPath,
    "POST",
    {
      decision: "approved",
      reason: "Self review",
      checks: QUESTION_REVIEW_CHECKS,
    },
    pending.etag,
  );
  assert.equal(self.status, 403);
  const approved = await fixture.admin(
    1,
    decisionPath,
    "POST",
    {
      decision: "approved",
      reason: "Synthetic fixture checked by independent test identity",
      checks: QUESTION_REVIEW_CHECKS,
    },
    pending.etag,
  );
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.body.reviews[0].checks, QUESTION_REVIEW_CHECKS);
  const published = await fixture.admin(2, "/admin/publications", "POST", {
    kind: "questionBank",
    draftIds: [pending.body.draftId],
    summary: "Synthetic question bank fixture",
  });
  assert.equal(published.status, 202, JSON.stringify(published.body));
  const stored = fixture.app.store.get<QuestionBank>(
    "public",
    "question-bank",
  )!.value;
  assert.equal(stored.questions[0].review?.reviewerId, "reviewer");
  assert.deepEqual(stored.questions[0].review?.checks, QUESTION_REVIEW_CHECKS);
  const open = await fixture.user("/assessment-attempts", "POST", {
    modules: ["english"],
  });
  assert.equal(open.status, 201);
  const another = await fixture.user("/assessment-attempts", "POST", {
    modules: ["english"],
  });
  const submitted = await fixture.user(
    `/assessment-attempts/${another.body.assessmentAttemptId}/submit`,
    "POST",
    { confirmUnanswered: true },
    another.etag,
  );
  assert.equal(submitted.status, 200);

  const changed = structuredClone(bank);
  changed.questions[0].correct = (changed.questions[0].correct + 1) % 4;
  const changedPending = await fixture.prepare(changed);
  await fixture.admin(
    1,
    `/admin/reviews/${changedPending.body.reviewId}/decision`,
    "POST",
    {
      decision: "approved",
      reason: "Test immutable revision guard",
      checks: QUESTION_REVIEW_CHECKS,
    },
    changedPending.etag,
  );
  const forbidden = await fixture.admin(2, "/admin/publications", "POST", {
    kind: "questionBank",
    draftIds: [changedPending.body.draftId],
    summary: "Must not overwrite existing revision",
  });
  assert.equal(forbidden.status, 409);
  assert.equal(forbidden.body.code, "QUESTION_REVISION_IMMUTABLE");
  assert.equal(
    fixture.app.store.get<QuestionBank>("public", "question-bank")!.value
      .questionBankVersion,
    published.body.version,
  );

  const withdrawn = await fixture.admin(
    2,
    `/admin/publications/${published.body.publicationId}/withdraw`,
    "POST",
    { reason: "Test invalidation" },
  );
  assert.equal(withdrawn.status, 200);
  const oldOpen = await fixture.user(
    `/assessment-attempts/${open.body.assessmentAttemptId}`,
  );
  assert.equal(oldOpen.body.status, "invalidated");
  assert.match(oldOpen.body.closedReason, /Test invalidation/);
  assert.deepEqual(oldOpen.body.answers, open.body.answers);
  const history = await fixture.user(
    `/assessment-attempts/${another.body.assessmentAttemptId}`,
  );
  assert.equal(history.body.status, "submitted");
  assert.deepEqual(history.body.diagnosis, submitted.body.diagnosis);
  const blocked = await fixture.user("/assessment-attempts", "POST", {
    modules: ["english"],
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "bank_withdrawn");
});
