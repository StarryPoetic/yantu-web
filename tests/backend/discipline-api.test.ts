import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import { blankProfile } from "../../server/profile.ts";
import { digest } from "../../server/http.ts";

async function fixture() {
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: undefined,
    rateLimit: 10000,
    admins: [],
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  function client() {
    let cookie = "";
    let csrf = "";
    return {
      get cookie() {
        return cookie;
      },
      async request(
        path: string,
        method = "GET",
        data?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await fetch(base + path, {
          method,
          headers: {
            "content-type": "application/json",
            cookie,
            "x-csrf-token": csrf,
            "idempotency-key": randomUUID(),
            ...headers,
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const body = await response.json();
        if (response.headers.get("set-cookie"))
          cookie = response.headers.get("set-cookie")!.split(";")[0];
        if (body.csrfToken !== undefined) csrf = body.csrfToken;
        return {
          status: response.status,
          body,
          etag: response.headers.get("etag") ?? "",
        };
      },
    };
  }
  const user = client();
  const session = await user.request("/guest-sessions", "POST", {});
  const profile = await user.request("/me/profile");
  const selections = await user.request("/me/selections");
  return { app, base, user, client, session, profile, selections };
}

test("national catalogue is public and every code can be confirmed independently of demo school coverage", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const anonymous = f.client();
  const directory = await anonymous.request("/disciplines");
  assert.equal(directory.status, 200);
  assert.equal(directory.body.items.length, 184);
  assert.equal(
    (
      await anonymous.request(
        "/disciplines?groupCode=03&degreeType=professional",
      )
    ).body.matched,
    5,
  );
  assert.equal(
    (await anonymous.request("/disciplines?groupCode=99")).status,
    422,
  );
  assert.equal((await anonymous.request("/disciplines?q=a&q=b")).status, 400);
  assert.equal(
    (await anonymous.request("/disciplines?status=verified")).status,
    400,
  );
  const saved = await f.user.request(
    "/me/confirmed-major",
    "PUT",
    { majorDirectionId: "0351" },
    { "if-match": f.selections.etag },
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.confirmedMajorId, "0351");
  assert.equal(
    (
      await f.user.request(
        "/me/confirmed-major",
        "PUT",
        { majorDirectionId: "9999" },
        { "if-match": saved.etag },
      )
    ).status,
    422,
  );
  const excluded = await f.user.request(
    "/me/exclusions/majorDirection/1051",
    "PUT",
    {},
    { "if-match": saved.etag },
  );
  assert.equal(excluded.status, 200);
  assert.equal((await anonymous.request("/guidance/latest")).status, 401);
});

test("first blank profile save persists confirmation and later identical saves keep the version", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  assert.equal(f.profile.body.profileCompleted, false);
  assert.equal(f.profile.body.profileSavedAt, null);
  const before = await f.user.request("/guidance", "POST", {
    profileVersion: 0,
    selectionVersion: 0,
    assessmentRefs: [],
  });
  assert.equal(before.status, 409);
  assert.equal(before.body.code, "profile_required");
  const saved = await f.user.request("/me/profile", "PUT", blankProfile(), {
    "if-match": f.profile.etag,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profileVersion, 1);
  assert.equal(saved.body.profileCompleted, true);
  assert.ok(saved.body.profileSavedAt);
  const repeat = await f.user.request("/me/profile", "PUT", blankProfile(), {
    "if-match": saved.etag,
  });
  assert.equal(repeat.etag, saved.etag);
  assert.equal(repeat.body.profileVersion, 1);
  assert.equal(repeat.body.profileSavedAt, saved.body.profileSavedAt);
  assert.equal((await f.user.request("/guidance/latest")).body.guidance, null);
  const guide = await f.user.request("/guidance", "POST", {
    profileVersion: 1,
    selectionVersion: 0,
    assessmentRefs: [],
  });
  assert.equal(guide.status, 201);
  assert.equal(guide.body.directions.length, 184);
  assert.deepEqual(guide.body.highlightedIds, []);
  assert.equal(guide.body.needsRefresh, false);
  assert.equal(
    (await f.user.request("/guidance/latest")).body.guidance.guidanceRunId,
    guide.body.guidanceRunId,
  );
});

test("guidance preserves fixed inputs, protects ownership, rejects forged output and marks stale historical conclusions", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const saved = await f.user.request(
    "/me/profile",
    "PUT",
    { ...blankProfile(), major: "护理学" },
    { "if-match": f.profile.etag },
  );
  const data = { profileVersion: 1, selectionVersion: 0, assessmentRefs: [] };
  assert.equal(
    (
      await f.user.request("/guidance", "POST", {
        ...data,
        highlightedIds: ["0812"],
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.user.request("/guidance", "POST", { ...data, profileVersion: 0 }))
      .status,
    409,
  );
  assert.equal(
    (
      await f.user.request("/guidance", "POST", {
        ...data,
        assessmentRefs: [
          { assessmentAttemptId: "fabricated", diagnosisVersion: "fake" },
        ],
      })
    ).status,
    404,
  );
  const key = randomUUID();
  const guide = await f.user.request("/guidance", "POST", data, {
    "idempotency-key": key,
  });
  assert.equal(guide.status, 201);
  assert.ok(guide.body.highlightedIds.includes("1054"));
  const other = f.client();
  await other.request("/guest-sessions", "POST", {});
  assert.equal(
    (await other.request(`/guidance/${guide.body.guidanceRunId}`)).status,
    404,
  );
  await f.user.request(
    "/me/profile",
    "PUT",
    { ...blankProfile(), major: "法学" },
    { "if-match": saved.etag },
  );
  const history = await f.user.request(`/guidance/${guide.body.guidanceRunId}`);
  assert.equal(history.body.needsRefresh, true);
  assert.equal(history.body.inputSnapshot.profile.major, "护理学");
  assert.equal(history.body.versions.profileVersion, 1);
  assert.deepEqual(history.body.directions, guide.body.directions);
  assert.equal(
    (await f.user.request("/guidance/latest")).body.guidance.needsRefresh,
    true,
  );
  const replay = await f.user.request("/guidance", "POST", data, {
    "idempotency-key": key,
  });
  assert.equal(replay.body.guidanceRunId, guide.body.guidanceRunId);
  assert.equal(replay.body.needsRefresh, true);
});

test("historical saved profiles migrate without inventing a save time or changing their semantic version", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const session = f.app.store.session(digest(f.user.cookie.split("=")[1]))!;
  f.app.store.put(session.subjectId, "profile", "current", {
    profile: { ...blankProfile(), major: "机械工程" },
    profileVersion: 4,
  });
  const profile = await f.user.request("/me/profile");
  assert.equal(profile.body.profileVersion, 4);
  assert.equal(profile.body.profileCompleted, true);
  assert.equal(profile.body.profileSavedAt, null);
  assert.equal((await f.user.request("/me/profile")).etag, profile.etag);
  const guidance = await f.user.request("/guidance", "POST", {
    profileVersion: 4,
    selectionVersion: 0,
    assessmentRefs: [],
  });
  assert.equal(guidance.status, 201);
  assert.ok(guidance.body.highlightedIds.includes("0802"));
  const selected = await f.user.request(
    "/me/confirmed-major",
    "PUT",
    { majorDirectionId: "1054" },
    { "if-match": f.selections.etag },
  );
  assert.equal(selected.status, 200);
  assert.equal(
    (await f.user.request("/guidance/latest")).body.guidance.needsRefresh,
    true,
  );
});

test("guidance uses submitted public-course observations only and detects withdrawals without deleting history", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  await f.user.request("/me/profile", "PUT", blankProfile(), {
    "if-match": f.profile.etag,
  });
  const created = await f.user.request("/assessment-attempts", "POST", {
    modules: ["english"],
  });
  assert.equal(created.status, 201);
  const submitted = await f.user.request(
    `/assessment-attempts/${created.body.assessmentAttemptId}/submit`,
    "POST",
    { confirmUnanswered: true },
    { "if-match": created.etag },
  );
  assert.equal(submitted.status, 200);
  const assessmentRefs = [
    {
      assessmentAttemptId: submitted.body.assessmentAttemptId,
      diagnosisVersion: submitted.body.diagnosis.diagnosisVersion,
    },
  ];
  const data = { profileVersion: 1, selectionVersion: 0, assessmentRefs };
  assert.equal(
    (
      await f.user.request("/guidance", "POST", {
        ...data,
        assessmentRefs: [...assessmentRefs, ...assessmentRefs],
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await f.user.request("/guidance", "POST", {
        ...data,
        assessmentRefs: [{ ...assessmentRefs[0], diagnosisVersion: "stale" }],
      })
    ).status,
    409,
  );
  const guide = await f.user.request("/guidance", "POST", data);
  assert.equal(guide.status, 201);
  assert.equal(guide.body.assessmentSummary.used, 0);
  assert.match(
    guide.body.assessmentSummary.ignored[0].reason,
    /不作为正式推荐依据/,
  );
  assert.ok(guide.body.assessmentSummary.observations.length > 0);
  const reference = guide.body.assessmentSummary.references[0];
  assert.equal(
    reference.questionBankVersion,
    submitted.body.questionBankVersion,
  );
  assert.equal(reference.submittedAt, submitted.body.submittedAt);
  assert.deepEqual(reference.scope, submitted.body.scope);
  assert.equal(reference.items.length, 5);
  assert.ok(
    reference.items.every(
      (item: {
        module: string;
        outcome: string;
        scopes: string[];
        calibration: string;
      }) =>
        item.module === "english" &&
        item.outcome === "unanswered" &&
        item.scopes.includes("common-foundation") &&
        item.calibration === "manual_initial",
    ),
  );
  assert.deepEqual(guide.body.highlightedIds, []);
  assert.equal(JSON.stringify(guide.body).includes("correctOption"), false);
  f.app.store.put(
    "public",
    "withdrawn-banks",
    submitted.body.questionBankVersion,
    { reason: "审核撤回" },
  );
  assert.equal(
    (await f.user.request("/guidance/latest")).body.guidance.needsRefresh,
    true,
  );
  const regenerated = await f.user.request("/guidance", "POST", data);
  assert.equal(regenerated.status, 201);
  assert.equal(regenerated.body.needsRefresh, false);
  assert.deepEqual(regenerated.body.versions.assessmentRefs, []);
  assert.deepEqual(regenerated.body.assessmentSummary.observations, []);
  assert.equal(regenerated.body.assessmentSummary.used, 0);
  assert.match(
    regenerated.body.assessmentSummary.ignored[0].reason,
    /题库已撤回/,
  );
});
