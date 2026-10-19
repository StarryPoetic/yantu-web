import { createHash } from "node:crypto";
import {
  RESEARCH_PRIORITY_FIELDS,
  RESEARCH_PRIORITY_GROUPS,
  type ResearchPriorityFact,
  type ResearchPriorityField,
  type ResearchTargetScore,
} from "../../shared/research-priority-facts.ts";
import type { Discipline } from "../disciplines/types.ts";
import type { WebSource } from "./web.ts";
import { schoolRegistry } from "../schools/index.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";
import { isSchoolPage } from "./research-evidence.ts";
import { safeSourceYear } from "./research-years.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";
import { externalPriorityFacts } from "./research-external-facts.ts";
import {
  researchSourceTier,
  externalFieldAllowed,
} from "./research-source-policy.ts";
import {
  tablePriorityFacts,
  redactAdmissionsText,
} from "./research-priority-tables.ts";

const labels: Record<ResearchPriorityField, RegExp> = {
  cutoff:
    /(?:复试(?:基本)?(?:分数)?线|复试分数要求|进入复试[^。\n]{0,12}总分)[：:为\s]*(\d{3})(?:\s*分)?/,
  admissionScore:
    /(?:录取(?:最低|平均|最高)分|拟录取(?:最低|平均|最高)(?:成绩|分数)|录取分数)[：:为\s]*(\d{3})(?:\s*分)?/,
  applicationAdmissionRatio: /报录比[：:为\s]*(\d+(?:\.\d+)?)[：:比/]1/,
  admittedCount: /(?:实际录取|录取人数|共录取)[：:为\s]*(\d+)\s*人/,
  recommendationShare:
    /推免(?:生)?(?:占比|比例)[：:为\s]*(\d+(?:\.\d+)?)\s*[%％]/,
  undergraduateAdmission:
    /(?:双非|非双一流|普通本科)[^。\n]{0,60}(?:录取|生源)|(?:录取|生源)[^。\n]{0,60}(?:双非|非双一流|普通本科)/,
  crossMajorAdmission:
    /跨(?:专业|考)[^。\n]{0,60}(?:录取|生源)|(?:录取|生源)[^。\n]{0,60}跨(?:专业|考)/,
  disciplineAssessment: /学科评估[^。\n]{0,30}(?:[ABC][+-]?|优秀)/,
  programRanking: /(?:专业|学科)(?:排名|排行)[^。\n]{0,20}(?:第\s*)?\d+/,
  employment:
    /(?:硕士|研究生|毕业生)[^。\n]{0,80}(?:就业去向|就业单位|就业行业|就业率|去向落实率|进入[^。\n]{0,20}企业)/,
  cityDevelopment:
    /(?:城市发展|产业发展|地区生产总值|产业布局|就业市场)[^。\n]{2,100}/,
};
export function hasPriorityEvidence(source: WebSource) {
  return (
    /复试.*(?:分数|基本)|拟录取名单|录取名单|学科评估|就业质量报告/.test(
      source.title + source.excerpt.slice(0, 1000),
    ) || Object.values(labels).some((pattern) => pattern.test(source.excerpt))
  );
}
export const PRIORITY_SEARCH_TERMS = [
  "复试线 录取最低分 录取平均分",
  "报录比 实际录取人数 推免占比",
  "双非 跨专业 录取 生源",
  "学科评估 专业排名",
  "硕士就业去向 城市发展 产业发展",
] as const;
export function validResearchTarget(
  value: unknown,
): ResearchTargetScore | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as ResearchTargetScore;
  if (
    ![300, 500].includes(v.maximum) ||
    !Number.isFinite(v.total) ||
    v.total < 0 ||
    v.total > v.maximum
  )
    return;
  return { total: v.total, maximum: v.maximum };
}
/** Same literal-original, official-page and school binding gates as core facts.
 * The model proposes passages only; it cannot choose a number, year or scope. */
export function validatePriorityFacts(
  proposals: unknown,
  source: WebSource,
  disciplines: readonly Discipline[],
  targetYear: string,
  target?: ResearchTargetScore,
): ResearchPriorityFact[] {
  if (source.kind === "authority_page" || source.kind === "reference_page") {
    if (!Array.isArray(proposals)) return [];
    const candidates = externalPriorityFacts(source, disciplines, targetYear);
    return candidates.filter((fact) =>
      proposals.some(
        (p) =>
          p &&
          typeof p === "object" &&
          p.sourceId === source.id &&
          p.field === fact.field &&
          p.quote === fact.quote,
      ),
    );
  }
  if (!Array.isArray(proposals) || !isSchoolPage(source)) return [];
  const school = schoolRegistry.byHost(new URL(source.url).hostname);
  if (!school || !sourceHasSchoolIdentity(source, school.name)) return [];
  const result: ResearchPriorityFact[] = [];
  const publicText = redactAdmissionsText(source.excerpt);
  const tables = tablePriorityFacts(source, disciplines, targetYear, target);
  for (const item of proposals.slice(0, 48)) {
    if (!item || typeof item !== "object") continue;
    const { field, quote, sourceId } = item as Record<string, unknown>;
    if (
      typeof field !== "string" ||
      !(RESEARCH_PRIORITY_FIELDS as readonly string[]).includes(field) ||
      typeof quote !== "string" ||
      quote.length < 8 ||
      quote.length > 600 ||
      sourceId !== source.id ||
      quote.includes(" … ") ||
      !source.excerpt.includes(quote) ||
      !publicText.includes(quote)
    )
      continue;
    const key = field as ResearchPriorityField;
    const tableMatches = tables.filter(
      (f) => f.field === key && f.quote === quote,
    );
    if (tableMatches.length) {
      result.push(...tableMatches);
      continue;
    }
    const matched = quote.match(labels[key]);
    if (!matched) continue;
    // A programme's training aspiration is not evidence of a city's economy.
    if (
      key === "cityDevelopment" &&
      (/培养目标|本专业|培养.*人才|产业发展需求|产业经济学|研究方向|第\d+行[：:]/.test(
        quote,
      ) ||
        !quote.includes(school.city))
    )
      continue;
    if (
      key === "employment" &&
      (!/(?:硕士|研究生)[^。\n]{0,24}毕业生|毕业[^。\n]{0,12}硕士/.test(
        quote,
      ) ||
        /博士|本科|定向|双向选择|就业方式|招聘|应当|须|应届.*报考/.test(
          quote,
        ) ||
        !/就业率[^。\n]*\d|去向落实率[^。\n]*\d|主要去向[：:]|就业(?:去向|单位|行业)[：:]/.test(
          quote,
        ))
    )
      continue;
    const years = [
      ...new Set(
        [...quote.matchAll(/\b(20\d{2})\s*年/g)].map((m) => Number(m[1])),
      ),
    ];
    const year =
      years.length === 1
        ? years[0]
        : years.length
          ? undefined
          : safeSourceYear(source);
    if (!year || year > Number(targetYear)) continue;
    if (
      [
        "cutoff",
        "admissionScore",
        "applicationAdmissionRatio",
        "admittedCount",
        "recommendationShare",
      ].includes(key) &&
      ![...historicalReferenceYears(targetYear), Number(targetYear)].includes(
        year,
      )
    )
      continue;
    const byCode = disciplines.filter((d) =>
      new RegExp(`\\b${d.code}\\d{0,2}\\b`).test(quote),
    );
    const named = disciplines.filter((d) => quote.includes(d.name));
    const matches = byCode.length
      ? byCode
      : named.filter(
          (d) =>
            !named.some(
              (other) =>
                other.name.length > d.name.length &&
                other.name.includes(d.name),
            ),
        );
    // More than one programme in a passage is ambiguous, even when all words are literal.
    const codes = [
      ...new Set([...quote.matchAll(/\b(\d{6})\b/g)].map((m) => m[1])),
    ];
    if (matches.length > 1 || codes.length > 1) continue;
    const discipline = matches[0];
    const programmeRequired = [
      "cutoff",
      "admissionScore",
      "applicationAdmissionRatio",
      "admittedCount",
      "recommendationShare",
      "disciplineAssessment",
      "programRanking",
    ].includes(key);
    if (
      programmeRequired &&
      (!discipline ||
        !/硕士|研究生/.test(source.excerpt) ||
        /本科(?:招生|录取)|博士(?:招生|录取)/.test(quote))
    )
      continue;
    if (codes.length && discipline && !codes[0].startsWith(discipline.code))
      continue;
    const assessmentClause = discipline
      ? quote
          .slice(Math.max(0, quote.indexOf(discipline.name)))
          .split(/[，,；;]/)[0]
      : "";
    const assessmentGrade =
      key === "disciplineAssessment"
        ? assessmentClause.match(
            /(?:获得|为|等级|结果|：|:)\s*([ABC][+-]?)(?=$|\s|等级|[，。；])/u,
          )?.[1]
        : undefined;
    if (
      key === "disciplineAssessment" &&
      (!assessmentGrade ||
        /未公布|预测|推测/.test(assessmentClause) ||
        !/第四轮/.test(quote + source.title) ||
        /第五轮|第三轮|2012年.*评估/.test(quote))
    )
      continue;
    // Reject literal passages about a different school embedded in the owner's page.
    if (
      schoolRegistry.schools.some(
        (s) => s.name !== school.name && quote.includes(s.name),
      )
    )
      continue;
    const number = matched[1] === undefined ? undefined : Number(matched[1]);
    if (
      number !== undefined &&
      (!Number.isFinite(number) ||
        number < 0 ||
        (key === "recommendationShare" && number > 100))
    )
      continue;
    const maximum = ["cutoff", "admissionScore"].includes(key)
      ? Number(quote.match(/满分[：:为\s]*(300|500)/)?.[1]) || undefined
      : undefined;
    if (maximum && number !== undefined && number > maximum) continue;
    const fact = {
      sourceTier: "school" as const,
      schoolName: school.name,
      disciplineCode: discipline?.code,
      programName: discipline?.name,
      majorCode: codes[0],
      scope: discipline ? ("program" as const) : ("school" as const),
      field: key,
      year,
      quote,
      sourceId: source.id,
      sourceUrl: source.url,
      value: {
        text: quote,
        ...(number !== undefined ? { number } : {}),
        ...(maximum ? { maximum } : {}),
        ...(key === "disciplineAssessment" ? { grade: assessmentGrade } : {}),
        ...(key === "employment"
          ? {
              employmentRate:
                Number(
                  quote.match(
                    /(?:就业率|去向落实率)[：:为\s]*(\d+(?:\.\d+)?)\s*[%％]/,
                  )?.[1],
                ) || undefined,
              destinations: quote.match(
                /(?:就业去向|主要去向|就业单位|就业行业)[：:为\s]*([^。\n]+)/,
              )?.[1],
            }
          : {}),
        ...(target && maximum === target.maximum && number !== undefined
          ? { targetGap: target.total - number }
          : {}),
      },
      status: "bound" as const,
      verified: false as const,
    };
    result.push({
      id: createHash("sha256")
        .update(JSON.stringify(fact))
        .digest("hex")
        .slice(0, 20),
      ...fact,
    });
  }
  return [...new Map(result.map((f) => [f.id, f])).values()];
}
/** Conservative offline fallback, also used for prefilter evidence before any model. */
export function extractPriorityFacts(
  source: WebSource,
  disciplines: readonly Discipline[],
  year: string,
  target?: ResearchTargetScore,
) {
  if (source.kind === "authority_page" || source.kind === "reference_page")
    return externalPriorityFacts(source, disciplines, year);
  const proposals = redactAdmissionsText(source.excerpt)
    .split(/[\n。]/)
    .flatMap((quote) =>
      RESEARCH_PRIORITY_FIELDS.filter((field) => labels[field].test(quote)).map(
        (field) => ({ field, quote, sourceId: source.id }),
      ),
    );
  return deduplicatePriorityFacts([
    ...validatePriorityFacts(proposals, source, disciplines, year, target),
    ...tablePriorityFacts(source, disciplines, year, target),
  ]);
}
export function compactPriorityPage(source: WebSource) {
  source = { ...source, excerpt: redactAdmissionsText(source.excerpt) };
  const chunks: string[] = [];
  const matches = [
    ...source.excerpt.matchAll(
      /复试|录取|报录比|推免|双非|跨专业|学科评估|专业排名|就业|产业发展|城市发展/g,
    ),
  ];
  for (const match of matches) {
    const start = Math.max(0, match.index - 180);
    const end = Math.min(source.excerpt.length, match.index + 420);
    const text = source.excerpt.slice(start, end);
    if (!chunks.some((v) => v.includes(text))) chunks.push(text);
    if (chunks.join("\n").length > 9000) break;
  }
  return (chunks.length ? chunks.join("\n") : source.excerpt).slice(0, 10000);
}
export function deduplicatePriorityFacts(
  facts: readonly ResearchPriorityFact[],
) {
  const sorted = [...facts].sort(
    (a, b) =>
      a.schoolName.localeCompare(b.schoolName, "zh-CN") ||
      b.year - a.year ||
      a.field.localeCompare(b.field) ||
      a.sourceUrl.localeCompare(b.sourceUrl),
  );
  const unique = new Map<string, ResearchPriorityFact>();
  for (const fact of sorted) {
    const key = JSON.stringify([
      fact.schoolName,
      fact.majorCode ?? fact.disciplineCode,
      fact.field,
      fact.year,
      fact.collegeName,
      fact.value,
      fact.quote,
    ]);
    if (!unique.has(key)) unique.set(key, fact);
  }
  return [...unique.values()];
}
function basePriorityCoverage(
  facts: readonly ResearchPriorityFact[],
  recommendations: readonly {
    institutionName: string;
    disciplineCode: string;
    majorCode?: string;
    collegeName?: string;
  }[],
  year: string,
) {
  const schools = [
    ...new Map(recommendations.map((r) => [r.institutionName, r])).values(),
  ];
  const rows = schools.map((r) => {
    const own = facts.filter((f) => priorityFactMatches(f, r));
    const confirmed = RESEARCH_PRIORITY_FIELDS.filter((field) =>
      own.some((f) => f.field === field),
    );
    const groups = Object.fromEntries(
      Object.entries(RESEARCH_PRIORITY_GROUPS).map(([key, fields]) => [
        key,
        fields.every((field) =>
          key === "scores"
            ? historicalReferenceYears(year).every((y) =>
                own.some((f) => f.field === field && f.year === y),
              )
            : own.some((f) => f.field === field),
        ),
      ]),
    );
    const missingScoreYears = (["cutoff", "admissionScore"] as const).flatMap(
      (field) =>
        historicalReferenceYears(year)
          .filter((y) => !own.some((f) => f.field === field && f.year === y))
          .map((year) => ({ field, year })),
    );
    const partialGroups = Object.fromEntries(
      Object.entries(RESEARCH_PRIORITY_GROUPS).map(([key, fields]) => {
        const total =
          fields.length *
          (key === "scores" ? historicalReferenceYears(year).length : 1);
        const confirmed =
          key === "scores"
            ? total - missingScoreYears.length
            : fields.filter((field) => own.some((f) => f.field === field))
                .length;
        return [key, { confirmed, total, ratio: confirmed / total }];
      }),
    );
    return {
      partialGroups,
      missingScoreYears,
      schoolName: r.institutionName,
      confirmed,
      pending: RESEARCH_PRIORITY_FIELDS.filter((f) => !confirmed.includes(f)),
      groups,
    };
  });
  return {
    partialGroups: Object.fromEntries(
      Object.keys(RESEARCH_PRIORITY_GROUPS).map((key) => {
        const confirmed = rows.reduce(
          (n, r) => n + r.partialGroups[key].confirmed,
          0,
        );
        const total = rows.reduce((n, r) => n + r.partialGroups[key].total, 0);
        return [
          key,
          { confirmed, total, ratio: total ? confirmed / total : 0 },
        ];
      }),
    ),
    partialAverage: rows.length
      ? rows.reduce(
          (n, r) =>
            n +
            Object.values(r.partialGroups).reduce((s, g) => s + g.ratio, 0) / 5,
          0,
        ) / rows.length
      : 0,
    completeAverage: rows.length
      ? rows.reduce(
          (n, r) => n + Object.values(r.groups).filter(Boolean).length,
          0,
        ) /
        (rows.length * 5)
      : 0,
    schools: rows,
    confirmed: rows.reduce(
      (n, r) =>
        n +
        r.confirmed.filter((f) => f !== "cutoff" && f !== "admissionScore")
          .length +
        6 -
        r.missingScoreYears.length,
      0,
    ),
    pending: rows.reduce(
      (n, r) =>
        n +
        r.pending.filter((f) => f !== "cutoff" && f !== "admissionScore")
          .length +
        r.missingScoreYears.length,
      0,
    ),
    schoolsWithCutoff: rows.filter((r) => r.confirmed.includes("cutoff"))
      .length,
    groups: Object.fromEntries(
      Object.keys(RESEARCH_PRIORITY_GROUPS).map((key) => [
        key,
        {
          confirmed: rows.filter((r) => r.groups[key]).length,
          total: rows.length,
        },
      ]),
    ),
  };
}

type PriorityRecommendation = Parameters<
  typeof basePriorityCoverage
>[1][number];
export function priorityFactMatches(
  f: ResearchPriorityFact,
  r: PriorityRecommendation,
) {
  return (
    f.schoolName === r.institutionName &&
    (!f.disciplineCode || f.disciplineCode === r.disciplineCode) &&
    (!f.majorCode || !r.majorCode || f.majorCode === r.majorCode) &&
    (!f.collegeName || !r.collegeName || f.collegeName === r.collegeName) &&
    (!f.value.population?.startsWith("学院毕业研究生") ||
      f.collegeName === r.collegeName)
  );
}
/** Missing old source labels are recovered from the URL; arbitrary hosts cannot self-certify. */
export const factSourceTier = (f: ResearchPriorityFact) =>
  researchSourceTier(f.sourceUrl);

/** Official evidence wins each field/year slot. Keep reference separate from confirmed. */
export function preferredPriorityFacts(
  facts: readonly ResearchPriorityFact[],
  r: PriorityRecommendation,
) {
  const own = facts.filter(
    (f) =>
      priorityFactMatches(f, r) &&
      factSourceTier(f) &&
      externalFieldAllowed(factSourceTier(f)!, f.field),
  );
  const rank = { school: 0, authority: 1, reference: 2 };
  const slots = new Map<string, ResearchPriorityFact[]>();
  for (const f of own) {
    const key = `${f.field}:${["cutoff", "admissionScore"].includes(f.field) ? f.year : ""}`;
    const existing = slots.get(key);
    if (
      !existing ||
      rank[factSourceTier(f)!] < rank[factSourceTier(existing[0])!]
    )
      slots.set(key, [f]);
    else if (rank[factSourceTier(f)!] === rank[factSourceTier(existing[0])!])
      existing.push(f);
  }
  return [...slots.values()].flat();
}

export function priorityCoverage(
  facts: readonly ResearchPriorityFact[],
  recommendations: readonly PriorityRecommendation[],
  year: string,
) {
  recommendations = [
    ...new Map(recommendations.map((r) => [r.institutionName, r])).values(),
  ];
  const preferred = recommendations.flatMap((r) =>
    preferredPriorityFacts(facts, r),
  );
  const byTier = (tier: "school" | "authority" | "reference") =>
    basePriorityCoverage(
      preferred.filter((f) => factSourceTier(f) === tier),
      recommendations,
      year,
    );
  const confirmed = basePriorityCoverage(
    preferred.filter((f) => factSourceTier(f) !== "reference"),
    recommendations,
    year,
  );
  const combined = basePriorityCoverage(preferred, recommendations, year);
  const years = historicalReferenceYears(year);
  const specialConfirmed = (field: "cutoff" | "disciplineAssessment") => {
    const total =
      recommendations.length * (field === "cutoff" ? years.length : 1);
    const filled = recommendations.reduce((n, r) => {
      const own = preferredPriorityFacts(facts, r).filter(
        (f) => f.field === field && factSourceTier(f) !== "reference",
      );
      return (
        n +
        (field === "cutoff"
          ? years.filter((y) => own.some((f) => f.year === y)).length
          : Number(own.length > 0))
      );
    }, 0);
    return { confirmed: filled, total, ratio: total ? filled / total : 0 };
  };
  return {
    ...confirmed,
    sourcePolicy: "source-policy-v1" as const,
    byTier: {
      school: byTier("school"),
      authority: byTier("authority"),
      reference: byTier("reference"),
    },
    combined,
    confirmedCutoff: specialConfirmed("cutoff"),
    confirmedAssessment: specialConfirmed("disciplineAssessment"),
  };
}
