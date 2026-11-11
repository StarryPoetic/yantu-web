import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
  symlink,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Store } from "../../server/store.ts";
import { createPersistentUsageLedger } from "../../server/explanation/usage-ledger.ts";

const execute = promisify(execFile);
const scripts = Object.fromEntries(
  ["managed-backup", "backup-database", "restore-isolated"].map((name) => [
    name,
    fileURLToPath(new URL(`../../scripts/${name}.mjs`, import.meta.url)),
  ]),
);
async function run(script: string, args: string[]) {
  const result = await execute(process.execPath, [scripts[script], ...args], {
    timeout: 30_000,
    env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
    windowsHide: true,
  });
  return JSON.parse(result.stdout);
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "yantu-recovery-"));
  const source = join(directory, "current.sqlite");
  const store = new Store(source);
  t.after(async () => {
    if (store.db.isOpen) store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, source, store };
}

test("managed backup requires explicit configuration and apply; retention only removes owned verified old snapshots", async (t) => {
  const { directory, source, store } = await fixture(t);
  store.put("public", "sentinel", "current", {
    value: "backup-private-test-marker",
  });
  const configPath = join(directory, "backup.json");
  const target = join(directory, "archives");
  const config = {
    enabled: false,
    source,
    directory: target,
    retainCount: 2,
    minimumAgeHours: 24,
  };
  await writeFile(configPath, JSON.stringify(config));
  assert.equal(
    (await run("managed-backup", ["--config", configPath, "--apply"])).status,
    "disabled",
  );
  config.enabled = true;
  await writeFile(configPath, JSON.stringify(config));
  assert.equal(
    (await run("managed-backup", ["--config", configPath])).status,
    "dry-run",
  );
  await assert.rejects(stat(target), { code: "ENOENT" });
  const snapshots: string[] = [];
  for (let i = 0; i < 3; i++)
    snapshots.push(
      (await run("managed-backup", ["--config", configPath, "--apply"]))
        .snapshot,
    );
  for (let i = 0; i < snapshots.length; i++) {
    const manifest = JSON.parse(await readFile(`${snapshots[i]}.json`, "utf8"));
    manifest.createdAt = `2000-01-0${i + 1}T00:00:00.000Z`;
    await writeFile(`${snapshots[i]}.json`, JSON.stringify(manifest));
  }
  const unowned = join(
    target,
    "yantu-backup-00000000-0000-0000-0000-000000000000.sqlite",
  );
  await writeFile(unowned, "do-not-delete");
  const result = await run("managed-backup", [
    "--config",
    configPath,
    "--apply",
  ]);
  assert.equal(result.removed, 2);
  assert.equal(result.retainedOwnedSnapshots, 2);
  assert.equal(await readFile(unowned, "utf8"), "do-not-delete");
  assert.equal(
    JSON.stringify(result).includes("backup-private-test-marker"),
    false,
  );
  assert.equal(store.get("public", "sentinel")?.value !== null, true);
  const backup = new DatabaseSync(result.snapshot, { readOnly: true });
  try {
    assert.ok(
      backup.prepare("SELECT * FROM resources WHERE kind='sentinel'").get(),
    );
  } finally {
    backup.close();
  }
  assert.equal((await readdir(target)).length, 5);
});

test("backup failure never prunes existing files and invalid retention/source paths fail closed", async (t) => {
  const { directory, source, store } = await fixture(t);
  const configPath = join(directory, "config.json");
  const target = join(directory, "archives");
  const config = {
    enabled: true,
    source,
    directory: target,
    retainCount: 2,
    minimumAgeHours: 24,
  };
  await writeFile(configPath, JSON.stringify(config));
  const first = await run("managed-backup", [
    "--config",
    configPath,
    "--apply",
  ]);
  const before = await readFile(first.snapshot);
  store.close();
  await writeFile(source, "broken-database");
  await assert.rejects(
    run("managed-backup", ["--config", configPath, "--apply"]),
  );
  assert.deepEqual(await readFile(first.snapshot), before);
  config.retainCount = 0;
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(
    run("managed-backup", ["--config", configPath, "--apply"]),
    (error: unknown) =>
      String((error as { stderr: string }).stderr).includes(
        "BACKUP_CONFIG_INVALID",
      ),
  );
  config.retainCount = 2;
  config.directory = directory;
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(
    run("managed-backup", ["--config", configPath]),
    (error: unknown) =>
      String((error as { stderr: string }).stderr).includes(
        "BACKUP_SOURCE_INSIDE_DESTINATION",
      ),
  );
});

test("backup retention ignores damaged ownership proofs and refuses a linked destination directory", async (t) => {
  const { directory, source } = await fixture(t);
  const configPath = join(directory, "config.json");
  const archive = join(directory, "archives");
  const config = {
    enabled: true,
    source,
    directory: archive,
    retainCount: 2,
    minimumAgeHours: 1,
  };
  await writeFile(configPath, JSON.stringify(config));
  const first = await run("managed-backup", [
    "--config",
    configPath,
    "--apply",
  ]);
  const manifest = JSON.parse(await readFile(`${first.snapshot}.json`, "utf8"));
  manifest.createdAt = "2000-01-01T00:00:00.000Z";
  manifest.sha256 = "0".repeat(64);
  await writeFile(`${first.snapshot}.json`, JSON.stringify(manifest));
  for (let i = 0; i < 3; i++)
    await run("managed-backup", ["--config", configPath, "--apply"]);
  assert.ok((await stat(first.snapshot)).isFile());
  const realTarget = join(directory, "linked-target");
  const linkedDirectory = join(directory, "linked-archive");
  await mkdir(realTarget);
  await symlink(
    realTarget,
    linkedDirectory,
    process.platform === "win32" ? "junction" : "dir",
  );
  config.directory = linkedDirectory;
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(
    run("managed-backup", ["--config", configPath, "--apply"]),
    (error: unknown) =>
      String((error as { stderr: string }).stderr).includes(
        "BACKUP_DIRECTORY_INVALID",
      ),
  );
  assert.deepEqual(await readdir(realTarget), []);
});

function addAccount(store: Store, name: string) {
  store.insertAccount({
    accountId: name,
    subjectId: name,
    username: name,
    usernameKey: name,
    passwordHash: `old-${name}-hash`,
    role: "student",
    adminRoles: [],
    createdAt: "2026-11-11T00:00:00Z",
  });
  store.createSession(`session-${name}`, `csrf-${name}`, name);
}

test("isolated restore protects current deletion, changed chat, passwords, withdrawals, logout and budget state", async (t) => {
  const { directory, source, store } = await fixture(t);
  for (const user of ["kept", "deleted", "closed"]) {
    addAccount(store, user);
    store.put(user, "profile", "current", { name: user });
  }
  store.put("kept", "conversation", "chat", {
    messages: ["kept-message", "removed-message"],
  });
  store.put("administration", "correction", "old", {
    subjectId: "deleted",
    text: "deleted-private-text",
  });
  const catalog = {
    withdrawnRevisionIds: [] as string[],
    revisions: [
      { programRevisionId: "revision-one", publicationStatus: "published" },
    ],
    releases: [
      {
        catalogVersion: "v1",
        programs: [],
        withdrawnRevisionIds: [] as string[],
      },
    ],
  };
  store.put("public", "catalog", "current", catalog);
  store.put("public", "question-bank", "current", {
    questionBankVersion: "bank-v1",
  });
  store.db.exec(
    "CREATE TABLE auth_recovery_codes (account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT",
  );
  store.db
    .prepare("INSERT INTO auth_recovery_codes VALUES (?,?,?)")
    .run("kept", "old-recovery-hash", Date.now() + 1000000);
  store.remember("kept", 0, "write", "old-key", "digest", { old: true });
  const usage = createPersistentUsageLedger(store);
  const reservation = usage.reserve({
    kind: "model",
    subjectId: "kept",
    day: "2026-11-11",
    amount: 100,
    headroom: 0,
    userLimit: 1000,
    globalLimit: 1000,
  })!;
  const snapshot = join(directory, "snapshot.sqlite");
  await run("backup-database", ["--source", source, "--destination", snapshot]);
  const snapshotBefore = await readFile(snapshot);
  store.transaction(() => {
    store.erase("deleted");
    store.put("deleted", "deletion-job", "current", { status: "complete" });
    store.erase("closed");
    store.revokeSubjectSessions("closed");
    store.db.prepare("DELETE FROM accounts WHERE account_id='closed'").run();
    store.put("kept", "conversation", "chat", { messages: ["kept-message"] });
    store.db
      .prepare(
        "UPDATE accounts SET password_hash='current-password-hash' WHERE account_id='kept'",
      )
      .run();
    store.revokeSubjectSessions("kept");
    catalog.withdrawnRevisionIds.push("revision-one");
    catalog.revisions[0].publicationStatus = "withdrawn";
    store.put("public", "catalog", "current", catalog);
    store.put("public", "withdrawn-banks", "bank-v1", { reason: "withdrawn" });
  });
  usage.settle(reservation, 5);
  usage.reserve({
    kind: "search",
    subjectId: "kept",
    day: "2026-11-11",
    amount: 3,
    headroom: 0,
    userLimit: 100,
    globalLimit: 100,
  });
  const target = join(directory, "isolated");
  const result = await run("restore-isolated", [
    "--snapshot",
    snapshot,
    "--current",
    source,
    "--directory",
    target,
  ]);
  assert.equal(result.status, "isolated-review-required");
  assert.equal(result.approvedForServing, false);
  assert.equal(result.removedPrivateResources, 4);
  assert.equal(JSON.stringify(result).includes("current-password-hash"), false);
  assert.equal(JSON.stringify(result).includes("removed-message"), false);
  assert.deepEqual(await readFile(snapshot), snapshotBefore);
  assert.equal(store.account("kept")?.passwordHash, "current-password-hash");
  assert.ok(store.get("kept", "conversation", "chat"));
  const restored = new DatabaseSync(join(target, "candidate.sqlite"), {
    readOnly: true,
  });
  try {
    assert.ok(
      restored
        .prepare(
          "SELECT 1 FROM resources WHERE owner='kept' AND kind='profile'",
        )
        .get(),
    );
    assert.equal(
      restored
        .prepare("SELECT 1 FROM resources WHERE kind='conversation'")
        .get(),
      undefined,
    );
    assert.equal(
      restored
        .prepare(
          "SELECT 1 FROM resources WHERE owner='deleted' AND kind='profile'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      restored
        .prepare("SELECT 1 FROM accounts WHERE account_id='closed'")
        .get(),
      undefined,
    );
    assert.equal(
      restored
        .prepare("SELECT password_hash FROM accounts WHERE account_id='kept'")
        .get()?.password_hash,
      "current-password-hash",
    );
    for (const table of ["sessions", "auth_recovery_codes", "idempotency"])
      assert.equal(
        restored.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count,
        0,
      );
    assert.ok(
      restored
        .prepare(
          "SELECT 1 FROM resources WHERE owner='deleted' AND kind='deletion-job'",
        )
        .get(),
    );
    assert.ok(
      restored
        .prepare(
          "SELECT 1 FROM resources WHERE kind='withdrawn-banks' AND id='bank-v1'",
        )
        .get(),
    );
    const restoredCatalog = JSON.parse(
      String(
        restored
          .prepare("SELECT value FROM resources WHERE kind='catalog'")
          .get()?.value,
      ),
    );
    assert.deepEqual(restoredCatalog.withdrawnRevisionIds, ["revision-one"]);
    assert.deepEqual(restoredCatalog.releases[0].withdrawnRevisionIds, [
      "revision-one",
    ]);
    assert.equal(
      restored
        .prepare("SELECT amount FROM usage_reservations WHERE kind='model'")
        .get()?.amount,
      100,
      "older higher reservation cannot be refunded by restoring",
    );
    assert.equal(
      restored
        .prepare("SELECT amount FROM usage_reservations WHERE kind='search'")
        .get()?.amount,
      3,
    );
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    restored.close();
  }
});

test("restore refuses missing authority, existing destinations, same input and unknown schemas", async (t) => {
  const { directory, source, store } = await fixture(t);
  const snapshot = join(directory, "snapshot.sqlite");
  await run("backup-database", ["--source", source, "--destination", snapshot]);
  const target = join(directory, "candidate");
  await assert.rejects(
    run("restore-isolated", [
      "--snapshot",
      snapshot,
      "--current",
      join(directory, "missing.sqlite"),
      "--directory",
      target,
    ]),
  );
  await assert.rejects(stat(target), { code: "ENOENT" });
  await assert.rejects(
    run("restore-isolated", [
      "--snapshot",
      source,
      "--current",
      source,
      "--directory",
      target,
    ]),
  );
  await writeFile(target, "do-not-overwrite");
  await assert.rejects(
    run("restore-isolated", [
      "--snapshot",
      snapshot,
      "--current",
      source,
      "--directory",
      target,
    ]),
  );
  assert.equal(await readFile(target, "utf8"), "do-not-overwrite");
  store.db.exec(
    "CREATE TABLE future_private_records(id TEXT PRIMARY KEY, content TEXT)",
  );
  await assert.rejects(
    run("restore-isolated", [
      "--snapshot",
      snapshot,
      "--current",
      source,
      "--directory",
      join(directory, "unknown-schema"),
    ]),
    (error: unknown) =>
      String((error as { stderr: string }).stderr).includes(
        "RESTORE_SCHEMA_UNSUPPORTED",
      ),
  );
  assert.equal(
    (await readdir(directory)).some((name) =>
      name.startsWith(".yantu-restore-"),
    ),
    false,
  );
});

test("restore refuses to revive a catalog when current withdrawal state is unavailable", async (t) => {
  const { directory, source, store } = await fixture(t);
  store.put("public", "catalog", "current", {
    withdrawnRevisionIds: [],
    revisions: [],
    releases: [],
  });
  const snapshot = join(directory, "snapshot.sqlite");
  await run("backup-database", ["--source", source, "--destination", snapshot]);
  store.db
    .prepare("DELETE FROM resources WHERE owner='public' AND kind='catalog'")
    .run();
  const target = join(directory, "candidate");
  await assert.rejects(
    run("restore-isolated", [
      "--snapshot",
      snapshot,
      "--current",
      source,
      "--directory",
      target,
    ]),
    (error: unknown) =>
      String((error as { stderr: string }).stderr).includes(
        "RESTORE_WITHDRAWAL_STATE_MISSING",
      ),
  );
  await assert.rejects(stat(target), { code: "ENOENT" });
});
