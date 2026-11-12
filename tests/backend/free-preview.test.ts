import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import { environmentConfig } from "../../server/config.ts";
import type { QuestionBank } from "../../server/assessment/types.ts";
import type { ResearchEngine } from "../../server/routes/research.ts";

function previewEnvironment(t: TestContext, databasePath: string) {
  const previous = process.env;
  // Use only synthetic settings. Credential getters prove preview never reads a provider key.
  process.env = {
    NODE_ENV: "production",
    YANTU_ORIGIN: "https://preview.example",
    YANTU_DATABASE_PATH: databasePath,
    YANTU_PREVIEW_MODE: "true",
    YANTU_SAMPLE_DATA: "false",
    YANTU_MODEL_ENABLED: "true",
    YANTU_SEARCH_ENABLED: "true",
    YANTU_SEARCH_PROVIDER: "invalid-provider-must-not-be-resolved",
  };
  for (const key of [
    "DEEPSEEK_API_KEY",
    "BOCHA_API_KEY",
    "BRAVE_SEARCH_API_KEY",
  ])
    Object.defineProperty(process.env, key, {
      get() {
        assert.fail("Preview must not resolve provider credentials");
      },
    });
  t.after(() => {
    process.env = previous;
  });
}

test("explicit preview allows examples but retains production HTTPS, absolute DB and Secure Cookie configuration", (t) => {
  previewEnvironment(t, resolve("var", "synthetic-preview.sqlite"));
  const config = environmentConfig();
  assert.equal(config.previewMode, true);
  assert.equal(config.sampleData, true);
  assert.equal(config.secureCookies, true);
  assert.deepEqual(config.origins, ["https://preview.example"]);
  process.env.YANTU_ORIGIN = "http://preview.example";
  assert.throws(environmentConfig, /HTTPS/);
  delete process.env.YANTU_ORIGIN;
  assert.throws(environmentConfig, /HTTPS/);
  process.env.YANTU_ORIGIN = "https://preview.example";
  for (const path of ["", ":memory:", "./var/preview.sqlite"]) {
    process.env.YANTU_DATABASE_PATH = path;
    assert.throws(environmentConfig, /YANTU_DATABASE_PATH/);
  }
  process.env.YANTU_DATABASE_PATH = resolve("var", "synthetic-preview.sqlite");
  process.env.YANTU_SAMPLE_DATA = "true";
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    if (flag === undefined) delete process.env.YANTU_PREVIEW_MODE;
    else process.env.YANTU_PREVIEW_MODE = flag;
    assert.equal(environmentConfig().previewMode, false);
    assert.equal(environmentConfig().sampleData, false);
  }
});

test("production preview supports sample account/catalog/assessment flows and blocks paid services despite enabled flags", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yantu-preview-test-"));
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  t.after(async () => {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  });
  previewEnvironment(t, join(directory, "preview.sqlite"));
  let injectedCalls = 0;
  const forbiddenEngine: ResearchEngine = {
    getReadiness() {
      injectedCalls++;
      assert.fail("Preview must not use an injected live research engine");
    },
    clearSubject() {},
    async generate() {
      injectedCalls++;
      assert.fail("Preview must not generate a paid report");
    },
  };
  app = await createApplication(
    { staticDirectory: undefined },
    { research: forbiddenEngine },
  );
  await new Promise<void>((done) => app!.server.listen(0, "127.0.0.1", done));
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  let cookie = "";
  let csrf = "";
  const nativeFetch = globalThis.fetch;
  let externalCalls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (...args: Parameters<typeof fetch>) => {
      if (!String(args[0]).startsWith(base + "/")) {
        externalCalls++;
        assert.fail("No external requests are allowed in preview tests");
      }
      return nativeFetch(...args);
    },
  );
  async function request(
    path: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: "https://preview.example",
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
        ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const body = await response.json();
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    if (body.csrfToken) csrf = body.csrfToken;
    return { status: response.status, body, headers: response.headers };
  }
  const anonymous = await request("/auth/session");
  assert.equal(anonymous.body.authenticated, false);
  assert.deepEqual(anonymous.body.features, {
    sampleData: true,
    previewMode: true,
    modelEnabled: false,
  });
  const account = await request("/auth/register", "POST", {
    username: "preview.student",
    password: "Synthetic-Preview-Password-2026!",
  });
  assert.equal(account.status, 201);
  assert.equal(account.body.features.previewMode, true);
  assert.equal(account.body.features.modelEnabled, false);
  assert.match(account.headers.get("set-cookie")!, /; Secure/);
  assert.match(account.headers.get("set-cookie")!, /; HttpOnly/);
  const catalog = await request("/programs");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.mode, "example");
  assert.ok(catalog.body.items.length > 0);
  const bank = app.store.get<QuestionBank>("public", "question-bank")!.value;
  assert.equal(bank.mode, "example");
  assert.ok(
    bank.questions.every((question) => question.reviewStatus !== "approved"),
  );
  const attempt = await request("/assessment-attempts", "POST", {
    modules: ["math"],
    stage: "initial",
  });
  assert.equal(attempt.status, 201);
  assert.equal(attempt.body.example, true);
  assert.ok(attempt.body.questions.length > 0);
  const profile = await request("/me/profile");
  const saved = await request(
    "/me/profile",
    "PUT",
    { ...profile.body.profile, major: "法学", targetMajor: "法学" },
    { "If-Match": profile.headers.get("etag")! },
  );
  assert.equal(saved.status, 200);
  const selections = await request("/me/selections");
  const guidance = await request("/guidance", "POST", {
    profileVersion: saved.body.profileVersion,
    selectionVersion: selections.body.selectionVersion,
    assessmentRefs: [],
  });
  assert.equal(guidance.status, 201);
  const readiness = await request("/research/status");
  assert.equal(readiness.body.ready, false);
  for (const reason of ["MODEL_DISABLED", "SEARCH_DISABLED"])
    assert.ok(readiness.body.reasons.includes(reason));
  const job = await request(
    `/guidance/${guidance.body.guidanceRunId}/research`,
    "POST",
    {},
  );
  assert.equal(job.body.status, "blocked");
  const chat = await request("/assistant/conversation");
  const answer = await request(
    "/assistant/conversation",
    "POST",
    { message: "查询今年招生信息", allowSearch: true },
    { "If-Match": chat.headers.get("etag")! },
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.body.messages.at(-1).reason, "MODEL_DISABLED");
  const web = await request("/assistant/questions", "POST", {
    question: "查询今年招生信息",
    allowSearch: true,
  });
  assert.equal(web.status, 200);
  assert.notEqual(web.body.status, "answered");
  assert.equal(web.body.searched, false);
  assert.equal(injectedCalls, 0);
  assert.equal(externalCalls, 0);
});
