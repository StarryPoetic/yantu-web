import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  generateGuidance,
  getDisciplineCatalog,
  isDisciplineId,
  programMatchesDiscipline,
} from "../../server/disciplines/index.ts";
import type { GuidanceInput } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import {
  createSeedCatalog,
  getCatalogSnapshot,
} from "../../server/catalog/index.ts";
import signals from "../../knowledge/disciplines/signals.json" with { type: "json" };

const input = (overrides: Partial<GuidanceInput> = {}): GuidanceInput => ({
  subjectId: "student",
  guidanceRunId: "guidance-1",
  generatedAt: "2026-09-27T00:00:00.000Z",
  profile: blankProfile(),
  profileVersion: 1,
  selectionVersion: 0,
  confirmedMajorId: null,
  excludedMajorIds: [],
  assessments: [],
  ...overrides,
});

test("national taxonomy includes every base group, all academic disciplines and professional categories with provenance", () => {
  const data = getDisciplineCatalog();
  assert.equal(data.coverage.disciplineGroups, 14);
  assert.equal(
    data.items.filter((item) => item.degreeType === "academic").length,
    117,
  );
  assert.equal(
    data.items.filter((item) => item.degreeType === "professional").length,
    67,
  );
  assert.equal(data.items.filter((item) => item.mastersOnly).length, 31);
  assert.equal(new Set(data.items.map((item) => item.code)).size, 184);
  assert.deepEqual(
    data.groups.map((group) => group.name),
    [
      "哲学",
      "经济学",
      "法学",
      "教育学",
      "文学",
      "历史学",
      "理学",
      "工学",
      "农学",
      "医学",
      "军事学",
      "管理学",
      "艺术学",
      "交叉学科",
    ],
  );
  for (const item of data.items) {
    assert.match(item.code, /^\d{4}$/);
    assert.equal(item.id, item.code);
    assert.equal(item.groupCode, item.code.slice(0, 2));
    assert.equal(
      item.degreeType,
      Number(item.code[2]) >= 5 ? "professional" : "academic",
    );
    assert.ok(
      item.sourceIds.every((id) =>
        data.sources.some((source) => source.sourceId === id),
      ),
    );
    assert.ok(item.sourcePage >= 3 && item.sourcePage <= 14);
    assert.equal(item.name.includes("*"), false);
    assert.equal(item.name.includes("（"), false);
  }
  const original = readFileSync(
    new URL(
      "../../knowledge/disciplines/sources/moe-graduate-catalog-2022.pdf",
      import.meta.url,
    ),
  );
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    data.sources[0].sha256,
  );
  assert.match(data.sources[0].url, /^https:\/\/www\.moe\.gov\.cn\//);
  assert.match(
    data.sources[0].retrievedFrom,
    /^https:\/\/webplus\.chd\.edu\.cn\//,
  );
  assert.equal(data.effectiveFrom, "2023");
  assert.match(data.warnings.join(" "), /六位年度招生专业/);
});

test("medical categories in footnotes and 2025 old-name correspondence do not disappear or create extra disciplines", () => {
  const data = getDisciplineCatalog();
  for (const [code, name] of [
    ["1051", "临床医学"],
    ["1052", "口腔医学"],
    ["1055", "药学"],
  ]) {
    const discipline = data.items.find((item) => item.code === code)!;
    assert.equal(discipline.name, name);
    assert.equal(discipline.degreeType, "professional");
    assert.equal(discipline.sourcePage, 10);
    assert.match(discipline.notes.join(""), /原文/);
  }
  assert.deepEqual(
    getDisciplineCatalog({ q: "汉语国际教育" }).items.map((item) => item.code),
    ["0453"],
  );
  assert.equal(isDisciplineId("0953"), false);
  assert.equal(isDisciplineId("0834"), false);
  assert.equal(isDisciplineId("0862"), true);
  assert.equal(isDisciplineId("research"), false);
  assert.equal(
    data.items.find((item) => item.code === "0251")!.mastersOnly,
    true,
  );
  assert.equal(
    data.items.find((item) => item.code === "1352")!.mastersOnly,
    false,
  );
  const professional = getDisciplineCatalog({
    groupCode: "03",
    degreeType: "professional",
  });
  assert.ok(
    professional.items.every(
      (item) => item.groupCode === "03" && item.degreeType === "professional",
    ),
  );
  assert.equal(professional.coverage.total, 184);
  professional.items[0].name = "attempted mutation";
  assert.notEqual(
    getDisciplineCatalog().items.find(
      (item) => item.code === professional.items[0].code,
    )!.name,
    "attempted mutation",
  );
  assert.ok(
    signals.connections.every((connection) =>
      connection.codes.every(isDisciplineId),
    ),
  );
});

test("blank profile explores all directions without a computer-science default or fabricated ability ranks", () => {
  const run = generateGuidance(input());
  assert.equal(run.status, "exploration");
  assert.equal(run.directions.length, 184);
  assert.deepEqual(run.highlightedIds, []);
  assert.ok(run.followUpQuestions.length >= 3);
  assert.ok(
    run.directions.every(
      (direction) =>
        direction.rank === null &&
        direction.fitScore === null &&
        direction.eligible === "unknown" &&
        direction.status === "open_exploration",
    ),
  );
  assert.deepEqual(generateGuidance(input()), run);
});

test("non-computing profile evidence highlights traceable directions while preserving every candidate", () => {
  const run = generateGuidance(
    input({
      profile: {
        ...blankProfile(),
        major: "汉语言文学",
        targetMajor: "法律",
        studyGoal: "想从事律师工作",
        crossMajor: "接受跨专业",
      },
    }),
  );
  assert.ok(run.highlightedIds.includes("0351"));
  assert.ok(run.highlightedIds.includes("0501"));
  assert.equal(run.highlightedIds.includes("0812"), false);
  assert.match(
    run.directions.find((d) => d.discipline.id === "0351")!.reasons.join(""),
    /法律/,
  );
  assert.equal(run.directions.length, 184);
  assert.ok(run.directions.every((d) => d.eligible === "unknown"));
  const military = generateGuidance(input({ confirmedMajorId: "1101" }));
  assert.deepEqual(military.highlightedIds, ["1101"]);
});

test("user exclusions and negative interests are respected without hard eligibility claims", () => {
  const run = generateGuidance(
    input({
      profile: {
        ...blankProfile(),
        major: "机械工程",
        targetMajor: "不想学计算机，不考虑法律",
        studyGoal: "想做金融",
        crossMajor: "不接受跨专业",
      },
      excludedMajorIds: ["0802"],
    }),
  );
  assert.equal(run.highlightedIds.includes("0812"), false);
  assert.equal(run.highlightedIds.includes("0301"), false);
  assert.equal(run.highlightedIds.includes("0802"), false);
  assert.equal(run.highlightedIds.includes("0251"), false);
  assert.equal(
    run.directions.find((d) => d.discipline.id === "0802")!.status,
    "user_excluded",
  );
  assert.ok(run.highlightedIds.includes("0855"));
  assert.equal(run.directions.length, 184);
});

test("public-course samples cannot manufacture exam scores or determine professional fit", () => {
  const base = input({ profile: { ...blankProfile(), major: "护理学" } });
  const noAssessment = generateGuidance(base);
  const run = generateGuidance({
    ...base,
    assessments: [
      {
        assessmentAttemptId: "sample",
        diagnosisVersion: "diagnosis-1",
        example: true,
        usableForRecommendation: false,
        modules: [
          {
            module: "politics",
            correct: 0,
            incorrect: 5,
            unanswered: 0,
            total: 5,
          },
          { module: "math", correct: 0, incorrect: 2, unanswered: 3, total: 5 },
        ],
        weakPoints: ["函数"],
        limitations: ["样本有限"],
      },
    ],
  });
  assert.deepEqual(run.highlightedIds, noAssessment.highlightedIds);
  assert.deepEqual(run.directions, noAssessment.directions);
  assert.equal(run.assessmentSummary.used, 0);
  assert.match(run.assessmentSummary.ignored[0].reason, /不作为正式推荐依据/);
  assert.equal(run.assessmentSummary.observations.length, 2);
  assert.match(run.assessmentSummary.observations.join(""), /示例练习观察/);
  assert.ok(run.highlightedIds.includes("1054"));
  assert.deepEqual(run.versions.assessmentRefs, [
    { assessmentAttemptId: "sample", diagnosisVersion: "diagnosis-1" },
  ]);
});

test("annual program matching uses actual degree and code, keeping demo labels narrowly compatible", () => {
  const program = structuredClone(
    getCatalogSnapshot(createSeedCatalog()).programs[0],
  );
  program.identity.majorCode = "030101";
  program.identity.degreeType = "academic";
  program.majorDirectionIds = ["custom-law"];
  assert.equal(programMatchesDiscipline(program, "0301"), true);
  assert.equal(programMatchesDiscipline(program, "0351"), false);
  assert.equal(programMatchesDiscipline(program, "research"), false);
  assert.equal(programMatchesDiscipline(program, "custom-law"), true);
  assert.equal(programMatchesDiscipline(program, null), true);
  program.identity.degreeType = "professional";
  assert.equal(programMatchesDiscipline(program, "0301"), false);
  program.identity.majorCode = "035101";
  assert.equal(programMatchesDiscipline(program, "0351"), true);
});

test("nearby-major willingness stays a condition to verify, and reviewed observations still cannot rank majors", () => {
  const base = input({
    profile: { ...blankProfile(), major: "数学", crossMajor: "只接受相近专业" },
  });
  const run = generateGuidance({
    ...base,
    assessments: [
      {
        assessmentAttemptId: "reviewed",
        diagnosisVersion: "d2",
        example: false,
        usableForRecommendation: true,
        modules: [
          { module: "math", correct: 4, incorrect: 1, unanswered: 0, total: 5 },
        ],
        weakPoints: ["函数"],
        limitations: ["小样本"],
      },
    ],
  });
  assert.match(run.considerations.join(""), /不能证明专业相近/);
  assert.equal(run.assessmentSummary.used, 1);
  assert.deepEqual(run.assessmentSummary.ignored, []);
  assert.deepEqual(run.directions, generateGuidance(base).directions);
  assert.equal(run.directions.length, 184);
});

test("supplementary notes provide attributed tentative clues without establishing background, qualifications or rank", () => {
  const run = generateGuidance(
    input({
      profile: {
        ...blankProfile(),
        studyGoal: "专业实践与行业就业",
        notes: "毕业后想做律师",
      },
    }),
  );
  assert.ok(run.highlightedIds.includes("0351"));
  const direction = run.directions.find(
    (item) => item.discipline.code === "0351",
  )!;
  assert.equal(direction.status, "goal_connection");
  assert.match(direction.reasons.join(""), /补充说明.*律师.*待你确认/);
  assert.match(
    direction.reasons.join(""),
    /不证明已有学习基础、官方招生要求或报考资格/,
  );
  assert.match(direction.preparation.join(""), /先阅读培养方案/);
  assert.equal(direction.eligible, "unknown");
  assert.equal(direction.rank, null);
  assert.equal(direction.fitScore, null);
  assert.equal(run.directions.length, 184);
  assert.match(run.versions.guidanceRuleVersion, /notes-v1$/);
});

test("negative notes never create positive recommendations and contrast clauses retain affirmative goals", () => {
  const run = generateGuidance(
    input({
      profile: {
        ...blankProfile(),
        notes:
          "不想学计算机但想做律师。对金融不感兴趣；不打算学护理，没有兴趣学机械",
      },
    }),
  );
  assert.ok(run.highlightedIds.includes("0351"));
  for (const code of ["0812", "0854", "0251", "1054", "0802", "0855"]) {
    assert.equal(run.highlightedIds.includes(code), false);
    assert.equal(
      run.directions.find((item) => item.discipline.code === code)!.status,
      "open_exploration",
    );
  }
});

test("notes cannot override an explicit exclusion or the refusal to cross majors", () => {
  const excluded = generateGuidance(
    input({
      profile: { ...blankProfile(), notes: "想做律师" },
      excludedMajorIds: ["0301", "0351"],
    }),
  );
  assert.deepEqual(excluded.highlightedIds, []);
  assert.equal(
    excluded.directions.find((item) => item.discipline.code === "0351")!.status,
    "user_excluded",
  );
  const noCross = generateGuidance(
    input({
      profile: {
        ...blankProfile(),
        major: "机械工程",
        crossMajor: "不接受跨专业",
        notes: "听说律师就业好，想进一步了解法律",
      },
    }),
  );
  assert.equal(noCross.highlightedIds.includes("0351"), false);
  assert.match(
    noCross.directions
      .find((item) => item.discipline.code === "0351")!
      .preparation.join(""),
    /不希望跨专业/,
  );
});
