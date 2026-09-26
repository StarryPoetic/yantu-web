import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { id, now } from "./http.ts";
import type { AccountRecord, AccountUser } from "./auth/types.ts";

export interface Resource<T> {
  value: T;
  etag: string;
  version: number;
}
export interface Subject {
  subjectId: string;
  generation: number;
}
export interface Session extends Subject {
  csrfToken: string;
  expiresAt: number;
  user?: AccountUser | null;
}

/** The persistence seam: transactions own both business writes and their replay records. */
export class Store {
  db: DatabaseSync;
  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db
      .exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS subjects (id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS resources (owner TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, etag TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(owner, kind, id)) STRICT;
      CREATE TABLE IF NOT EXISTS idempotency (owner TEXT NOT NULL, generation INTEGER NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner,generation,operation,key)) STRICT;
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, object_id TEXT NOT NULL, at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS accounts (account_id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, subject_id TEXT NOT NULL UNIQUE REFERENCES subjects(id), role TEXT NOT NULL CHECK(role IN ('student','admin')), admin_roles TEXT NOT NULL, created_at TEXT NOT NULL, CHECK(account_id=subject_id)) STRICT;
      CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS resources_owner_kind ON resources(owner,kind);
      INSERT OR IGNORE INTO migrations VALUES (1, datetime('now'));
      INSERT OR IGNORE INTO migrations VALUES (2, datetime('now'));`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  get<T>(owner: string, kind: string, key = "current"): Resource<T> | null {
    const row = this.db
      .prepare(
        "SELECT value,etag,version FROM resources WHERE owner=? AND kind=? AND id=?",
      )
      .get(owner, kind, key);
    return row
      ? {
          value: JSON.parse(String(row.value)) as T,
          etag: String(row.etag),
          version: Number(row.version),
        }
      : null;
  }
  put<T>(owner: string, kind: string, key: string, value: T): Resource<T> {
    const resource = {
      value,
      etag: `"${id()}"`,
      version: (this.get(owner, kind, key)?.version ?? 0) + 1,
    };
    this.db
      .prepare(
        "INSERT INTO resources VALUES (?,?,?,?,?,?) ON CONFLICT(owner,kind,id) DO UPDATE SET value=excluded.value,etag=excluded.etag,version=excluded.version",
      )
      .run(
        owner,
        kind,
        key,
        JSON.stringify(value),
        resource.etag,
        resource.version,
      );
    return resource;
  }
  list<T>(owner: string, kind: string): Array<Resource<T> & { id: string }> {
    return this.db
      .prepare(
        "SELECT id,value,etag,version FROM resources WHERE owner=? AND kind=? ORDER BY rowid DESC",
      )
      .all(owner, kind)
      .map((row) => ({
        id: String(row.id),
        value: JSON.parse(String(row.value)) as T,
        etag: String(row.etag),
        version: Number(row.version),
      }));
  }
  session(hash: string): Session | null {
    const row = this.db
      .prepare(
        "SELECT s.subject_id,s.csrf,s.expires_at,p.generation FROM sessions s JOIN subjects p ON p.id=s.subject_id WHERE token_hash=? AND expires_at>?",
      )
      .get(hash, Date.now());
    return row
      ? {
          subjectId: String(row.subject_id),
          csrfToken: String(row.csrf),
          expiresAt: Number(row.expires_at),
          generation: Number(row.generation),
          user: this.accountUser(String(row.subject_id)),
        }
      : null;
  }
  createSession(hash: string, csrf: string, subjectId?: string): Session {
    const session = {
      subjectId: subjectId ?? id(),
      csrfToken: csrf,
      generation: subjectId ? this.generation(subjectId) : 0,
      expiresAt: Date.now() + 30 * 86400000,
    };
    if (!subjectId)
      this.db
        .prepare("INSERT INTO subjects VALUES (?,0)")
        .run(session.subjectId);
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
      .run(hash, session.subjectId, csrf, session.expiresAt);
    return { ...session, user: this.accountUser(session.subjectId) };
  }
  revokeSession(hash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash);
  }
  revokeSubjectSessions(subjectId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE subject_id=?").run(subjectId);
  }
  account(usernameKey: string): AccountRecord | null {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE username_key=?")
      .get(usernameKey);
    if (!row) return null;
    return {
      accountId: String(row.account_id),
      username: String(row.username),
      usernameKey: String(row.username_key),
      passwordHash: String(row.password_hash),
      subjectId: String(row.subject_id),
      role: row.role as AccountRecord["role"],
      adminRoles: JSON.parse(String(row.admin_roles)),
      createdAt: String(row.created_at),
    };
  }
  accountUser(subjectId: string): AccountUser | null {
    const row = this.db
      .prepare(
        "SELECT account_id,username,role,admin_roles FROM accounts WHERE subject_id=?",
      )
      .get(subjectId);
    return row
      ? {
          accountId: String(row.account_id),
          username: String(row.username),
          role: row.role as AccountUser["role"],
          adminRoles: JSON.parse(String(row.admin_roles)),
        }
      : null;
  }
  insertAccount(account: AccountRecord, adoptingGuest = false): void {
    if (adoptingGuest) {
      this.db
        .prepare("UPDATE subjects SET generation=generation+1 WHERE id=?")
        .run(account.subjectId);
      this.revokeSubjectSessions(account.subjectId);
      this.db
        .prepare("DELETE FROM idempotency WHERE owner=?")
        .run(account.subjectId);
    } else
      this.db
        .prepare("INSERT INTO subjects VALUES (?,0)")
        .run(account.subjectId);
    this.db
      .prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?)")
      .run(
        account.accountId,
        account.username,
        account.usernameKey,
        account.passwordHash,
        account.subjectId,
        account.role,
        JSON.stringify(account.adminRoles),
        account.createdAt,
      );
  }
  hasPersonalData(subjectId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM resources WHERE owner=? AND kind != 'deletion-job' LIMIT 1",
        )
        .get(subjectId),
    );
  }
  consumeAuthLimit(
    key: string,
    limit: number,
    windowMs: number,
    at = Date.now(),
  ): boolean {
    const current = this.db
      .prepare("SELECT count,expires_at FROM auth_limits WHERE key=?")
      .get(key);
    if (
      current &&
      Number(current.expires_at) > at &&
      Number(current.count) >= limit
    )
      return false;
    this.db
      .prepare(
        "INSERT INTO auth_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at",
      )
      .run(
        key,
        current && Number(current.expires_at) > at
          ? Number(current.count) + 1
          : 1,
        current && Number(current.expires_at) > at
          ? Number(current.expires_at)
          : at + windowMs,
      );
    this.db.prepare("DELETE FROM auth_limits WHERE expires_at<=?").run(at);
    return true;
  }
  generation(owner: string): number {
    return Number(
      this.db.prepare("SELECT generation FROM subjects WHERE id=?").get(owner)
        ?.generation ?? -1,
    );
  }
  replay(owner: string, generation: number, operation: string, key: string) {
    return this.db
      .prepare(
        "SELECT digest,response FROM idempotency WHERE owner=? AND generation=? AND operation=? AND key=?",
      )
      .get(owner, generation, operation, key);
  }
  remember(
    owner: string,
    generation: number,
    operation: string,
    key: string,
    digest: string,
    response: unknown,
  ) {
    this.db
      .prepare("INSERT INTO idempotency VALUES (?,?,?,?,?,?,?)")
      .run(
        owner,
        generation,
        operation,
        key,
        digest,
        JSON.stringify(response),
        now(),
      );
  }
  erase(owner: string): number {
    this.db
      .prepare("UPDATE subjects SET generation=generation+1 WHERE id=?")
      .run(owner);
    this.db
      .prepare("DELETE FROM resources WHERE owner=? AND kind != 'deletion-job'")
      .run(owner);
    this.db.prepare("DELETE FROM idempotency WHERE owner=?").run(owner);
    this.db
      .prepare(
        "DELETE FROM resources WHERE owner='administration' AND kind='correction' AND json_extract(value,'$.subjectId')=?",
      )
      .run(owner);
    return this.generation(owner);
  }
  audit(actor: string, action: string, objectId: string) {
    this.db
      .prepare("INSERT INTO audit VALUES (?,?,?,?,?)")
      .run(id(), actor, action, objectId, now());
  }
  auditEvents() {
    return this.db
      .prepare(
        "SELECT id,actor,action,object_id AS objectId,at FROM audit ORDER BY at DESC LIMIT 200",
      )
      .all();
  }
  close() {
    this.db.close();
  }
}
