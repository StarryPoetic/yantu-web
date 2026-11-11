import { randomUUID } from "node:crypto";
import type { Store } from "../store.ts";

export interface UsageReservation {
  kind: "model" | "search";
  subjectId: string;
  day: string;
  amount: number;
  headroom: number;
  userLimit: number;
  globalLimit: number;
}

/** Only billing counters are stored; prompts, credentials and responses never enter this ledger. */
export interface UsageLedger {
  reserve(request: UsageReservation): string | null;
  settle(reservationId: string, amount: number): void;
}

function validate(request: UsageReservation) {
  if (
    !["model", "search"].includes(request.kind) ||
    !request.subjectId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(request.day) ||
    ![
      request.amount,
      request.headroom,
      request.userLimit,
      request.globalLimit,
      request.amount + request.headroom,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  )
    throw new Error("INVALID_USAGE_RESERVATION");
}

function validAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error("INVALID_USAGE_AMOUNT");
}

/** Standalone modules/tests may opt into memory; the application always injects SQLite. */
export function createMemoryUsageLedger(): UsageLedger {
  const rows = new Map<string, UsageReservation & { settled: boolean }>();
  return {
    reserve(request) {
      validate(request);
      let user = 0;
      let global = 0;
      for (const row of rows.values()) {
        if (row.kind !== request.kind || row.day !== request.day) continue;
        global += row.amount;
        if (row.subjectId === request.subjectId) user += row.amount;
      }
      const required = request.amount + request.headroom;
      if (
        required > request.userLimit - user ||
        required > request.globalLimit - global
      )
        return null;
      const reservationId = randomUUID();
      rows.set(reservationId, { ...request, settled: false });
      return reservationId;
    },
    settle(reservationId, amount) {
      validAmount(amount);
      const row = rows.get(reservationId);
      if (row && !row.settled) {
        row.amount = amount;
        row.settled = true;
      }
    },
  };
}

/** BEGIN IMMEDIATE serializes check-and-reserve across SQLite connections/processes.
 * A crash leaves its reservation charged. Only a known usage reply can settle it;
 * restarting, lowering limits, deleting a profile or crossing midnight never erases usage.
 */
export function createPersistentUsageLedger(store: Store): UsageLedger {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS usage_reservations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('model','search')),
      subject_id TEXT NOT NULL,
      day TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount >= 0),
      settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS usage_reservations_day ON usage_reservations(kind,day,subject_id);
  `);
  return {
    reserve(request) {
      validate(request);
      return store.transaction(() => {
        const totals = store.db
          .prepare(
            `
          SELECT COALESCE(SUM(amount),0) AS total,
            COALESCE(SUM(CASE WHEN subject_id=? THEN amount ELSE 0 END),0) AS account
          FROM usage_reservations WHERE kind=? AND day=?
        `,
          )
          .get(request.subjectId, request.kind, request.day)!;
        const required = request.amount + request.headroom;
        if (
          required > request.userLimit - Number(totals.account) ||
          required > request.globalLimit - Number(totals.total)
        )
          return null;
        const reservationId = randomUUID();
        store.db
          .prepare("INSERT INTO usage_reservations VALUES (?,?,?,?,?,0)")
          .run(
            reservationId,
            request.kind,
            request.subjectId,
            request.day,
            request.amount,
          );
        return reservationId;
      });
    },
    settle(reservationId, amount) {
      validAmount(amount);
      store.transaction(() => {
        store.db
          .prepare(
            "UPDATE usage_reservations SET amount=?,settled=1 WHERE id=? AND settled=0",
          )
          .run(amount, reservationId);
      });
    },
  };
}
