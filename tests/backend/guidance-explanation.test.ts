import test from "node:test";
import assert from "node:assert/strict";
import { createGuidanceExplainer } from "../../server/explanation/guidance.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import { createApplication } from "../../server/app.ts";

const fixture = () =>
  generateGuidance({
    subjectId: "student-one",
    guidanceRunId: "guidance-one",
    generatedAt: "2026-09-27T10:00:00Z",
    profile: {
      ...blankProfile(),
      major: "法学",
      targetMajor: "法律",
      crossMajor: "接受相近专业",
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [],
  });
function runtime(content: string) {
  return createModelRuntime({
    adapter: {
      async complete() {
        return { content, inputTokens: 100, outputTokens: 50, model: "test" };
      },
    },
  });
}

test("guidance model can organize verified reasons but cannot add an unsupported profession or claim", async () => {
  const run = fixture();
  const valid = await createGuidanceExplainer(
    runtime(JSON.stringify({ evidenceIds: ["reason-2", "reason-1"] })),
  ).explain(run.subjectId, run);
  assert.equal(valid.status, "model");
  assert.ok(valid.text.includes(run.conclusion));
  assert.ok(valid.text.includes(run.limitations[0]));
  for (const content of [
    JSON.stringify({ evidenceIds: ["forged-reason"] }),
    JSON.stringify({ evidenceIds: ["reason-1"], claim: "保证被录取" }),
    JSON.stringify({ evidenceIds: ["reason-1", "reason-1"] }),
    "不是JSON",
  ]) {
    const fallback = await createGuidanceExplainer(runtime(content)).explain(
      run.subjectId,
      run,
    );
    assert.equal(fallback.status, "fallback");
    assert.equal(fallback.text.includes("保证被录取"), false);
    assert.ok(fallback.text.includes(run.conclusion));
  }
  await assert.rejects(
    createGuidanceExplainer(runtime("{}")).explain("other-person", run),
    /辅助模型/,
  );
});

test("model disabled remains explicit and deleting during explanation cannot return private fallback text", async () => {
  const run = fixture();
  const disabled = await createGuidanceExplainer(
    createModelRuntime({ enabled: false }),
  ).explain(run.subjectId, run);
  assert.equal(disabled.status, "fallback");
  assert.equal(disabled.reason, "MODEL_DISABLED");
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const shared = createModelRuntime({
    adapter: {
      async complete() {
        await pending;
        return {
          content: '{"evidenceIds":["reason-1"]}',
          inputTokens: 1,
          outputTokens: 1,
          model: "test",
        };
      },
    },
  });
  const response = createGuidanceExplainer(shared).explain(run.subjectId, run);
  shared.clearSubject(run.subjectId);
  finish();
  await assert.rejects(
    response,
    (error) => (error as { code?: string }).code === "DATA_DELETED",
  );
});

test("annual catalog query uses nationwide discipline codes and rejects invalid codes", async (t) => {
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: undefined,
  });
  t.after(() => app.close());
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1/programs`;
  const absent = await fetch(`${base}?disciplineCodes=0301`).then((response) =>
    response.json(),
  );
  assert.equal(absent.items.length, 0);
  const computing = await fetch(`${base}?disciplineCodes=0812`).then(
    (response) => response.json(),
  );
  assert.ok(computing.items.length);
  assert.ok(
    computing.items.every(
      (item: { identity: { majorCode: string; degreeType: string } }) =>
        item.identity.majorCode.startsWith("0812") &&
        item.identity.degreeType === "academic",
    ),
  );
  assert.equal(
    (await fetch(`${base}?disciplineCodes=nonexistent`)).status,
    422,
  );
});
