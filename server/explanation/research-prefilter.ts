import type { ResearchPriorityFact } from "../../shared/research-priority-facts.ts";
import type { Profile } from "../../shared/profile.ts";
import type {
  ResearchPrefilter,
  PrefilterSchoolResult,
  PrefilterScore,
} from "../../shared/research-prefilter.ts";
import { normalizeCityName } from "../../shared/cities.ts";
import { schoolRegistry, type SchoolRegistryEntry } from "../schools/index.ts";
import type { ProgramFact } from "./research-facts.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import type { SubjectAdvice } from "../../shared/assessment-advice.ts";
import type { ResearchExamEvidence } from "../../shared/research-matching.ts";
import { compareExamAdvice } from "./research-subject-advice.ts";

// Product discovery preference, not a live popularity/employment ranking: major
// regional university centres represented in the local registry. No external lookup.
export const PREFILTER_POPULAR_CITIES = [
  "北京",
  "上海",
  "广州",
  "深圳",
  "杭州",
  "南京",
  "武汉",
  "成都",
  "西安",
] as const;
export const PREFILTER_CITY_BASIS =
  "全国模式限定北京、上海、广州、深圳、杭州、南京、武汉、成都、西安：选择依据为教育资源较强的区域高校中心，不代表实时热度或就业排名。";
export interface LocalEvidence<T> {
  value: T;
  quote: string;
  sourceUrl: string;
  year: number;
}
export interface LocalProgram {
  key: string;
  disciplineCode: string;
  exams?: ResearchExamEvidence;
  catalog?: LocalEvidence<true>;
  assessment?: LocalEvidence<
    "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-"
  >;
  seats?: LocalEvidence<number>;
  cutoff?: LocalEvidence<{ total: number; maximum: number }>;
  tuition?: LocalEvidence<number>;
  duration?: LocalEvidence<number>;
}
export interface LocalSchool {
  key: string;
  name: string;
  domain: string;
  city: string;
  campusCities?: readonly string[];
  tags: readonly string[];
  programs: LocalProgram[];
  undergraduateAdvantage?: LocalEvidence<{
    university: string;
    applicable: boolean;
  }>;
}
export interface PrefilterProfile {
  cities: readonly string[];
  university: string;
  year: number;
  disciplineCodes: readonly string[];
  subjectAdvice?: SubjectAdvice;
  annualBudget?: number;
  maxDuration?: number;
  score?: { total: number; maximum: number };
  undergraduateTier?: "double-first-class" | "other";
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function prefilterCities(cities: readonly string[]) {
  return [
    ...new Set(
      cities
        .map(normalizeCityName)
        .filter(
          (c) => c && !/^(全国|不限(?:城市)?|不确定|无偏好|未确定)$/.test(c),
        ),
    ),
  ];
}
export function prefilterProfile(
  profile: Profile,
  disciplineCodes: string[],
  score?: PrefilterProfile["score"],
  subjectAdvice?: SubjectAdvice,
): PrefilterProfile {
  const budgets: Record<string, number> = {
    "1万元以内": 10000,
    "1-2万元": 20000,
    "2-5万元": 50000,
    "5-10万元": 100000,
  };
  const undergraduate = schoolRegistry.schools.find(
    (s) => s.name === profile.university,
  );
  return {
    undergraduateTier: undergraduate
      ? undergraduate.tags.includes("双一流")
        ? "double-first-class"
        : "other"
      : undefined,
    score,
    ...(subjectAdvice ? { subjectAdvice } : {}),
    cities: profile.cities,
    university: profile.university,
    year: Number(profile.year),
    disciplineCodes,
    annualBudget:
      budgets[profile.budget.replace(/\s/g, "").replace(/[—–~～至]/g, "-")],
  };
}

/** Adapt only bound public facts; no text guessing, examples, or fabricated scores. */
export function localPrefilterSchools(
  schools: readonly SchoolRegistryEntry[],
  facts: readonly ProgramFact[],
  targetYear = Number.POSITIVE_INFINITY,
  priorityFacts: readonly ResearchPriorityFact[] = [],
): LocalSchool[] {
  return schools.map((school) => {
    const own = facts.filter(
      (f) =>
        f.schoolName === school.name &&
        (f.year === undefined || f.year <= targetYear) &&
        f.status === "bound" &&
        f.quote &&
        f.sourceUrl,
    );
    const programs = new Map<string, LocalProgram>();
    const catalog = own.filter((f) => f.field === "catalog");
    for (const f of catalog.filter(
      (f) =>
        !catalog.some(
          (other) =>
            other.majorCode === f.majorCode &&
            other.collegeName === f.collegeName &&
            other.studyMode === f.studyMode &&
            (other.year ?? 0) > (f.year ?? 0),
        ),
    )) {
      const key = JSON.stringify([
        f.majorCode,
        f.collegeName,
        f.studyMode,
        f.year,
      ]);
      if (!programs.has(key))
        programs.set(key, {
          key,
          disciplineCode: f.disciplineCode,
          catalog: f.year
            ? {
                value: true,
                quote: f.quote,
                sourceUrl: f.sourceUrl,
                year: f.year,
              }
            : undefined,
        });
    }
    for (const [key, p] of programs) {
      const examFacts = own.filter(
        (f) =>
          f.field === "exams" &&
          JSON.stringify([f.majorCode, f.collegeName, f.studyMode, f.year]) ===
            key &&
          f.freshness !== "stale" &&
          "subjects" in f.value,
      );
      const combinations = new Set(
        examFacts.map((f) =>
          "subjects" in f.value
            ? JSON.stringify(
                [...f.value.subjects].sort((a, b) => compare(a.code, b.code)),
              )
            : "",
        ),
      );
      const examFact = examFacts[0];
      if (
        examFact &&
        examFact.year !== undefined &&
        combinations.size === 1 &&
        "subjects" in examFact.value &&
        examFacts.every(
          (f) =>
            "status" in f.value &&
            ["verified_current", "historical"].includes(f.value.status),
        )
      ) {
        p.exams = structuredClone(examFact.value);
        // A cached fact may have been "current" for an earlier report year.
        // Preserve its own year and never present that as this year's requirement.
        if (examFact.year < targetYear) {
          p.exams.status = "historical";
          p.exams.year = examFact.year;
          p.exams.historicalReference = {
            ...structuredClone(examFact.value),
            status: "historical",
            year: examFact.year,
          };
        }
      }
      const fees = own.filter(
        (f) =>
          f.field === "tuition" &&
          JSON.stringify([f.majorCode, f.collegeName, f.studyMode, f.year]) ===
            key &&
          f.freshness !== "stale" &&
          f.targetYearApplicable &&
          "period" in f.value &&
          f.value.period === "academic_year" &&
          f.value.currency === "CNY",
      );
      const amounts = new Set(
        fees.map((f) => ("amount" in f.value ? f.value.amount : undefined)),
      );
      const f = fees[0];
      if (f && amounts.size === 1 && "amount" in f.value && f.year)
        p.tuition = {
          value: f.value.amount,
          quote: f.quote,
          sourceUrl: f.sourceUrl,
          year: f.year,
        };
    }
    for (const p of programs.values()) {
      const cutoffs = priorityFacts.filter(
        (f) =>
          f.schoolName === school.name &&
          f.disciplineCode === p.disciplineCode &&
          f.field === "cutoff" &&
          f.year <= targetYear &&
          f.value.maximum &&
          f.value.number !== undefined &&
          (!f.majorCode || JSON.parse(p.key)[0] === f.majorCode),
      );
      const latest = Math.max(...cutoffs.map((f) => f.year));
      const applicable = cutoffs.filter((f) => f.year === latest);
      if (
        applicable.length &&
        new Set(applicable.map((f) => `${f.value.number}/${f.value.maximum}`))
          .size === 1
      ) {
        const f = applicable[0];
        p.cutoff = {
          value: { total: f.value.number!, maximum: f.value.maximum! },
          quote: f.quote,
          sourceUrl: f.sourceUrl,
          year: f.year,
        };
      }
    }
    return {
      key: school.registrableDomain,
      name: school.name,
      domain: school.registrableDomain,
      city: school.city,
      campusCities: school.campusHints.map((h) => h.city),
      tags: school.tags,
      programs: [...programs.values()].sort((a, b) => compare(a.key, b.key)),
    };
  });
}

/** Pure and deterministic. Scores select investigation order, never admission probability. */
export function prefilterResearchSchools(
  profile: PrefilterProfile,
  schools: readonly LocalSchool[],
): ResearchPrefilter {
  const cities = prefilterCities(profile.cities);
  const valid = <T>(e?: LocalEvidence<T>) =>
    !!e &&
    !!e.quote.trim() &&
    /^https?:\/\//.test(e.sourceUrl) &&
    Number.isInteger(e.year) &&
    e.year <= profile.year;
  const current = <T>(e?: LocalEvidence<T>) =>
    valid(e) && e!.year === profile.year;
  const scored: PrefilterSchoolResult[] = schools
    .map((s) => {
      const scores: PrefilterScore[] = [];
      const add = (
        dimension: PrefilterScore["dimension"],
        points: number,
        reasons: string[],
      ) => scores.push({ dimension, points, reasons });
      const programs = s.programs.filter((p) =>
        profile.disciplineCodes.includes(p.disciplineCode),
      );
      const violations = (p: LocalProgram) => [
        ...(profile.annualBudget !== undefined &&
        current(p.tuition) &&
        p.tuition!.value > profile.annualBudget
          ? [
              `${p.key}：${p.tuition!.year}年学费${p.tuition!.value}元/年超过预算${profile.annualBudget}元；${p.tuition!.quote}`,
            ]
          : []),
        ...(profile.maxDuration !== undefined &&
        current(p.duration) &&
        p.duration!.value > profile.maxDuration
          ? [
              `${p.key}：学制${p.duration!.value}年超过上限${profile.maxDuration}年；${p.duration!.quote}`,
            ]
          : []),
      ];
      const eligible = programs.filter((p) => !violations(p).length);
      const excludedReasons =
        programs.length && !eligible.length ? programs.flatMap(violations) : [];
      const grades = {
        "A+": 20,
        A: 18,
        "A-": 16,
        "B+": 14,
        B: 12,
        "B-": 10,
        "C+": 8,
        C: 6,
        "C-": 4,
      };
      const programScores = eligible
        .map((p) => ({
          p,
          subjectMatch: compareExamAdvice(
            profile.subjectAdvice,
            p.exams?.year !== undefined && p.exams.year <= profile.year
              ? p.exams
              : undefined,
          ),
          points:
            (valid(p.catalog) ? 20 : 0) +
            (valid(p.assessment) ? grades[p.assessment!.value] : 0) +
            (current(p.seats) && p.seats!.value > 0 ? 5 : 0),
        }))
        .sort(
          (a, b) =>
            b.points +
              b.subjectMatch.bonus -
              (a.points + a.subjectMatch.bonus) || compare(a.p.key, b.p.key),
        );
      const best = programScores[0]?.p;
      add(
        "program",
        (programScores[0]?.points ?? 0) +
          (programScores[0]?.subjectMatch.bonus ?? 0),
        [
          best && valid(best.catalog)
            ? `目标方向${best.disciplineCode}有${best.catalog!.year}年目录依据：${best.catalog!.quote}（${best.catalog!.sourceUrl}）；历史不保证当年招生。`
            : "没有可用的目标专业目录证据，存在性记0；未查到不等于不招生。",
          best && valid(best.assessment)
            ? `学科评估${best.assessment!.value}：${best.assessment!.quote}`
            : "学科评估无证据，记0。",
          best && current(best.seats)
            ? `招生人数${best.seats!.value}：${best.seats!.quote}`
            : "当年招生人数无证据，记0。",
          ...(programScores[0]?.subjectMatch.factors.map((f) => f.reason) ??
            []),
        ],
      );
      const cutoff = best?.cutoff;
      const comparable =
        profile.score &&
        valid(cutoff) &&
        cutoff!.value.maximum === profile.score.maximum &&
        profile.score.total >= 0 &&
        profile.score.total <= profile.score.maximum &&
        cutoff!.value.total > 0;
      add(
        "score",
        comparable
          ? profile.score!.total >= cutoff!.value.total
            ? 15
            : profile.score!.total >= cutoff!.value.total - 20
              ? 5
              : 0
          : 0,
        [
          comparable
            ? `同满分口径目标总分${profile.score!.total}，参考${cutoff!.year}年分数线${cutoff!.value.total}：${cutoff!.quote}；不代表录取概率。`
            : "缺少可比分数线或用户总分，记0；不换算小测成绩。",
        ],
      );
      const advantage = s.undergraduateAdvantage;
      const applies =
        current(advantage) &&
        advantage!.value.applicable &&
        advantage!.value.university === profile.university;
      add("undergraduate", applies ? 10 : 0, [
        applies
          ? `有适用于本科学校的政策：${advantage!.quote}`
          : "没有适用本科优势政策证据，记0；同校、同省或同系统不自动加分。",
      ]);
      const scopeCities = cities.length
        ? cities
        : [...PREFILTER_POPULAR_CITIES];
      const city =
        scopeCities.find((c) => c === s.city || s.campusCities?.includes(c)) ??
        s.city;
      const cityIndex = cities.indexOf(city);
      add("city", cityIndex >= 0 ? Math.max(1, 40 - cityIndex) : 0, [
        cityIndex >= 0
          ? `第${cityIndex + 1}意向城市${city}，按填写顺序加权；种子所在地/校区提示仅作调查线索。`
          : cities.length
            ? "不在意向城市线索内，城市分0。"
            : "全国/不限城市，无指定城市加分。",
      ]);
      const fits =
        best &&
        ((profile.annualBudget !== undefined &&
          current(best.tuition) &&
          best.tuition!.value <= profile.annualBudget) ||
          (profile.maxDuration !== undefined &&
            current(best.duration) &&
            best.duration!.value <= profile.maxDuration));
      add(
        "constraints",
        fits ? 5 : 0,
        excludedReasons.length
          ? excludedReasons
          : [
              fits
                ? "已绑定的当年费用或学制符合已填写上限；其他条件仍待核验。"
                : "费用/学制限制未填写或证据不足，记0并保留；历史、冲突及待确认价格不作硬剔除。",
            ],
      );
      add(
        "national",
        !cities.length
          ? (s.tags.includes("双一流") ? 4 : 0) +
              ((PREFILTER_POPULAR_CITIES as readonly string[]).includes(s.city)
                ? 3
                : 0)
          : 0,
        [
          !cities.length
            ? `${s.tags.includes("双一流") ? "种子双一流标签+4（院校层次，不是目标学科评估）；" : "无院校层次加分；"}${(PREFILTER_POPULAR_CITIES as readonly string[]).includes(s.city) ? "固定高校中心城市+3。" : "无固定城市加分。"}${PREFILTER_CITY_BASIS}`
            : "有明确城市偏好，不启用全国调查偏好分。",
        ],
      );
      const comparablePrograms = eligible.filter(
        (p) =>
          profile.score &&
          valid(p.cutoff) &&
          p.cutoff!.value.maximum === profile.score.maximum,
      );
      const allBelow =
        eligible.length > 0 &&
        comparablePrograms.length === eligible.length &&
        comparablePrograms.every(
          (p) => profile.score!.total < p.cutoff!.value.total - 30,
        );
      const estimatedHigh =
        !comparablePrograms.length &&
        s.tags.includes("双一流") &&
        profile.undergraduateTier === "other";
      const feasibility = {
        basis: comparablePrograms.length
          ? ("evidence" as const)
          : ("estimate" as const),
        risk:
          allBelow || estimatedHigh
            ? ("high" as const)
            : comparablePrograms.some(
                  (p) => profile.score!.total >= p.cutoff!.value.total,
                )
              ? ("lower" as const)
              : ("unknown" as const),
        reason: comparablePrograms.length
          ? comparablePrograms
              .map(
                (p) =>
                  `${p.cutoff!.year}年参考线${p.cutoff!.value.total}，目标分差${profile.score!.total - p.cutoff!.value.total}；${p.cutoff!.sourceUrl}`,
              )
              .join("；")
          : `估计：${estimatedHigh ? "本科院校非双一流，目标院校为双一流，暂列高挑战" : "缺少可比目标分或院校背景证据，保留调查"}；院校层次不能证明录取机会或本科歧视。`,
      };
      return {
        feasibility,
        institutionName: s.name,
        key: s.key,
        domain: s.domain,
        city,
        scores,
        score: scores.reduce((n, x) => n + x.points, 0),
        excludedReasons,
      };
    })
    .sort(
      (a, b) =>
        (cities.length ? cities.indexOf(a.city) - cities.indexOf(b.city) : 0) ||
        (cities.length > 3
          ? { lower: 0, unknown: 1, high: 2 }[a.feasibility.risk] -
            { lower: 0, unknown: 1, high: 2 }[b.feasibility.risk]
          : 0) ||
        b.score - a.score ||
        compare(a.key, b.key) ||
        compare(a.institutionName, b.institutionName),
    );
  const selected: PrefilterSchoolResult[] = [],
    omitted: ResearchPrefilter["omitted"] = [];
  const counts = new Map<string, number>();
  for (const school of scored) {
    const scopeCities: readonly string[] = cities.length
      ? cities
      : PREFILTER_POPULAR_CITIES;
    const reason = school.excludedReasons.length
      ? "明确不满足限制"
      : !scopeCities.includes(school.city)
        ? "不在本次城市范围"
        : !cities.length && school.feasibility!.risk === "high"
          ? `全国模式高挑战剔除：${school.feasibility!.reason}`
          : cities.length > 3 &&
              (counts.get(school.city) ?? 0) >= B.prefilterCitySchools
            ? "城市名额上限"
            : "";
    if (reason) omitted.push({ ...school, reason });
    else {
      selected.push(school);
      counts.set(school.city, (counts.get(school.city) ?? 0) + 1);
    }
  }
  return {
    version: "local-prefilter-v1",
    candidateCount: scored.length,
    cities,
    selected,
    omitted,
    limitations: [
      "评分仅决定精查优先级，不是录取概率或全国学科排名；缺失维度记0。",
      "资料库覆盖有限，未入选不等于没有合适专业；专业培养城市须联网核验。",
      PREFILTER_CITY_BASIS,
    ],
  };
}
