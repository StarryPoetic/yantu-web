import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { createDeepSeekAdapter } from "../../server/explanation/deepseek.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";

const model = "deepseek-v4-pro";
const options = { model, thinking: true, maxOutputTokens: 100 } as const;
const encoder = new TextEncoder();
const usage = {
  prompt_tokens: 20,
  completion_tokens: 80,
  completion_tokens_details: { reasoning_tokens: 70 },
};
function chunk(
  delta: Record<string, unknown>,
  finish: string | null = null,
  extra: Record<string, unknown> = {},
) {
  return {
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  };
}
function event(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}
function streamResponse(raw: string, split = false) {
  const bytes = encoder.encode(raw);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        const end = split ? offset + 1 : bytes.length;
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}
function adapterFor(raw: string, split = false) {
  return createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock-secret",
    fetch: async () => streamResponse(raw, split),
  });
}
function completeStream(extra: Record<string, unknown> = { usage }) {
  return (
    event(chunk({ content: "最终结果" }, "stop", extra)) + "data: [DONE]\n\n"
  );
}

function controlledResponse(thinking = true) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = 0;
  let signal!: AbortSignal;
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: async (_url, init) => {
      signal = init!.signal!;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
          cancel() {
            cancelled++;
          },
        }),
        {
          headers: {
            "Content-Type": thinking ? "text/event-stream" : "application/json",
          },
        },
      );
    },
  });
  return {
    adapter,
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    cancelled: () => cancelled,
    aborted: () => signal.aborted,
  };
}

test("continuous reasoning and raw SSE bytes survive 180 seconds and clean up both timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const stream = controlledResponse();
  const reply = stream.adapter.complete([], options);
  await flush();
  // No final content for the first 150 seconds. Even incomplete SSE frames
  // count as activity; waiting for a parsed event would incorrectly time out.
  for (const text of [
    event(chunk({ reasoning_content: "private thought" })),
    ": heart",
    "beat",
    "\n\n",
    event(chunk({ reasoning_content: "more thought" })),
    completeStream(),
  ]) {
    t.mock.timers.tick(30000);
    assert.equal(stream.aborted(), false);
    stream.send(text);
    await flush();
  }
  assert.equal((await reply).content, "最终结果");
  assert.equal(stream.cancelled(), 1);
  t.mock.timers.tick(B.thinkingTimeoutMs);
  assert.equal(
    stream.aborted(),
    false,
    "success disposes idle and total timers",
  );
});

test("45 seconds without bytes times out before or after reasoning; empty chunks do not refresh idle time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  for (const midstream of [false, true]) {
    const stream = controlledResponse();
    const failed = assert.rejects(stream.adapter.complete([], options), {
      code: "MODEL_TIMEOUT",
    });
    await flush();
    if (midstream) {
      t.mock.timers.tick(20000);
      stream.send(event(chunk({ reasoning_content: "private thought" })));
      await flush();
    }
    t.mock.timers.tick(B.thinkingIdleTimeoutMs - 1);
    stream.send("");
    await flush();
    assert.equal(stream.aborted(), false);
    t.mock.timers.tick(1);
    await failed;
    assert.equal(stream.cancelled(), 1);
  }
});

test("continuous bytes cannot extend the default or configured total thinking deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  for (const total of [undefined, 90000, 360000]) {
    const limit = total ?? B.thinkingTimeoutMs;
    const stream = controlledResponse();
    const failed = assert.rejects(
      stream.adapter.complete([], { ...options, timeoutMs: total }),
      { code: "MODEL_TIMEOUT" },
    );
    await flush();
    for (let elapsed = 30000; elapsed < limit; elapsed += 30000) {
      t.mock.timers.tick(30000);
      stream.send(": heartbeat\n\n");
      await flush();
      assert.equal(stream.aborted(), false);
    }
    t.mock.timers.tick(29999);
    assert.equal(stream.aborted(), false);
    t.mock.timers.tick(1);
    await failed;
    assert.equal(stream.cancelled(), 1);
  }
});

test("non-streaming calls retain the 30 second cap even with a longer configured timeout and incoming bytes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  for (const timeoutMs of [undefined, B.thinkingTimeoutMs]) {
    const stream = controlledResponse(false);
    const failed = assert.rejects(stream.adapter.complete([], { timeoutMs }), {
      code: "MODEL_TIMEOUT",
    });
    await flush();
    t.mock.timers.tick(20000);
    stream.send('{"model":');
    await flush();
    t.mock.timers.tick(B.normalTimeoutMs - 20001);
    assert.equal(stream.aborted(), false);
    t.mock.timers.tick(1);
    await failed;
    assert.equal(stream.cancelled(), 1);
  }
});

test("idle timeout includes waiting for response headers and retains the full quota reservation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let requests = 0;
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: async (_url, init) => {
      requests++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    },
  });
  const runtime = createModelRuntime({ adapter, userDailyTokens: 150 });
  const failed = assert.rejects(
    runtime.run("a", "first", [], (content) => content, options),
    { code: "MODEL_TIMEOUT" },
  );
  t.mock.timers.tick(B.thinkingIdleTimeoutMs);
  await failed;
  await assert.rejects(
    runtime.run("a", "retry", [], (content) => content, options),
    { code: "BUDGET_EXHAUSTED" },
  );
  assert.equal(requests, 1);
});

test("thinking requests consume split UTF-8 SSE, discard reasoning and preserve total completion usage", async () => {
  let calls = 0;
  const raw =
    ": keepalive\r\n\r\n" +
    event(
      chunk({
        role: "assistant",
        content: "",
        reasoning_content: "private thought",
      }),
    ).replaceAll("\n", "\r\n") +
    event(chunk({ content: '{"结论":"' })) +
    event(chunk({ content: "真实资料" })) +
    event(chunk({ content: '"}', role: null }, "stop", { usage })) +
    "data: [DONE]\n\n";
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock-secret",
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.stream, true);
      assert.deepEqual(body.stream_options, { include_usage: true });
      assert.deepEqual(body.thinking, { type: "enabled" });
      assert.equal(body.tools, undefined);
      assert.equal(init?.redirect, "error");
      return streamResponse(raw, true);
    },
  });
  const reply = await adapter.complete(
    [{ role: "user", content: "Return JSON" }],
    options,
  );
  assert.deepEqual(reply, {
    model,
    content: '{"结论":"真实资料"}',
    inputTokens: 20,
    outputTokens: 80,
  });
  assert.doesNotMatch(
    JSON.stringify(reply),
    /private thought|reasoning_content|mock-secret/,
  );
  assert.equal(calls, 1);
});

test("SSE accepts multiline data, CR/LF framing and a separate usage-only terminal chunk", async () => {
  const multiline = JSON.stringify(chunk({ content: "完成" }, "stop"), null, 2)
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\r");
  const raw =
    `event: message\rretry: 500\r${multiline}\r\r` +
    event({ model, choices: [], usage }) +
    "data: [DONE]";
  const reply = await adapterFor(raw, true).complete([], options);
  assert.equal(reply.content, "完成");
  assert.equal(reply.outputTokens, 80);
});

test("stream protocol, model, completion and tool guards reject untrusted or truncated replies", async () => {
  const cases: Array<[string, string]> = [
    [
      event(chunk({ content: "unfinished" }, "stop", { usage })),
      "INCOMPLETE_RESPONSE",
    ],
    [
      event(chunk({ content: "unfinished" }, null, { usage })) +
        "data: [DONE]\n\n",
      "INCOMPLETE_RESPONSE",
    ],
    [completeStream({ usage: null }), "UNKNOWN_USAGE"],
    [
      completeStream({ usage: { prompt_tokens: 1.5, completion_tokens: 10 } }),
      "UNKNOWN_USAGE",
    ],
    [
      event(chunk({ content: "x" }, "length", { usage })) + "data: [DONE]\n\n",
      "INCOMPLETE_RESPONSE",
    ],
    [
      event(chunk({ content: " " }, "stop", { usage })) + "data: [DONE]\n\n",
      "INCOMPLETE_RESPONSE",
    ],
    [
      event(chunk({ content: "x" }, "stop", { model: "unexpected", usage })),
      "INVALID_RESPONSE",
    ],
    [
      event({
        ...chunk({ content: "x" }),
        choices: [{ index: 1, delta: { content: "x" }, finish_reason: "stop" }],
      }),
      "INCOMPLETE_RESPONSE",
    ],
    [
      event({
        ...chunk({}),
        choices: [chunk({}).choices[0], chunk({}).choices[0]],
      }),
      "INCOMPLETE_RESPONSE",
    ],
    [
      event(chunk({ tool_calls: [{ function: { name: "steal" } }] })),
      "INCOMPLETE_RESPONSE",
    ],
    [event(chunk({ function_call: { name: "steal" } })), "INCOMPLETE_RESPONSE"],
    [event(chunk({ role: "system", content: "x" })), "INCOMPLETE_RESPONSE"],
    ["data: not-json-private-provider-text\n\n", "INVALID_RESPONSE"],
    [
      event({ error: { message: "private provider message" } }),
      "INVALID_RESPONSE",
    ],
    [
      completeStream() + event(chunk({ content: "late output" })),
      "INVALID_RESPONSE",
    ],
    [
      event(chunk({ content: "x" }, "stop", { usage })) +
        event({
          model,
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      "UNKNOWN_USAGE",
    ],
  ];
  for (const [raw, code] of cases)
    await assert.rejects(
      adapterFor(raw).complete([], options),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, code);
        assert.doesNotMatch(
          JSON.stringify(error),
          /private|steal|unfinished|late output/,
        );
        return true;
      },
    );
});

test("thinking SSE requires the expected MIME and valid UTF-8", async () => {
  const wrongMime = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: async () =>
      new Response(completeStream(), {
        headers: { "Content-Type": "application/json" },
      }),
  });
  await assert.rejects(wrongMime.complete([], options), {
    code: "INVALID_RESPONSE",
  });
  const invalidUtf8 = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: async () =>
      new Response(new Uint8Array([0xff]), {
        headers: { "Content-Type": "text/event-stream" },
      }),
  });
  await assert.rejects(invalidUtf8.complete([], options), {
    code: "INVALID_RESPONSE",
  });
});

test("all SSE bytes including framing count toward 8 MiB and cancellation stops the stream", async () => {
  for (const declared of [false, true]) {
    let cancelled = 0;
    const adapter = createDeepSeekAdapter({
      enabled: true,
      apiKey: "mock",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(": keepalive\n\n".repeat(650000)),
              );
            },
            cancel() {
              cancelled++;
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              ...(declared ? { "Content-Length": "8388609" } : {}),
            },
          },
        ),
    });
    await assert.rejects(adapter.complete([], options), {
      code: "RESPONSE_TOO_LARGE",
    });
    assert.equal(cancelled, 1);
  }
});

test("the total deadline covers stalled SSE and is not extended by thinking keepalives", async () => {
  for (const heartbeat of [false, true]) {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const adapter = createDeepSeekAdapter({
      enabled: true,
      apiKey: "mock",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  event(chunk({ reasoning_content: "private thought" })),
                ),
              );
              if (heartbeat)
                interval = setInterval(
                  () => controller.enqueue(encoder.encode(": heartbeat\n\n")),
                  2,
                );
            },
            cancel() {
              cancelled = true;
              clearInterval(interval);
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    });
    await assert.rejects(adapter.complete([], { ...options, timeoutMs: 10 }), {
      code: "MODEL_TIMEOUT",
    });
    assert.equal(cancelled, true);
  }
});

test("DONE terminates a still-open transport while unexpected disconnects stay network errors without retry", async () => {
  let cancelled = 0;
  const done = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(completeStream()));
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  });
  assert.equal((await done.complete([], options)).content, "最终结果");
  assert.equal(cancelled, 1);
  let requests = 0;
  const failed = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: async () => {
      requests++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                event(chunk({ content: "partial private output" })),
              ),
            );
          },
          pull(controller) {
            controller.error(new Error("private connection failure"));
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  await assert.rejects(failed.complete([], options), {
    code: "PROVIDER_NETWORK_ERROR",
  });
  assert.equal(requests, 1);
});

test("missing streaming usage retains the full shared reservation and cannot be treated as free", async () => {
  let requests = 0;
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "mock",
    fetch: async () => {
      requests++;
      return streamResponse(completeStream({}));
    },
  });
  const runtime = createModelRuntime({ adapter, userDailyTokens: 150 });
  await assert.rejects(
    runtime.run("a", "first", [], (content) => content, options),
    { code: "UNKNOWN_USAGE" },
  );
  await assert.rejects(
    runtime.run("a", "second", [], (content) => content, options),
    { code: "BUDGET_EXHAUSTED" },
  );
  assert.equal(requests, 1);
});

test("many valid small thinking events may exceed 512 KiB without accumulating reasoning", async () => {
  const reasoning = event(chunk({ reasoning_content: "推理片段".repeat(20) }));
  const raw = reasoning.repeat(4000) + completeStream();
  assert.ok(encoder.encode(raw).byteLength > 524288);
  const reply = await adapterFor(raw).complete([], options);
  assert.equal(reply.content, "最终结果");
  assert.equal(reply.outputTokens, 80);
  assert.doesNotMatch(JSON.stringify(reply), /推理片段/);
});

test("single SSE events and unfinished lines cannot exceed 64 KiB", async () => {
  for (const raw of [
    event(chunk({ reasoning_content: "a".repeat(65536) })),
    "data: " + "a".repeat(65536),
    ("data: " + "a".repeat(1000) + "\n").repeat(66),
  ]) {
    await assert.rejects(adapterFor(raw).complete([], options), {
      code: "RESPONSE_TOO_LARGE",
    });
  }
});

test("final content has its own 128 KiB UTF-8 limit independent of thinking/frame allowance", async () => {
  const segment = "中".repeat(10000);
  const raw = event(chunk({ content: segment })).repeat(4);
  const reply = await adapterFor(
    raw +
      event(chunk({ content: "完成" }, "stop", { usage })) +
      "data: [DONE]\n\n",
  ).complete([], options);
  assert.equal(reply.content, segment.repeat(4) + "完成");
  await assert.rejects(
    adapterFor(
      raw + event(chunk({ content: segment })) + completeStream(),
    ).complete([], options),
    { code: "RESPONSE_TOO_LARGE" },
  );
});
