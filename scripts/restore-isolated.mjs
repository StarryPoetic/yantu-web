import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { backupDatabase } from "./backup-database.mjs";

const allowedTables = new Set([
  "migrations",
  "subjects",
  "sessions",
  "resources",
  "idempotency",
  "audit",
  "accounts",
  "auth_limits",
  "auth_recovery_codes",
  "usage_reservations",
  "research_public_sources",
  "research_program_facts",
  "research_public_aliases",
  "research_public_disciplines",
  "research_public_schools",
  "research_public_read_attempts",
  "research_pending_schools",
]);
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const resourceKey = (row) => JSON.stringify([row.owner, row.kind, row.id]);

function table(db, name) {
  return db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}
function check(db) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  if (
    rows.length !== 1 ||
    Object.values(rows[0])[0] !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    fail("RESTORE_INTEGRITY_FAILED");
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1",
      )
      .get()
  )
    fail("RESTORE_SCHEMA_UNSUPPORTED");
  for (const row of db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all())
    if (!allowedTables.has(row.name)) fail("RESTORE_SCHEMA_UNSUPPORTED");
  for (const name of [
    "subjects",
    "sessions",
    "resources",
    "accounts",
    "idempotency",
    "audit",
    "auth_limits",
  ])
    if (!table(db, name)) fail("RESTORE_SCHEMA_UNSUPPORTED");
}

function replaceTable(destination, source, name, { empty = false } = {}) {
  destination.exec(`DROP TABLE IF EXISTS "${name}"`);
  const definition = table(source, name);
  if (!definition) return;
  destination.exec(definition.sql);
  if (!empty) {
    const columns = source
      .prepare(`PRAGMA table_info("${name}")`)
      .all()
      .map((row) => row.name);
    const insert = destination.prepare(
      `INSERT INTO "${name}" VALUES (${columns.map(() => "?").join(",")})`,
    );
    for (const row of source.prepare(`SELECT * FROM "${name}"`).all())
      insert.run(...columns.map((column) => row[column]));
  }
  for (const index of source
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
    )
    .all(name))
    destination.exec(index.sql);
}

function mergeUsage(destination, source) {
  if (!table(source, "usage_reservations")) return;
  if (!table(destination, "usage_reservations"))
    destination.exec(table(source, "usage_reservations").sql);
  const upsert =
    destination.prepare(`INSERT INTO usage_reservations VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET amount=MAX(amount,excluded.amount),settled=MIN(settled,excluded.settled)`);
  for (const row of source.prepare("SELECT * FROM usage_reservations").all()) {
    const old = destination
      .prepare("SELECT kind,subject_id,day FROM usage_reservations WHERE id=?")
      .get(row.id);
    if (
      old &&
      (old.kind !== row.kind ||
        old.subject_id !== row.subject_id ||
        old.day !== row.day)
    )
      fail("RESTORE_USAGE_CONFLICT");
    upsert.run(
      row.id,
      row.kind,
      row.subject_id,
      row.day,
      row.amount,
      row.settled,
    );
  }
}

function protectResources(destination, current) {
  const currentResources = new Map(
    current
      .prepare("SELECT * FROM resources")
      .all()
      .map((row) => [resourceKey(row), row]),
  );
  const oldGenerations = new Map(
    destination
      .prepare("SELECT * FROM subjects")
      .all()
      .map((row) => [row.id, row.generation]),
  );
  const newGenerations = new Map(
    current
      .prepare("SELECT * FROM subjects")
      .all()
      .map((row) => [row.id, row.generation]),
  );
  const currentAccounts = new Set(
    current
      .prepare("SELECT subject_id FROM accounts")
      .all()
      .map((row) => row.subject_id),
  );
  const oldAccounts = new Set(
    destination
      .prepare("SELECT subject_id FROM accounts")
      .all()
      .map((row) => row.subject_id),
  );
  let removedPrivateResources = 0;
  const remove = destination.prepare(
    "DELETE FROM resources WHERE owner=? AND kind=? AND id=?",
  );
  for (const row of destination
    .prepare("SELECT * FROM resources WHERE owner!='public'")
    .all()) {
    const live = currentResources.get(resourceKey(row));
    if (
      !live ||
      hash(live.value) !== hash(row.value) ||
      (row.owner !== "administration" &&
        (!newGenerations.has(row.owner) ||
          oldGenerations.get(row.owner) !== newGenerations.get(row.owner))) ||
      (oldAccounts.has(row.owner) && !currentAccounts.has(row.owner))
    ) {
      remove.run(row.owner, row.kind, row.id);
      removedPrivateResources++;
    } else {
      destination
        .prepare(
          "UPDATE resources SET etag=?,version=? WHERE owner=? AND kind=? AND id=?",
        )
        .run(live.etag, live.version, row.owner, row.kind, row.id);
    }
  }
  const oldCatalogRow = destination
    .prepare(
      "SELECT * FROM resources WHERE owner='public' AND kind='catalog' AND id='current'",
    )
    .get();
  const currentCatalogRow = current
    .prepare(
      "SELECT * FROM resources WHERE owner='public' AND kind='catalog' AND id='current'",
    )
    .get();
  let protectedWithdrawals = 0;
  if (oldCatalogRow) {
    if (!currentCatalogRow) fail("RESTORE_WITHDRAWAL_STATE_MISSING");
    const oldCatalog = JSON.parse(oldCatalogRow.value);
    const live = JSON.parse(currentCatalogRow.value);
    if (
      ![
        oldCatalog.withdrawnRevisionIds,
        live.withdrawnRevisionIds,
        oldCatalog.revisions,
        oldCatalog.releases,
        live.revisions,
        live.releases,
      ].every(Array.isArray)
    )
      fail("RESTORE_CATALOG_INVALID");
    const withdrawn = new Set([
      ...oldCatalog.withdrawnRevisionIds,
      ...live.withdrawnRevisionIds,
      ...live.revisions
        .filter((r) => r.publicationStatus === "withdrawn")
        .map((r) => r.programRevisionId),
      ...live.releases.flatMap((r) => r.withdrawnRevisionIds ?? []),
    ]);
    if ([...withdrawn].some((value) => typeof value !== "string"))
      fail("RESTORE_CATALOG_INVALID");
    oldCatalog.withdrawnRevisionIds = [...withdrawn];
    for (const revision of oldCatalog.revisions)
      if (withdrawn.has(revision.programRevisionId))
        revision.publicationStatus = "withdrawn";
    for (const release of oldCatalog.releases)
      release.withdrawnRevisionIds = [
        ...new Set([...(release.withdrawnRevisionIds ?? []), ...withdrawn]),
      ];
    destination
      .prepare(
        "UPDATE resources SET value=?,etag=?,version=version+1 WHERE owner='public' AND kind='catalog' AND id='current'",
      )
      .run(JSON.stringify(oldCatalog), '"isolated-restore-review-required"');
    protectedWithdrawals = withdrawn.size;
  }
  const put = destination.prepare(
    "INSERT INTO resources VALUES (?,?,?,?,?,?) ON CONFLICT(owner,kind,id) DO UPDATE SET value=excluded.value,etag=excluded.etag,version=excluded.version",
  );
  for (const row of currentResources.values()) {
    if (
      (row.owner === "public" && row.kind === "withdrawn-banks") ||
      row.kind === "deletion-job"
    )
      put.run(row.owner, row.kind, row.id, row.value, row.etag, row.version);
  }
  // These active resources encode withdrawal in their content, not solely in a
  // separate tombstone. A snapshot's approval can never establish current approval.
  for (const kind of ["rule", "question-bank"]) {
    const live = currentResources.get(
      JSON.stringify(["public", kind, "current"]),
    );
    if (live)
      put.run(
        live.owner,
        live.kind,
        live.id,
        live.value,
        live.etag,
        live.version,
      );
    else remove.run("public", kind, "current");
  }
  const activeBankRow = destination
    .prepare(
      "SELECT * FROM resources WHERE owner='public' AND kind='question-bank' AND id='current'",
    )
    .get();
  if (activeBankRow) {
    const activeBank = JSON.parse(activeBankRow.value);
    if (typeof activeBank.questionBankVersion !== "string")
      fail("RESTORE_QUESTION_BANK_INVALID");
    if (
      destination
        .prepare(
          "SELECT 1 FROM resources WHERE owner='public' AND kind='withdrawn-banks' AND id=?",
        )
        .get(activeBank.questionBankVersion)
    ) {
      if (!Array.isArray(activeBank.questions))
        fail("RESTORE_QUESTION_BANK_INVALID");
      activeBank.questions = activeBank.questions.map((question) => ({
        ...question,
        publicationStatus: "withdrawn",
      }));
      put.run(
        "public",
        "question-bank",
        "current",
        JSON.stringify(activeBank),
        '"isolated-restore-withdrawn-bank"',
        Number(activeBankRow.version) + 1,
      );
    }
  }
  return { removedPrivateResources, protectedWithdrawals };
}

/** Produces an isolated candidate only. Never replaces a live database or starts a service. */
export async function restoreIsolated({ snapshot, current, directory }) {
  if (
    ![snapshot, current, directory].every(
      (value) => typeof value === "string" && isAbsolute(value),
    )
  )
    fail("RESTORE_ABSOLUTE_PATHS_REQUIRED");
  const snapshotPath = await realpath(snapshot);
  const currentPath = await realpath(current);
  if (snapshotPath === currentPath) fail("RESTORE_SOURCES_MUST_DIFFER");
  if (
    !(await lstat(snapshotPath)).isFile() ||
    !(await lstat(currentPath)).isFile()
  )
    fail("RESTORE_SOURCE_INVALID");
  const parent = await realpath(dirname(resolve(directory)));
  const target = join(parent, basename(resolve(directory)));
  try {
    await lstat(target);
    fail("RESTORE_TARGET_EXISTS");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const staging = await mkdtemp(join(parent, ".yantu-restore-"));
  let live;
  let restored;
  try {
    live = new DatabaseSync(currentPath, { readOnly: true, timeout: 5000 });
    live.exec("PRAGMA trusted_schema=OFF; BEGIN");
    check(live);
    const capturedAt = new Date().toISOString();
    const candidate = join(staging, "candidate.sqlite");
    await backupDatabase(snapshotPath, candidate);
    restored = new DatabaseSync(candidate, { timeout: 5000 });
    restored.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=OFF");
    check(restored);
    restored.exec("BEGIN IMMEDIATE");
    const protection = protectResources(restored, live);
    // Account hashes and deletion generations are always current, never rolled back.
    for (const name of ["subjects", "accounts", "auth_limits", "audit"])
      replaceTable(restored, live, name);
    // Every pre-restore session, recovery code and write replay is invalidated.
    for (const name of ["sessions", "auth_recovery_codes", "idempotency"])
      replaceTable(restored, live, name, { empty: true });
    mergeUsage(restored, live);
    restored.exec("COMMIT; PRAGMA foreign_keys=ON");
    check(restored);
    restored.exec("PRAGMA journal_mode=DELETE");
    restored.close();
    restored = undefined;
    live.exec("COMMIT");
    live.close();
    live = undefined;
    const report = {
      schemaVersion: 1,
      status: "isolated-review-required",
      currentStateCapturedAt: capturedAt,
      ...protection,
      sessionsCleared: true,
      recoveryCodesCleared: true,
      idempotencyCleared: true,
      accountState: "current",
      usage: "conservative-union",
      approvedForServing: false,
      limitations: [
        "个人资源仅保留与可信当前库内容一致且主体代次未改变的快照记录；变更或缺失记录保守丢弃，不据旧快照恢复。",
        "当前状态截点后若发生删除、撤回、改密或退出，必须重新演练；工具不提供上线切换。",
        "当前可信库不可读时拒绝，仅有旧备份不足以证明恢复安全。",
      ],
    };
    await mkdir(target, { mode: 0o700 });
    await writeFile(
      join(target, "RESTORE_REVIEW_REQUIRED.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await link(candidate, join(target, "candidate.sqlite"));
    return { ...report, directory: target };
  } finally {
    if (restored?.isOpen) restored.close();
    if (live?.isOpen) live.close();
    // Only the generated, resolved staging directory is ever recursively removed.
    if (
      dirname(staging) !== parent ||
      !basename(staging).startsWith(".yantu-restore-")
    )
      fail("RESTORE_CLEANUP_PATH_INVALID");
    await rm(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        snapshot: { type: "string" },
        current: { type: "string" },
        directory: { type: "string" },
      },
      strict: true,
    });
    console.log(JSON.stringify(await restoreIsolated(values)));
  } catch (error) {
    console.error(
      JSON.stringify({ status: "error", code: error.code ?? "RESTORE_FAILED" }),
    );
    process.exitCode = 1;
  }
}
