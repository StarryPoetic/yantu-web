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
      university: "本科教育背景大学",
      major: "法学",
      targetMajor: "法学",
      studyGoal: "专业实践与行业就业",
      cities: ["上海", "杭州"],
      budget: "1 万元以内",
      hours: "每天2至4小时",
      crossMajor: "接受跨专业",
      notes: "私密补充信息",
      priorities: { ...blankProfile().priorities, 就业机会: 90, 专业兴趣: 85 },
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "0301",
    excludedMajorIds: [],
    assessments: [
      {
        assessmentAttemptId: "a1",
        diagnosisVersion: "d1",
        example: true,
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
function fitReasons() {
  return [
    {
      profileField: "studyGoal",
      profileValue: "专业实践与行业就业",
      reason:
        "结合你的实践就业目标，可优先比较课程中的案例与实践训练，这属于准备方向的推断。",
    },
    {
      profileField: "budget",
      profileValue: "1 万元以内",
      reason: "学费是否超出你的1万元预算仍待核实，需要核对费用与资助后取舍。",
    },
  ];
}
function planBody(codes = ["0301"]) {
  return {
    directions: codes.map((disciplineCode) => ({
      disciplineCode,
      rationale:
        "综合职业目标、学习兴趣与准备约束规划，并非按本科专业固定匹配。",
      fitReasons: fitReasons(),
    })),
    followUpQuestions: [],
  };
}
function reportBody() {
  return {
    summary:
      "建议优先比较该学校专业的研究内容与实践训练，以下是结合本人约束的准备建议。",
    facts: [{ text: quote, citations: ["research-1"] }],
    recommendations: [
      {
        institutionName: "示例研究大学",
        programName: "法学理论",
        disciplineCode: "0301",
        rationale:
          "结合你的职业目标，可以比较法律理论训练如何服务实践；这属于基于资料的推断。",
        fitReasons: fitReasons(),
        tradeoffs: ["需要补足研究方法基础，且费用条件仍待核对。"],
        preparation: ["针对阅读理解安排练习", "核对培养方案与考试范围"],
        uncertainties: ["具体报名条件仍需核验"],
        citations: ["research-1"],
      },
    ],
    limitations: ["本次资料范围有限"],
  };
}
type ReaderOptions = {
  year?: string;
  content?: string;
  domain?: string;
  noResults?: boolean;
  failPage?: boolean;
};
type WebEvent = { url: string; options: Parameters<WebReader>[1] };
function mockReader(
  options: ReaderOptions = {},
  events: WebEvent[] = [],
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
                    title: `示例研究大学${options.year ?? "2027"}年法学硕士招生目录`,
                    description: options.content ?? quote,
                  },
                ],
          },
        }),
      };
    if (options.failPage) throw new ModelError("WEB_ADDRESS_BLOCKED");
    return {
      contentType: "text/html",
      text: `<html><title>${options.year ?? "2027"}年硕士招生目录</title><script>不可信脚本</script><p>${options.content ?? quote}</p></html>`,
    };
  };
}
function setup(
  settings: {
    body?: unknown;
    plan?: unknown;
    reader?: WebReader;
    model?: ModelAdapter;
    planningModel?: ModelAdapter;
    userDailyTokens?: number;
  } = {},
) {
  const calls: { messages: ModelMessage[]; options?: ModelRequestOptions }[] =
    [];
  const planningCalls: typeof calls = [];
  const adapter: ModelAdapter = {
    async complete(messages, options) {
      const planning = messages[0].content.includes(
        "research-direction-plan-v4",
      );
      (planning ? planningCalls : calls).push({ messages, options });
      const custom = planning ? settings.planningModel : settings.model;
      if (custom) return custom.complete(messages, options);
      return {
        content: JSON.stringify(
          planning
            ? (settings.plan ?? planBody())
            : (settings.body ?? reportBody()),
        ),
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
    userDailyTokens: settings.userDailyTokens ?? 100000,
    globalDailyTokens: 500000,
  };
  const runtime = createModelRuntime(config);
  const web = createWebAnswerModule({ ...config, runtime });
  return {
    module: createResearchReportModule(config, { runtime, web }),
    calls,
    planningCalls,
    runtime,
    web,
    config,
  };
}

test("readiness remains local and missing providers cannot masquerade as completed research", async () => {
  let calls = 0;
  const module = createResearchReportModule({
    reader: async () => {
      calls++;
      throw Error("unexpected");
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
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(report.status, "blocked");
  assert.equal(calls, 0);
  assert.equal(report.searched, false);
});

test("two-stage research receives all 184 disciplines and full relevant profile, and returns concrete grounded school programs", async () => {
  const events: WebEvent[] = [];
  const { module, calls, planningCalls } = setup({
    reader: mockReader({}, events),
  });
  const stages: string[] = [];
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
    onProgress: (stage) => {
      stages.push(stage);
    },
  });
  assert.equal(report.status, "completed");
  assert.equal(report.reportVersion, "profile-research-v4");
  assert.equal(report.recommendations[0].programName, "法学理论");
  assert.equal(report.recommendations[0].degreeType, "academic");
  assert.equal(report.recommendations[0].admissionStatus, "current_evidence");
  assert.equal(report.recommendations[0].fitReasons!.length, 2);
  assert.deepEqual(report.facts, reportBody().facts);
  assert.equal(planningCalls.length, 1);
  assert.equal(calls.length, 1);
  assert.ok(
    events
      .filter((event) => new URL(event.url).hostname !== "api.search.brave.com")
      .every((event) => event.options.allowPdf === true),
  );
  const planning = JSON.parse(planningCalls[0].messages[1].content);
  assert.equal(planning.catalog.length, 184);
  assert.equal(planning.context.profile.priorities["就业机会"], 90);
  assert.equal(planning.context.profile.university, "本科教育背景大学");
  for (const request of [...planningCalls, ...calls]) {
    assert.equal(request.options?.model, "deepseek-v4-pro");
    const sent = JSON.stringify(request.messages);
    assert.ok(sent.includes("阅读理解"));
    assert.ok(sent.includes("私密补充信息"));
    for (const secret of [
      "不应外发的姓名",
      "server-model-placeholder",
      "server-search-placeholder",
    ])
      assert.equal(sent.includes(secret), false);
    assert.ok(sent.length < 24000);
  }
  assert.equal(planningCalls[0].options?.thinking, false);
  assert.equal(planningCalls[0].options?.maxOutputTokens, 4096);
  assert.equal(planningCalls[0].options?.timeoutMs, 30000);
  assert.equal(calls[0].options?.thinking, true);
  assert.equal(calls[0].options?.maxOutputTokens, 12000);
  assert.equal(calls[0].options?.reasoningEffort, "high");
  const queries = events
    .filter((event) => new URL(event.url).hostname === "api.search.brave.com")
    .map((event) => new URL(event.url).searchParams.get("q")!);
  assert.equal(queries.length, 6);
  assert.equal(queries[0], "上海 法学 硕士");
  assert.equal(queries[0].includes("2027"), false);
  assert.match(queries[1], /法学 硕士 培养 招生.*site:example\.edu\.cn/);
  assert.equal(queries[1].includes("2027"), false);
  assert.ok(
    events
      .filter((event) => new URL(event.url).hostname === "api.search.brave.com")
      .every((event) => new URL(event.url).searchParams.get("count") === "10"),
  );
  assert.equal(
    queries.some(
      (q) =>
        q.includes("私密") ||
        q.includes("本科教育背景") ||
        q.includes("0301") ||
        q.includes("上海 杭州"),
    ),
    false,
  );
  assert.deepEqual(
    [...new Set(stages)],
    ["preparing", "researching", "analyzing", "writing"],
  );
});

test("mechanical background and a confirmed major cannot lock planning to undergraduate or highlighted directions", async () => {
  const run = fixture();
  Object.assign(run.inputSnapshot.profile, {
    major: "机械工程",
    targetMajor: "教育",
    notes: "希望从事教育与科普活动，愿意跨专业",
  });
  run.inputSnapshot.confirmedMajorId = "0802";
  run.highlightedIds = ["0802"];
  const body = reportBody();
  body.facts = [];
  Object.assign(body.recommendations[0], {
    institutionName: "城市师范大学",
    programName: "科学与技术教育",
    disciplineCode: "0451",
    rationale:
      "结合你的教育兴趣与职业目标，可以比较科学教育实践与课程研究，这属于适合方向的推断。",
  });
  const content =
    "城市师范大学硕士专业介绍：045117 科学与技术教育，开展科普教育实践。";
  const { module, planningCalls } = setup({
    plan: planBody(["0451"]),
    body,
    reader: mockReader({ year: "2024", content }),
  });
  const report = await module.generate({ subjectId: "student", run });
  assert.equal(report.status, "completed");
  assert.equal(report.recommendations[0].disciplineCode, "0451");
  assert.equal(report.recommendations[0].programName, "科学与技术教育");
  assert.equal(report.recommendations[0].admissionStatus, "needs_verification");
  assert.equal(
    JSON.parse(planningCalls[0].messages[1].content).catalog.filter(
      (item: string[]) => item[3] === "allowed",
    ).length,
    184,
  );
  assert.equal(run.inputSnapshot.confirmedMajorId, "0802");
});

test("an undecided profile without a chosen school can repair planning once and produce concrete recommendations", async () => {
  const run = fixture();
  run.inputSnapshot.confirmedMajorId = null;
  Object.assign(run.inputSnapshot.profile, {
    targetMajor: "",
    studyGoal: "不确定，希望先探索",
    notes: "希望从事公共法律服务",
  });
  const reasons = [
    {
      profileField: "notes",
      profileValue: "希望从事公共法律服务",
      reason: "法律实践方向与你的服务兴趣相关，这是方向建议。",
    },
    {
      profileField: "priorities.就业机会",
      profileValue: 90,
      reason: "你重视就业，应进一步比较该专业的实践训练和准备投入。",
    },
  ];
  let planned = 0;
  const body = {
    ...reportBody(),
    recommendations: reportBody().recommendations.map((card) => ({
      ...card,
      fitReasons: reasons,
    })),
  };
  const { module, calls } = setup({
    body,
    planningModel: {
      async complete() {
        planned++;
        return {
          content:
            planned === 1
              ? '{"directions":false}'
              : JSON.stringify({
                  directions: [
                    {
                      disciplineCode: "0301",
                      rationale: "综合服务兴趣和就业侧重探索法律方向。",
                      fitReasons: reasons,
                      searchSchools: null,
                    },
                  ],
                }),
          inputTokens: 100,
          outputTokens: 200,
          model: "deepseek-v4-pro",
        };
      },
    },
  });
  const messages: string[] = [];
  const report = await module.generate({
    subjectId: "student",
    run,
    onProgress: (_stage, message) => {
      if (message) messages.push(message);
    },
  });
  assert.equal(planned, 2);
  assert.equal(calls.length, 1);
  assert.equal(report.recommendations[0].institutionName, "示例研究大学");
  assert.equal(report.recommendations[0].fitReasons![1].profileValue, "90");
  assert.equal(report.status, "completed");
  assert.ok(messages.some((message) => message.includes("自动修正")));
  assert.equal(report.failureStage, undefined);
});

test("rejected final citations are repaired once against the original evidence", async () => {
  let attempts = 0;
  const { module } = setup({
    model: {
      async complete() {
        attempts++;
        const body = reportBody();
        if (attempts === 1)
          body.recommendations[0].citations = ["invented-source"];
        return {
          content: JSON.stringify(body),
          inputTokens: 100,
          outputTokens: 200,
          model: "deepseek-v4-pro",
        };
      },
    },
  });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(attempts, 2);
  assert.equal(report.status, "completed");
  assert.deepEqual(report.recommendations[0].citations, ["research-1"]);
});

test("personal cross-major intent and historic pages cannot invent eligibility, named exams or employment advantages", async () => {
  const body = reportBody();
  const card = body.recommendations[0];
  card.programName = "法学理论专业学位硕士研究生";
  card.fitReasons.push({
    profileField: "crossMajor",
    profileValue: "接受跨专业",
    reason: "用户接受跨专业，可以报考法学。",
  });
  card.preparation.push(
    "数学基础薄弱，需大量时间攻克数学一",
    "需要核对是否可以报考和是否考数学一",
    "补充高等数学基础",
  );
  card.tradeoffs.push("该校就业机会较多，值得优先选择");
  const { module } = setup({ body, reader: mockReader({ year: "2024" }) });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  const kept = report.recommendations[0];
  assert.equal(kept.programName, "法学理论");
  assert.equal(kept.fitReasons!.length, 2);
  assert.equal(kept.tradeoffs!.length, 1);
  assert.ok(kept.preparation.includes("需要核对是否可以报考和是否考数学一"));
  assert.ok(kept.preparation.includes("补充高等数学基础"));
  assert.ok(!kept.preparation.some((item) => item.includes("攻克数学一")));
});

test("planning failure keeps profile intact and repair progress authorization failures cannot become reports", async () => {
  const invalid = { directions: false };
  const failed = setup({ plan: invalid });
  const run = fixture();
  const snapshot = structuredClone(run);
  const report = await failed.module.generate({ subjectId: "student", run });
  assert.equal(failed.planningCalls.length, 2);
  assert.equal(failed.calls.length, 0);
  assert.equal(report.failureStage, "preparing");
  assert.equal(report.searched, false);
  assert.equal(report.followUpQuestions, undefined);
  assert.deepEqual(run, snapshot);
  const cancelled = setup({ plan: invalid });
  const error = new Error("session revoked");
  await assert.rejects(
    cancelled.module.generate({
      subjectId: "student",
      run,
      onProgress: (_stage, message) => {
        if (message) throw error;
      },
    }),
    (failure) => failure === error,
  );
  assert.equal(cancelled.planningCalls.length, 1);
});

test("optional planner school names only guide searches and cannot establish a recommendation", async () => {
  const plan = planBody();
  Object.assign(plan.directions[0], {
    searchSchools: ["虚构候选大学", "示例研究大学"],
  });
  const events: WebEvent[] = [];
  const { module, planningCalls } = setup({
    plan,
    reader: mockReader({}, events),
  });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  const firstSearch = events.find(
    (event) => new URL(event.url).hostname === "api.search.brave.com",
  )!;
  assert.equal(
    new URL(firstSearch.url).searchParams.get("q"),
    "虚构候选大学 法学 硕士",
  );
  assert.match(planningCalls[0].messages[0].content, /searchSchools/);
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.recommendations[0].institutionName, "示例研究大学");
  assert.equal(JSON.stringify(report).includes("虚构候选大学"), false);
  for (const names of [
    ["https://invented.edu.cn"],
    ["示例研究大学 site:evil.com"],
    ["示例研究大学", "示例研究大学"],
    ["第一研究大学", "第二研究大学", "第三研究大学"],
  ]) {
    const invalid = structuredClone(plan);
    Object.assign(invalid.directions[0], { searchSchools: names });
    const testCase = setup({ plan: invalid });
    const rejected = await testCase.module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(rejected.status, "blocked");
    assert.equal(testCase.calls.length, 0);
    assert.equal(rejected.searched, false);
  }
});

test("blank defaults, undergraduate major alone and unknown preferences trigger questions before any model or search", async () => {
  for (const profile of [
    blankProfile(),
    { ...blankProfile(), major: "机械工程" },
    {
      ...blankProfile(),
      major: "机械工程",
      studyGoal: "不确定，希望先探索",
      targetMajor: "不确定",
    },
  ]) {
    const run = fixture();
    run.inputSnapshot.profile = profile as unknown as Record<string, unknown>;
    const { module, calls, planningCalls } = setup();
    const result = await module.generate({ subjectId: "student", run });
    assert.equal(result.reason, "RESEARCH_PROFILE_REQUIRED");
    assert.ok(result.followUpQuestions!.length > 0);
    assert.equal(calls.length + planningCalls.length, 0);
    assert.equal(result.searched, false);
  }
  const { module, calls } = setup({
    plan: {
      directions: [],
      followUpQuestions: ["更偏向教学实践还是课程研究？"],
    },
  });
  const result = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(result.status, "blocked");
  assert.equal(calls.length, 0);
  assert.equal(result.followUpQuestions![0], "更偏向教学实践还是课程研究？");
});

test("excluded disciplines, explicit no-cross and explicit degree constraints reject conflicting plans without fallback", async () => {
  for (const constraint of [
    "excluded",
    "no-cross",
    "degree",
    "negative-interest",
  ]) {
    const run = fixture();
    if (constraint === "excluded")
      run.inputSnapshot.excludedMajorIds = ["0451"];
    if (constraint === "no-cross")
      run.inputSnapshot.profile.crossMajor = "不接受跨专业";
    if (constraint === "degree") run.inputSnapshot.profile.notes = "只考虑学硕";
    if (constraint === "negative-interest")
      run.inputSnapshot.profile.notes = "不考虑教育方向";
    const { module, calls } = setup({ plan: planBody(["0451"]) });
    const report = await module.generate({ subjectId: "student", run });
    assert.equal(report.reason, "RESEARCH_DIRECTION_NOT_ALLOWED", constraint);
    assert.equal(report.searched, false);
    assert.equal(calls.length, 0);
  }
});

test("historical and undated school-program evidence supports tentative recommendations but not current eligibility facts", async () => {
  const eligibility = "示例研究大学法学理论专业接受跨专业考生报名。";
  for (const year of ["2022", ""]) {
    const body = reportBody();
    body.facts = [{ text: eligibility, citations: ["research-1"] }];
    const { module } = setup({
      body,
      reader: mockReader({ year, content: eligibility }),
    });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "completed");
    assert.equal(
      report.recommendations[0].admissionStatus,
      "needs_verification",
    );
    assert.match(
      report.recommendations[0].uncertainties.join(" "),
      /2027年.*资格/,
    );
    assert.deepEqual(report.facts, []);
    assert.ok(report.sources[0].excerpt.includes(eligibility));
  }
});

test("a current search title or footer year cannot upgrade an older school body to current admissions evidence", async () => {
  for (const page of [
    `2022年法学硕士招生目录 ${quote}`,
    `Copyright 2027 版权所有 硕士专业介绍 ${quote}`,
  ]) {
    const search = mockReader();
    const reader: WebReader = (url, options) =>
      new URL(url).hostname === "api.search.brave.com"
        ? search(url, options)
        : Promise.resolve({ contentType: "text/html", text: page });
    const { module } = setup({ reader });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "completed");
    assert.equal(
      report.recommendations[0].admissionStatus,
      "needs_verification",
    );
    assert.deepEqual(report.facts, []);
  }
});

test("explicit demonstration and suspended admission content cannot support school recommendations; school names containing 示例 remain valid", async () => {
  for (const marker of [
    "本页为示例数据",
    "测试说明",
    "本专业暂停招生",
    "本专业不招生",
  ]) {
    const { module } = setup({
      reader: mockReader({ content: `${quote}${marker}` }),
    });
    const result = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(result.status, "partial");
    assert.equal(result.reason, "RESEARCH_EVIDENCE_EXCLUDED");
    assert.deepEqual(result.recommendations, []);
    assert.equal(result.sources.length, 1);
  }
  const { module } = setup({
    reader: mockReader({ content: `${quote}不招收同等学力考生。` }),
  });
  assert.equal(
    (await module.generate({ subjectId: "student", run: fixture() }))
      .recommendations.length,
    1,
  );
});

test("fit reasons must cite two real distinct relevant dimensions; neutral defaults and fabricated values cannot pad a card", async () => {
  const invalidFits = [
    [{ profileField: "major", profileValue: "法学", reason: "存在学习联系" }],
    [
      { profileField: "major", profileValue: "法学", reason: "存在学习联系" },
      {
        profileField: "university",
        profileValue: "本科教育背景大学",
        reason: "自述教育背景",
      },
    ],
    [
      { profileField: "year", profileValue: "2027", reason: "目标年份" },
      fitReasons()[0],
    ],
    [{ ...fitReasons()[0], profileValue: "编造的职业目标" }, fitReasons()[1]],
    [fitReasons()[0], fitReasons()[0]],
    [
      {
        profileField: "priorities.专业兴趣",
        profileValue: "85",
        reason: "优先比较兴趣",
      },
      {
        profileField: "priorities.就业机会",
        profileValue: "90",
        reason: "优先考虑实践",
      },
    ],
  ];
  for (const fit of invalidFits) {
    const body = reportBody();
    body.recommendations[0].fitReasons = fit;
    const { module } = setup({ body });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "partial");
    assert.deepEqual(report.recommendations, []);
  }
  const run = fixture();
  run.inputSnapshot.profile.priorities = blankProfile().priorities;
  const body = reportBody();
  body.recommendations[0].fitReasons = [
    fitReasons()[0],
    {
      profileField: "priorities.就业机会",
      profileValue: "50",
      reason: "就业是你的强烈偏好",
    },
  ];
  const { module } = setup({ body });
  assert.equal(
    (await module.generate({ subjectId: "student", run })).recommendations
      .length,
    0,
  );
});

test("city lists tolerate normal punctuation without accepting invented destinations", async () => {
  for (const value of [
    "上海,杭州",
    "上海，杭州",
    "杭州、上海",
    '["上海","杭州"]',
    '["杭州","上海"]',
  ]) {
    const plan = planBody();
    plan.directions[0].fitReasons = [
      fitReasons()[0],
      {
        profileField: "cities",
        profileValue: value,
        reason: "在本人意向城市比较学习与实践条件。",
      },
    ];
    const body = reportBody();
    body.recommendations[0].fitReasons = plan.directions[0].fitReasons;
    const { module } = setup({ plan, body });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "completed");
    assert.equal(
      report.recommendations[0].fitReasons![1].profileValue,
      "上海、杭州",
    );
  }
  for (const value of [
    "上海,北京",
    '["上海","北京"]',
    '["上海","上海"]',
    '["上海",1]',
    '{"cities":["上海","杭州"]}',
    "[]",
    "[invalid",
  ]) {
    const plan = planBody();
    plan.directions[0].fitReasons = [
      fitReasons()[0],
      { profileField: "cities", profileValue: value, reason: "城市选择" },
    ];
    const { module } = setup({ plan });
    assert.equal(
      (await module.generate({ subjectId: "student", run: fixture() })).reason,
      "UNGROUNDED_PROFILE_FIT",
    );
  }
});

test("undergraduate code-prefix collisions and navigation links cannot establish a corresponding master's program", async () => {
  const body = reportBody();
  body.facts = [];
  Object.assign(body.recommendations[0], {
    programName: "教育学",
    disciplineCode: "0401",
  });
  for (const content of [
    "示例研究大学本科专业介绍：040101教育学，授予教育学学士学位。导航：研究生教育。",
    "示例研究大学网站导航：硕士招生目录。本科专业介绍：040101教育学，授予教育学学士学位。",
  ]) {
    const search = mockReader({ content });
    const reader: WebReader = (url, options) =>
      new URL(url).hostname === "api.search.brave.com"
        ? search(url, options)
        : Promise.resolve({ contentType: "text/html", text: content });
    const { module } = setup({ plan: planBody(["0401"]), body, reader });
    const result = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.status, "partial");
  }
});

test("one invalid candidate and invented fact are isolated while a valid school-program recommendation remains", async () => {
  const body = reportBody();
  body.summary = "建议比较示例研究大学与虚构候选大学，结合你的目标做准备。";
  body.limitations.push("虚构候选大学的条件尚待确认。");
  body.recommendations.push({
    ...body.recommendations[0],
    institutionName: "虚构候选大学",
    programName: "官网没有的专业",
  });
  body.facts.push({ text: "没有来源的资格条件", citations: ["research-1"] });
  const { module } = setup({ body });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(report.status, "partial");
  assert.equal(report.reason, "RESEARCH_PARTIAL_VALIDATION");
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.recommendations[0].programName, "法学理论");
  assert.deepEqual(report.facts, reportBody().facts);
  assert.match(report.limitations.join(" "), /单独移除/);
  assert.equal(report.summary.includes("虚构候选大学"), false);
  assert.equal(
    report.limitations.some((item) => item.includes("虚构候选大学")),
    false,
  );
});

test("local advice failures preserve grounded identity, cited department, two profile dimensions and a valid tradeoff", async () => {
  const body = reportBody();
  body.recommendations[0].rationale =
    "历史资料列出教育学院的法学理论专业，与本人实践目标有联系，具体培养方式需进一步核验。";
  body.recommendations[0].fitReasons.push({
    profileField: "cities",
    profileValue: "上海",
    reason: "保证录取。",
  });
  body.recommendations[0].preparation.push(
    "联系示例研究大学教育学院核对该专业当年科目。",
    "系统学习311教育学专业基础综合。",
    "联系没有引用大学申请入学。",
  );
  body.recommendations[0].tradeoffs.push("你已符合报考条件，可直接报考。");
  body.recommendations[0].uncertainties.push(
    "目标年度招生专业目录未发布，仍待官网核验。",
  );
  body.limitations.push("目标年度（2027）招生目录、学费等官方信息尚未发布。");
  const { module } = setup({
    body,
    reader: mockReader({
      content: `${quote} 学院：(105)教育学院，专业：030101法学理论。`,
    }),
  });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(report.status, "partial");
  assert.equal(report.recommendations.length, 1);
  const card = report.recommendations[0];
  assert.equal(card.fitReasons!.length, 2);
  assert.equal(card.tradeoffs!.length, 1);
  assert.ok(card.preparation.some((item) => item.includes("教育学院")));
  assert.equal(JSON.stringify(report).includes("311"), false);
  assert.equal(JSON.stringify(report).includes("没有引用大学"), false);
  assert.equal(JSON.stringify(report).includes("保证录取"), false);
  assert.equal(JSON.stringify(report).includes("未发布"), false);
  assert.ok(
    card.uncertainties.some((item) => item.includes("本次尚未取得目标年度")),
  );
});

test("a card still fails when its core rationale or minimum remaining fit/tradeoff evidence fails", async () => {
  for (const mode of [
    "rationale",
    "one-fit",
    "no-tradeoff",
    "uncited-department",
  ]) {
    const body = reportBody();
    if (mode === "rationale") body.recommendations[0].rationale = "保证录取。";
    if (mode === "one-fit")
      body.recommendations[0].fitReasons[1].reason = "保证录取。";
    if (mode === "no-tradeoff")
      body.recommendations[0].tradeoffs = ["你已符合报考条件，可直接报考。"];
    if (mode === "uncited-department")
      body.recommendations[0].rationale = "该专业属于没有来源学院。";
    const { module } = setup({ body });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.recommendations.length, 0, mode);
  }
});

test("explicit exam-code preparation requires cited current evidence instead of historical assumptions", async () => {
  for (const year of ["2027", "2024"]) {
    const body = reportBody();
    body.facts = [];
    body.recommendations[0].preparation.push("系统学习311教育学专业基础综合。");
    const { module } = setup({
      body,
      reader: mockReader({
        year,
        content: `${quote} 法学理论硕士初试科目代码311。`,
      }),
    });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.recommendations.length, 1);
    assert.equal(
      report.recommendations[0].preparation.some((item) =>
        item.includes("311"),
      ),
      year === "2027",
    );
  }
});

test("a known current undergraduate eligibility conflict excludes a card, while historical restrictions remain risks", async () => {
  for (const year of ["2027", "2024"]) {
    const body = reportBody();
    body.facts = [];
    const content = `示例研究大学${year}年硕士招生专业目录：030101法学理论，仅限法学本科毕业生报考，不接受跨专业考生。`;
    const { module } = setup({ body, reader: mockReader({ year, content }) });
    const run = fixture();
    run.inputSnapshot.profile.major = "机械设计制造及其自动化";
    const report = await module.generate({ subjectId: "student", run });
    assert.equal(report.recommendations.length, year === "2027" ? 0 : 1);
    if (year === "2027")
      assert.equal(report.reason, "KNOWN_ADMISSION_CONFLICT");
    else
      assert.equal(
        report.recommendations[0].admissionStatus,
        "needs_verification",
      );
  }
});

test("fabricated school/program/code/citation or a missing concrete program is rejected locally", async () => {
  for (const patch of [
    { institutionName: "不存在大学" },
    { programName: "量子计算" },
    { programName: undefined },
    { disciplineCode: "0812" },
    { citations: ["invented"] },
    { tradeoffs: [] },
  ]) {
    const body = reportBody();
    Object.assign(body.recommendations[0], patch);
    const { module } = setup({ body });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "partial");
    assert.equal(report.recommendations.length, 0);
  }
});

test("actual personal budget restatements and negative guarantees are allowed, external prices and positive guarantees are not", async () => {
  for (const limitation of ["无法预测录取概率", "不保证录取", "不能承诺保录"]) {
    const { module } = setup({
      body: { ...reportBody(), limitations: [limitation] },
    });
    assert.equal(
      (await module.generate({ subjectId: "student", run: fixture() })).status,
      "completed",
    );
  }
  for (const claim of [
    "该校学费1万元",
    "你预算1万元可以支付该校学费1万元",
    "保证录取",
    "即使不保证录取，录取概率也有90%",
    "你已符合报考条件，可直接报考。",
    "官网 https://invented.example/",
  ]) {
    const body = reportBody();
    body.recommendations[0].rationale = claim;
    const { module } = setup({ body });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.recommendations.length, 0, claim);
    assert.equal(report.reason, "UNSUPPORTED_RESEARCH_CLAIM");
  }
});

test("unsupported budget comparisons become verification risks while an unsafe global summary cannot erase valid cards", async () => {
  const body = reportBody();
  body.summary = "该校学费2.7万元，费用太高。";
  body.recommendations[0].tradeoffs.push(
    "该专业同样面临学费超出1万预算的问题。",
  );
  body.limitations.push("本人的预算与该专业费用超过可用预算的问题尚需核验。");
  const { module } = setup({ body });
  const report = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.status, "partial");
  assert.equal(report.summary.includes("2.7万元"), false);
  assert.equal(
    report.recommendations[0].tradeoffs!.some((item) =>
      item.includes("超出1万"),
    ),
    false,
  );
  assert.ok(
    report.recommendations[0].tradeoffs!.some((item) =>
      /学费与资助尚待.*官网核验/.test(item),
    ),
  );
});

test("retrieval rotates regions/directions within six searches, six pages and twelve sources, with both model inputs bounded", async () => {
  let searches = 0,
    pages = 0;
  const reader: WebReader = async (url) => {
    if (new URL(url).hostname === "api.search.brave.com") {
      searches++;
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: Array.from({ length: 5 }, (_, i) => ({
              url: `https://s${searches}-${i}.edu.cn/catalog`,
              title: "示例研究大学法学硕士专业介绍",
              description: quote,
            })),
          },
        }),
      };
    }
    pages++;
    return {
      contentType: "text/html",
      text: `2027年硕士招生目录 ${"导航菜单 ".repeat(3000)} ${quote} ${"材料 ".repeat(3000)} 示例研究大学 版权所有`,
    };
  };
  const { module, calls, planningCalls } = setup({
    plan: planBody(["0301", "0351", "0451"]),
    reader,
  });
  const run = fixture();
  run.inputSnapshot.profile.notes = "私密补充".repeat(750);
  run.inputSnapshot.profile.courses = "相关课程内容".repeat(600);
  const report = await module.generate({ subjectId: "student", run });
  assert.equal(searches, 6);
  assert.equal(pages, 6);
  assert.equal(report.sources.length, 12);
  for (const call of [...calls, ...planningCalls])
    assert.ok(JSON.stringify(call.messages).length < 24000);
  assert.ok(
    report.sources.some(
      (source) =>
        source.kind === "official_page" &&
        source.excerpt.includes("法学理论") &&
        source.excerpt.includes("示例研究大学"),
    ),
  );
  const sent = JSON.parse(calls[0].messages[1].content);
  assert.equal(sent.context.profile.notes.length, 3000);
  assert.equal(sent.context.profile.courses.length, 3000);
});

test("search snippets and public admission platforms remain partial and official host policy remains server controlled", async () => {
  for (const options of [
    { domain: "school-info.test" },
    { failPage: true },
    { domain: "yz.chsi.com.cn" },
  ]) {
    const { module } = setup({ reader: mockReader(options) });
    const report = await module.generate({
      subjectId: "student",
      run: fixture(),
    });
    assert.equal(report.status, "partial");
    assert.equal(report.reason, "SEARCH_SNIPPETS_ONLY");
    assert.match(report.limitations.join(" "), /尚未读取学校官网正文/);
  }
  const { config } = setup();
  const report = await createResearchReportModule({
    ...config,
    allowAcademicHosts: false,
  }).generate({ subjectId: "student", run: fixture() });
  assert.equal(report.status, "partial");
  assert.equal(report.sources[0].kind, "search_snippet");
});

test("no external results stops before the final analyzing stage and does not claim a completed school investigation", async () => {
  const { module, calls, planningCalls } = setup({
    reader: mockReader({ noResults: true }),
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
  assert.equal(report.reason, "NO_WEB_EVIDENCE");
  assert.equal(calls.length, 0);
  assert.equal(planningCalls.length, 1);
  assert.equal(stages.includes("analyzing"), false);
});

test("progress authorization checks around both model calls remain awaited and cannot become fallback reports", async () => {
  for (const stop of ["after-plan", "analyzing", "writing"]) {
    const { module, calls, planningCalls } = setup();
    let preparations = 0;
    const cancelled = new Error("session or version changed");
    await assert.rejects(
      module.generate({
        subjectId: "student",
        run: fixture(),
        onProgress: async (stage) => {
          if (stage === "preparing") preparations++;
          if ((stop === "after-plan" && preparations === 2) || stage === stop)
            throw cancelled;
        },
      }),
      (error) => error === cancelled,
    );
    assert.equal(planningCalls.length, 1);
    assert.equal(calls.length, stop === "writing" ? 1 : 0);
  }
});

test("deletion during planning, retrieval or final thinking prevents delivery and stale caches", async () => {
  for (const phase of ["planning", "retrieval", "model"]) {
    let started!: () => void, finish!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pause = async () => {
      started();
      await pending;
    };
    const reply = (body: unknown) => ({
      content: JSON.stringify(body),
      inputTokens: 1,
      outputTokens: 1,
      model: "deepseek-v4-pro",
    });
    const reader = mockReader();
    const { module } = setup({
      reader: async (url, options) => {
        if (phase === "retrieval") await pause();
        return reader(url, options);
      },
      planningModel: {
        async complete() {
          if (phase === "planning") await pause();
          return reply(planBody());
        },
      },
      model: {
        async complete() {
          if (phase === "model") await pause();
          return reply(reportBody());
        },
      },
    });
    const result = module.generate({ subjectId: "student", run: fixture() });
    await startedPromise;
    module.clearSubject("student");
    finish();
    await assert.rejects(
      result,
      (error) => (error as ModelError).code === "DATA_DELETED",
    );
  }
});

test("both model phases use the shared token ledger and retrieval consumes the same search allowance as other tasks", async () => {
  const limited = setup({ userDailyTokens: 10 });
  const result = await limited.module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(result.reason, "BUDGET_EXHAUSTED");
  assert.equal(limited.calls.length + limited.planningCalls.length, 0);
  assert.equal(result.searched, false);
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
  assert.match(report.limitations.join(" "), /今日网页搜索次数已用完/);
  assert.equal(normal.calls.length, 0);
  assert.equal(normal.planningCalls.length, 1);
  const charged = setup({
    userDailyTokens: 28000,
    planningModel: {
      async complete() {
        return {
          content: JSON.stringify(planBody()),
          inputTokens: 9000,
          outputTokens: 9000,
          model: "deepseek-v4-pro",
        };
      },
    },
  });
  const afterPlan = await charged.module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(afterPlan.reason, "BUDGET_EXHAUSTED");
  assert.equal(charged.planningCalls.length, 1);
  assert.equal(charged.calls.length, 0);
});

test("incomplete planning responses retain their shared budget reservation instead of being counted as free", async () => {
  const reservation =
    JSON.stringify(
      (
        await import("../../server/explanation/research-planning.ts")
      ).planningMessages(fixture()),
    ).length + 4096;
  const { module, planningCalls } = setup({
    userDailyTokens: reservation + 500,
    planningModel: {
      async complete() {
        throw new ModelError("INCOMPLETE_RESPONSE");
      },
    },
  });
  const first = await module.generate({ subjectId: "student", run: fixture() });
  assert.equal(first.reason, "INCOMPLETE_RESPONSE");
  const second = await module.generate({
    subjectId: "student",
    run: fixture(),
  });
  assert.equal(second.reason, "BUDGET_EXHAUSTED");
  assert.equal(planningCalls.length, 1);
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
