import test from "node:test";
import assert from "node:assert/strict";
import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import { createResearchReportModule } from "../../server/explanation/research.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import {
  createDeepSeekAdapter,
  ModelError,
} from "../../server/explanation/deepseek.ts";
import type {
  ModelAdapter,
  ModelMessage,
  ModelRequestOptions,
} from "../../server/explanation/deepseek.ts";
import { createWebAnswerModule } from "../../server/explanation/web.ts";
import type { WebReader } from "../../server/explanation/web.ts";

const now = () => Date.parse("2026-09-27T10:00:00Z");
const quote =
  "示例研究大学法学专业招生目录列出法学理论研究方向，具体条件以招生简章为准。";
function fixture() {
  return generateGuidance({
    subjectId: "student",
    guidanceRunId: "run-one",
    generatedAt: new Date(now()).toISOString(),
    profile: {
      ...blankProfile(),
      name: "不应外发的姓名",
      university: "不应外发的本科院校",
      major: "法学",
      targetMajor: "法学",
      notes: "私密补充信息",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "0301",
    excludedMajorIds: [],
    assessments: [
      {
        assessmentAttemptId: "a1",
        diagnosisVersion: "d1",
        example: false,
        usableForRecommendation: true,
        modules: [
          {
            module: "english",
            correct: 2,
            incorrect: 2,
            unanswered: 1,
            total: 5,
          },
        ],
        weakPoints: ["阅读理解"],
        limitations: ["仅用于知识点诊断"],
      },
    ],
  });
}
function reportBody() {
  return {
    summary: "建议把该方向作为进一步核验的候选，先比较研究内容与备考条件。",
    facts: [{ text: quote, citations: ["research-1"] }],
    recommendations: [
      {
        institutionName: "示例研究大学",
        disciplineCode: "0301",
        rationale:
          "结合你已填写的法学基础，可以先比较研究内容是否符合兴趣；这属于准备方向的推断。",
        preparation: ["针对阅读理解安排练习", "核对招生简章与考试范围"],
        uncertainties: ["报考条件和当年招生安排仍需核验"],
        citations: ["research-1"],
      },
    ],
    limitations: ["本次资料范围有限"],
  };
}
function mockReader(
  options: {
    domain?: string;
    noResults?: boolean;
    failPage?: boolean;
    year?: string;
    content?: string;
  } = {},
  events: Array<{ url: string; options: Parameters<WebReader>[1] }> = [],
): WebReader {
  return async (url, requestOptions) => {
    events.push({ url, options: requestOptions });
    if (new URL(url).hostname === "api.search.brave.com")
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: options.noResults
              ? []
              : [
                  {
                    url: `https://${options.domain ?? "yz.example.edu.cn"}/law`,
                    title: `示例研究大学${options.year ?? "2027"}年法学招生目录`,
                    description: options.content ?? quote,
                  },
                ],
          },
        }),
      };
    if (options.failPage) throw new ModelError("WEB_ADDRESS_BLOCKED");
    return {
      contentType: "text/html",
      text: `<html><title>${options.year ?? "2027"}年招生目录</title><script>不可信脚本</script><p>${options.content ?? quote}</p></html>`,
    };
  };
}
function setup(
  settings: {
    body?: unknown;
    reader?: WebReader;
    model?: ModelAdapter;
    userDailyTokens?: number;
  } = {},
) {
  const calls: { messages: ModelMessage[]; options?: ModelRequestOptions }[] =
    [];
  const adapter = settings.model ?? {
    async complete(messages: ModelMessage[], options?: ModelRequestOptions) {
      calls.push({ messages, options });
      return {
        content: JSON.stringify(settings.body ?? reportBody()),
        inputTokens: 150,
        outputTokens: 500,
        model: "deepseek-v4-pro",
      };
    },
  };
  const config = {
    enabled: true,
    apiKey: "server-model-placeholder",
    searchEnabled: true,
    searchKey: "server-search-placeholder",
    adapter,
    reader: settings.reader ?? mockReader(),
    now,
    userDailyTokens: settings.userDailyTokens ?? 60000,
    globalDailyTokens: 200000,
  };
  const runtime = createModelRuntime(config);
  const web = createWebAnswerModule({ ...config, runtime });
  return {
    module: createResearchReportModule(config, { runtime, web }),
    calls,
    runtime,
    web,
    config,
  };
}

test("historical, undated, sample and suspended admissions cannot become final recommendations or current eligibility facts", async () => {
  const eligibility = "示例研究大学法学专业接受跨专业考生报名。";
  for (const source of [
    { year: "2022", content: eligibility },
    { year: "", content: eligibility },
    { year: "2027", content: `${eligibility}本页为示例数据，不代表实际招生。` },
    { year: "2027", content: `${eligibility}本页为测试资料。` },
    { year: "2027", content: `${eligibility}示例说明：用于讲解。` },
    { year: "2027", content: `${eligibility}测试说明：用于验证。` },
    { year: "2027", content: `${eligibility}本专业暂停招生。` },
    { year: "2027", content: `${eligibility}本专业不招生。` },
  ]) {
    const body = reportBody();
    body.facts = [{ text: eligibility, citations: ["research-1"] }];
    const { module } = setup({ body, reader: mockReader(source) });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "partial", JSON.stringify(source));
    assert.deepEqual(report.recommendations, []);
    assert.deepEqual(report.facts, []);
    assert.ok(report.sources[0].excerpt.includes(eligibility));
    assert.match(report.limitations.join(" "), /目标年度|示例|暂停|不招生/);
  }
});

test("a current search title or copyright year cannot make historical or undated school body current", async () => {
  for (const page of [
    `2022年法学招生目录 ${quote}`,
    `Copyright 2027 版权所有 招生政策 ${quote}`,
    `招生目录 ${quote}`,
  ]) {
    const searchReader = mockReader();
    const reader: WebReader = async (url, options) =>
      new URL(url).hostname === "api.search.brave.com"
        ? searchReader(url, options)
        : { contentType: "text/html", text: `<p>${page}</p>` };
    const { module } = setup({ reader });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "partial", page);
    assert.equal(report.reason, "ADMISSION_EVIDENCE_NOT_APPLICABLE");
    assert.deepEqual(report.facts, []);
    assert.deepEqual(report.recommendations, []);
    assert.equal(report.sources.length, 1);
  }
});

test("one current school page cannot qualify a second recommendation supported only by historical evidence", async () => {
  const otherQuote = quote.replaceAll("示例研究大学", "另一研究大学");
  const reader: WebReader = async (url) => {
    if (new URL(url).hostname === "api.search.brave.com")
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: [
              {
                url: "https://yz.example.edu.cn/current",
                title: "示例研究大学2027年法学招生目录",
                description: quote,
              },
              {
                url: "https://yz.other.edu.cn/historical",
                title: "另一研究大学2022年法学招生目录",
                description: otherQuote,
              },
            ],
          },
        }),
      };
    return {
      contentType: "text/html",
      text: url.endsWith("/current")
        ? `2027年招生目录 ${quote}`
        : `2022年招生目录 ${otherQuote}`,
    };
  };
  const body = reportBody();
  body.facts.push({ text: otherQuote, citations: ["research-2"] });
  body.recommendations.push({
    ...body.recommendations[0],
    institutionName: "另一研究大学",
    citations: ["research-2"],
  });
  const { module } = setup({ reader, body });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(report.status, "partial");
  assert.equal(report.reason, "ADMISSION_EVIDENCE_NOT_APPLICABLE");
  assert.deepEqual(report.facts, reportBody().facts);
  assert.deepEqual(report.recommendations, reportBody().recommendations);
  assert.equal(report.sources.length, 2);
  assert.match(report.summary, /已移除/);
});

test("negative admission disclaimers are allowed while guarantees and probabilities remain blocked", async () => {
  for (const limitation of ["无法预测录取概率", "不保证录取", "不能承诺保录"]) {
    const body = { ...reportBody(), limitations: [limitation] };
    const { module } = setup({ body });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "completed", limitation);
    assert.ok(report.limitations.includes(limitation));
  }
  for (const summary of [
    "保证录取",
    "录取概率很高",
    "即使不保证录取，录取概率也有90%",
    "并非不保证录取",
    "不能不保证录取",
  ]) {
    const { module } = setup({ body: { ...reportBody(), summary } });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "partial", summary);
    assert.equal(report.reason, "UNSUPPORTED_RESEARCH_CLAIM");
  }
});

test("readiness is local, missing providers block without a fake research report or paid request", async () => {
  let requests = 0;
  const module = createResearchReportModule({
    reader: async () => {
      requests++;
      throw new Error("unexpected");
    },
  });
  assert.deepEqual(module.getReadiness(), {
    ready: false,
    reasons: [
      "MODEL_DISABLED",
      "MODEL_NOT_CONFIGURED",
      "SEARCH_DISABLED",
      "SEARCH_NOT_CONFIGURED",
    ],
    model: { name: "deepseek-v4-pro", thinking: true, effort: "high" },
  });
  const stages: string[] = [];
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
    onProgress: (stage) => {
      stages.push(stage);
    },
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.searched, false);
  assert.equal(requests, 0);
  assert.deepEqual(stages, ["preparing"]);
});

test("real evidence pipeline reads bounded school pages, sends minimal profile and diagnostics, and writes grounded advice", async () => {
  const events: Array<{ url: string; options: Parameters<WebReader>[1] }> = [];
  const { module, calls } = setup({ reader: mockReader({}, events) });
  const stages: string[] = [];
  const run = fixture();
  const report = await module.generate({
    subjectId: "student",
    run,
    onProgress: async (stage) => {
      stages.push(stage);
    },
  });
  assert.equal(report.status, "completed");
  assert.equal(report.searched, true);
  assert.equal(report.sources[0].kind, "official_page");
  assert.equal(report.sources[0].verified, false);
  assert.equal(report.sources[0].retrievedAt, new Date(now()).toISOString());
  assert.deepEqual(report.facts, reportBody().facts);
  assert.equal(report.recommendations[0].institutionName, "示例研究大学");
  assert.deepEqual(
    [...new Set(stages)],
    ["preparing", "researching", "analyzing", "writing"],
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, {
    model: "deepseek-v4-pro",
    thinking: true,
    reasoningEffort: "high",
    timeoutMs: 120000,
    maxOutputTokens: 12000,
    format: "json",
  });
  const sent = JSON.stringify(calls[0].messages);
  assert.ok(sent.includes("阅读理解"));
  assert.ok(sent.includes("私密补充信息"));
  for (const secret of [
    "不应外发的姓名",
    "不应外发的本科院校",
    "server-model-placeholder",
    "server-search-placeholder",
  ])
    assert.equal(sent.includes(secret), false);
  assert.equal(events.length, 2);
  assert.ok(new URL(events[0].url).searchParams.get("q")!.includes("0301"));
  assert.equal(
    events.some((event) =>
      event.url.includes(encodeURIComponent("私密补充信息")),
    ),
    false,
  );
  assert.equal(
    events[0].options.headers?.["X-Subscription-Token"],
    "server-search-placeholder",
  );
  assert.equal(events[1].options.headers, undefined);
  assert.ok(events[1].options.allowedHosts.includes("yz.example.edu.cn"));
  assert.equal(events[1].options.maxBytes, 512000);
  assert.equal(events[1].options.timeoutMs, 8000);
  assert.equal(run.inputSnapshot.confirmedMajorId, "0301");
});

test("search snippets and failed official page retrieval remain partial; no external evidence remains blocked", async () => {
  for (const reader of [
    mockReader({ domain: "school-info.test" }),
    mockReader({ failPage: true }),
  ]) {
    const { module } = setup({ reader });
    const result = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(result.status, "partial");
    assert.equal(result.reason, "SEARCH_SNIPPETS_ONLY");
    assert.equal(result.sources[0].kind, "search_snippet");
    assert.ok(
      result.limitations.some((value) => value.includes("仅取得搜索摘要")),
    );
  }
  const { module, calls } = setup({ reader: mockReader({ noResults: true }) });
  const stages: string[] = [];
  assert.equal(
    (
      await module.generate({
        subjectId: "student",
        run: fixture(),
        onProgress: (stage) => {
          stages.push(stage);
        },
      })
    ).status,
    "blocked",
  );
  assert.equal(calls.length, 0);
  assert.deepEqual([...new Set(stages)], ["preparing", "researching"]);
});

test("profile notes reach only the model with a fixed length bound, while name remains omitted", async () => {
  const events: Array<{ url: string; options: Parameters<WebReader>[1] }> = [];
  const { module, calls } = setup({ reader: mockReader({}, events) });
  const run = fixture();
  const prefix = "只在模型分析中使用的补充约束";
  run.inputSnapshot.profile.notes =
    prefix + "备考安排".repeat(1000) + "超限尾部";
  await module.generate({ subjectId: "student", run });
  const evidence = JSON.parse(calls[0].messages[1].content);
  assert.equal(evidence.context.profile.notes.length, 3000);
  assert.ok(evidence.context.profile.notes.startsWith(prefix));
  assert.equal(evidence.context.profile.notes.includes("超限尾部"), false);
  assert.equal(evidence.context.profile.name, undefined);
  for (const event of events)
    assert.equal(decodeURIComponent(event.url).includes(prefix), false);
});

test("invented facts, institutions, discipline codes, citations, URLs and quantitative claims never enter research recommendations", async () => {
  const forged = [
    {
      ...reportBody(),
      facts: [{ text: "学校承诺全部录取。", citations: ["research-1"] }],
    },
    {
      ...reportBody(),
      recommendations: [
        { ...reportBody().recommendations[0], institutionName: "不存在大学" },
      ],
    },
    {
      ...reportBody(),
      recommendations: [
        { ...reportBody().recommendations[0], disciplineCode: "0812" },
      ],
    },
    {
      ...reportBody(),
      recommendations: [
        { ...reportBody().recommendations[0], citations: ["invented"] },
      ],
    },
    { ...reportBody(), summary: "官网 https://invented.example/" },
    { ...reportBody(), summary: "学费9000元，录取概率90%。" },
    { ...reportBody(), summary: "该项目学费九千元。" },
    { ...reportBody(), summary: "你已符合报考条件，可直接报考。" },
    {
      ...reportBody(),
      recommendations: [
        { ...reportBody().recommendations[0], institutionName: "法学" },
      ],
    },
    {
      ...reportBody(),
      recommendations: [
        {
          ...reportBody().recommendations[0],
          rationale: "也可以报考不存在大学。",
        },
      ],
    },
  ];
  for (const body of forged) {
    const { module } = setup({ body });
    const result = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(result.status, "partial");
    assert.deepEqual(result.recommendations, []);
    assert.deepEqual(result.facts, []);
    assert.equal(result.summary.includes("不存在大学"), false);
  }
});

test("public admission platforms do not masquerade as retrieved school pages", async () => {
  const { module } = setup({
    reader: mockReader({ domain: "yz.chsi.com.cn" }),
  });
  const result = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(result.sources[0].kind, "official_page");
  assert.equal(result.status, "partial");
  assert.ok(
    result.limitations.some((value) => value.includes("尚未读取学校官网正文")),
  );
});

test("multiple research directions share bounded retrieval fairly without unlimited searches or page reads", async () => {
  let searches = 0,
    pages = 0;
  const reader: WebReader = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "api.search.brave.com") {
      searches++;
      const code = /\b(0301|0351|1001)\b/.exec(
        parsed.searchParams.get("q")!,
      )![1];
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: Array.from({ length: 5 }, (_, i) => ({
              url: `https://r${code}-${i}.edu.cn/notice`,
              title: `示例研究大学 ${code} 目录`,
              description: `${quote} 目录代码${code}`,
            })),
          },
        }),
      };
    }
    pages++;
    return { contentType: "text/html", text: `<p>${quote}</p>` };
  };
  const { module } = setup({ reader });
  const run = fixture();
  run.inputSnapshot.confirmedMajorId = null;
  run.highlightedIds = ["0301", "0351", "1001"];
  const report = await module.generate({ subjectId: "student", run });
  assert.equal(searches, 3);
  assert.equal(pages, 2);
  assert.equal(report.sources.length, 6);
  for (const code of run.highlightedIds)
    assert.ok(report.sources.some((source) => source.url.includes(code)));
});

test("no focus is invented and academic host access can be disabled by the server", async () => {
  const { config, calls } = setup();
  const module = createResearchReportModule({
    ...config,
    allowAcademicHosts: false,
  });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(report.status, "partial");
  assert.equal(report.sources[0].kind, "search_snippet");
  const empty = fixture();
  empty.inputSnapshot.confirmedMajorId = null;
  empty.highlightedIds = [];
  const before = calls.length;
  assert.equal(
    (await module.generate({ subjectId: "student", run: empty })).reason,
    "RESEARCH_FOCUS_REQUIRED",
  );
  assert.equal(calls.length, before);
});

test("progress checks are awaited and cancellation errors cannot be swallowed as model fallback", async () => {
  for (const stop of ["analyzing", "writing"]) {
    const { module, calls } = setup();
    const cancelled = new Error("session or guidance changed");
    await assert.rejects(
      module.generate({
        subjectId: "student",
        run: fixture(),
        onProgress: async (stage) => {
          if (stage === stop) throw cancelled;
        },
      }),
      (error) => error === cancelled,
    );
    assert.equal(calls.length, stop === "analyzing" ? 0 : 1);
  }
});

test("deletion during retrieval or model thinking prevents both delivery and cached private fallbacks", async () => {
  for (const phase of ["retrieval", "model"]) {
    let started!: () => void, finish!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reader = mockReader();
    const { module } = setup({
      reader: async (url, options) => {
        if (phase === "retrieval") {
          started();
          await pending;
        }
        return reader(url, options);
      },
      model: {
        async complete() {
          if (phase === "model") {
            started();
            await pending;
          }
          return {
            content: JSON.stringify(reportBody()),
            inputTokens: 1,
            outputTokens: 1,
            model: "deepseek-v4-pro",
          };
        },
      },
    });
    const result = module.generate({ subjectId: "student", run: fixture() });
    await startedPromise;
    module.clearSubject("student");
    finish();
    await assert.rejects(
      result,
      (error) => (error as { code?: string }).code === "DATA_DELETED",
    );
  }
});

test("research shares token and search limits with ordinary tasks and cannot exceed reservations", async () => {
  const { config, runtime, calls } = setup({ userDailyTokens: 10 });
  const limited = createResearchReportModule(config, { runtime });
  const result = await limited.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(result.reason, "BUDGET_EXHAUSTED");
  assert.equal(calls.length, 0);
  const normal = setup();
  const web = createWebAnswerModule({
    ...normal.config,
    searchDailyRequestsPerUser: 1,
  });
  await web.answer(
    { subjectId: "student", question: "先前搜索", search: true },
    { sourcesOnly: true },
  );
  const report = await createResearchReportModule(normal.config, {
    runtime: normal.runtime,
    web,
  }).generate({ subjectId: "student", run: fixture() });
  assert.equal(report.status, "blocked");
  assert.ok(
    report.limitations.some((value) =>
      value.includes("今日网页搜索次数已用完"),
    ),
  );
  assert.equal(
    report.limitations.join(" ").includes("SEARCH_BUDGET_EXHAUSTED"),
    false,
  );
  assert.equal(normal.calls.length, 0);
});

test("DeepSeek research uses official pro thinking controls, counts total completion usage, and never exposes reasoning", async () => {
  let payload: Record<string, unknown> | undefined;
  const adapter = createDeepSeekAdapter({
    enabled: true,
    apiKey: "test-key",
    fetch: async (_url, init) => {
      payload = JSON.parse(String(init!.body));
      assert.equal(init?.redirect, "error");
      return Response.json({
        model: "deepseek-v4-pro",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "{}",
              reasoning_content: "private internal reasoning",
            },
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 1500,
          completion_tokens_details: { reasoning_tokens: 1400 },
        },
      });
    },
  });
  const reply = await adapter.complete(
    [{ role: "user", content: "Return JSON" }],
    {
      model: "deepseek-v4-pro",
      thinking: true,
      reasoningEffort: "high",
      maxOutputTokens: 12000,
      timeoutMs: 120000,
    },
  );
  assert.equal(payload?.model, "deepseek-v4-pro");
  assert.deepEqual(payload?.thinking, { type: "enabled" });
  assert.equal(payload?.reasoning_effort, "high");
  assert.equal(payload?.max_tokens, 12000);
  assert.equal(payload?.tools, undefined);
  assert.equal(reply.outputTokens, 1500);
  assert.equal(
    JSON.stringify(reply).includes("private internal reasoning"),
    false,
  );
  for (const options of [
    { maxOutputTokens: Number.NaN },
    { maxOutputTokens: -1 },
    { maxOutputTokens: 20000 },
    { timeoutMs: 120001 },
    { model: "untrusted" },
  ])
    await assert.rejects(
      adapter.complete([], options as ModelRequestOptions),
      (error) => (error as ModelError).code === "INVALID_MODEL_OPTIONS",
    );
});
