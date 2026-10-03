import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidenceCandidates,
  createDemandPlan,
  evaluateDemandMatch,
  extractProgramExams,
  rankDemandCandidates,
} from "../../server/explanation/research-matching.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import type {
  Discipline,
  GuidanceRun,
} from "../../server/disciplines/types.ts";
import type { ResearchReport } from "../../server/explanation/research.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import { blankProfile } from "../../server/profile.ts";

// Synthetic programme-row fixtures exercise official-page structure, not claims
// about actual 2027 programme requirements or eligibility at these institutions.
const discipline = (code: string): Discipline =>
  getDisciplineCatalog().items.find((item) => item.code === code)!;
const mechanical = [discipline("0802"), discipline("0855")];
const school = "杭州电子科技大学";
const year = "2027";

function guidance(profile: Record<string, unknown> = {}): GuidanceRun {
  return generateGuidance({
    subjectId: "matching-test-student",
    guidanceRunId: "matching-test-guidance",
    generatedAt: "2026-10-04T00:00:00Z",
    profile: {
      ...blankProfile(),
      major: "机械设计制造及其自动化",
      cities: ["杭州"],
      crossMajor: "接受跨专业",
      hours: "每天4小时",
      ...profile,
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [],
  });
}

function source(excerpt: string, changes: Partial<WebSource> = {}): WebSource {
  return {
    id: "hdu-catalog",
    title: `${school}2027年硕士研究生招生专业目录`,
    url: "https://grs.hdu.edu.cn/catalog.htm",
    kind: "official_page",
    excerpt,
    verified: false,
    retrievedAt: "2026-10-04T00:00:00Z",
    ...changes,
  };
}

const twoRoutes = () =>
  source(
    `${school}2027年硕士研究生招生专业目录。初试考试科目：\n080200 机械工程 学术学位 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理。\n085500 机械 专业学位 ①101思想政治理论 ②204英语二 ③302数学二 ④811机械原理。\n${school}地址：浙江省杭州市钱塘区大学路1号。`,
  );

function candidates(
  run = guidance(),
  sources = [twoRoutes()],
  disciplines = mechanical,
  schoolNames?: string[],
) {
  return buildEvidenceCandidates({
    run,
    sources,
    disciplines,
    targetYear: year,
    schoolNames,
  });
}

function exams(sources: WebSource[], code = "0802", programName = "机械工程") {
  return extractProgramExams({
    institutionName: school,
    programName,
    discipline: discipline(code),
    sources,
    targetYear: year,
  });
}

test("a fixed mechanical profile deterministically investigates both academic and professional routes", () => {
  const run = guidance();
  const first = createDemandPlan(run);
  assert.deepEqual(createDemandPlan(run), first);
  assert.deepEqual(
    first.directions.map((item) => item.disciplineCode),
    ["0802", "0855"],
  );
  assert.ok(first.directions.every((item) => item.searchSchools?.length === 0));
});

test("a mechanical undergraduate declining cross-major study still investigates related academic and professional routes", () => {
  const run = guidance({ crossMajor: "不接受跨专业" });
  assert.deepEqual(
    createDemandPlan(run).directions.map((item) => item.disciplineCode),
    ["0802", "0855"],
  );
  assert.deepEqual(
    candidates(run)
      .recommendations.map((item) => item.disciplineCode)
      .sort(),
    ["0802", "0855"],
  );
});

test("an explicitly negative interest cannot become a positive investigation direction", () => {
  const plan = createDemandPlan(
    guidance({ targetMajor: "不想学计算机，只考虑机械" }),
  );
  assert.deepEqual(
    plan.directions.map((item) => item.disciplineCode),
    ["0802", "0855"],
  );
});

test("coded Hangzhou programme evidence enters the inventory independently of model recommendations", () => {
  const result = candidates();
  assert.equal(result.recommendations.length, 2);
  assert.deepEqual(
    result.recommendations.map((item) => item.disciplineCode).sort(),
    ["0802", "0855"],
  );
  assert.ok(
    result.recommendations.every((item) => item.institutionName === school),
  );
  assert.ok(result.recommendations.every((item) => item.tier === "preferred"));
  assert.ok(
    result.recommendations.every((item) =>
      item.constraintChecks?.some(
        (check) => check.field === "cities" && check.status === "match",
      ),
    ),
  );
  assert.equal(result.audit[0].status, "recommended");
});

test("a school keeps both degree routes visible while counting once in the school list", () => {
  const run = guidance();
  const sources = [twoRoutes()];
  const result = rankDemandCandidates(
    candidates(run, sources).recommendations,
    run,
    mechanical,
    sources,
    year,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].institutionName, school);
  assert.equal(result[0].degreeType, "academic");
  assert.equal(result[0].programAlternatives.length, 1);
  assert.equal(result[0].programAlternatives[0].degreeType, "professional");
  assert.equal(result[0].exams.status, "verified_current");
  assert.deepEqual(
    result[0].exams.subjects.map((item) => item.code),
    ["101", "201", "301", "811"],
  );
  assert.deepEqual(
    result[0].programAlternatives[0].exams.subjects.map((item) => item.code),
    ["101", "204", "302", "811"],
  );
});

test("a validated model explanation for the same programme cannot erase its directory code and college metadata", () => {
  const run = guidance();
  const page = source(
    `${school}2027年硕士研究生招生专业目录。初试考试科目：\n001机械工程学院 | 080200 机械工程 学术学位 ①101思想政治理论 ②201英语一 ③301数学一 ④812机械工程综合。\n002机械工程学院 | 085500 机械 专业学位 ①101思想政治理论 ②204英语二 ③302数学二 ④812机械工程综合。\n${school}地址：杭州市钱塘区大学路1号。`,
  );
  const inventory = candidates(run, [page]).recommendations;
  const academic = inventory.find((item) => item.degreeType === "academic")!;
  assert.equal(academic.majorCode, "080200");
  assert.equal(academic.collegeName, "机械工程学院");
  const modelCard = {
    ...academic,
    majorCode: undefined,
    collegeName: undefined,
    rationale: "依据课程背景与目标比较专业训练，这是初步判断。",
  };
  const ranked = rankDemandCandidates(
    [modelCard, ...inventory],
    run,
    mechanical,
    [page],
    year,
  );
  assert.equal(ranked[0].majorCode, "080200");
  assert.equal(ranked[0].collegeName, "机械工程学院");
});

test("provider tier wording and input order cannot change the deterministic school order or first choice", () => {
  const run = guidance();
  const outside = source(
    "南京乙大学2027年硕士研究生招生专业目录。080200 机械工程 学术学位。南京乙大学地址：江苏省南京市大学路1号。",
    {
      id: "outside",
      title: "南京乙大学2027年硕士研究生招生专业目录",
      url: "https://grad.b.edu.cn/catalog.htm",
    },
  );
  const sources = [twoRoutes(), outside];
  const inventory = candidates(run, sources).recommendations;
  const first = rankDemandCandidates(inventory, run, mechanical, sources, year);
  const changed = inventory
    .map((item, index) => ({
      ...item,
      tier: index % 2 ? ("preferred" as const) : ("exploratory" as const),
      tierReasons: ["模型随机文本"],
    }))
    .reverse();
  const second = rankDemandCandidates(changed, run, mechanical, sources, year);
  assert.deepEqual(second, first);
  assert.equal(first[0].institutionName, school);
  assert.equal(first[0].tier, "preferred");
});

test("a saved profile change recalculates city preference without rewriting the previous snapshot", () => {
  const firstRun = guidance();
  const before = structuredClone(firstRun);
  const changedRun = guidance({ cities: ["南京"] });
  const outside = source(
    "南京乙大学2027年硕士研究生招生专业目录。080200 机械工程 学术学位。南京乙大学地址：江苏省南京市大学路1号。",
    {
      id: "outside",
      title: "南京乙大学2027年硕士研究生招生专业目录",
      url: "https://grad.b.edu.cn/catalog.htm",
    },
  );
  const sources = [twoRoutes(), outside];
  const original = rankDemandCandidates(
    candidates(firstRun, sources).recommendations,
    firstRun,
    mechanical,
    sources,
    year,
  );
  const changed = rankDemandCandidates(
    candidates(changedRun, sources).recommendations,
    changedRun,
    mechanical,
    sources,
    year,
  );
  assert.equal(original[0].institutionName, school);
  assert.equal(changed[0].institutionName, "南京乙大学");
  assert.deepEqual(firstRun, before);
});

test("explicit professional preference changes the main route while retaining academic comparison", () => {
  const run = guidance({ degreePreference: "倾向专硕" });
  const sources = [twoRoutes()];
  const ranked = rankDemandCandidates(
    candidates(run, sources).recommendations,
    run,
    mechanical,
    sources,
    year,
  );
  assert.equal(ranked[0].degreeType, "professional");
  assert.equal(ranked[0].tier, "preferred");
  assert.equal(ranked[0].programAlternatives[0].degreeType, "academic");
  assert.equal(ranked[0].programAlternatives[0].tier, "alternative");
});

test("negative degree and career language does not accidentally prefer the excluded route", () => {
  const run = guidance({
    degreePreference: "不考虑学硕",
    studyGoal: "不想读博，希望就业",
  });
  const inventory = candidates(run).recommendations;
  const academic = inventory.find((item) => item.degreeType === "academic")!;
  const professional = inventory.find(
    (item) => item.degreeType === "professional",
  )!;
  assert.notEqual(
    evaluateDemandMatch(academic, run, discipline("0802")).tier,
    "preferred",
  );
  assert.equal(
    evaluateDemandMatch(professional, run, discipline("0855")).tier,
    "preferred",
  );
});

test("clear exclusions filter the catalogue but open and double-negative notes preserve both degree routes", () => {
  for (const [notes, codes] of [
    ["不考虑学硕", ["0855"]],
    ["只考虑学硕", ["0802"]],
    ["并非不考虑学硕，学硕和专硕都可以比较", ["0802", "0855"]],
    ["不是不想读学硕", ["0802", "0855"]],
    ["不排除专硕", ["0802", "0855"]],
    ["没有说不考虑学硕", ["0802", "0855"]],
    ["不考虑放弃学硕，学硕和专硕都可以比较", ["0802", "0855"]],
    ["只考虑专硕而不考虑学硕", ["0855"]],
  ] as [string, string[]][]) {
    const run = guidance({ notes });
    assert.deepEqual(
      createDemandPlan(run).directions.map((item) => item.disciplineCode),
      codes,
      notes,
    );
    const results = candidates(run).recommendations;
    for (const item of results)
      assert.equal(
        evaluateDemandMatch(item, run, discipline(item.disciplineCode)).tier,
        codes.includes(item.disciplineCode) ? "preferred" : "alternative",
        notes,
      );
  }
});

test("city, interest and degree rules generalize to non-registry schools in different fields", () => {
  for (const scenario of [
    {
      city: "南京",
      otherCity: "成都",
      school: "南京青山大学",
      otherSchool: "成都远山大学",
      major: "法学",
      targetMajor: "律师",
      academic: "0301",
      professional: "0351",
      academicCode: "030101",
      professionalCode: "035101",
      academicName: "法学理论",
      professionalName: "法律",
    },
    {
      city: "苏州",
      otherCity: "武汉",
      school: "苏州青山大学",
      otherSchool: "武汉远山大学",
      major: "计算机科学与技术",
      targetMajor: "软件编程",
      academic: "0812",
      professional: "0854",
      academicCode: "081200",
      professionalCode: "085404",
      academicName: "计算机科学与技术",
      professionalName: "计算机技术",
    },
  ]) {
    const selected = [
      discipline(scenario.academic),
      discipline(scenario.professional),
    ];
    const page = (institutionName: string, city: string, id: string) =>
      source(
        `${institutionName}2027年硕士研究生招生专业目录。\n${scenario.academicCode} ${scenario.academicName} 学术学位。\n${scenario.professionalCode} ${scenario.professionalName} 专业学位。\n${institutionName}地址：${city}市大学路1号。`,
        {
          id,
          title: `${institutionName}2027年硕士研究生招生专业目录`,
          url: `https://grad.${id}.edu.cn/catalog.htm`,
        },
      );
    const pages = [
      page(scenario.otherSchool, scenario.otherCity, "outside-general"),
      page(scenario.school, scenario.city, "inside-general"),
    ];
    const run = guidance({
      major: scenario.major,
      targetMajor: scenario.targetMajor,
      cities: [scenario.city],
      degreePreference: "倾向专硕",
    });
    const leads = createDemandPlan(run).directions.map(
      (item) => item.disciplineCode,
    );
    assert.ok(
      leads.includes(scenario.academic) &&
        leads.includes(scenario.professional),
    );
    const inventory = buildEvidenceCandidates({
      run,
      disciplines: selected,
      sources: pages,
      targetYear: year,
      schoolNames: [scenario.school, scenario.otherSchool],
    }).recommendations;
    const ranked = rankDemandCandidates(inventory, run, selected, pages, year);
    assert.equal(ranked[0].institutionName, scenario.school);
    assert.equal(ranked[0].degreeType, "professional");
    assert.equal(ranked[0].tier, "preferred");
    assert.equal(ranked[0].programAlternatives[0].degreeType, "academic");
    assert.equal(ranked[0].programAlternatives[0].tier, "alternative");
    const changed = guidance({
      major: scenario.major,
      targetMajor: scenario.targetMajor,
      cities: [scenario.otherCity],
      degreePreference: "只考虑学硕",
    });
    assert.ok(
      createDemandPlan(changed).directions.every(
        (item) => discipline(item.disciplineCode).degreeType === "academic",
      ),
    );
    const academicInventory = buildEvidenceCandidates({
      run: changed,
      disciplines: [selected[0]],
      sources: pages,
      targetYear: year,
      schoolNames: [scenario.school, scenario.otherSchool],
    }).recommendations;
    const reranked = rankDemandCandidates(
      academicInventory,
      changed,
      selected,
      pages,
      year,
    );
    assert.equal(reranked[0].institutionName, scenario.otherSchool);
    assert.equal(reranked[0].degreeType, "academic");
    assert.equal(reranked[0].programAlternatives.length, 0);
  }
});

test("each same-school route retains independent college, study mode, city and tuition after repeated ranking", () => {
  const run = guidance({ budget: "每年10000元以内" });
  const inventory = candidates(run).recommendations;
  const academic = {
    ...inventory[0],
    collegeName: "机械工程学院",
    studyMode: "full_time" as const,
    location: {
      city: "杭州",
      quote: "机械工程学院培养校区位于杭州市",
      sourceId: "academic-campus",
    },
    tuition: {
      amount: 8000,
      currency: "CNY" as const,
      period: "academic_year" as const,
      year: 2027,
      studyMode: "full_time" as const,
      quote: "机械工程学费8000元每年",
      sourceId: "academic-fees",
    },
    constraintChecks: [
      {
        field: "cities" as const,
        status: "match" as const,
        reason: "杭州",
        sourceIds: ["academic-campus"],
      },
      {
        field: "budget" as const,
        status: "match" as const,
        reason: "8000在预算内",
        sourceIds: ["academic-fees"],
      },
    ],
  };
  const professional = {
    ...inventory[1],
    collegeName: "技术研究院",
    studyMode: "part_time" as const,
    location: {
      city: "南京",
      quote: "技术研究院培养校区位于南京市",
      sourceId: "professional-campus",
    },
    tuition: {
      amount: 20000,
      currency: "CNY" as const,
      period: "academic_year" as const,
      year: 2027,
      studyMode: "part_time" as const,
      quote: "机械专业学费20000元每年",
      sourceId: "professional-fees",
    },
    constraintChecks: [
      {
        field: "cities" as const,
        status: "mismatch" as const,
        reason: "南京不在意向城市",
        sourceIds: ["professional-campus"],
      },
      {
        field: "budget" as const,
        status: "mismatch" as const,
        reason: "超过年度预算",
        sourceIds: ["professional-fees"],
      },
    ],
  };
  const ranked = rankDemandCandidates(
    [academic, professional],
    run,
    mechanical,
    [],
    year,
  );
  const route = ranked[0].programAlternatives[0];
  assert.equal(ranked[0].location?.city, "杭州");
  assert.equal(route.location?.city, "南京");
  assert.equal(route.tuition?.amount, 20000);
  assert.equal(route.collegeName, "技术研究院");
  assert.equal(route.studyMode, "part_time");
  assert.deepEqual(route.constraintChecks, professional.constraintChecks);
  assert.deepEqual(
    rankDemandCandidates(ranked, run, mechanical, [], year),
    ranked,
  );
  const legacy = structuredClone(ranked);
  delete legacy[0].programAlternatives[0].location;
  delete legacy[0].programAlternatives[0].tuition;
  delete legacy[0].programAlternatives[0].constraintChecks;
  const recovered = rankDemandCandidates(legacy, run, mechanical, [], year)[0]
    .programAlternatives[0];
  assert.equal(recovered.location, undefined);
  assert.equal(recovered.tuition, undefined);
  assert.ok(
    recovered.constraintChecks?.every((check) => check.status === "unknown"),
  );
});

test("identical programme names and codes in different colleges remain independent routes with scoped initial subjects", () => {
  const run = guidance();
  const page = source(
    `${school}2027年硕士研究生招生专业目录。初试科目：\n001机械工程学院 | 080200 机械工程 全日制 ①101思想政治理论 ②201英语一 ③301数学一。\n002技术研究院 | 080200 机械工程 非全日制 ①101思想政治理论 ②204英语二 ③302数学二。\n${school}地址：杭州市钱塘区。`,
  );
  const inventory = candidates(
    run,
    [page],
    [discipline("0802")],
  ).recommendations;
  assert.equal(inventory.length, 2);
  const academic = inventory.find(
    (item) => item.collegeName === "机械工程学院",
  )!;
  const institute = inventory.find(
    (item) => item.collegeName === "技术研究院",
  )!;
  assert.deepEqual(
    academic.exams!.subjects.map((subject) => subject.code),
    ["101", "201", "301"],
  );
  assert.deepEqual(
    institute.exams!.subjects.map((subject) => subject.code),
    ["101", "204", "302"],
  );
  const ranked = rankDemandCandidates(
    inventory,
    run,
    [discipline("0802")],
    [page],
    year,
  );
  assert.equal(ranked[0].programAlternatives.length, 1);
  assert.notEqual(
    ranked[0].collegeName,
    ranked[0].programAlternatives[0].collegeName,
  );
  assert.deepEqual(
    rankDemandCandidates(ranked, run, [discipline("0802")], [page], year),
    ranked,
  );
  assert.equal(exams([page]).status, "ambiguous");
  for (const scope of [
    { collegeName: "未知学院" },
    { collegeName: "机械工程学院", studyMode: "part_time" as const },
  ])
    assert.equal(
      extractProgramExams({
        institutionName: school,
        programName: "机械工程",
        discipline: discipline("0802"),
        sources: [page],
        targetYear: year,
        ...scope,
      }).status,
      "unknown",
    );
});

test("unreviewed assessment performance cannot eliminate a matching programme or decide a degree route", () => {
  const run = guidance();
  const weakRun = structuredClone(run);
  weakRun.assessmentSummary.references = [
    {
      assessmentAttemptId: "practice",
      diagnosisVersion: "practice-version",
      example: true,
      usableForRecommendation: false,
      modules: [
        { module: "math", correct: 0, incorrect: 5, unanswered: 0, total: 5 },
      ],
      weakPoints: ["导数"],
      limitations: ["示例练习"],
    },
  ];
  const sources = [twoRoutes()];
  assert.deepEqual(
    rankDemandCandidates(
      candidates(weakRun, sources).recommendations,
      weakRun,
      mechanical,
      sources,
      year,
    ),
    rankDemandCandidates(
      candidates(run, sources).recommendations,
      run,
      mechanical,
      sources,
      year,
    ),
  );
});

test("actual module-specific assessment gaps become preparation tasks without changing tiers and repeated evaluation does not duplicate tasks", () => {
  const run = guidance();
  const weakRun = structuredClone(run);
  const assessment = {
    assessmentAttemptId: "weak-practice",
    diagnosisVersion: "weak-practice-version",
    questionBankVersion: "test-practice-bank",
    submittedAt: "2026-10-03T10:00:00Z",
    scope: { math: "common-foundation" },
    example: true,
    usableForRecommendation: false,
    modules: [
      { module: "math", correct: 0, incorrect: 5, unanswered: 0, total: 5 },
    ],
    items: [
      {
        questionId: "derivative",
        questionRevisionId: "derivative-r1",
        module: "math",
        point: "导数",
        outcome: "incorrect" as const,
        scopes: ["common-foundation", "math-one", "math-two"],
        calibration: "manual_initial" as const,
      },
    ],
    weakPoints: ["导数"],
    limitations: ["示例练习，不用于能力预测"],
  };
  weakRun.assessmentSummary.references = [
    assessment,
    structuredClone(assessment),
  ];
  const sources = [twoRoutes()];
  const original = rankDemandCandidates(
    candidates(run, sources).recommendations,
    run,
    mechanical,
    sources,
    year,
  );
  const observed = rankDemandCandidates(
    candidates(weakRun, sources).recommendations,
    weakRun,
    mechanical,
    sources,
    year,
  );
  assert.deepEqual(
    observed.map((item) => ({
      school: item.institutionName,
      code: item.disciplineCode,
      tier: item.tier,
      match: item.match,
    })),
    original.map((item) => ({
      school: item.institutionName,
      code: item.disciplineCode,
      tier: item.tier,
      match: item.match,
    })),
  );
  assert.equal(
    observed[0].preparation.filter(
      (item) => item.includes("练习回顾") && item.includes("导数"),
    ).length,
    1,
  );
  assert.deepEqual(
    rankDemandCandidates(observed, weakRun, mechanical, sources, year),
    observed,
  );
});

test("search snippets do not enter the programme inventory or supply exam combinations", () => {
  const snippet = { ...twoRoutes(), kind: "search_snippet" as const };
  const inventory = candidates(guidance(), [snippet], mechanical, [school]);
  assert.equal(inventory.recommendations.length, 0);
  assert.equal(inventory.audit[0].status, "awaiting_evidence");
  assert.equal(exams([snippet]).status, "unknown");
});

test("a current stopped programme is excluded even when an earlier historical or open page was encountered first", () => {
  const historical = source(
    `${school}2026年硕士研究生招生专业目录。080200 机械工程 学术学位。${school}地址：杭州市钱塘区。`,
    { id: "historical", title: `${school}2026年硕士研究生招生专业目录` },
  );
  const stopped = source(
    `${school}2027年硕士研究生招生专业目录。080200 机械工程，本专业暂停招生。`,
    { id: "stopped" },
  );
  for (const sources of [
    [historical, stopped],
    [stopped, historical],
  ]) {
    const inventory = candidates(guidance(), sources, [discipline("0802")]);
    assert.equal(inventory.recommendations.length, 0);
    assert.equal(inventory.audit[0].status, "excluded");
  }
});

test("a current hard eligibility conflict cannot be rescued by an older unrestricted project page", () => {
  const old = source(
    `${school}2026年硕士研究生招生专业目录。030101 法学理论。`,
    { id: "old-law", title: `${school}2026年硕士研究生招生专业目录` },
  );
  const current = source(
    `${school}2027年硕士研究生招生专业目录。030101 法学理论，仅限法学本科毕业生报考。`,
    { id: "current-law" },
  );
  for (const sources of [
    [old, current],
    [current, old],
  ]) {
    const inventory = candidates(guidance({ targetMajor: "法学" }), sources, [
      discipline("0301"),
    ]);
    assert.equal(inventory.recommendations.length, 0);
    assert.equal(inventory.audit[0].status, "excluded");
  }
});

test("current supported programme rows take precedence over historical rows independently of source order", () => {
  const historical = source(
    `${school}2026年硕士研究生招生专业目录。080200 机械工程 学术学位。${school}地址：杭州市钱塘区。`,
    { id: "old-open", title: `${school}2026年硕士研究生招生专业目录` },
  );
  for (const sources of [
    [historical, twoRoutes()],
    [twoRoutes(), historical],
  ]) {
    const inventory = candidates(guidance(), sources, [discipline("0802")]);
    assert.equal(inventory.recommendations.length, 1);
    assert.equal(
      inventory.recommendations[0].admissionStatus,
      "current_evidence",
    );
    assert.ok(inventory.recommendations[0].citations.includes("hdu-catalog"));
  }
});

test("an unrelated neighbouring programme closure cannot exclude an open mechanical programme", () => {
  const page = source(
    `${school}2027年硕士研究生招生专业目录。080200 机械工程正常招生。085500 机械，本专业暂停招生。${school}地址：杭州市钱塘区。`,
  );
  const inventory = candidates(guidance(), [page]);
  assert.deepEqual(
    inventory.recommendations.map((item) => item.disciplineCode),
    ["0802"],
  );
});

test("exam extraction binds each combination to its actual coded programme rather than its neighbour", () => {
  assert.deepEqual(
    exams([twoRoutes()]).subjects.map((item) => item.code),
    ["101", "201", "301", "811"],
  );
  assert.deepEqual(
    exams([twoRoutes()], "0855", "机械").subjects.map((item) => item.code),
    ["101", "204", "302", "811"],
  );
  const page = source(
    `${school}2027年硕士研究生招生专业目录。初试考试科目：080200 机械工程。085500 机械 ①101思想政治理论 ②204英语二 ③302数学二。`,
  );
  assert.equal(exams([page]).status, "unknown");
});

test("a programme name mentioned in a neighbouring row's curriculum does not transfer its exams within the same category", () => {
  const page = source(
    `${school}2027年硕士研究生招生专业目录。初试考试科目：030101 法学理论，培养内容包含法律史课程，201英语一。030102 法律史，考试科目另行公布。`,
  );
  assert.equal(exams([page], "0301", "法律史").status, "unknown");
});

test("an explicitly labelled self-set initial subject is preserved with its actual code and name", () => {
  const page = source(
    `${school}2027年硕士研究生招生专业目录。080200 机械工程 初试科目：①101思想政治理论 ②201英语一 ③301数学一 ④812机械工程综合。复试参考科目：821机械设计。培养课程包含801机械制造基础。`,
  );
  const result = exams([page]);
  assert.equal(result.status, "verified_current");
  assert.deepEqual(result.subjects, [
    { code: "101", name: "思想政治理论" },
    { code: "201", name: "英语一" },
    { code: "301", name: "数学一" },
    { code: "812", name: "机械工程综合" },
  ]);
});

test("self-set initial subjects do not require an unrelated uniform subject to be present in the excerpt", () => {
  const page = source(
    `${school}2027年硕士研究生招生专业目录。080200 机械工程 初试科目：④812机械工程综合。其他初试科目见完整目录。`,
  );
  const result = exams([page]);
  assert.equal(result.status, "verified_current");
  assert.deepEqual(result.subjects, [{ code: "812", name: "机械工程综合" }]);
});

test("circled self-set codes under retest or reference-course headings cannot become initial-exam subjects", () => {
  for (const heading of [
    "复试科目",
    "复试参考科目",
    "参考课程",
    "同等学力加试科目",
  ]) {
    const page = source(
      `${school}2027年硕士研究生招生专业目录。080200 机械工程 初试科目：①101思想政治理论 ②201英语一 ③301数学一。${heading}：④812机械工程综合。`,
    );
    const result = exams([page]);
    assert.equal(result.status, "verified_current", heading);
    assert.deepEqual(
      result.subjects.map((item) => item.code),
      ["101", "201", "301"],
      heading,
    );
  }
});

test("missing exam rows do not invent a mathematics or English combination from degree labels", () => {
  const page = source(
    `${school}2027年硕士研究生招生专业目录。080200 机械工程 学术学位。085500 机械 专业学位。`,
  );
  for (const [code, name] of [
    ["0802", "机械工程"],
    ["0855", "机械"],
  ]) {
    const result = exams([page], code, name);
    assert.equal(result.status, "unknown");
    assert.deepEqual(result.subjects, []);
  }
});

test("historical rows stay historical and a clear target-year row takes precedence", () => {
  const old = source(
    `${school}2026年硕士研究生招生专业目录。初试考试科目：080200 机械工程 ①101思想政治理论 ②204英语二 ③302数学二。`,
    { id: "old-exam", title: `${school}2026年硕士研究生招生专业目录` },
  );
  const historical = exams([old]);
  assert.equal(historical.status, "historical");
  assert.equal(historical.year, 2026);
  const current = exams([old, twoRoutes()]);
  assert.equal(current.status, "verified_current");
  assert.equal(current.year, 2027);
  assert.deepEqual(
    current.subjects.map((item) => item.code),
    ["101", "201", "301", "811"],
  );
});

test("historical ambiguous combinations cannot outweigh one clear target-year combination", () => {
  const old = source(
    `${school}2026年硕士研究生招生专业目录。初试考试科目：080200 机械工程，方向一201英语一301数学一，方向二204英语二302数学二。`,
    { id: "old-ambiguous", title: `${school}2026年硕士研究生招生专业目录` },
  );
  const result = exams([old, twoRoutes()]);
  assert.equal(result.status, "verified_current");
  assert.equal(result.year, 2027);
  assert.deepEqual(
    result.subjects.map((item) => item.code),
    ["101", "201", "301", "811"],
  );
});

test("two current conflicting combinations are ambiguous without selecting one by source order", () => {
  const alternate = source(
    `${school}2027年硕士研究生招生专业目录。初试考试科目：080200 机械工程 ①101思想政治理论 ②204英语二 ③302数学二。`,
    { id: "current-alternate" },
  );
  for (const sources of [
    [twoRoutes(), alternate],
    [alternate, twoRoutes()],
  ]) {
    const result = exams(sources);
    assert.equal(result.status, "ambiguous");
    assert.deepEqual(result.subjects, []);
  }
});

test("multiple direction groups or foreign-language choices remain ambiguous pending group selection", () => {
  for (const combination of [
    "方向一201英语一301数学一；方向二204英语二302数学二",
    "201英语一或203日语，301数学一",
    "202俄语或203日语，301数学一",
  ]) {
    const page = source(
      `${school}2027年硕士研究生招生专业目录。初试考试科目：080200 机械工程 ${combination}。`,
    );
    assert.equal(exams([page]).status, "ambiguous", combination);
  }
});

test("an inconsistent exam code/name pair is rejected rather than rewritten as a plausible combination", () => {
  const page = source(
    `${school}2027年硕士研究生招生专业目录。初试考试科目：080200 机械工程 201英语二 301数学一。`,
  );
  assert.equal(exams([page]).status, "unknown");
});

test("ranked results and stored guidance snapshots stay immutable under repeated rule evaluation", () => {
  const run = guidance();
  const sources = [twoRoutes()];
  const inventory: ResearchReport["recommendations"] = candidates(
    run,
    sources,
  ).recommendations;
  const before = structuredClone({ run, sources, inventory });
  const first = rankDemandCandidates(inventory, run, mechanical, sources, year);
  assert.deepEqual(
    rankDemandCandidates(inventory, run, mechanical, sources, year),
    first,
  );
  assert.deepEqual({ run, sources, inventory }, before);
});
