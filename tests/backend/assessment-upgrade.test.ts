import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApplication } from "../../server/app.ts";
import {
  createAttempt,
  loadQuestionBank,
  submitAttempt,
} from "../../server/assessment/index.ts";
import { upgradeExampleBank } from "../../server/assessment/upgrade-example-bank.ts";
import type { QuestionBank } from "../../server/assessment/types.ts";

test("V3B seed upgrade backs up first, changes only the public bank, and preserves custom/current banks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yantu-v3b-"));
  const databasePath = join(dir, "fixture.sqlite");
  const app = await createApplication({
    databasePath,
    sampleData: true,
    admins: [],
    staticDirectory: undefined,
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  try {
    app.store.insertAccount({
      accountId: "private-fixture",
      subjectId: "private-fixture",
      username: "fixture_user",
      usernameKey: "fixture_user",
      passwordHash: "test-only-placeholder-hash",
      role: "student",
      adminRoles: [],
      createdAt: "2026-10-12T00:00:00Z",
    });
    const accountBefore = app.store.db
      .prepare("SELECT * FROM accounts WHERE account_id='private-fixture'")
      .get();
    const old = await loadQuestionBank();
    old.questionBankVersion = "example-unreviewed-v3-inline-stem";
    old.questions = old.questions.filter((q) => q.id.startsWith("v2-"));
    app.store.put("public", "question-bank", "current", old);
    const draft = createAttempt(old, {
      subjectId: "private-fixture",
      allowExampleBank: true,
    });
    app.store.put(
      "private-fixture",
      "attempt",
      draft.assessmentAttemptId,
      submitAttempt(draft, {
        expectedAttemptVersion: 1,
        confirmUnanswered: true,
      }),
    );
    app.store.put("private-fixture", "profile", "current", {
      major: "历史画像",
    });
    app.store.put("private-fixture", "research-report", "old", {
      summary: "历史报告",
    });
    const privateRows = () =>
      app.store.db
        .prepare(
          "SELECT * FROM resources WHERE owner != 'public' ORDER BY owner,kind,id",
        )
        .all();
    const before = privateRows();
    const result = await upgradeExampleBank(
      databasePath,
      join(dir, "before.sqlite"),
    );
    assert.equal(result.updated, true);
    assert.equal(
      app.store.get<QuestionBank>("public", "question-bank")!.value.questions
        .length,
      56,
    );
    assert.deepEqual(privateRows(), before);
    assert.deepEqual(
      app.store.db
        .prepare("SELECT * FROM accounts WHERE account_id='private-fixture'")
        .get(),
      accountBefore,
    );
    const backup = new DatabaseSync(join(dir, "before.sqlite"), {
      readOnly: true,
    });
    try {
      const oldBank = JSON.parse(
        String(
          backup
            .prepare(
              "SELECT value FROM resources WHERE owner='public' AND kind='question-bank'",
            )
            .get()!.value,
        ),
      );
      assert.equal(oldBank.questionBankVersion, old.questionBankVersion);
      assert.equal(oldBank.questions.length, 20);
    } finally {
      backup.close();
    }
    const unchanged = app.store.get("public", "question-bank");
    assert.equal(
      (await upgradeExampleBank(databasePath, join(dir, "second.sqlite")))
        .updated,
      false,
    );
    assert.deepEqual(app.store.get("public", "question-bank"), unchanged);
    await assert.rejects(
      upgradeExampleBank(databasePath, join(dir, "before.sqlite")),
      { code: "TARGET_EXISTS" },
    );
    for (const changes of [
      { questionBankVersion: "custom-example" },
      { mode: "reviewed" as const },
    ]) {
      const custom = { ...old, ...changes };
      app.store.put("public", "question-bank", "current", custom);
      assert.equal(
        (
          await upgradeExampleBank(
            databasePath,
            join(dir, `${changes.mode ?? "custom"}.sqlite`),
          )
        ).updated,
        false,
      );
      assert.deepEqual(
        app.store.get<QuestionBank>("public", "question-bank")!.value,
        custom,
      );
    }
  } finally {
    await app.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(dir.includes("yantu-v3b-"));
    await rm(dir, { recursive: true, force: true });
  }
});
