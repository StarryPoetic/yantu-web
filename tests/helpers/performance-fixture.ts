import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import { createSeedCatalog } from "../../server/catalog/index.ts";
import type { AppConfig } from "../../server/config.ts";

/** Synthetic verified scope for workflow tests only; no real catalog/review is published. */
export async function performanceFixture(overrides: Partial<AppConfig> = {}) {
  const admins = [
    {
      actorId: "performance-reviewer",
      token: randomUUID(),
      roles: ["reviewer"] as "reviewer"[],
    },
    {
      actorId: "performance-editor",
      token: randomUUID(),
      roles: ["editor"] as "editor"[],
    },
  ];
  const options = {
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: undefined,
    rateLimit: 10000,
    admins,
    bootstrapAdmins: [],
    ...overrides,
  };
  let app = await createApplication(options);
  const state = createSeedCatalog();
  const target = state.releases[0].programs[0];
  target.identity.targetAdmissionYear = new Date().getUTCFullYear() + 1;
  target.identity.examGroupId = "synthetic-comparable-group";
  target.availability = "verified_current";
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
      optionGroupId: "language",
    },
    {
      subjectId: "japanese",
      name: "日语",
      maxScore: 100,
      optionGroupId: "language",
    },
    { subjectId: "math", name: "数学一", maxScore: 150, optionGroupId: null },
    {
      subjectId: "major",
      name: "专业基础",
      maxScore: 150,
      optionGroupId: null,
    },
  ].map((row) => ({
    ...row,
    availability: "verified_current" as const,
    minimumScore: 0,
    sourceIds: ["synthetic-test-only"],
  }));
  app.store.put("public", "catalog", "current", state);
  let base = "";
  async function listen() {
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    base = `http://127.0.0.1:${address.port}`;
  }
  await listen();
  async function send(
    path: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get("etag") ?? "",
      headers: response.headers,
    };
  }
  function client() {
    let cookie = "",
      csrf = "";
    return {
      async request(
        path: string,
        method = "GET",
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await send(path, method, body, {
          cookie,
          "x-csrf-token": csrf,
          ...headers,
        });
        if (response.headers.get("set-cookie"))
          cookie = response.headers.get("set-cookie")!.split(";")[0];
        if (response.body.csrfToken !== undefined)
          csrf = response.body.csrfToken ?? "";
        return response;
      },
    };
  }
  const student = client();
  const registered = await student.request("/auth/register", "POST", {
    username: `performance_${randomUUID().slice(0, 8)}`,
    password: "Test-Performance-Password-2026!",
  });
  assert.equal(registered.status, 201);
  const owner = registered.body.user.accountId as string;
  async function choose() {
    const selection = await student.request("/me/selections");
    const chosen = await student.request(
      "/me/target",
      "PUT",
      {
        programId: target.programId,
        programRevisionId: target.programRevisionId,
      },
      { "if-match": selection.etag },
    );
    assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
    return chosen;
  }
  await choose();
  const submission = {
    programId: target.programId,
    programRevisionId: target.programRevisionId,
    targetAdmissionYear: target.identity.targetAdmissionYear,
    examGroupId: target.identity.examGroupId,
    subjectId: "english",
    score: 61,
    maxScore: 100,
    measuredAt: new Date().toISOString().slice(0, 10),
    kind: "standardized_mock",
    source: "Synthetic exam test only",
    evidenceReference:
      "Synthetic proof test only; no real grades or human review",
  };
  async function admin(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
    index = 0,
  ) {
    return send(path, method, body, {
      authorization: `Bearer ${admins[index].token}`,
      ...headers,
    });
  }
  async function approve(
    item: { performanceId: string; etag: string },
    headers: Record<string, string> = {},
  ) {
    return admin(
      `/admin/performance/${item.performanceId}/decision`,
      "POST",
      {
        decision: "approved",
        reason: "仅用于自动化测试的合成材料审核，不是真实审核记录。",
        checks: ["evidence_verified", "scope_comparable", "score_checked"],
      },
      { "if-match": item.etag, ...headers },
    );
  }
  async function savePlan(language = "english") {
    const initial = await student.request("/me/plan"),
      selection = await student.request("/me/selections");
    return student.request(
      "/me/plan",
      "PUT",
      {
        programId: target.programId,
        programRevisionId: target.programRevisionId,
        selectionVersion: selection.body.selectionVersion,
        selectedSubjectIds: ["politics", language, "math", "major"],
        subjectTargets: { [language]: 80 },
      },
      { "if-match": initial.etag },
    );
  }
  return {
    get app() {
      return app;
    },
    get base() {
      return base;
    },
    admins,
    state,
    target,
    owner,
    student,
    client,
    submission,
    admin,
    approve,
    savePlan,
    async restart() {
      await app.close();
      app = await createApplication(options);
      await listen();
    },
    close: () => app.close(),
  };
}
