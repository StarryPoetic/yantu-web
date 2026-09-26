import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { id, now } from "./http.ts";

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
      CREATE INDEX IF NOT EXISTS resources_owner_kind ON resources(owner,kind);
      INSERT OR IGNORE INTO migrations VALUES (1, datetime('now'));`);
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
        }
      : null;
  }
  createSession(hash: string, csrf: string): Session {
    const session = {
      subjectId: id(),
      csrfToken: csrf,
      generation: 0,
      expiresAt: Date.now() + 30 * 86400000,
    };
    this.db.prepare("INSERT INTO subjects VALUES (?,0)").run(session.subjectId);
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
      .run(hash, session.subjectId, csrf, session.expiresAt);
    return session;
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
