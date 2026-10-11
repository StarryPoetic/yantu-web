import test from "node:test";
import assert from "node:assert/strict";
import {
  prefilterResearchSchools,
  prefilterProfile,
  localPrefilterSchools,
  type LocalSchool,
  type LocalEvidence,
  type PrefilterProfile,
} from "../../server/explanation/research-prefilter.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import { blankProfile } from "../../server/profile.ts";
import { schoolRegistry } from "../../server/schools/index.ts";
import type { ProgramFact } from "../../server/explanation/research-facts.ts";

const evidence = <T>(value: T, year = 2027): LocalEvidence<T> => ({
  value,
  year,
  quote: "官方测试政策原文",
  sourceUrl: "https://school.edu.cn/policy",
});
const profile: PrefilterProfile = {
  cities: [],
  university: "本科大学",
  year: 2027,
  disciplineCodes: ["0802"],
};
const school = (key = "10001", city = "杭州"): LocalSchool => ({
  key,
  name: `院校${key}`,
  city,
  domain: `s${key}.edu.cn`,
  tags: [],
  programs: [],
});
const points = (s: LocalSchool, dimension: string, p = profile) =>
  prefilterResearchSchools(p, [s]).selected[0]?.scores.find(
    (s) => s.dimension === dimension,
  )?.points;

test("missing academic, score, seats and undergraduate evidence stays zero even for the same university", () => {
  const s = school();
  s.name = profile.university;
  const result = prefilterResearchSchools(profile, [s]);
  for (const d of ["program", "score", "undergraduate", "constraints"])
    assert.equal(points(s, d), 0);
  assert.equal(result.selected[0].scores.length, 6);
  assert.ok(result.selected[0].scores.every((s) => s.reasons.length > 0));
});
test("target discipline catalogue, assessment and positive current seats contribute independently", () => {
  const s = school();
  s.programs = [
    {
      key: "p",
      disciplineCode: "0802",
      catalog: evidence(true),
      assessment: evidence("A+"),
      seats: evidence(30),
    },
  ];
  assert.equal(points(s, "program"), 45);
  assert.equal(
    points(s, "program", { ...profile, disciplineCodes: ["0301"] }),
    0,
  );
  s.programs[0].seats = evidence(30, 2026);
  assert.equal(points(s, "program"), 40);
});
test("score matching requires evidence and the same maximum, never guessed from self assessment", () => {
  const s = school();
  s.programs = [
    {
      key: "p",
      disciplineCode: "0802",
      catalog: evidence(true),
      cutoff: evidence({ total: 350, maximum: 500 }, 2026),
    },
  ];
  assert.equal(points(s, "score"), 0);
  assert.equal(
    points(s, "score", { ...profile, score: { total: 360, maximum: 500 } }),
    15,
  );
  assert.equal(
    points(s, "score", { ...profile, score: { total: 340, maximum: 500 } }),
    5,
  );
  assert.equal(
    points(s, "score", { ...profile, score: { total: 300, maximum: 500 } }),
    0,
  );
  assert.equal(
    points(s, "score", { ...profile, score: { total: 360, maximum: 300 } }),
    0,
  );
});
test("undergraduate advantage needs current policy for this exact university and applicability", () => {
  const s = school();
  s.undergraduateAdvantage = evidence({
    university: profile.university,
    applicable: true,
  });
  assert.equal(points(s, "undergraduate"), 10);
  assert.equal(
    points(s, "undergraduate", { ...profile, university: "其他大学" }),
    0,
  );
  s.undergraduateAdvantage = evidence({
    university: profile.university,
    applicable: false,
  });
  assert.equal(points(s, "undergraduate"), 0);
  s.undergraduateAdvantage = evidence(
    { university: profile.university, applicable: true },
    2026,
  );
  assert.equal(points(s, "undergraduate"), 0);
});
test("multiple cities preserve input order and never exceed the per-city ceiling", () => {
  const schools = Array.from({ length: 45 }, (_, i) =>
    school(
      String(i).padStart(3, "0"),
      ["杭州", "上海", "南京"][Math.floor(i / 15)],
    ),
  );
  const result = prefilterResearchSchools(
    { ...profile, cities: ["上海", "杭州", "南京"] },
    schools,
  );
  assert.equal(result.selected.length, B.prefilterSchools);
  assert.equal(result.selected[0].city, "上海");
  for (const city of result.cities)
    assert.ok(
      result.selected.filter((s) => s.city === city).length <=
        B.prefilterCitySchools,
    );
  assert.ok(result.omitted.some((s) => s.reason === "城市名额上限"));
  const reverse = prefilterResearchSchools(
    { ...profile, cities: ["杭州", "上海", "南京"] },
    schools,
  );
  assert.equal(reverse.selected[0].city, "杭州");
});
test("single city can fill the shortlist; national markers do not discard explicit city ordering", () => {
  const schools = Array.from({ length: 30 }, (_, i) => school(String(i)));
  assert.equal(
    prefilterResearchSchools({ ...profile, cities: ["杭州"] }, schools).selected
      .length,
    25,
  );
  assert.deepEqual(
    prefilterResearchSchools(
      { ...profile, cities: ["全国", "上海市", "杭州", "上海"] },
      schools,
    ).cities,
    ["上海", "杭州"],
  );
});
test("national mode uses explicit tier and fixed city clues, without inventing discipline assessment", () => {
  const s = school();
  s.tags = ["双一流"];
  assert.equal(points(s, "national"), 7);
  assert.equal(points(s, "program"), 0);
  for (const cities of [[], ["全国"], ["不限城市"], ["不确定"]])
    assert.equal(points(s, "national", { ...profile, cities }), 7);
  assert.equal(points(s, "national", { ...profile, cities: ["杭州"] }), 0);
});
test("current annual tuition and duration violations exclude, while unknown, historical and alternative programmes remain", () => {
  const s = school();
  s.programs = [
    {
      key: "p",
      disciplineCode: "0802",
      catalog: evidence(true),
      tuition: evidence(20000),
      duration: evidence(4),
    },
  ];
  const p = { ...profile, annualBudget: 10000, maxDuration: 3 };
  const result = prefilterResearchSchools(p, [s]);
  assert.equal(result.selected.length, 0);
  assert.equal(result.omitted[0].excludedReasons.length, 2);
  s.programs.push({
    key: "unknown",
    disciplineCode: "0802",
    catalog: evidence(true),
  });
  assert.equal(prefilterResearchSchools(p, [s]).selected.length, 1);
  s.programs = [
    {
      key: "historical",
      disciplineCode: "0802",
      tuition: evidence(20000, 2026),
    },
  ];
  assert.equal(prefilterResearchSchools(p, [s]).selected.length, 1);
  s.programs = [
    { key: "fit", disciplineCode: "0802", tuition: evidence(8000) },
  ];
  assert.equal(points(s, "constraints", p), 5);
});
test("empty provenance and future evidence cannot contribute or exclude", () => {
  const s = school();
  s.programs = [
    {
      key: "p",
      disciplineCode: "0802",
      catalog: { ...evidence(true), quote: "" },
      tuition: evidence(50000, 2028),
    },
  ];
  assert.equal(points(s, "program"), 0);
  assert.equal(
    prefilterResearchSchools({ ...profile, annualBudget: 10000 }, [s]).selected
      .length,
    1,
  );
});
test("ties use fixed keys and repeated runs are deeply identical without mutating inputs", () => {
  const schools = [school("3"), school("1"), school("2")];
  const before = structuredClone(schools);
  const first = prefilterResearchSchools(profile, schools);
  assert.deepEqual(
    first.selected.map((s) => s.key),
    ["1", "2", "3"],
  );
  for (let i = 0; i < 5; i++)
    assert.deepEqual(prefilterResearchSchools(profile, schools), first);
  assert.deepEqual(schools, before);
});
test("actual profile adapter does not invent score or duration and catalogue seeds alone never prove admissions", () => {
  const p = prefilterProfile(
    {
      ...blankProfile(),
      budget: "1–2万元",
      english: "优秀",
      notes: "我考了400分，学制2年",
    },
    ["0802"],
  );
  assert.equal(p.annualBudget, 20000);
  assert.equal(p.score, undefined);
  assert.equal(p.maxDuration, undefined);
  const all = localPrefilterSchools(schoolRegistry.schools, []);
  assert.equal(all.length, 458);
  assert.ok(all.every((s) => !s.programs.length));
});

test("real fact adapter separates programme identities, ignores stale/pending/conflicting fees and prefers current catalogue", () => {
  const seed = schoolRegistry.schools[0];
  const catalog: ProgramFact = {
    schoolName: seed.name,
    registrableDomain: seed.registrableDomain,
    majorCode: "080200",
    programName: "机械工程",
    disciplineCode: "0802",
    degreeType: "academic",
    studyMode: "full_time",
    year: 2027,
    field: "catalog",
    value: { exists: true },
    quote: "官方目录连续原文",
    sourceUrl: seed.homepage,
    sourceId: "source",
    retrievedAt: "2026-10-11T00:00:00Z",
    extractedAt: "2026-10-11T00:00:00Z",
    extractor: "test",
    status: "bound",
    verified: false,
  };
  const fee: ProgramFact = {
    ...catalog,
    field: "tuition",
    targetYearApplicable: true,
    freshness: "fresh",
    value: {
      amount: 20000,
      currency: "CNY",
      period: "academic_year",
      year: 2027,
      studyMode: "full_time",
      quote: "学费20000元/年",
      sourceId: "source",
    },
  };
  const run = (facts: ProgramFact[]) =>
    prefilterResearchSchools(
      { ...profile, annualBudget: 10000 },
      localPrefilterSchools([seed], facts, 2027),
    );
  assert.equal(
    run([catalog, fee, { ...catalog, year: 2026 }]).selected.length,
    0,
  );
  for (const changed of [
    { ...fee, status: "pending" as const },
    { ...fee, freshness: "stale" as const },
    { ...fee, year: 2026 },
    { ...fee, majorCode: "085500" },
    { ...fee, collegeName: "别院" },
    { ...fee, studyMode: "part_time" as const },
    { ...fee, value: { ...fee.value, period: "program" as const } },
  ])
    assert.equal(run([catalog, changed]).selected.length, 1);
  assert.equal(
    run([catalog, fee, { ...fee, value: { ...fee.value, amount: 8000 } }])
      .selected.length,
    1,
  );
});
