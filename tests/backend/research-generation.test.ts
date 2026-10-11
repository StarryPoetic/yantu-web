import test from "node:test";
import assert from "node:assert/strict";
import { generateResearchValue } from "../../server/explanation/research-generation.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import {
  ModelError,
  type ModelAdapter,
  type ModelMessage,
  type ModelReply,
  type ModelRequestOptions,
} from "../../server/explanation/deepseek.ts";

const messages: ModelMessage[] = [{ role: "user", content: "固定画像与来源" }];
const options: ModelRequestOptions = {
  model: "deepseek-v4-pro",
  thinking: false,
  maxOutputTokens: 100,
  timeoutMs: 30000,
  format: "json",
};
const reply = (
  content: string,
  inputTokens = 10,
  outputTokens = 10,
): ModelReply => ({
  content,
  inputTokens,
  outputTokens,
  model: "deepseek-v4-pro",
});
const code = (expected: string) => (error: unknown) =>
  error instanceof ModelError && error.code === expected;
function validate(raw: string) {
  if (raw !== '{"ok":true}') throw new ModelError("INVALID_RESEARCH_REPORT");
  return { ok: true };
}
function setup(adapter: ModelAdapter, userDailyTokens = 100000) {
  const runtime = createModelRuntime({
    adapter,
    userDailyTokens,
    globalDailyTokens: 1000000,
  });
  return {
    runtime,
    subjectId: "owner",
    key: { task: "planning", version: 1 },
    messages,
    validate,
    options,
    beforeRepair: async () => {},
  };
}

test("valid research values use the runtime cache isolated by subject, version and deletion", async () => {
  let calls = 0;
  const input = setup({
    async complete() {
      calls++;
      return reply('{"ok":true}');
    },
  });
  assert.equal((await generateResearchValue(input)).cached, false);
  assert.equal((await generateResearchValue(input)).cached, true);
  assert.equal(calls, 1);
  await generateResearchValue({ ...input, subjectId: "other" });
  await generateResearchValue({ ...input, key: { ...input.key, version: 2 } });
  assert.equal(calls, 3);
  input.runtime.clearSubject("owner");
  assert.equal((await generateResearchValue(input)).cached, false);
  assert.equal(calls, 4);
});

test("a rejected structure is repaired once using original evidence, bounded internal feedback and the same options", async () => {
  const requests: {
    messages: ModelMessage[];
    options?: ModelRequestOptions;
  }[] = [];
  let checks = 0;
  const input = setup({
    async complete(sent, config) {
      requests.push({ messages: structuredClone(sent), options: config });
      return reply(requests.length === 1 ? '{"wrong":true}' : '{"ok":true}');
    },
  });
  const result = await generateResearchValue({
    ...input,
    beforeRepair: async () => {
      checks++;
    },
    validate(raw) {
      if (raw !== '{"ok":true}')
        throw Object.assign(new ModelError("INVALID_RESEARCH_REPORT"), {
          issues: [
            {
              path: "directions[0].disciplineCode",
              reason: "expected four-digit code",
            },
          ],
        });
      return { ok: true };
    },
  });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(requests.length, 2);
  assert.equal(checks, 1);
  assert.deepEqual(requests[1].messages[0], messages[0]);
  assert.equal(requests[1].messages[1].role, "assistant");
  assert.equal(requests[1].messages[1].content, '{"wrong":true}');
  assert.match(
    requests[1].messages.at(-1)!.content,
    /directions\[0\]\.disciplineCode/,
  );
  assert.deepEqual(requests[1].options, options);
  assert.ok(
    requests[1].messages
      .at(-1)!
      .content.includes("本次sources列表中给出的id，不得自造或改写"),
  );
  const cachedRepair = await input.runtime.run(
    "owner",
    { ...input.key, repair: 1, validation: "INVALID_RESEARCH_REPORT" },
    requests[1].messages,
    validate,
    options,
  );
  assert.equal(cachedRepair.cached, true);
  assert.equal(requests.length, 2);
});

test("failed repair never attempts a third call, including citation and actual-profile failures", async () => {
  for (const reason of [
    "INVALID_RESEARCH_REPORT",
    "INVALID_RESEARCH_CITATION",
    "UNGROUNDED_PROFILE_FIT",
  ]) {
    let calls = 0;
    const input = setup({
      async complete() {
        calls++;
        return reply('{"wrong":true}');
      },
    });
    await assert.rejects(
      generateResearchValue({
        ...input,
        validate() {
          throw new ModelError(reason);
        },
      }),
      code(reason),
    );
    assert.equal(calls, 2, reason);
  }
});

test("provider, transport, quota and cancellation failures are never retried or reclassified as validation", async () => {
  for (const reason of [
    "MODEL_TIMEOUT",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_NETWORK_ERROR",
    "PROVIDER_BALANCE_INSUFFICIENT",
    "PROVIDER_INVALID_REQUEST",
    "RATE_LIMITED",
    "INVALID_RESPONSE",
    "BUDGET_EXHAUSTED",
    "CONCURRENCY_LIMIT",
    "DATA_DELETED",
    "INCOMPLETE_RESPONSE",
    "INVALID_RESEARCH_REPORT",
  ]) {
    let calls = 0,
      checks = 0;
    const input = setup({
      async complete() {
        calls++;
        throw new ModelError(reason);
      },
    });
    await assert.rejects(
      generateResearchValue({
        ...input,
        beforeRepair: async () => {
          checks++;
        },
      }),
      code(reason),
    );
    assert.equal(calls, 1, reason);
    assert.equal(checks, 0, reason);
  }
});

test("rejected replies consume shared budget and a repair cannot bypass quota reservation", async () => {
  let calls = 0;
  const reserve = JSON.stringify(messages).length + options.maxOutputTokens!;
  const input = setup(
    {
      async complete() {
        calls++;
        return reply('{"wrong":true}', reserve - 10, 10);
      },
    },
    reserve,
  );
  await assert.rejects(generateResearchValue(input), code("BUDGET_EXHAUSTED"));
  assert.equal(calls, 1);
  await assert.rejects(
    input.runtime.run("owner", { task: "chat" }, messages, validate, options),
    code("BUDGET_EXHAUSTED"),
  );
  assert.equal(calls, 1);
  const empty = setup(
    {
      async complete() {
        throw new Error("must not call");
      },
    },
    0,
  );
  await assert.rejects(generateResearchValue(empty), code("BUDGET_EXHAUSTED"));
});

test("authorization is checked before repair and deletion during repair prevents delivery and caching", async () => {
  let calls = 0;
  const cancelled = setup({
    async complete() {
      calls++;
      return reply('{"wrong":true}');
    },
  });
  await assert.rejects(
    generateResearchValue({
      ...cancelled,
      beforeRepair: async () => {
        throw new ModelError("DATA_DELETED");
      },
    }),
    code("DATA_DELETED"),
  );
  assert.equal(calls, 1);
  let finish!: (value: ModelReply) => void;
  let started!: () => void;
  const repairStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const input = setup({
    async complete() {
      calls++;
      if (calls === 2) return reply('{"wrong":true}');
      started();
      return new Promise<ModelReply>((resolve) => {
        finish = resolve;
      });
    },
  });
  const pending = generateResearchValue(input);
  await repairStarted;
  input.runtime.clearSubject("owner");
  finish(reply('{"ok":true}'));
  await assert.rejects(pending, code("DATA_DELETED"));
  assert.equal(calls, 3);
});

test("repair drops only the rejected reply near context limits and never truncates original evidence", async () => {
  const requests: ModelMessage[][] = [];
  const input = setup({
    async complete(sent) {
      requests.push(structuredClone(sent));
      return reply(
        requests.length === 1 ? "invalid".repeat(500) : '{"ok":true}',
      );
    },
  });
  const original: ModelMessage[] = [
    { role: "user", content: "证据".repeat(7600) },
  ];
  await generateResearchValue({ ...input, messages: original });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1][0], original[0]);
  assert.equal(
    requests[1].some((item) => item.role === "assistant"),
    false,
  );
  assert.ok(JSON.stringify(requests[1]).length <= 16000);
});

test("a context that cannot fit repair feedback stops without an additional paid request", async () => {
  let calls = 0,
    checks = 0;
  const input = setup({
    async complete() {
      calls++;
      return reply("invalid");
    },
  });
  await assert.rejects(
    generateResearchValue({
      ...input,
      messages: [{ role: "user", content: "x".repeat(15900) }],
      beforeRepair: async () => {
        checks++;
      },
    }),
    code("INVALID_RESEARCH_REPORT"),
  );
  assert.equal(calls, 1);
  assert.equal(checks, 0);
});

test("a confirmed temporary provider failure retries once through the same runtime after a live check", async () => {
  let calls = 0,
    checks = 0;
  const input = setup({
    async complete(sent, sentOptions) {
      calls++;
      assert.deepEqual(sent, messages);
      assert.deepEqual(sentOptions, options);
      if (calls === 1) throw new ModelError("PROVIDER_TEMPORARY_UNAVAILABLE");
      assert.equal(checks, 1);
      return reply('{"ok":true}');
    },
  });
  const result = await generateResearchValue({
    ...input,
    beforeRetry: async () => {
      checks++;
    },
  });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(calls, 2);
  const cached = await input.runtime.run(
    "owner",
    { ...input.key, retry: 1 },
    messages,
    validate,
    options,
  );
  assert.equal(cached.cached, true);
  assert.equal(calls, 2);
});

test("temporary retry and structural repair share a one-retry ceiling in either order", async () => {
  for (const sequence of [
    ["temporary", "invalid", "valid"],
    ["invalid", "temporary", "valid"],
    ["temporary", "invalid", "temporary"],
    ["invalid", "temporary", "temporary"],
  ]) {
    let calls = 0,
      retries = 0,
      repairs = 0;
    const input = setup({
      async complete() {
        const step = sequence[calls++];
        assert.ok(step, "must not attempt a fourth provider call");
        if (step === "temporary")
          throw new ModelError("PROVIDER_TEMPORARY_UNAVAILABLE");
        return reply(step === "invalid" ? '{"wrong":true}' : '{"ok":true}');
      },
    });
    const pending = generateResearchValue({
      ...input,
      beforeRetry: async () => {
        retries++;
      },
      beforeRepair: async () => {
        repairs++;
      },
    });
    if (sequence.at(-1) === "valid")
      assert.deepEqual((await pending).value, { ok: true });
    else await assert.rejects(pending, code("PROVIDER_TEMPORARY_UNAVAILABLE"));
    assert.equal(calls, 3);
    assert.equal(retries, 1);
    assert.equal(repairs, 1);
  }
});

test("a temporary failure retains its reservation and retry cannot bypass the shared quota", async () => {
  let calls = 0,
    checks = 0;
  const reserve = JSON.stringify(messages).length + options.maxOutputTokens!;
  const input = setup(
    {
      async complete() {
        calls++;
        throw new ModelError("PROVIDER_TEMPORARY_UNAVAILABLE");
      },
    },
    reserve,
  );
  await assert.rejects(
    generateResearchValue({
      ...input,
      beforeRetry: async () => {
        checks++;
      },
    }),
    code("BUDGET_EXHAUSTED"),
  );
  assert.equal(calls, 1);
  assert.equal(checks, 1);
  await assert.rejects(
    input.runtime.run("owner", { task: "chat" }, messages, validate, options),
    code("BUDGET_EXHAUSTED"),
  );
});

test("retry authorization failure stops before a second request and deletion during retry prevents return or caching", async () => {
  for (const callback of ["beforeRetry", "beforeRepair"] as const) {
    let calls = 0;
    const input = setup({
      async complete() {
        calls++;
        throw new ModelError("PROVIDER_TEMPORARY_UNAVAILABLE");
      },
    });
    await assert.rejects(
      generateResearchValue({
        ...input,
        [callback]: async () => {
          throw new ModelError("DATA_DELETED");
        },
      }),
      code("DATA_DELETED"),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  let started!: () => void;
  let finish!: (value: ModelReply) => void;
  const retryStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const input = setup({
    async complete() {
      calls++;
      if (calls === 1) throw new ModelError("PROVIDER_TEMPORARY_UNAVAILABLE");
      started();
      return new Promise<ModelReply>((resolve) => {
        finish = resolve;
      });
    },
  });
  const pending = generateResearchValue(input);
  await retryStarted;
  input.runtime.clearSubject("owner");
  finish(reply('{"ok":true}'));
  await assert.rejects(pending, code("DATA_DELETED"));
  assert.equal(calls, 2);
});

test("a second temporary failure ends the phase and a distinct retry failure preserves its exact cause", async () => {
  for (const second of [
    "PROVIDER_TEMPORARY_UNAVAILABLE",
    "MODEL_TIMEOUT",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_BALANCE_INSUFFICIENT",
    "PROVIDER_NETWORK_ERROR",
  ]) {
    let calls = 0;
    const input = setup({
      async complete() {
        calls++;
        throw new ModelError(
          calls === 1 ? "PROVIDER_TEMPORARY_UNAVAILABLE" : second,
        );
      },
    });
    await assert.rejects(generateResearchValue(input), code(second));
    assert.equal(calls, 2);
  }
});
