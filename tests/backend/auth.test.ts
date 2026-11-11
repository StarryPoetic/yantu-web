import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createApplication } from "../../server/app.ts";
import { digest } from "../../server/http.ts";
import { hashPassword, verifyPassword } from "../../server/auth/password.ts";
import { blankProfile } from "../../server/profile.ts";
import type { AppConfig } from "../../server/config.ts";
import { authRateLimit } from "../../server/config.ts";
import type { ResearchEngine } from "../../server/routes/research.ts";

const password = "test-only-secure-password";

test("only successful account deletion clears the owner's active research and prevents late writes", async (t) => {
  let release!: () => void;
  let started!: () => void;
  const suspended = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generating = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cleared: string[] = [];
  const privateMemory = new Map<string, string>();
  const model = {
    name: "deepseek-v4-pro",
    thinking: true,
    effort: "high",
  } as const;
  const engine: ResearchEngine = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject(owner) {
      cleared.push(owner);
      privateMemory.delete(owner);
    },
    async generate(input) {
      privateMemory.set(input.subjectId, "test-only-private-context");
      started();
      await suspended;
      // Simulate an upstream call that has already completed despite cancellation.
      return {
        schemaVersion: 1,
        status: "completed",
        generatedAt: new Date().toISOString(),
        guidanceRunId: input.run.guidanceRunId,
        versions: input.run.versions,
        summary: "late private result",
        facts: [],
        recommendations: [],
        sources: [],
        limitations: ["synthetic test only"],
        model,
        searched: true,
      };
    },
  };
  const f = await setup({}, { research: engine });
  t.after(async () => {
    release();
    await f.app.close();
  });
  const client = f.client();
  const registered = await client.request("/auth/register", "POST", {
    username: "cleanup.student",
    password,
  });
  const owner = registered.body.user.accountId;
  const other = await f
    .client()
    .request("/auth/register", "POST", { username: "cleanup.other", password });
  const otherOwner = other.body.user.accountId;
  privateMemory.set(otherOwner, "other-owner-memory");
  const profile = await client.request("/me/profile");
  const saved = await client.request(
    "/me/profile",
    "PUT",
    { ...profile.body.profile, major: "法学", targetMajor: "法学" },
    { "If-Match": profile.etag },
  );
  const selection = await client.request("/me/selections");
  const guidance = await client.request("/guidance", "POST", {
    profileVersion: saved.body.profileVersion,
    selectionVersion: selection.body.selectionVersion,
    assessmentRefs: [],
  });
  assert.equal(guidance.status, 201);
  const job = await client.request(
    "/guidance/" + guidance.body.guidanceRunId + "/research",
    "POST",
    {},
  );
  assert.equal(job.status, 202);
  await generating;
  assert.ok(privateMemory.has(owner));
  for (const [body, status] of [
    [{ currentPassword: password }, 422],
    [
      { currentPassword: "wrong-password", confirmation: "DELETE_ACCOUNT" },
      401,
    ],
  ] as const) {
    assert.equal(
      (await client.request("/auth/delete-account", "POST", body)).status,
      status,
    );
    assert.deepEqual(cleared, []);
    assert.ok(privateMemory.has(owner));
    assert.ok(f.app.store.get(owner, "research-job", job.body.jobId));
  }
  const deleted = await client.request("/auth/delete-account", "POST", {
    currentPassword: password,
    confirmation: "DELETE_ACCOUNT",
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(cleared, [owner]);
  assert.equal(privateMemory.has(owner), false);
  assert.equal(privateMemory.get(otherOwner), "other-owner-memory");
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.app.store.get(owner, "research-job", job.body.jobId), null);
  assert.equal(f.app.store.list(owner, "research-checkpoint").length, 0);
  assert.equal(f.app.store.list(owner, "research-latest").length, 0);
  assert.equal(f.app.store.hasPersonalData(owner), false);
  assert.equal(f.app.store.account("cleanup.student"), null);
  assert.ok(f.app.store.account("cleanup.other"));
});

test("password recovery preserves unrelated guest records and requires the normal login migration choice", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const owner = f.client();
  await owner.request("/auth/register", "POST", {
    username: "recovery.guest",
    password,
  });
  const issued = await owner.request("/auth/recovery-code", "POST", {
    currentPassword: password,
  });
  const guest = f.client();
  const guestSession = await guest.request("/guest-sessions", "POST", {});
  const guestId = f.app.store.session(
    digest(guest.cookie.split("=")[1]),
  )!.subjectId;
  f.app.store.put(guestId, "chat", "draft", { content: "保留游客草稿" });
  const cookie = guest.cookie;
  const reset = await guest.request("/auth/recover", "POST", {
    username: "recovery.guest",
    recoveryCode: issued.body.recoveryCode,
    newPassword: "new-guest-safe-password",
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.guestHasData, true);
  assert.equal(reset.body.csrfToken, guestSession.body.csrfToken);
  assert.equal(guest.cookie, cookie);
  assert.ok(f.app.store.get(guestId, "chat", "draft"));
  assert.equal(
    (
      await guest.request("/auth/login", "POST", {
        username: "recovery.guest",
        password: "new-guest-safe-password",
      })
    ).status,
    409,
  );
});

test("password change reauthenticates rotates current session and revokes other sessions and recovery", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = f.client(),
    b = f.client();
  await a.request("/auth/register", "POST", {
    username: "security.change",
    password,
  });
  await b.request("/auth/login", "POST", {
    username: "security.change",
    password,
  });
  const recovery = await a.request("/auth/recovery-code", "POST", {
    currentPassword: password,
  });
  assert.equal(recovery.status, 200);
  assert.equal(
    (
      await a.request("/auth/password", "POST", {
        currentPassword: "incorrect-password",
        newPassword: "new-strong-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await a.request(
        "/auth/password",
        "POST",
        { currentPassword: password, newPassword: "new-strong-password" },
        { "x-csrf-token": "wrong" },
      )
    ).status,
    403,
  );
  const before = a.cookie;
  assert.equal(
    (
      await a.request("/auth/password", "POST", {
        currentPassword: password,
        newPassword: "new-strong-password",
      })
    ).status,
    200,
  );
  assert.notEqual(a.cookie, before);
  assert.equal((await a.request("/auth/session")).body.authenticated, true);
  assert.equal((await b.request("/auth/session")).body.authenticated, false);
  assert.equal(
    (
      await f.client().request("/auth/login", "POST", {
        username: "security.change",
        password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.client().request("/auth/recover", "POST", {
        username: "security.change",
        recoveryCode: recovery.body.recoveryCode,
        newPassword: password,
      })
    ).status,
    401,
  );
});

test("recovery codes are hash-only replaceable expiring and consumed once under concurrent requests", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = f.client();
  const registered = await a.request("/auth/register", "POST", {
    username: "security.recover",
    password,
  });
  const first = await a.request("/auth/recovery-code", "POST", {
    currentPassword: password,
  });
  const second = await a.request("/auth/recovery-code", "POST", {
    currentPassword: password,
  });
  assert.match(second.body.recoveryCode, /^[A-Za-z0-9_-]{43}$/);
  const rows = f.app.store.db
    .prepare("SELECT * FROM auth_recovery_codes")
    .all();
  assert.equal(JSON.stringify(rows).includes(second.body.recoveryCode), false);
  assert.equal(
    JSON.stringify(f.app.store.auditEvents()).includes(
      second.body.recoveryCode,
    ),
    false,
  );
  const reset = (code: string) =>
    f.client().request("/auth/recover", "POST", {
      username: "security.recover",
      recoveryCode: code,
      newPassword: "recovered-new-password",
    });
  assert.equal((await reset(first.body.recoveryCode)).status, 401);
  const results = await Promise.all([
    reset(second.body.recoveryCode),
    reset(second.body.recoveryCode),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.some((r) => r.status === 401 || r.status === 409));
  assert.equal((await a.request("/auth/session")).body.authenticated, false);
  const next = f.client();
  assert.equal(
    (
      await next.request("/auth/login", "POST", {
        username: "security.recover",
        password: "recovered-new-password",
      })
    ).status,
    200,
  );
  const expired = await next.request("/auth/recovery-code", "POST", {
    currentPassword: "recovered-new-password",
  });
  f.app.store.db
    .prepare("UPDATE auth_recovery_codes SET expires_at=0 WHERE account_id=?")
    .run(registered.body.user.accountId);
  assert.equal((await reset(expired.body.recoveryCode)).status, 401);
});

test("account deletion needs confirmation and password removes records and prevents stale identity resurrection", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = f.client(),
    b = f.client();
  const registered = await a.request("/auth/register", "POST", {
    username: "security.delete",
    password,
  });
  const owner = registered.body.user.accountId;
  f.app.store.put(owner, "chat", "private", { content: "delete-me" });
  f.app.store.put("administration", "correction", "private", {
    subjectId: owner,
    description: "delete-me",
  });
  await a.request("/auth/recovery-code", "POST", { currentPassword: password });
  await b.request("/auth/login", "POST", {
    username: "security.delete",
    password,
  });
  assert.equal(
    (
      await a.request("/auth/delete-account", "POST", {
        currentPassword: password,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await a.request("/auth/delete-account", "POST", {
        currentPassword: "wrong-password",
        confirmation: "DELETE_ACCOUNT",
      })
    ).status,
    401,
  );
  const before = f.app.store.generation(owner);
  const outcomes = await Promise.all([
    a.request("/auth/delete-account", "POST", {
      currentPassword: password,
      confirmation: "DELETE_ACCOUNT",
    }),
    f.client().request("/auth/login", "POST", {
      username: "security.delete",
      password,
    }),
  ]);
  assert.equal(outcomes[0].status, 200);
  assert.equal(f.app.store.account("security.delete"), null);
  assert.equal(f.app.store.generation(owner), before + 1);
  assert.equal(f.app.store.get(owner, "chat", "private"), null);
  assert.equal(
    f.app.store.get("administration", "correction", "private"),
    null,
  );
  assert.equal((await b.request("/auth/session")).body.authenticated, false);
  assert.equal(
    f.app.store.db
      .prepare("SELECT count(*) AS n FROM sessions WHERE subject_id=?")
      .get(owner)!.n,
    0,
  );
  assert.equal(
    f.app.store.db
      .prepare(
        "SELECT count(*) AS n FROM auth_recovery_codes WHERE account_id=?",
      )
      .get(owner)!.n,
    0,
  );
  const recreated = await f.client().request("/auth/register", "POST", {
    username: "security.delete",
    password,
  });
  assert.equal(recreated.status, 201);
  assert.notEqual(recreated.body.user.accountId, owner);
});

test("security operations reject anonymous clients and administrator self-deletion", async (t) => {
  const f = await setup({
    bootstrapAdmins: [
      { username: "security.admin", password, roles: ["auditor"] },
    ],
  });
  t.after(() => f.app.close());
  assert.equal(
    (
      await f
        .client()
        .request("/auth/recovery-code", "POST", { currentPassword: password })
    ).status,
    401,
  );
  const a = f.client();
  await a.request("/auth/login", "POST", {
    username: "security.admin",
    password,
  });
  assert.equal(
    (
      await a.request("/auth/delete-account", "POST", {
        currentPassword: password,
        confirmation: "DELETE_ACCOUNT",
      })
    ).status,
    403,
  );
  assert.ok(f.app.store.account("security.admin"));
});
async function setup(
  overrides: Partial<AppConfig> = {},
  dependencies: Parameters<typeof createApplication>[1] = {},
) {
  const app = await createApplication(
    {
      databasePath: ":memory:",
      sampleData: true,
      staticDirectory: undefined,
      rateLimit: 10000,
      ...overrides,
    },
    dependencies,
  );
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
        body?: unknown,
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
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const value = await response.json();
        if (response.headers.get("set-cookie"))
          cookie = response.headers.get("set-cookie")!.split(";")[0];
        if (value.csrfToken !== undefined) csrf = value.csrfToken ?? "";
        return {
          status: response.status,
          body: value,
          etag: response.headers.get("etag") ?? "",
          headers: response.headers,
        };
      },
    };
  }
  return { app, base, client };
}

test("passwords use independent scrypt salts and uniform verification, including missing users", async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^scrypt-v1\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword(password), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});

test("registration returns a real student identity, cannot self-promote, and never persists plaintext credentials", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = f.client();
  const anonymous = await a.request("/auth/session");
  assert.equal(anonymous.body.authenticated, false);
  assert.equal(anonymous.body.guest, false);
  assert.equal(anonymous.body.user, null);
  assert.equal(
    (
      await a.request("/auth/register", "POST", {
        username: "student.one",
        password: "short",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await a.request("/auth/register", "POST", {
        username: "student.one",
        password,
        role: "admin",
      })
    ).status,
    400,
  );
  const registered = await a.request("/auth/register", "POST", {
    username: "Student.One",
    password,
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.authenticated, true);
  assert.equal(registered.body.user.role, "student");
  assert.deepEqual(registered.body.user.adminRoles, []);
  assert.match(registered.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
  const account = f.app.store.account("student.one")!;
  assert.equal(account.accountId, account.subjectId);
  assert.equal(registered.body.user.accountId, account.accountId);
  assert.equal(JSON.stringify(registered.body).includes("password"), false);
  assert.equal(account.passwordHash.includes(password), false);
  const dumps = ["resources", "idempotency", "audit"].map((table) =>
    f.app.store.db.prepare(`SELECT * FROM ${table}`).all(),
  );
  assert.equal(JSON.stringify(dumps).includes(password), false);
  const same = await a.request("/guest-sessions", "POST", {});
  assert.deepEqual(same.body.user, registered.body.user);
  assert.equal(same.body.guest, false);
  const duplicate = await f
    .client()
    .request("/auth/register", "POST", { username: "student.one", password });
  assert.equal(duplicate.status, 409);
  assert.equal((await a.request("/admin/me")).status, 403);
  assert.equal((await a.request("/admin/drafts/program")).status, 403);
});

test("account data survives another browser login, sessions rotate and logout only revokes the current browser", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const first = f.client();
  const second = f.client();
  const stranger = f.client();
  const registered = await first.request("/auth/register", "POST", {
    username: "persistent.user",
    password,
  });
  const profile = await first.request("/me/profile");
  const saved = await first.request(
    "/me/profile",
    "PUT",
    { ...blankProfile(), name: "跨设备保留" },
    { "if-match": profile.etag },
  );
  assert.equal(saved.status, 200);
  const assessment = await first.request("/assessment-attempts", "POST", {
    modules: ["english"],
  });
  const login = await second.request("/auth/login", "POST", {
    username: "PERSISTENT.USER",
    password,
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.accountId, registered.body.user.accountId);
  assert.equal(
    (await second.request("/me/profile")).body.profile.name,
    "跨设备保留",
  );
  await stranger.request("/auth/register", "POST", {
    username: "another.user",
    password,
  });
  assert.equal(
    (
      await stranger.request(
        `/assessment-attempts/${assessment.body.assessmentAttemptId}`,
      )
    ).status,
    404,
  );
  const oldCookie = first.cookie;
  const rotated = await first.request("/auth/login", "POST", {
    username: "persistent.user",
    password,
  });
  assert.equal(rotated.status, 200);
  assert.notEqual(first.cookie, oldCookie);
  assert.equal(f.app.store.session(digest(oldCookie.split("=")[1])), null);
  const beforeLogout = first.cookie;
  const loggedOut = await first.request("/auth/logout", "POST", {});
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.body.authenticated, false);
  assert.match(loggedOut.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal(f.app.store.session(digest(beforeLogout.split("=")[1])), null);
  assert.equal((await first.request("/me/profile")).status, 401);
  assert.equal(
    (await second.request("/me/profile")).body.profile.name,
    "跨设备保留",
  );
});

test("registering with guest data requires a migration choice and revokes every old guest token", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const visitor = f.client();
  const guest = await visitor.request("/guest-sessions", "POST", {});
  assert.equal(guest.body.authenticated, false);
  assert.equal(guest.body.guest, true);
  const guestCookie = visitor.cookie;
  const oldSession = f.app.store.session(digest(guestCookie.split("=")[1]))!;
  const original = await visitor.request("/me/profile");
  await visitor.request(
    "/me/profile",
    "PUT",
    { ...blankProfile(), name: "游客原资料" },
    { "if-match": original.etag },
  );
  f.app.store.createSession(
    "second-guest-cookie-hash",
    "second-guest-csrf",
    oldSession.subjectId,
  );
  const confirm = await visitor.request("/auth/register", "POST", {
    username: "migrated.user",
    password,
  });
  assert.equal(confirm.status, 409);
  assert.equal(confirm.body.code, "guest_migration_confirmation_required");
  const registered = await visitor.request("/auth/register", "POST", {
    username: "migrated.user",
    password,
    migrateGuestData: true,
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.guestDataMigrated, true);
  assert.equal(registered.body.user.accountId, oldSession.subjectId);
  assert.equal(f.app.store.session(digest(guestCookie.split("=")[1])), null);
  assert.equal(f.app.store.session("second-guest-cookie-hash"), null);
  assert.equal(
    (await visitor.request("/me/profile")).body.profile.name,
    "游客原资料",
  );
  const browser = f.client();
  await browser.request("/auth/login", "POST", {
    username: "migrated.user",
    password,
  });
  assert.equal(
    (await browser.request("/me/profile")).body.profile.name,
    "游客原资料",
  );
});

test("login cannot silently import a different guest profile or overwrite the existing account", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const owner = f.client();
  const guest = f.client();
  await owner.request("/auth/register", "POST", {
    username: "existing.user",
    password,
  });
  const original = await owner.request("/me/profile");
  await owner.request(
    "/me/profile",
    "PUT",
    { ...blankProfile(), name: "账户原资料" },
    { "if-match": original.etag },
  );
  await guest.request("/guest-sessions", "POST", {});
  const guestSubject = f.app.store.session(
    digest(guest.cookie.split("=")[1]),
  )!.subjectId;
  const profile = await guest.request("/me/profile");
  await guest.request(
    "/me/profile",
    "PUT",
    { ...blankProfile(), name: "另一位游客" },
    { "if-match": profile.etag },
  );
  const blocked = await guest.request("/auth/login", "POST", {
    username: "existing.user",
    password,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "guest_data_confirmation_required");
  const login = await guest.request("/auth/login", "POST", {
    username: "existing.user",
    password,
    leaveGuestData: true,
  });
  assert.equal(login.status, 200);
  assert.match(login.body.notice, /未导入/);
  assert.equal(
    (await guest.request("/me/profile")).body.profile.name,
    "账户原资料",
  );
  assert.equal(
    f.app.store.get<{ profile: { name: string } }>(guestSubject, "profile")!
      .value.profile.name,
    "另一位游客",
  );
});

test("login origin/CSRF and persistent failed-attempt limits prevent abuse without exposing account existence", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const a = f.client();
  assert.equal(
    (
      await a.request(
        "/auth/register",
        "POST",
        { username: "origin.user", password },
        { origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  await a.request("/auth/register", "POST", {
    username: "limited.user",
    password,
  });
  assert.equal(
    (await a.request("/auth/logout", "POST", {}, { "x-csrf-token": "" }))
      .status,
    403,
  );
  const attacker = f.client();
  const missing = await attacker.request("/auth/login", "POST", {
    username: "missing.user",
    password,
  });
  const wrong = await attacker.request("/auth/login", "POST", {
    username: "limited.user",
    password: "incorrect-password",
  });
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(missing.body.message, wrong.body.message);
  let result = wrong;
  for (let count = 0; count < 10; count += 1)
    result = await attacker.request("/auth/login", "POST", {
      username: "limited.user",
      password: "incorrect-password",
    });
  assert.equal(result.status, 429);
  assert.equal(result.body.code, "auth_rate_limited");
});

test("bootstrap creates separate administrator accounts, ordinary registrations cannot access production admin", async (t) => {
  const f = await setup({
    sampleData: false,
    bootstrapAdmins: [
      { username: "admin.editor", password, roles: ["editor"] },
      {
        username: "admin.reviewer",
        password,
        roles: ["reviewer", "publisher", "auditor"],
      },
    ],
  });
  t.after(() => f.app.close());
  assert.deepEqual(f.app.config.bootstrapAdmins, []);
  const editor = f.client();
  const reviewer = f.client();
  const student = f.client();
  const editorLogin = await editor.request("/auth/login", "POST", {
    username: "admin.editor",
    password,
  });
  assert.equal(editorLogin.body.user.role, "admin");
  assert.deepEqual(editorLogin.body.user.adminRoles, ["editor"]);
  await reviewer.request("/auth/login", "POST", {
    username: "admin.reviewer",
    password,
  });
  assert.notEqual(
    (await reviewer.request("/admin/me")).body.actorId,
    (await editor.request("/admin/me")).body.actorId,
  );
  assert.equal((await editor.request("/admin/audit-events")).status, 403);
  assert.equal((await reviewer.request("/admin/audit-events")).status, 200);
  assert.equal(
    (
      await editor.request(
        "/admin/publications",
        "POST",
        {},
        { "x-csrf-token": "" },
      )
    ).status,
    403,
  );
  await student.request("/auth/register", "POST", {
    username: "ordinary.student",
    password,
  });
  assert.equal((await student.request("/admin/me")).status, 403);
  assert.equal(
    (await student.request("/admin/publications", "POST", {})).status,
    403,
  );
});

test("database restart preserves accounts/data and bootstrap never resets passwords or elevates existing students", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yantu-auth-"));
  const databasePath = join(directory, "auth.sqlite");
  let fixture: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    fixture = await setup({
      databasePath,
      bootstrapAdmins: [
        { username: "persisted.admin", password, roles: ["reviewer"] },
      ],
    });
    const browser = fixture.client();
    await browser.request("/auth/register", "POST", {
      username: "persisted.student",
      password,
    });
    const original = await browser.request("/me/profile");
    await browser.request(
      "/me/profile",
      "PUT",
      { ...blankProfile(), name: "重启保留" },
      { "if-match": original.etag },
    );
    await fixture.app.close();
    fixture = undefined;
    await assert.rejects(
      setup({
        databasePath,
        bootstrapAdmins: [
          {
            username: "persisted.student",
            password: "new-unwanted-password",
            roles: ["publisher"],
          },
        ],
      }),
      /不能自动提升权限/,
    );
    fixture = await setup({
      databasePath,
      bootstrapAdmins: [
        {
          username: "persisted.admin",
          password: "replacement-is-not-applied",
          roles: ["publisher"],
        },
      ],
    });
    const login = fixture.client();
    const result = await login.request("/auth/login", "POST", {
      username: "persisted.student",
      password,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.role, "student");
    assert.equal(
      (await login.request("/me/profile")).body.profile.name,
      "重启保留",
    );
    const admin = fixture.client();
    const adminLogin = await admin.request("/auth/login", "POST", {
      username: "persisted.admin",
      password,
    });
    assert.equal(adminLogin.status, 200);
    assert.deepEqual(adminLogin.body.user.adminRoles, ["reviewer"]);
    assert.equal(
      (
        await fixture.client().request("/auth/login", "POST", {
          username: "persisted.admin",
          password: "replacement-is-not-applied",
        })
      ).status,
      401,
    );
  } finally {
    if (fixture) await fixture.app.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent registration cannot create duplicate users or reuse a claimed guest identity", async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const results = await Promise.all(
    [f.client(), f.client()].map((browser) =>
      browser.request("/auth/register", "POST", {
        username: "concurrent.user",
        password,
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(
    Number(
      f.app.store.db
        .prepare("SELECT count(*) AS count FROM accounts WHERE username_key=?")
        .get("concurrent.user")!.count,
    ),
    1,
  );
});

test("authentication rate limits are configurable but never accept disabled, unbounded or NaN values", async (t) => {
  for (const value of [0, -1, 1001, NaN, Infinity, 1.5, "no-limit", "", true])
    assert.throws(() => authRateLimit(value), /1 至 1000/);
  assert.equal(authRateLimit("200"), 200);
  const f = await setup({ authRegistrationIpLimit: 1 });
  t.after(() => f.app.close());
  assert.equal(
    (
      await f.client().request("/auth/register", "POST", {
        username: "first.allowed",
        password,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await f.client().request("/auth/register", "POST", {
        username: "second.blocked",
        password,
      })
    ).status,
    429,
  );
  assert.equal(f.app.store.account("second.blocked"), null);
});
