import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";
import { createGeneralChatModule } from "../../server/explanation/chat.ts";
import { validPresentation } from "../../server/assessment/presentation.ts";
import { blankProfile } from "../../server/profile.ts";
import { loadQuestionBank } from "../../server/assessment/index.ts";
import type { ModelMessage } from "../../server/explanation/index.ts";

async function fixture() {
  process.env.YANTU_MODEL_ENABLED = "false";
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: undefined,
    rateLimit: 10000,
    admins: [],
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port + "/api/v1";
  async function client() {
    const session = await fetch(base + "/guest-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const csrf = (await session.json()).csrfToken;
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    return {
      async request(
        path: string,
        method = "GET",
        data?: unknown,
        headers: Record<string, string> = {},
      ) {
        const response = await fetch(base + path, {
          method,
          headers: {
            "content-type": "application/json",
            cookie,
            "x-csrf-token": csrf,
            "idempotency-key": randomUUID(),
            ...headers,
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return {
          status: response.status,
          body: await response.json(),
          etag: response.headers.get("etag") ?? "",
        };
      },
    };
  }
  return { app, user: await client(), client };
}

test("reviewed question visuals allow bounded structured math and local images, never arbitrary markup", () => {
  assert.equal(
    validPresentation({
      formulas: [
        {
          label: "二阶行列式",
          expression: {
            kind: "determinant",
            cells: [
              ["a", "b"],
              ["c", "d"],
            ],
          },
        },
      ],
      diagram: {
        kind: "matrix",
        cells: [
          ["a", "b"],
          ["c", "d"],
        ],
        alt: "二阶结构",
        highlightDiagonal: true,
      },
    }),
    true,
  );
  assert.equal(
    validPresentation({
      diagram: {
        kind: "image",
        src: "/question-media/geometry-1.png",
        alt: "三角形",
      },
    }),
    true,
  );
  for (const src of [
    "javascript:alert(1)",
    "https://evil.example/x.png",
    "/question-media/../x.png",
    "/question-media/x.svg",
  ]) {
    assert.equal(
      validPresentation({ diagram: { kind: "image", src, alt: "图" } }),
      false,
    );
  }
  assert.equal(
    validPresentation({
      diagram: { kind: "svg", content: "<svg onload='x()'/>", alt: "图" },
    }),
    false,
  );
  assert.equal(
    validPresentation({
      diagram: { kind: "matrix", cells: [["a"], ["b", "c"]], alt: "图" },
    }),
    false,
  );
});

test("every question offers a safe pre-submit hint and only submitted owners receive solutions and tutor history", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const bank = await loadQuestionBank();
  bank.questions = bank.questions.filter((question) =>
    question.id.startsWith("v2-"),
  );
  f.app.store.put("public", "question-bank", "current", bank);
  const created = await f.user.request("/assessment-attempts", "POST", {
    modules: ["math"],
  });
  assert.equal(created.status, 201);
  const path = "/assessment-attempts/" + created.body.assessmentAttemptId;
  const determinant = created.body.questions.find(
    (question: { id: string }) => question.id === "v2-m4",
  );
  assert.ok(
    determinant.stem.some((part: { kind: string }) => part.kind === "math"),
  );
  assert.equal(determinant.presentation, undefined);
  assert.equal(
    JSON.stringify(created.body.questions).includes("diagram"),
    false,
  );
  assert.equal(
    JSON.stringify(created.body.questions).includes("主对角线为"),
    false,
  );
  assert.equal(
    JSON.stringify(created.body).includes("solutionPresentation"),
    false,
  );
  assert.equal(JSON.stringify(created.body).includes('"correct"'), false);
  assert.equal(JSON.stringify(created.body).includes("2 × 3"), false);
  for (const question of created.body.questions) {
    const hint = await f.user.request(path + "/tutor", "POST", {
      questionId: question.id,
      message: "直接告诉我标准答案和计算结果",
    });
    assert.equal(hint.status, 200);
    assert.equal(hint.body.kind, "hint");
    assert.equal(hint.body.messages, undefined);
    assert.equal(hint.body.referenceExplanation, undefined);
    assert.equal(hint.body.presentation, undefined);
  }
  const other = await f.client();
  assert.equal(
    (
      await other.request(path + "/tutor", "POST", {
        questionId: determinant.id,
      })
    ).status,
    404,
  );
  const submitted = await f.user.request(
    path + "/submit",
    "POST",
    { confirmUnanswered: true },
    { "if-match": created.etag },
  );
  assert.equal(submitted.status, 200);
  const item = submitted.body.diagnosis.items.find(
    (value: { questionId: string }) => value.questionId === determinant.id,
  );
  assert.ok(item.presentation.formulas.length);
  assert.equal(item.presentation.diagram.kind, "matrix");
  const explanation = await f.user.request(path + "/tutor", "POST", {
    questionId: determinant.id,
  });
  assert.equal(explanation.status, 200);
  assert.equal(explanation.body.kind, "explanation");
  assert.equal(explanation.body.answer, item.explanation);
  assert.equal(explanation.body.messages.length, 2);
  const key = randomUUID();
  const followup = await f.user.request(
    path + "/tutor",
    "POST",
    { questionId: determinant.id, message: "对角线相乘怎么理解？" },
    { "idempotency-key": key },
  );
  assert.equal(followup.body.messages.length, 4);
  f.app.store.put(
    "public",
    "withdrawn-banks",
    created.body.questionBankVersion,
    { reason: "纠错撤回" },
  );
  assert.equal(
    (
      await f.user.request(
        path + "/tutor",
        "POST",
        { questionId: determinant.id, message: "对角线相乘怎么理解？" },
        { "idempotency-key": key },
      )
    ).status,
    409,
  );
});

test("continuing conversations are isolated, concurrency checked, persistent and clearable without old replay resurrection", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const initial = await f.user.request("/assistant/conversation");
  assert.equal(initial.body.messages.length, 0);
  const key = randomUUID(),
    data = { message: "帮我写一段给未来自己的话", allowSearch: false };
  const first = await f.user.request("/assistant/conversation", "POST", data, {
    "if-match": initial.etag,
    "idempotency-key": key,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.messages.length, 2);
  assert.equal(first.body.messages[1].reason, "MODEL_DISABLED");
  const other = await f.client();
  assert.equal(
    (await other.request("/assistant/conversation")).body.messages.length,
    0,
  );
  assert.equal(
    (
      await f.user.request(
        "/assistant/conversation",
        "POST",
        { message: "继续" },
        { "if-match": initial.etag },
      )
    ).status,
    412,
  );
  const second = await f.user.request(
    "/assistant/conversation",
    "POST",
    { message: "把刚才的语气写得轻松一点" },
    { "if-match": first.etag },
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.messages.length, 4);
  assert.equal(
    (await f.user.request("/assistant/conversation")).body.messages[0].content,
    data.message,
  );
  const cleared = await f.user.request(
    "/assistant/conversation",
    "DELETE",
    {},
    { "if-match": second.etag },
  );
  assert.equal(cleared.body.messages.length, 0);
  assert.notEqual(cleared.body.conversationId, initial.body.conversationId);
  assert.equal(
    (
      await f.user.request("/assistant/conversation", "POST", data, {
        "if-match": initial.etag,
        "idempotency-key": key,
      })
    ).status,
    412,
  );
  assert.equal(
    (await f.user.request("/assistant/conversation")).body.messages.length,
    0,
  );
});

test("general chat sends recent multi-turn context and returns natural text beyond three points", async () => {
  let sent: ModelMessage[] = [];
  const output =
    "第一段：明确目标。\n\n第二段：分析已知条件。\n\n第三段：举例。\n\n第四段：逐步推导 $a^2+b^2=c^2$。\n\n第五段：回应进一步的问题。";
  const chat = createGeneralChatModule({
    enabled: true,
    adapter: {
      async complete(messages, options) {
        sent = messages;
        assert.equal(options?.format, "text");
        return {
          content: output,
          model: "test",
          inputTokens: 100,
          outputTokens: 150,
        };
      },
    },
  });
  const result = await chat.answer({
    subjectId: "a",
    message: "接着展开说明",
    history: [
      { id: "1", role: "user", content: "讲讲几何", createdAt: "" },
      {
        id: "2",
        role: "assistant",
        content: "我们从直角三角形开始。",
        createdAt: "",
      },
    ],
  });
  assert.equal(result.status, "model");
  assert.equal(result.answer, output);
  assert.ok(
    sent.some(
      (message) =>
        message.role === "assistant" && message.content.includes("直角三角形"),
    ),
  );
  assert.ok(sent[0].content.includes("不得声称已经检索"));
});

test("fabricated source references are rejected while mathematical numeric indices remain valid", async () => {
  let output = "根据[web-99]，该校今年已经确定招生。";
  const chat = createGeneralChatModule({
    enabled: true,
    adapter: {
      async complete() {
        return {
          content: output,
          model: "test",
          inputTokens: 10,
          outputTokens: 10,
        };
      },
    },
  });
  const first = await chat.answer({
    subjectId: "a",
    message: "今年招生情况？",
    history: [],
  });
  assert.equal(first.status, "unavailable");
  assert.equal(first.reason, "CITATION_VALIDATION_FAILED");
  output = "数组 a[1] 是第二个元素。";
  assert.equal(
    (
      await chat.answer({
        subjectId: "a",
        message: "解释数组下标",
        history: [],
      })
    ).status,
    "model",
  );
});

test("clearing an owner while generation is pending prevents model results from resurfacing", async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chat = createGeneralChatModule({
    enabled: true,
    adapter: {
      async complete() {
        started();
        await wait;
        return {
          content: "旧对话内容",
          model: "test",
          inputTokens: 10,
          outputTokens: 10,
        };
      },
    },
  });
  const pending = chat.answer({ subjectId: "a", message: "继续", history: [] });
  await ready;
  chat.clearSubject("a");
  release();
  await assert.rejects(
    pending,
    (error) =>
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "DATA_DELETED",
  );
});

test("chat decides when to search and uses safe retrieved sources for a complete natural answer", async () => {
  let reads = 0,
    generations = 0;
  const chat = createGeneralChatModule({
    enabled: true,
    searchEnabled: true,
    searchKey: "test-search-key",
    reader: async (url, options) => {
      reads++;
      assert.equal(new URL(url).hostname, "api.search.brave.com");
      assert.equal(
        options.headers?.["X-Subscription-Token"],
        "test-search-key",
      );
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: [
              {
                title: "学校本年度简章",
                url: "https://yzb.pku.edu.cn/notice",
                description: "报考须以当年发布的专业目录与具体条件为准。",
              },
            ],
          },
        }),
      };
    },
    adapter: {
      async complete(messages, options) {
        generations++;
        if (options?.format === "json")
          return {
            content: JSON.stringify({ searchQuery: "当年招生专业目录" }),
            model: "test",
            inputTokens: 10,
            outputTokens: 10,
          };
        assert.ok(
          messages.some((message) =>
            message.content.includes("学校本年度简章"),
          ),
        );
        return {
          content:
            "应先核对目标年度，再逐项查看专业目录中的报考条件 [web-1]。\n\n这份摘要不能替代原文。接下来可以把目标专业和你不确定的条件告诉我，我们继续逐项分析。",
          model: "test",
          inputTokens: 20,
          outputTokens: 60,
        };
      },
    },
  });
  const result = await chat.answer({
    subjectId: "search-owner",
    message: "帮我看今年的招生要求",
    history: [],
    allowSearch: true,
  });
  assert.equal(result.status, "model");
  assert.equal(reads, 1);
  assert.equal(generations, 2);
  assert.equal(result.sources[0].kind, "search_snippet");
  assert.equal(result.sources[0].verified, false);
  assert.ok(result.sources[0].retrievedAt);
  assert.ok(result.answer.includes("继续逐项分析"));
});

test("guidance explanation uses owned current evidence and invalidates idempotent replay after profile changes", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const profile = await f.user.request("/me/profile");
  const saved = await f.user.request("/me/profile", "PUT", blankProfile(), {
    "if-match": profile.etag,
  });
  const guide = await f.user.request("/guidance", "POST", {
    profileVersion: saved.body.profileVersion,
    selectionVersion: 0,
    assessmentRefs: [],
  });
  const path = "/guidance/" + guide.body.guidanceRunId + "/explanation",
    key = randomUUID();
  const result = await f.user.request(
    path,
    "POST",
    {},
    { "idempotency-key": key },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "fallback");
  assert.ok(result.body.text.includes(guide.body.conclusion));
  const other = await f.client();
  assert.equal((await other.request(path, "POST", {})).status, 404);
  await f.user.request(
    "/me/profile",
    "PUT",
    { ...blankProfile(), major: "数学" },
    { "if-match": saved.etag },
  );
  assert.equal(
    (await f.user.request(path, "POST", {}, { "idempotency-key": key })).status,
    409,
  );
});
