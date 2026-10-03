import test from "node:test";
import assert from "node:assert/strict";
import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import { createResearchReportModule } from "../../server/explanation/research.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import {
  ModelError,
  type ModelMessage,
} from "../../server/explanation/deepseek.ts";

const schools = [..."甲乙丙丁戊己庚辛壬癸子"].map((name) => `${name}研究大学`);
const now = () => Date.parse("2026-10-04T00:00:00Z");
const reasons = () => [
  {
    profileField: "studyGoal",
    reason: "法律研究训练与本人实践就业目标相结合，这是基于课程方向的推断。",
  },
  {
    profileField: "budget",
    reason: "本人预算有限，需要核对目标年度收费后再比较准备成本。",
  },
];
function fixture() {
  return generateGuidance({
    subjectId: "supplement-student",
    guidanceRunId: "supplement-run",
    generatedAt: new Date(now()).toISOString(),
    profile: {
      ...blankProfile(),
      university: "本科背景大学",
      major: "法学",
      year: "2027",
      studyGoal: "专业实践与行业就业",
      budget: "1 万元以内",
      cities: ["苏州"],
      crossMajor: "接受跨专业",
      hours: "4–6 小时",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "0301",
    excludedMajorIds: [],
    assessments: [],
  });
}
function card(index: number, messages: ModelMessage[]) {
  const evidence = JSON.parse(messages[1].content).sources as {
    id: string;
    excerpt: string;
  }[];
  const source = evidence.find((source) =>
    source.excerpt.includes(schools[index]),
  );
  assert.ok(
    source,
    `school ${index} has actual official evidence in the model input`,
  );
  return {
    institutionName: schools[index],
    programName: "法学理论",
    disciplineCode: "0301",
    suitabilityTier: "alternative",
    suitabilityReason: "结合实践目标与预算约束值得比较，研究训练仍有准备成本。",
    rationale: "法律训练可支持本人专业实践目标，这是基于培养方向的推断。",
    fitReasons: reasons(),
    tradeoffs: ["需要补足研究方法基础，费用条件仍需核验。"],
    preparation: ["了解培养课程并安排法律阅读练习。"],
    uncertainties: ["目标年度报考条件与收费仍需官网核验。"],
    citations: [source.id],
  };
}
const body = (recommendations: unknown[]) => ({
  summary: "根据本人实践目标与准备约束比较真实学校项目。",
  facts: [],
  recommendations,
  limitations: [],
});
function setup(
  settings: {
    count?: number;
    initial?: number[];
    supplement?: (messages: ModelMessage[]) => unknown;
    failSupplement?: string;
    userDailyTokens?: number;
    firstUsage?: number;
    restrictedSchool?: number;
    coded?: boolean;
  } = {},
) {
  const count = settings.count ?? 6;
  const requests: {
    planning: boolean;
    supplemental: boolean;
    messages: ModelMessage[];
  }[] = [];
  const runtimeKeys: { task?: string }[] = [];
  let searchCount = 0;
  const config = {
    enabled: true,
    apiKey: "test-only",
    searchEnabled: true,
    searchProvider: "bocha" as const,
    searchKey: "test-only",
    searchDailyRequestsPerUser: 30,
    searchDailyRequestsGlobal: 100,
    userDailyTokens: settings.userDailyTokens ?? 150000,
    globalDailyTokens: 500000,
    now,
    adapter: {
      async complete(messages: ModelMessage[]) {
        const planning = messages[0].content.includes(
          "research-direction-plan-v6",
        );
        const supplemental = messages.at(-1)!.content.includes("已保留：");
        requests.push({
          planning,
          supplemental,
          messages: structuredClone(messages),
        });
        if (supplemental && settings.failSupplement)
          throw new ModelError(settings.failSupplement);
        const content = planning
          ? {
              directions: [
                {
                  disciplineCode: "0301",
                  rationale: "结合实践目标与预算约束调查法律研究训练。",
                  fitReasons: reasons(),
                },
              ],
              followUpQuestions: [],
            }
          : supplemental
            ? (settings.supplement?.(messages) ??
              body([2, 3, 4].map((index) => card(index, messages))))
            : body(
                (settings.initial ?? [0, 1]).map((index) =>
                  card(index, messages),
                ),
              );
        return {
          content: JSON.stringify(content),
          inputTokens:
            planning || supplemental ? 100 : (settings.firstUsage ?? 200) - 100,
          outputTokens: 100,
          model: "deepseek-v4-pro",
        };
      },
    },
    reader: async (url: string) => {
      if (new URL(url).hostname === "api.bocha.cn") {
        const indices = Array.from({ length: count }, (_, i) => i);
        // The provider has a ten-result cap. A subsequent real search can expose
        // the eleventh school without returning an invented source to the model.
        if (searchCount++ && count > 10) indices.unshift(indices.pop()!);
        return {
          contentType: "application/json",
          text: JSON.stringify({
            code: 200,
            data: {
              webPages: {
                value: indices.map((index) => ({
                  name: `${schools[index]}2027年法学硕士招生专业目录`,
                  url: `https://law.school${index}.edu.cn/catalog`,
                  summary: `${schools[index]}2027年硕士研究生招生专业目录：030101 法学理论。`,
                })),
              },
            },
          }),
        };
      }
      const index = Number(
        new URL(url).hostname.match(/school(\d+)\.edu\.cn/)?.[1],
      );
      return {
        contentType: "text/html",
        text: `<p>${schools[index]}2027年硕士研究生招生专业目录：${settings.coded ? "030101 " : ""}法学理论${settings.restrictedSchool === index ? "，仅限医学本科毕业生报考，不接受跨专业考生" : ""}。培养课程包含法律案例与研究方法。</p>`,
      };
    },
  };
  const shared = createModelRuntime(config);
  const runtime = {
    run: (async (...args: Parameters<typeof shared.run>) => {
      runtimeKeys.push(args[1] as { task?: string });
      return shared.run(...args);
    }) as typeof shared.run,
    clearSubject: shared.clearSubject,
  };
  return {
    module: createResearchReportModule(config, { runtime }),
    requests,
    runtimeKeys,
    run: fixture(),
  };
}

test("a short report gets one shared-runtime supplement, preserves accepted cards, deduplicates schools and caches the extra call", async () => {
  const setupResult = setup({
    supplement: (messages) =>
      body([
        {
          ...card(0, messages),
          rationale: "补充调用的新解释不能替换此前核验通过的建议。",
        },
        ...[2, 3, 4].map((index) => card(index, messages)),
      ]),
  });
  const input = { subjectId: setupResult.run.subjectId, run: setupResult.run };
  const report = await setupResult.module.generate(input);
  assert.equal(report.recommendations.length, 5);
  assert.equal(report.coverage!.schoolCount, 5);
  assert.equal(
    report.recommendations.find((item) => item.institutionName === schools[0])!
      .rationale,
    card(0, setupResult.requests[1].messages).rationale,
  );
  assert.equal(
    setupResult.requests.filter((request) => request.supplemental).length,
    1,
  );
  assert.equal(
    setupResult.runtimeKeys.filter((key) => key.task?.endsWith("-coverage"))
      .length,
    1,
  );
  await setupResult.module.generate(input);
  assert.equal(
    setupResult.requests.length,
    3,
    "planning, initial report and supplemental report all reuse the shared model cache",
  );
});

test("the ten-school cap retains old accepted cards even when all new suggestions have a higher tier", async () => {
  const setupResult = setup({
    count: 11,
    initial: [0],
    supplement: (messages) =>
      body(
        Array.from({ length: 10 }, (_, index) => ({
          ...card(index + 1, messages),
          suitabilityTier: "preferred",
        })),
      ),
  });
  const report = await setupResult.module.generate({
    subjectId: setupResult.run.subjectId,
    run: setupResult.run,
  });
  assert.equal(report.recommendations.length, 10);
  assert.ok(
    report.recommendations.some((item) => item.institutionName === schools[0]),
  );
  assert.equal(
    new Set(report.recommendations.map((item) => item.institutionName)).size,
    10,
  );
  assert.equal(
    setupResult.requests.filter((request) => request.supplemental).length,
    1,
  );
});

test("a supplemental provider failure leaves the original useful recommendations and makes no retry", async () => {
  const setupResult = setup({
    failSupplement: "PROVIDER_TEMPORARY_UNAVAILABLE",
  });
  const report = await setupResult.module.generate({
    subjectId: setupResult.run.subjectId,
    run: setupResult.run,
  });
  assert.deepEqual(
    report.recommendations.map((item) => item.institutionName),
    schools.slice(0, 2),
  );
  assert.equal(
    setupResult.requests.filter((request) => request.supplemental).length,
    1,
  );
  assert.ok(
    report.limitations.some((value) => value.includes("学校覆盖补充未完成")),
  );
});

test("the shared token ledger can block supplementation without discarding initial suggestions or sending another model request", async () => {
  const setupResult = setup({
    count: 5,
    userDailyTokens: 30000,
    firstUsage: 8500,
  });
  const report = await setupResult.module.generate({
    subjectId: setupResult.run.subjectId,
    run: setupResult.run,
  });
  assert.equal(report.recommendations.length, 2);
  assert.equal(
    setupResult.runtimeKeys.filter((key) => key.task?.endsWith("-coverage"))
      .length,
    1,
  );
  assert.equal(
    setupResult.requests.filter((request) => request.supplemental).length,
    0,
  );
  assert.ok(
    report.limitations.some((value) => value.includes("学校覆盖补充未完成")),
  );
});

test("fewer than five observed school domains cannot trigger an additional coverage call", async () => {
  const setupResult = setup({ count: 4 });
  const report = await setupResult.module.generate({
    subjectId: setupResult.run.subjectId,
    run: setupResult.run,
  });
  assert.equal(report.recommendations.length, 2);
  assert.equal(setupResult.requests.length, 2);
  assert.equal(
    setupResult.runtimeKeys.filter((key) => key.task?.endsWith("-coverage"))
      .length,
    0,
  );
});

test("coded official programme inventory covers model omissions without needing another model call", async () => {
  const setupResult = setup({ coded: true });
  const input = { subjectId: setupResult.run.subjectId, run: setupResult.run };
  const report = await setupResult.module.generate(input);
  assert.equal(report.recommendations.length, 6);
  assert.equal(report.coverage?.schoolCount, 6);
  assert.deepEqual(
    new Set(report.recommendations.map((item) => item.institutionName)),
    new Set(schools.slice(0, 6)),
  );
  assert.equal(
    setupResult.requests.filter((request) => request.supplemental).length,
    0,
  );
  assert.equal(
    setupResult.runtimeKeys.filter((key) => key.task?.endsWith("-coverage"))
      .length,
    0,
  );
  await setupResult.module.generate(input);
  assert.equal(
    setupResult.requests.length,
    2,
    "planning and report explanations both reuse their model cache",
  );
});

test("supplemental cards still reject current eligibility conflicts, unknown citations and invented prices or guarantees", async () => {
  const setupResult = setup({
    restrictedSchool: 3,
    supplement: (messages) =>
      body([
        {
          ...card(2, messages),
          rationale: "该专业学费2000元。",
          tuition: {
            amount: 2000,
            currency: "CNY",
            period: "academic_year",
            year: "2027",
            studyMode: "full_time",
            quote: `${schools[2]}2027年全日制法学理论学费2000元/年。`,
            sourceId: card(2, messages).citations[0],
          },
        },
        card(3, messages),
        { ...card(4, messages), rationale: "学校允许跨专业，可直接报考。" },
        { ...card(5, messages), citations: ["nonexistent-source"] },
      ]),
  });
  const report = await setupResult.module.generate({
    subjectId: setupResult.run.subjectId,
    run: setupResult.run,
  });
  assert.ok(
    report.recommendations.some((item) => item.institutionName === schools[0]),
  );
  assert.ok(
    !report.recommendations.some((item) => item.institutionName === schools[3]),
  );
  assert.ok(
    !report.recommendations.some((item) => item.institutionName === schools[5]),
  );
  assert.ok(
    !report.recommendations.some((item) => item.tuition?.amount === 2000),
  );
  assert.doesNotMatch(
    JSON.stringify(report.recommendations),
    /2000元|可直接报考|学校允许跨专业/,
  );
  assert.equal(
    setupResult.requests.filter((request) => request.supplemental).length,
    1,
  );
});
