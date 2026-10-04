import test from "node:test";
import assert from "node:assert/strict";
import { deriveResearchCoverage } from "../../server/explanation/research-coverage.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import type { ResearchReport } from "../../server/explanation/research.ts";

// These fictional official-page fixtures verify evidence boundaries, not real admission policies.
const school = "南京清源大学";
const disciplines = getDisciplineCatalog().items.filter((item) =>
  ["0802", "0855"].includes(item.code),
);
const run = generateGuidance({
  subjectId: "coverage-student",
  guidanceRunId: "coverage-run",
  generatedAt: "2026-10-04T00:00:00Z",
  profile: {
    ...blankProfile(),
    major: "机械工程",
    cities: ["杭州"],
    budget: "1万元以内",
    targetMajor: "机械",
  },
  profileVersion: 1,
  selectionVersion: 0,
  confirmedMajorId: null,
  excludedMajorIds: [],
  assessments: [],
});
function source(
  id: string,
  excerpt: string,
  changes: Partial<WebSource> = {},
): WebSource {
  return {
    id,
    excerpt,
    title: `${school}研究生资料`,
    url: `https://yz.qingyuan.edu.cn/${id}.htm`,
    kind: "official_page",
    retrievedAt: "2026-10-04T00:00:00Z",
    verified: false,
    ...changes,
  };
}
function directory(
  year = 2026,
  body = "001机械学院 | 080200 机械工程 学术学位 全日制 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理",
) {
  return source(
    `directory-${year}`,
    `${school}${year}年硕士研究生招生专业目录。\n${body}`,
  );
}
function derive(
  sources: WebSource[],
  changes: Partial<Parameters<typeof deriveResearchCoverage>[0]> = {},
) {
  return deriveResearchCoverage({
    run,
    disciplines,
    sources,
    recommendations: [],
    candidateAudit: [
      {
        institutionName: school,
        status: "awaiting_evidence",
        reasons: [],
        sourceIds: [],
      },
    ],
    targetYear: "2027",
    ...changes,
  });
}
const first = (result: ReturnType<typeof derive>) =>
  result.candidates[0].coverage!.programs[0];

test("a fetched school page without a concrete master's row produces one precise school-level gap", () => {
  const page = source("home", `${school}官方网站，研究生招生栏目导航`);
  const result = derive([page]);
  assert.equal(result.summary.programCount, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].field, "program");
  assert.equal(result.gaps[0].priority, "high");
  assert.equal(result.gaps[0].programIdentity, undefined);
  assert.deepEqual(result.gaps[0].referenceYears, [2026, 2025, 2024]);
  assert.match(result.gaps[0].reason, /不能据此排除/);
  assert.match(result.gaps[0].nextAction, /目录.*附件/);
});

test("search snippets and a target year only in a title cannot become programme proof", () => {
  const snippet = directory(2027);
  snippet.kind = "search_snippet";
  const missing = derive([snippet]);
  assert.equal(missing.summary.programCount, 0);
  const undated = source(
    "undated",
    `${school}硕士研究生招生专业目录\n080200 机械工程 全日制`,
    { title: `${school}2027年硕士专业目录` },
  );
  const result = derive([undated]);
  assert.equal(first(result).fields.program.status, "missing");
  assert.equal(first(result).fields.program.references[0].year, undefined);
  assert.equal(result.summary.supportedProgramCount, 0);
});

test("a dated programme retains independent unknown fields and clearly labelled historical exam reference", () => {
  const result = derive([directory()]);
  const program = first(result);
  assert.equal(program.majorCode, "080200");
  assert.equal(program.collegeName, "机械学院");
  assert.equal(program.studyMode, "full_time");
  assert.equal(program.referenceYear, 2026);
  assert.equal(program.fields.program.status, "supported_reference");
  assert.equal(program.fields.exams.status, "supported_reference");
  for (const field of [
    "location",
    "tuition",
    "eligibility",
    "curriculum",
  ] as const)
    assert.equal(program.fields[field].status, "missing");
  assert.equal(
    program.missing.find((gap) => gap.field === "exams")!.priority,
    "low",
  );
  assert.equal(
    program.missing.find((gap) => gap.field === "exams")!.requestedYear,
    2027,
  );
  assert.equal(
    program.missing.find((gap) => gap.field === "location")!.requestedYear,
    2026,
  );
  assert.equal(result.summary.supportedProgramCount, 1);
  assert.equal(result.summary.pendingProgramCount, 1);
  assert.ok(
    program.fields.program.references.every((ref) =>
      directory().excerpt.includes(ref.quote),
    ),
  );
});

test("every related read programme remains visible even without model inventory or a final school card", () => {
  const result = derive([
    directory(
      2026,
      [
        "001机械学院 | 080200 机械工程 全日制 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理",
        "001机械学院 | 080201 机械制造及其自动化 全日制",
        "002工程学院 | 085500 机械 非全日制",
        "003计算机学院 | 081200 计算机科学与技术 全日制",
      ].join("\n"),
    ),
  ]);
  assert.equal(result.summary.programCount, 3);
  assert.deepEqual(
    result.candidates[0]
      .coverage!.programs.map((program) => program.majorCode)
      .sort(),
    ["080200", "080201", "085500"],
  );
  assert.ok(
    result.candidates[0].coverage!.programs.every((program) =>
      program.fields.program.references.every((ref) =>
        ref.quote.includes(program.majorCode!),
      ),
    ),
  );
  assert.ok(
    result.candidates[0].coverage!.programs.every((program) =>
      program.fields.program.references.every(
        (ref) => !/081200/.test(ref.quote),
      ),
    ),
  );
});

test("same code in different colleges and study modes has independent evidence and stable task identities", () => {
  const a = directory(
    2026,
    [
      "001机械学院 | 085500 机械 全日制 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理",
      "002工程学院 | 085500 机械 非全日制 ①101思想政治理论 ②204英语二 ③302数学二 ④812工程基础",
    ].join("\n"),
  );
  const b = source("other", `${school}学校概况`);
  const result = derive([a, b]);
  const reversed = derive([b, a]);
  assert.deepEqual(result, reversed);
  const programs = result.candidates[0].coverage!.programs;
  assert.equal(programs.length, 2);
  assert.notEqual(programs[0].identity, programs[1].identity);
  const mechanical = programs.find(
    (program) => program.collegeName === "机械学院",
  )!;
  assert.match(mechanical.fields.exams.references[0].quote, /201英语一/);
  assert.doesNotMatch(mechanical.fields.exams.references[0].quote, /204英语二/);
  assert.equal(
    new Set(result.gaps.map((gap) => gap.id)).size,
    result.gaps.length,
  );
});

test("current stop-enrolment overrides a supported historical programme and never produces a retry gap", () => {
  const old = directory();
  const stopped = directory(
    2027,
    "001机械学院 | 080200 机械工程 学术学位 全日制 本专业停招",
  );
  const result = derive([old, stopped]);
  assert.equal(first(result).fields.program.status, "excluded");
  assert.equal(result.gaps.length, 0);
  assert.equal(result.summary.supportedProgramCount, 0);
  const schoolExcluded = derive([source("home", `${school}招生资料`)], {
    candidateAudit: [
      {
        institutionName: school,
        status: "excluded",
        reasons: ["明确资格冲突"],
        sourceIds: ["home"],
      },
    ],
  });
  assert.equal(schoolExcluded.gaps.length, 0);
});

test("different-college rows cannot supply another college's eligibility or curriculum", () => {
  const page = directory(
    2026,
    [
      "001机械学院 | 085500 机械 全日制",
      "002工程学院 | 085500 机械 非全日制 报考条件：仅限机械工程本科背景；培养方案课程设置：机器人设计",
    ].join("\n"),
  );
  const result = derive([page]);
  const mechanical = result.candidates[0].coverage!.programs.find(
    (program) => program.collegeName === "机械学院",
  )!;
  const engineering = result.candidates[0].coverage!.programs.find(
    (program) => program.collegeName === "工程学院",
  )!;
  assert.equal(mechanical.fields.eligibility.status, "missing");
  assert.equal(mechanical.fields.curriculum.status, "missing");
  assert.equal(engineering.fields.eligibility.status, "supported_reference");
  assert.equal(engineering.fields.curriculum.status, "supported_reference");
});

test("model-supplied city, fee and exam claims are independently rechecked rather than treated as acquired evidence", () => {
  const claimed: ResearchReport["recommendations"][number] = {
    institutionName: school,
    programName: "机械工程",
    disciplineCode: "0802",
    majorCode: "080200",
    collegeName: "机械学院",
    studyMode: "full_time",
    rationale: "模型解释",
    preparation: [],
    uncertainties: [],
    citations: ["directory-2026"],
    location: {
      city: "杭州",
      quote: "虚构原文",
      sourceId: "directory-2026",
      year: 2027,
    },
    tuition: {
      amount: 8000,
      currency: "CNY",
      period: "academic_year",
      year: 2027,
      studyMode: "full_time",
      quote: "虚构收费",
      sourceId: "directory-2026",
    },
    exams: {
      status: "verified_current",
      subjects: [{ code: "204", name: "英语二" }],
      year: 2027,
      reason: "模型填入",
    },
  };
  const result = derive([directory()], { recommendations: [claimed] });
  assert.equal(first(result).fields.location.status, "missing");
  assert.equal(first(result).fields.tuition.status, "missing");
  assert.equal(first(result).fields.exams.status, "supported_reference");
  assert.match(first(result).fields.exams.references[0].quote, /201英语一/);
});

test("failed attachment diagnostics attach to the right school's gap and retain actionable reasons", () => {
  const failed = "https://yz.qingyuan.edu.cn/2026-directory.pdf";
  const page = source("list", `${school}研究生招生资料`, {
    documentLinks: [{ url: failed, title: "2026年硕士专业目录" }],
  });
  const attempts = [
    {
      url: failed,
      status: "failed" as const,
      reason: "WEB_PDF_EMPTY",
      attemptedAt: "2026-10-04T00:00:00Z",
    },
    {
      url: "https://yz.foreign.edu.cn/directory.pdf",
      status: "failed" as const,
      reason: "WEB_TIMEOUT",
      attemptedAt: "2026-10-04T00:00:00Z",
    },
  ];
  const before = structuredClone(attempts);
  const result = derive([page], { attempts });
  assert.deepEqual(result.gaps[0].attempts, [attempts[0]]);
  assert.deepEqual(attempts, before);
  assert.equal(result.gaps[0].attempts[0].reason, "WEB_PDF_EMPTY");
});

test("annual city and fee evidence remain covered when they mismatch user preferences", () => {
  const page = directory(2027);
  const address = source(
    "location",
    `${school}2027年机械工程硕士培养地点政策。${school}机械工程硕士培养地址：南京市清源路1号。`,
  );
  const fee = source(
    "fee",
    `${school}2027年机械工程硕士全日制学费12000元/学年。`,
  );
  const result = derive([page, address, fee]);
  assert.equal(first(result).fields.program.status, "supported_current");
  assert.equal(first(result).fields.location.status, "supported_current");
  assert.equal(first(result).fields.tuition.status, "supported_current");
  assert.ok(
    !result.gaps.some(
      (gap) => gap.field === "location" || gap.field === "tuition",
    ),
  );
});

test("ambiguous learning modes and same-year exam groups remain unresolved rather than verified", () => {
  const mixed = directory(
    2026,
    "001机械学院 | 085500 机械 全日制、非全日制 ①101思想政治理论 ②201英语一或204英语二 ③301数学一或302数学二 ④811机械原理",
  );
  const result = derive([mixed]);
  assert.equal(first(result).fields.program.status, "ambiguous");
  assert.equal(first(result).fields.exams.status, "ambiguous");
  assert.equal(
    first(result).missing.find((gap) => gap.field === "exams")!.purpose,
    "resolve_ambiguity",
  );
});

test("newer current programme data does not erase the nearest historical reference or merge programmes across admission years", () => {
  const historical = directory(2025);
  const current = directory(2027);
  const result = derive([current, historical]);
  assert.equal(result.summary.programCount, 1);
  assert.equal(first(result).referenceYear, 2025);
  assert.equal(first(result).fields.program.status, "supported_current");
  assert.deepEqual(
    first(result).fields.program.references.map((ref) => ref.year),
    [2027, 2025],
  );
  assert.ok(!result.gaps.some((gap) => gap.field === "program"));
});

test("a partial initial-exam excerpt retains its literal reference but stays a missing full-route task", () => {
  const result = derive([
    directory(
      2027,
      "001机械学院 | 080200 机械工程 全日制 初试科目：②201英语一 ③301数学一",
    ),
  ]);
  assert.equal(first(result).fields.program.status, "supported_current");
  assert.equal(first(result).fields.exams.status, "missing");
  assert.equal(first(result).fields.exams.references.length, 1);
  assert.match(first(result).fields.exams.reason, /部分初试科目/);
  assert.ok(
    result.gaps.some(
      (gap) => gap.field === "exams" && gap.purpose === "missing_evidence",
    ),
  );
});

test("a stop notice for the same code in another college does not exclude the active college", () => {
  const result = derive([
    directory(
      2027,
      [
        "001机械学院 | 085500 机械 全日制 初试科目：①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理",
        "002工程学院 | 085500 机械 全日制 本专业停招",
      ].join("\n"),
    ),
  ]);
  const programs = result.candidates[0].coverage!.programs;
  assert.equal(
    programs.find((program) => program.collegeName === "机械学院")!.fields
      .program.status,
    "supported_current",
  );
  assert.equal(
    programs.find((program) => program.collegeName === "机械学院")!.fields.exams
      .status,
    "supported_current",
  );
  assert.equal(
    programs.find((program) => program.collegeName === "工程学院")!.fields
      .program.status,
    "excluded",
  );
});

test("a fee or direct city for another college cannot fill the same-code programme's missing fields", () => {
  const page = directory(
    2027,
    "001机械学院 | 085500 机械 全日制\n002工程学院 | 085500 机械 全日制",
  );
  const fee = source(
    "fee",
    `${school}2027年硕士研究生收费标准\n工程学院 | 085500 机械全日制学费8000元/年。`,
  );
  const location = source(
    "location",
    `${school}2027年硕士培养地点政策\n工程学院 | 085500 机械硕士培养地址：南京市清源路1号。`,
  );
  const result = derive([page, fee, location]);
  const mechanical = result.candidates[0].coverage!.programs.find(
    (program) => program.collegeName === "机械学院",
  )!;
  assert.equal(mechanical.fields.tuition.status, "missing");
  assert.equal(mechanical.fields.location.status, "missing");
});

test("a college heading on the preceding line is retained as literal programme provenance", () => {
  const page = directory(2026, "机械学院\n080200 机械工程 全日制");
  const result = derive([page]);
  assert.equal(first(result).collegeName, "机械学院");
  assert.equal(
    first(result).fields.program.references[0].quote,
    "机械学院\n080200 机械工程 全日制",
  );
  assert.ok(
    page.excerpt.includes(first(result).fields.program.references[0].quote),
  );
});

test("a current demonstration stop page cannot exclude a genuine historical programme or turn a factual gap into a known rejection", () => {
  const genuine = directory(2026);
  const demo = directory(
    2027,
    "001机械学院 | 080200 机械工程 学术学位 全日制 本专业停招",
  );
  demo.excerpt = `${demo.excerpt}\n本页仅为演示数据，不代表实际招生。`;
  const result = derive([genuine, demo]);
  assert.equal(result.summary.supportedProgramCount, 1);
  assert.equal(first(result).fields.program.status, "supported_reference");
  assert.equal(first(result).referenceYear, 2026);
  assert.ok(
    first(result).fields.program.references.every(
      (ref) => ref.sourceId === genuine.id,
    ),
  );
  assert.ok(
    result.gaps.some(
      (gap) => gap.field === "program" && gap.purpose === "target_year_check",
    ),
  );
});
