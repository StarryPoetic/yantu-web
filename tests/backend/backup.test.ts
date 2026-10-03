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
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const script = fileURLToPath(
  new URL("../../scripts/backup-database.mjs", import.meta.url),
);

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "yantu-backup-test-"));
  const databases: DatabaseSync[] = [];
  t.after(async () => {
    for (const database of databases) if (database.isOpen) database.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    databases,
    source: join(directory, "source.sqlite"),
    destination: join(directory, "backup.sqlite"),
  };
}

async function backup(source: string, destination: string) {
  return run(
    process.execPath,
    [script, "--source", source, "--destination", destination],
    { timeout: 30_000 },
  );
}

test("manual online backup captures committed WAL data while the source stays open and verifies a standalone snapshot", async (t) => {
  const f = await fixture(t);
  const source = new DatabaseSync(f.source);
  f.databases.push(source);
  source.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO records VALUES (1, 'committed-in-WAL');",
  );
  assert.ok((await stat(f.source + "-wal")).size > 0);
  const result = await backup(f.source, f.destination);
  assert.equal(JSON.parse(result.stdout).integrity, "ok");
  assert.equal(result.stdout.includes("committed-in-WAL"), false);
  const snapshot = new DatabaseSync(f.destination, { readOnly: true });
  try {
    assert.equal(
      snapshot.prepare("SELECT value FROM records WHERE id=1").get()?.value,
      "committed-in-WAL",
    );
    assert.equal(
      snapshot.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
    assert.deepEqual(snapshot.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    snapshot.close();
  }
  source.exec("INSERT INTO records VALUES (2, 'after-snapshot');");
  const reopened = new DatabaseSync(f.destination, { readOnly: true });
  try {
    assert.equal(
      reopened.prepare("SELECT COUNT(*) AS count FROM records").get()?.count,
      1,
    );
  } finally {
    reopened.close();
  }
  if (process.platform !== "win32")
    assert.equal((await stat(f.destination)).mode & 0o777, 0o600);
  assert.equal(
    (await readdir(f.directory)).some((name) =>
      name.startsWith(".yantu-backup-"),
    ),
    false,
  );
});

test("backup refuses an existing target or the source itself without changing either", async (t) => {
  const f = await fixture(t);
  const database = new DatabaseSync(f.source);
  database.exec(
    "CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('preserve-source');",
  );
  database.close();
  await writeFile(f.destination, "existing-backup-sentinel");
  const originalSource = await readFile(f.source);
  await assert.rejects(
    backup(f.source, f.destination),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? "", /TARGET_EXISTS/);
      return true;
    },
  );
  await assert.rejects(
    backup(f.source, f.source),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? "", /SAME_PATH/);
      return true;
    },
  );
  assert.equal(
    await readFile(f.destination, "utf8"),
    "existing-backup-sentinel",
  );
  assert.deepEqual(await readFile(f.source), originalSource);
});

test("missing or corrupt sources cannot create a replacement database or publish a misleading snapshot", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    backup(f.source, f.destination),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? "", /SOURCE_NOT_FOUND/);
      return true;
    },
  );
  assert.deepEqual(await readdir(f.directory), []);
  await writeFile(f.source, "synthetic-private-corrupt-database-content");
  await assert.rejects(
    backup(f.source, f.destination),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? "", /BACKUP_FAILED/);
      assert.equal((error.stderr ?? "").includes("synthetic-private"), false);
      return true;
    },
  );
  assert.deepEqual(await readdir(f.directory), ["source.sqlite"]);
});

test("a structurally valid database with broken foreign keys fails verification and leaves no backup", async (t) => {
  const f = await fixture(t);
  const source = new DatabaseSync(f.source);
  source.exec(
    "PRAGMA foreign_keys=OFF; CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(parent_id INTEGER REFERENCES parents(id)); INSERT INTO children VALUES (99);",
  );
  source.close();
  await assert.rejects(
    backup(f.source, f.destination),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? "", /INTEGRITY_FAILED/);
      return true;
    },
  );
  assert.deepEqual(await readdir(f.directory), ["source.sqlite"]);
});
