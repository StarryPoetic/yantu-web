import test from "node:test";
import assert from "node:assert/strict";
import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import {
  PlanningValidationError,
  planningMessages,
  profileQuestions,
  researchContext,
  researchRecord,
  validatePlan,
  validateProfileFitReason,
} from "../../server/explanation/research-planning.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";

function fixture() {
  return generateGuidance({
    subjectId: "planning-student",
    guidanceRunId: "planning-run",
    generatedAt: "2026-10-03T00:00:00Z",
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [],
    profile: {
      ...blankProfile(),
      name: "不得进入错误反馈的姓名",
      major: "机械工程",
      studyGoal: "课程设计与科普工作",
      budget: "1 万元以内",
      cities: ["上海", "杭州"],
      crossMajor: "接受跨专业",
      hours: "4–6 小时",
      priorities: { ...blankProfile().priorities, 就业机会: 85 },
    },
  });
}
function plan() {
  return {
    directions: [
      {
        disciplineCode: "0401",
        rationale:
          "结合课程设计职业目标与经济约束探索教育研究，不能按本科专业固定匹配。",
        fitReasons: [
          {
            profileField: "studyGoal",
            profileValue: "课程设计与科普工作",
            reason: "课程设计目标与教育研究内容有关。",
          },
          {
            profileField: "budget",
            profileValue: "1 万元以内",
            reason: "需要先核对费用再权衡学校。",
          },
        ],
      },
    ],
    followUpQuestions: [],
  };
}

test("planning ignores harmless extra model fields and normalizes optional null or missing arrays", () => {
  const value = plan();
  Object.assign(value, { followUpQuestions: null, explanation: "冗余说明" });
  Object.assign(value.directions[0], {
    name: "教育学",
    confidence: 0.8,
    searchSchools: null,
  });
  Object.assign(value.directions[0].fitReasons[0], { source: "profile" });
  assert.deepEqual(validatePlan(JSON.stringify(value), fixture()), plan());
  const missing = { directions: plan().directions };
  assert.deepEqual(validatePlan(JSON.stringify(missing), fixture()), plan());
});

test("planning accepts actual city arrays and numerical priority values without inventing profile values", () => {
  const value = plan();
  value.directions[0].fitReasons = [
    {
      profileField: "cities",
      profileValue: ["杭州", "上海"] as never,
      reason: "比较本人意向城市。",
    },
    {
      profileField: "priorities.就业机会",
      profileValue: 85 as never,
      reason: "按本人就业偏好考察培养方向。",
    },
  ];
  const normalized = validatePlan(JSON.stringify(value), fixture());
  assert.equal(
    normalized.directions[0].fitReasons[0].profileValue,
    "上海、杭州",
  );
  assert.equal(normalized.directions[0].fitReasons[1].profileValue, "85");
});

test("an undecided target can explore from real constraints without requiring the user to name schools or disciplines", () => {
  const run = fixture();
  delete run.inputSnapshot.profile.studyGoal;
  delete run.inputSnapshot.profile.targetMajor;
  run.inputSnapshot.profile.priorities = blankProfile().priorities;
  assert.deepEqual(profileQuestions(run), []);
  run.inputSnapshot.profile = {
    ...blankProfile(),
    major: "机械工程",
    studyGoal: "不确定具体专业，但喜欢教学设计，希望做课程研发",
  };
  assert.deepEqual(profileQuestions(run), []);
  assert.match(planningMessages(run)[0].content, /没有目标学校|尚未确定目标/);
});

test("a deidentified real reply shape with numerical priorities 100, 97 and 96 validates without locking to the confirmed direction", () => {
  const run = fixture();
  run.inputSnapshot.confirmedMajorId = "0453";
  run.inputSnapshot.profile.notes =
    "愿意学习人工智能应用，希望先比较研究与应用培养路径。";
  run.inputSnapshot.profile.priorities = {
    ...blankProfile().priorities,
    就业机会: 100,
    发展前景: 97,
    政策支持: 96,
  };
  const value = {
    directions: ["0854", "0812", "1405"].map((disciplineCode, index) => ({
      disciplineCode,
      rationale: "综合技术学习意愿、本人优先级及跨专业意愿探索此方向。",
      searchSchools: ["甲研究大学", "乙工程大学"],
      fitReasons: [
        {
          profileField: "notes",
          profileValue: "愿意学习人工智能应用",
          reason: "将兴趣作为调查线索，进一步核对项目培养内容。",
        },
        {
          profileField:
            index === 2 ? "priorities.政策支持" : "priorities.就业机会",
          profileValue: index === 2 ? 96 : 100,
          reason: "依据本人明确的优先级取舍。",
        },
        {
          profileField: "priorities.发展前景",
          profileValue: 97,
          reason: "需要调查后续培养方向。",
        },
        {
          profileField: "crossMajor",
          profileValue: "接受跨专业",
          reason: "允许探索本科以外的培养路径。",
        },
      ],
    })),
    followUpQuestions: [],
  };
  const result = validatePlan(JSON.stringify(value), run);
  assert.deepEqual(
    result.directions.map((item) => item.disciplineCode),
    ["0854", "0812", "1405"],
  );
  assert.equal(result.directions[0].fitReasons[1].profileValue, "100");
  assert.equal(result.directions[2].fitReasons[1].profileValue, "96");
});

test("final report profile validation shares safe numeric and array normalization but retains its strict schema", () => {
  const profile = researchContext(fixture()).profile;
  for (const [field, value, expected] of [
    ["priorities.就业机会", 85, "85"],
    ["cities", ["杭州", "上海"], "上海、杭州"],
  ] as const) {
    const fit = {
      profileField: field,
      profileValue: value,
      reason: "引用本人已保存的真实偏好。",
    };
    assert.equal(validateProfileFitReason(fit, profile).profileValue, expected);
    assert.throws(
      () =>
        validateProfileFitReason({ ...fit, unknown: "不能存入报告" }, profile),
      { code: "INVALID_RESEARCH_REPORT" },
    );
  }
  for (const value of [86, "86", true, { value: 85 }])
    assert.throws(
      () =>
        validateProfileFitReason(
          {
            profileField: "priorities.就业机会",
            profileValue: value,
            reason: "不真实的值。",
          },
          profile,
        ),
      ModelError,
    );
  for (const value of [["上海", "北京"], ["上海", "上海"], { city: "上海" }])
    assert.throws(
      () =>
        validateProfileFitReason(
          {
            profileField: "cities",
            profileValue: value,
            reason: "不真实的城市集合。",
          },
          profile,
        ),
      ModelError,
    );
  assert.throws(
    () => researchRecord({ accepted: true, extra: true }, ["accepted"]),
    { code: "INVALID_RESEARCH_REPORT" },
  );
});

test("bounded repair feedback identifies a field without echoing private values or untrusted model text", () => {
  const value = plan();
  value.directions[0].fitReasons[1].profileValue = "敏感原文与伪造预算";
  let captured: unknown;
  try {
    validatePlan(JSON.stringify(value), fixture());
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof PlanningValidationError);
  assert.ok(captured instanceof ModelError);
  assert.equal(captured.code, "UNGROUNDED_PROFILE_FIT");
  assert.deepEqual(
    captured.issues.map(({ path, code }) => ({ path, code })),
    [
      {
        path: "directions[0].fitReasons[1].profileValue",
        code: "PROFILE_VALUE_MISMATCH",
      },
    ],
  );
  assert.match(captured.issues[0].message, /实际画像值/);
  assert.doesNotMatch(
    JSON.stringify(captured.issues),
    /敏感原文|伪造预算|不得进入|1 万元/,
  );
});

test("planning normalizes wrappers and field prefixes but rejects incomplete required structure", () => {
  const value = plan();
  value.directions[0].fitReasons[0].profileField = "context.profile.studyGoal";
  value.directions[0].disciplineCode = 401 as never;
  assert.deepEqual(
    validatePlan(
      `\uFEFF\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,
      fixture(),
    ),
    plan(),
  );
  for (const [raw, path, code] of [
    ["preface " + JSON.stringify(plan()), "$", "INVALID_JSON"],
    [JSON.stringify(plan()) + "{}", "$", "INVALID_JSON"],
    [JSON.stringify({ directions: null }), "directions", "EXPECTED_ARRAY"],
    [
      JSON.stringify({ directions: [{ disciplineCode: "0401" }] }),
      "directions[0].rationale",
      "EXPECTED_TEXT",
    ],
    [
      JSON.stringify({
        directions: [
          {
            disciplineCode: "0401",
            rationale: "必需理由已提供",
            fitReasons: null,
          },
        ],
      }),
      "directions[0].fitReasons",
      "EXPECTED_ARRAY",
    ],
    [JSON.stringify({ directions: [] }), "directions", "EMPTY_PLAN"],
  ]) {
    assert.throws(
      () => validatePlan(raw, fixture()),
      (error: unknown) =>
        error instanceof PlanningValidationError &&
        error.code === "INVALID_RESEARCH_PLAN" &&
        error.issues[0].path === path &&
        error.issues[0].code === code,
    );
  }
});

test("normalization does not bypass excluded directions, degree or cross-major constraints", () => {
  const run = fixture();
  run.inputSnapshot.excludedMajorIds = ["0401"];
  assert.throws(() => validatePlan(JSON.stringify(plan()), run), {
    code: "RESEARCH_DIRECTION_NOT_ALLOWED",
  });
  run.inputSnapshot.excludedMajorIds = [];
  run.inputSnapshot.profile.crossMajor = "不接受跨专业";
  assert.throws(() => validatePlan(JSON.stringify(plan()), run), {
    code: "RESEARCH_DIRECTION_NOT_ALLOWED",
  });
  run.inputSnapshot.profile.crossMajor = "接受跨专业";
  run.inputSnapshot.profile.notes = "只考虑专硕";
  assert.throws(() => validatePlan(JSON.stringify(plan()), run), {
    code: "RESEARCH_DIRECTION_NOT_ALLOWED",
  });
});

test("separate priority sliders cannot substitute for two actual dimensions and neutral values cannot manufacture fit", () => {
  const run = fixture();
  const value = plan();
  const weights: Record<string, number> = {
    ...blankProfile().priorities,
    就业机会: 85,
    发展前景: 90,
  };
  run.inputSnapshot.profile.priorities = weights;
  value.directions[0].fitReasons = ["就业机会", "发展前景"].map((key) => ({
    profileField: `priorities.${key}`,
    profileValue: weights[key] as never,
    reason: "多个滑块仍只是一类偏好。",
  }));
  assert.throws(() => validatePlan(JSON.stringify(value), run), {
    code: "INSUFFICIENT_PROFILE_FIT",
  });
  run.inputSnapshot.profile.priorities = blankProfile().priorities;
  value.directions[0].fitReasons = [
    plan().directions[0].fitReasons[0],
    {
      profileField: "priorities.就业机会",
      profileValue: 50 as never,
      reason: "默认值并非明确偏好。",
    },
  ];
  assert.throws(() => validatePlan(JSON.stringify(value), run), {
    code: "UNGROUNDED_PROFILE_FIT",
  });
});

test("true blank or placeholder-only profiles still ask useful questions", () => {
  const run = fixture();
  for (const profile of [
    blankProfile(),
    { ...blankProfile(), major: "机械工程" },
    {
      ...blankProfile(),
      major: "机械工程",
      studyGoal: "不确定，希望先探索",
      cities: ["不确定"],
    },
  ]) {
    run.inputSnapshot.profile = { ...profile };
    assert.ok(profileQuestions(run).length > 0);
  }
});

test("planning context stays within 15000 characters while retaining 184 directions and all structured preferences", () => {
  const run = fixture();
  run.inputSnapshot.profile.notes = "课程设计与职业约束。".repeat(300);
  run.inputSnapshot.profile.courses = "学过基础课程但希望补充研究方法。".repeat(
    200,
  );
  const before = structuredClone(run.inputSnapshot.profile);
  const messages = planningMessages(run);
  assert.ok(JSON.stringify(messages).length <= 15000);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.catalog.length, 184);
  assert.deepEqual(payload.context.profile.cities, before.cities);
  assert.deepEqual(payload.context.profile.priorities, before.priorities);
  for (const key of ["major", "studyGoal", "hours", "budget", "crossMajor"])
    assert.equal(payload.context.profile[key], before[key]);
  for (const key of ["notes", "courses"])
    assert.ok(String(before[key]).startsWith(payload.context.profile[key]));
  assert.equal("name" in payload.context.profile, false);
  assert.deepEqual(run.inputSnapshot.profile, before);
});
