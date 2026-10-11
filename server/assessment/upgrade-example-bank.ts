import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadQuestionBank } from "./index.ts";
import type { QuestionBank } from "./types.ts";

const legacyVersions = new Set([
  "example-unreviewed-v1",
  "example-unreviewed-v2-presentation",
  "example-unreviewed-v3-inline-stem",
]);

/** Explicit one-off seed-data upgrade. Only the public active example bank changes.
 * Existing attempts own their question/diagnosis snapshots and remain untouched. */
export async function upgradeExampleBank(
  databasePath: string,
  backupPath: string,
) {
  const bank = await loadQuestionBank();
  // Reuse the established online, integrity-checked, no-overwrite backup tool.
  // A fixed file URL keeps this optional CLI out of the application startup path.
  const backupModule = new URL(
    "../../scripts/backup-database.mjs",
    import.meta.url,
  ).href;
  const { backupDatabase } = (await import(backupModule)) as {
    backupDatabase: (source: string, destination: string) => Promise<unknown>;
  };
  await backupDatabase(databasePath, backupPath);
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  try {
    db.exec("BEGIN IMMEDIATE");
    const row = db
      .prepare(
        "SELECT value, version FROM resources WHERE owner='public' AND kind='question-bank' AND id='current'",
      )
      .get();
    const old = row
      ? (JSON.parse(String(row.value)) as QuestionBank)
      : undefined;
    if (
      old?.mode !== "example" ||
      !legacyVersions.has(old.questionBankVersion)
    ) {
      db.exec("COMMIT");
      return {
        updated: false,
        reason: "Only known legacy example banks may be upgraded.",
      };
    }
    db.prepare(
      "UPDATE resources SET value=?, etag=?, version=version+1 WHERE owner='public' AND kind='question-bank' AND id='current' AND version=?",
    ).run(JSON.stringify(bank), `"${randomUUID()}"`, row!.version);
    db.exec("COMMIT");
    return {
      updated: true,
      previousVersion: old.questionBankVersion,
      questionBankVersion: bank.questionBankVersion,
      questions: bank.questions.length,
    };
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [databasePath, backupPath, extra] = process.argv.slice(2);
  if (!databasePath || !backupPath || extra)
    throw new Error(
      "Usage: node server/assessment/upgrade-example-bank.ts DATABASE NEW_BACKUP",
    );
  console.log(
    JSON.stringify(await upgradeExampleBank(databasePath, backupPath)),
  );
}
