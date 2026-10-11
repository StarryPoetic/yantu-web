import test from "node:test";
import assert from "node:assert/strict";
import {
  compareExamAdvice,
  researchSubjectAdvice,
} from "../../server/explanation/research-subject-advice.ts";
import {
  createAttempt,
  loadQuestionBank,
  saveDraft,
  submitAttempt,
} from "../../server/assessment/index.ts";
import { knowledgeArea } from "../../shared/assessment-knowledge.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import type { ResearchExamEvidence } from "../../shared/research-matching.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import {
  createDemandPlan,
  buildEvidenceCandidates,
  rankDemandCandidates,
} from "../../server/explanation/research-matching.ts";
import {
  prefilterResearchSchools,
  localPrefilterSchools,
} from "../../server/explanation/research-prefilter.ts";
import { extractProgramFacts } from "../../server/explanation/research-facts.ts";
import { schoolRegistry } from "../../server/schools/index.ts";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import { researchReportMarkdown } from "../../src/workspace/research-report.ts";

const bank = await loadQuestionBank();
function run() {
  let attempt = createAttempt(bank, {
    subjectId: "advice",
    modules: ["math", "english"],
    allowExampleBank: true,
    seed: "subject-integration",
  });
  attempt = saveDraft(attempt, {
    expectedAttemptVersion: 1,
    answers: attempt.questions.map((q) => ({
      questionId: q.id,
      selectedOption:
        (q.correct +
          ((q.module === "math"
            ? ["probability", "math-one", "economics"]
            : ["reading"]
          ).includes(knowledgeArea(q.module, q.point))
            ? 1
            : 0)) %
        q.options.length,
    })),
  });
  attempt = submitAttempt(attempt, {
    expectedAttemptVersion: attempt.attemptVersion,
    now: "2026-10-12T00:00:00Z",
  });
  const d = attempt.diagnosis!;
  return generateGuidance({
    subjectId: "advice",
    guidanceRunId: "advice-run",
    generatedAt: "2026-10-12T00:00:00Z",
    profile: {
      ...blankProfile(),
      major: "机械工程",
      targetMajor: "机械工程",
      cities: ["杭州"],
      year: "2027",
      degreePreference: "不确定",
      studyGoal: "不确定",
      crossMajor: "接受跨专业",
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [
      {
        assessmentAttemptId: attempt.assessmentAttemptId,
        diagnosisVersion: d.diagnosisVersion,
        submittedAt: attempt.submittedAt,
        questionBankVersion: bank.questionBankVersion,
        scope: attempt.scope,
        example: true,
        usableForRecommendation: false,
        modules: d.modules,
        items: d.items.map((item) => ({
          ...item,
          scopes: attempt.questions.find((q) => q.id === item.questionId)!
            .scopes,
        })),
        weakPoints: [],
        limitations: d.limitations,
      },
    ],
  });
}
const exams = (math = "302", english = "204"): ResearchExamEvidence => ({
  status: "verified_current",
  year: 2027,
  sourceId: "catalog",
  reason: "synthetic row",
  subjects: [
    { code: "101", name: "思想政治理论" },
    { code: english, name: english === "204" ? "英语二" : "英语一" },
    { code: math, name: math === "302" ? "数学二" : "数学一" },
    { code: "811", name: "机械原理" },
  ],
});

test("V3B matching exam subjects add six points; mismatches add risks without a penalty or exclusion", () => {
  const advice = researchSubjectAdvice(run())!;
  assert.equal(advice.math.subject, "math-two");
  assert.equal(advice.english.subject, "english-two");
  assert.equal(compareExamAdvice(advice, exams()).bonus, 6);
  const mismatch = compareExamAdvice(advice, exams("301", "201"));
  assert.equal(mismatch.bonus, 0);
  assert.equal(mismatch.risks.length, 2);
  assert.match(mismatch.risks[0], /该专业考数一，你的测评更适合数二/);
  assert.deepEqual(compareExamAdvice(undefined, exams()), {
    bonus: 0,
    factors: [],
    risks: [],
  });
  for (const status of ["unknown", "ambiguous"] as const) {
    const result = compareExamAdvice(advice, { ...exams(), status });
    assert.equal(result.bonus, 0);
    assert.equal(result.risks.length, 0);
    assert.ok(result.factors.every((f) => f.status === "unknown"));
  }
  assert.equal(
    compareExamAdvice(advice, { ...exams(), sourceId: undefined }).bonus,
    0,
  );
});

test("V3B history remains labelled and no-math needs a complete non-math combination", () => {
  const advice = researchSubjectAdvice(run())!;
  const historical = { ...exams(), status: "historical" as const, year: 2026 };
  const result = compareExamAdvice(advice, {
    ...historical,
    historicalReference: { ...historical, year: 2026 },
  });
  assert.equal(result.bonus, 6);
  assert.match(result.factors[0].reason, /2026年历史目录参考/);
  assert.match(result.factors[0].reason, /目标年度/);
  advice.math.subject = "math-none";
  const noMath = {
    ...exams(),
    subjects: [
      { code: "101", name: "思想政治理论" },
      { code: "204", name: "英语二" },
      { code: "611", name: "文学基础" },
      { code: "811", name: "文学评论" },
    ],
  };
  assert.equal(compareExamAdvice(advice, noMath).bonus, 6);
  assert.equal(
    compareExamAdvice(advice, {
      ...noMath,
      subjects: noMath.subjects.slice(0, 2),
    }).bonus,
    3,
  );
  noMath.subjects[2] = { code: "396", name: "经济类综合能力" };
  assert.equal(compareExamAdvice(advice, noMath).bonus, 3);
  noMath.subjects[2] = { code: "601", name: "高等数学" };
  assert.equal(compareExamAdvice(advice, noMath).bonus, 3);
});

test("V3B latest module snapshot wins without summing retests; absent and incompatible records are ignored", () => {
  const r = run();
  const old = structuredClone(r.assessmentSummary.references[0]);
  old.submittedAt = "2026-10-01T00:00:00Z";
  old.items!.forEach((i) => (i.outcome = "correct"));
  old.modules.forEach((m) =>
    Object.assign(m, { correct: m.total, incorrect: 0, unanswered: 0 }),
  );
  r.assessmentSummary.references.push(old);
  assert.equal(researchSubjectAdvice(r)!.math.subject, "math-two");
  assert.match(researchSubjectAdvice(r)!.math.reason, /5\/5题/);
  r.assessmentSummary.references = [];
  assert.equal(researchSubjectAdvice(r), undefined);
  old.example = false;
  old.usableForRecommendation = false;
  r.assessmentSummary.references = [old];
  assert.equal(researchSubjectAdvice(r), undefined);
});

function sources(): WebSource[] {
  return [
    {
      id: "hdu-advice",
      title: "杭州电子科技大学2027年硕士研究生招生专业目录",
      url: "https://grs.hdu.edu.cn/advice.htm",
      kind: "official_page",
      verified: false,
      retrievedAt: "2026-10-12T00:00:00Z",
      excerpt:
        "杭州电子科技大学2027年硕士研究生招生专业目录。初试考试科目：\n080200 机械工程 学术学位 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理。机械工程培养地点：杭州市大学路1号。\n085500 机械 专业学位 ①101思想政治理论 ②204英语二 ③302数学二 ④811机械原理。机械专业硕士培养地点：杭州市大学路1号。杭州电子科技大学地址：杭州市大学路1号。",
    },
  ];
}

test("V3B ranking uses bound subjects and retains conflicting same-school routes and stable snapshots", () => {
  const r = run(),
    pages = sources(),
    disciplines = getDisciplineCatalog().items.filter((d) =>
      ["0802", "0855"].includes(d.code),
    );
  const input = {
    run: r,
    sources: pages,
    disciplines,
    targetYear: "2027",
    plan: createDemandPlan(r),
  };
  const candidates = buildEvidenceCandidates(input).recommendations;
  const original = structuredClone({ r, candidates });
  const ranked = rankDemandCandidates(
    candidates,
    r,
    disciplines,
    pages,
    "2027",
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].disciplineCode, "0855");
  assert.equal(ranked[0].match.subjectAdviceBonus, 6);
  const other = ranked[0].programAlternatives!.find(
    (p) => p.disciplineCode === "0802",
  )!;
  assert.ok(other);
  assert.match(other.uncertainties!.join(" "), /考数一.*更适合数二/);
  assert.deepEqual(
    rankDemandCandidates(ranked, r, disciplines, pages, "2027"),
    ranked,
  );
  assert.deepEqual({ r, candidates }, original);
});

test("V3B local scope keeps cities and eligibility constraints while subject match changes investigation order", () => {
  const advice = researchSubjectAdvice(run())!;
  const profile = {
    cities: ["杭州"],
    university: "",
    year: 2027,
    disciplineCodes: ["0802"],
    subjectAdvice: advice,
  };
  const schools = [
    {
      key: "a",
      name: "合成甲校",
      domain: "a.edu.cn",
      city: "杭州",
      tags: [],
      programs: [
        { key: "p", disciplineCode: "0802", exams: exams("301", "201") },
      ],
    },
    {
      key: "b",
      name: "合成乙校",
      domain: "b.edu.cn",
      city: "杭州",
      tags: [],
      programs: [{ key: "p", disciplineCode: "0802", exams: exams() }],
    },
  ];
  const noAdvice = prefilterResearchSchools(
    { ...profile, subjectAdvice: undefined },
    schools,
  );
  assert.equal(noAdvice.selected[0].key, "a");
  const compared = prefilterResearchSchools(profile, schools);
  assert.equal(compared.selected[0].key, "b");
  assert.equal(compared.selected[0].score - noAdvice.selected[0].score, 6);
  assert.ok(compared.selected.every((s) => !s.excludedReasons.length));
  const otherCity = { ...schools[1], key: "c", city: "成都" };
  assert.ok(
    !prefilterResearchSchools(profile, [schools[0], otherCity]).selected.some(
      (s) => s.key === "c",
    ),
  );
});

test("V3B local exam facts remain bound to their own programme identity and stale facts do not score", () => {
  const pages = sources();
  const facts = extractProgramFacts(pages[0], pages, "2026-10-12T00:00:00Z");
  const schools = [schoolRegistry.byHost("hdu.edu.cn")!];
  const local = localPrefilterSchools(schools, facts, 2027);
  const codes = local[0].programs
    .map((p) => p.exams?.subjects.find((s) => s.code.startsWith("30"))?.code)
    .sort();
  assert.deepEqual(codes, ["301", "302"]);
  const stale = facts.map((f) =>
    f.field === "exams" ? { ...f, freshness: "stale" as const } : f,
  );
  assert.ok(
    localPrefilterSchools(schools, stale, 2027)[0].programs.every(
      (p) => !p.exams,
    ),
  );
  const future = prefilterResearchSchools(
    {
      cities: ["杭州"],
      university: "",
      year: 2027,
      disciplineCodes: ["0802"],
      subjectAdvice: researchSubjectAdvice(run()),
    },
    [
      {
        key: "fixture",
        name: "杭州合成校",
        domain: "fixture.edu.cn",
        city: "杭州",
        tags: [],
        programs: [
          {
            key: "future",
            disciplineCode: "0802",
            exams: { ...exams(), year: 2028 },
          },
        ],
      },
    ],
  );
  assert.ok(
    !future.selected[0].scores
      .flatMap((s) => s.reasons)
      .some((reason) => reason.includes("+3")),
  );
  const historical = localPrefilterSchools(schools, facts, 2028)[0].programs;
  assert.ok(
    historical.every(
      (p) => p.exams?.status === "historical" && p.exams.year === 2027,
    ),
  );
});

test("V3B offline report generation carries subject risks into its export without new provider calls", async () => {
  const f = prefilterFixture({
    cities: ["杭州"],
    schoolNames: ["杭州电子科技大学"],
    completeFields: true,
  });
  f.run.assessmentSummary.references = run().assessmentSummary.references;
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
  });
  assert.ok(report.recommendations.length);
  assert.match(
    report.recommendations[0].uncertainties.join(" "),
    /考数一.*更适合数二/,
  );
  assert.match(
    researchReportMarkdown(report, f.run, false),
    /考数一.*更适合数二/,
  );
});
