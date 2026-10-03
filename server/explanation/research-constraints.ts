import type { Profile } from "../../shared/profile.ts";
import type {
  LocationEvidence,
  RecommendationConstraintCheck,
  RecommendationConstraints,
  ResearchStudyMode,
  TuitionEvidence,
  TuitionPeriod,
} from "../../shared/research-recommendation.ts";
import type { WebSource } from "./web.ts";

export interface RecommendationConstraintInput {
  profile: Pick<Profile, "budget" | "cities">;
  targetYear: string | number;
  institutionName: string;
  programName: string;
  degreeType?: "academic" | "professional";
  studyMode?: ResearchStudyMode;
  citations: string[];
  sources: WebSource[];
  tuition?: unknown;
  location?: unknown;
}

const periods: TuitionPeriod[] = [
  "academic_year",
  "program",
  "semester",
  "credit",
];
const modes: ResearchStudyMode[] = ["full_time", "part_time", "unspecified"];
const money = /(?<![\d.,])(\d+(?:,\d{3})*(?:\.\d+)?)\s*(万)?\s*元/g;
const clauses = (value: string) =>
  value
    .split(/[。；;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const cityName = (value: string) => value.trim().replace(/市$/, "");
const substantive = (text: string) =>
  text.replace(
    /(?:友情链接|相关链接|院校链接)[\s\S]*?(?=学院地址|学校地址|联系地址|Copyright|版权所有|$)/gi,
    "",
  );

function projectPosition(text: string, input: RecommendationConstraintInput) {
  let position = text.indexOf(input.programName);
  while (position >= 0) {
    const before = text.slice(0, position);
    const after = text.slice(position + input.programName.length);
    const starts =
      !/[\p{Script=Han}]$/u.test(before) ||
      before.endsWith(input.institutionName) ||
      /20\d{2}[年级]$/.test(before);
    const ends =
      !/^[\p{Script=Han}]/u.test(after) ||
      /^(?:专业|硕士|学费|收费|全日制|非全日制|学术学位|专业学位|培养地址|培养地点|办学地点|教学地点)/.test(
        after,
      );
    if (starts && ends) return position;
    position = text.indexOf(
      input.programName,
      position + input.programName.length,
    );
  }
  return -1;
}

/** A quoted amount/address is only useful after the caller's hard project/eligibility guards. */
function citedQuote(
  raw: Record<string, unknown>,
  input: RecommendationConstraintInput,
) {
  if (
    typeof raw.sourceId !== "string" ||
    !input.citations.includes(raw.sourceId) ||
    typeof raw.quote !== "string" ||
    raw.quote.trim().length < 8 ||
    raw.quote.length > 1800 ||
    raw.quote.includes(" … ")
  )
    return undefined;
  const matches = input.sources.filter((source) => source.id === raw.sourceId);
  if (matches.length !== 1) return undefined;
  const source = matches[0];
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return undefined;
  }
  if (
    source.kind !== "official_page" ||
    url.protocol !== "https:" ||
    /(^|\.)chsi\.com\.cn$/.test(url.hostname) ||
    !substantive(source.excerpt).includes(input.institutionName) ||
    !substantive(source.excerpt).includes(raw.quote.trim())
  )
    return undefined;
  return { source, quote: raw.quote.trim() };
}

function statedModes(text: string): ResearchStudyMode[] {
  const result: ResearchStudyMode[] = [];
  if (/非全日制/.test(text)) result.push("part_time");
  if (/全日制/.test(text.replace(/非全日制/g, ""))) result.push("full_time");
  return result;
}

function statedPeriod(
  before: string,
  after: string,
): TuitionPeriod | undefined {
  const found: TuitionPeriod[] = [];
  for (const [period, unit] of [
    ["academic_year", "(?:学年|年)(?!制)"],
    ["semester", "学期"],
    ["credit", "学分"],
  ] as const) {
    const suffix = new RegExp(
      `^\\s*(?:[（(]\\s*)?(?:每|[/／·])\\s*(?:(?:生|人)\\s*[/／·每]?\\s*)?${unit}`,
    );
    const prefix = new RegExp(
      `每(?:(?:生|人)每?)?${unit}(?:学费|收费标准|收费|为|[:：\\s])*$`,
    );
    if (suffix.test(after) || prefix.test(before)) found.push(period);
  }
  if (
    /(?:全(?:学|过)?程(?:学费|收费标准|收费)?|总学费|学费总(?:额|计)|学制内)(?:为|[:：\s])*$/.test(
      before,
    ) ||
    /^\s*(?:[/／·（(]\s*)?(?:全(?:学|过)?程|学制内)/.test(after)
  )
    found.push("program");
  return found.length === 1 ? found[0] : undefined;
}

function checkedTuition(
  input: RecommendationConstraintInput,
): TuitionEvidence | undefined {
  const raw = record(input.tuition);
  if (
    !raw ||
    typeof raw.amount !== "number" ||
    !Number.isFinite(raw.amount) ||
    raw.amount <= 0 ||
    raw.amount > 10_000_000 ||
    raw.currency !== "CNY" ||
    !periods.includes(raw.period as TuitionPeriod) ||
    !Number.isInteger(raw.year) ||
    Number(raw.year) < 2000 ||
    Number(raw.year) > 2099 ||
    (raw.studyMode !== undefined &&
      !modes.includes(raw.studyMode as ResearchStudyMode))
  )
    return undefined;
  const cited = citedQuote(raw, input);
  if (!cited || !/学费|收费标准/.test(cited.quote)) return undefined;
  const { quote } = cited;
  const years = [...new Set(quote.match(/\b20\d{2}\b/g) ?? [])];
  if (!years.includes(String(raw.year))) return undefined;
  const parts = clauses(quote);
  const header = parts[0];
  const feeHeader =
    /学费|收费标准/.test(header) &&
    /硕士|研究生/.test(header) &&
    [...header.matchAll(money)].length === 0;
  // An explicit project row is required. A university-wide amount is never silently
  // assigned to every project, and amounts from adjacent programme rows cannot migrate.
  for (const clause of parts) {
    const programAt = projectPosition(clause, input);
    if (programAt < 0) continue;
    const amounts = [...clause.matchAll(money)];
    if (amounts.length !== 1) continue;
    const match = amounts[0];
    const value = Number(match[1].replace(/,/g, "")) * (match[2] ? 10_000 : 1);
    if (Math.abs(value - raw.amount) > 0.005) continue;
    if (match.index! < programAt || match.index! - programAt > 160) continue;
    const between = clause.slice(
      programAt + input.programName.length,
      match.index,
    );
    if (/\b(?:0[1-9]|1[0-4])\d{4}\b/.test(between)) continue;
    if (
      /(?:[，,、]|\s)(?!全日制|非全日制|学术|专业学位|硕士研究生|本专业|该专业)[\p{Script=Han}]{2,20}(?:专业|硕士)/u.test(
        between,
      )
    )
      continue;
    const feeLabels = [
      ...clause
        .slice(0, match.index)
        .matchAll(
          /学费|住宿费|报名费|奖学金|助学金|生活费|学杂费|考试费|补助/g,
        ),
    ];
    if (feeLabels.length && feeLabels.at(-1)![0] !== "学费") continue;
    if (
      !feeLabels.length &&
      !/^(?:[^。；;\n]{0,160})(?:学费|收费标准)/.test(quote)
    )
      continue;
    // A nearby project statement cannot borrow a different year's heading.
    if (
      !clause.includes(String(raw.year)) &&
      !(years.length === 1 && feeHeader && header.includes(String(raw.year)))
    )
      continue;
    if (
      statedPeriod(
        clause.slice(0, match.index),
        clause.slice(match.index! + match[0].length),
      ) !== raw.period
    )
      continue;
    if (input.degreeType === "academic" && /专业学位|专硕/.test(clause))
      continue;
    if (input.degreeType === "professional" && /学术学位|学硕/.test(clause))
      continue;
    const localModes = statedModes(clause);
    const evidenceModes = localModes.length
      ? localModes
      : feeHeader
        ? statedModes(header)
        : [];
    if (evidenceModes.length > 1) continue;
    const studyMode = evidenceModes[0] ?? "unspecified";
    if (
      raw.studyMode &&
      raw.studyMode !== "unspecified" &&
      raw.studyMode !== studyMode
    )
      continue;
    if (
      input.studyMode &&
      input.studyMode !== "unspecified" &&
      input.studyMode !== studyMode
    )
      continue;
    return {
      amount: value,
      currency: "CNY",
      period: raw.period as TuitionPeriod,
      year: Number(raw.year),
      studyMode,
      quote,
      sourceId: String(raw.sourceId),
    };
  }
  return undefined;
}

function checkedLocation(
  input: RecommendationConstraintInput,
): LocationEvidence | undefined {
  const raw = record(input.location);
  if (
    !raw ||
    typeof raw.city !== "string" ||
    !/^[\p{Script=Han}]{2,14}$/u.test(raw.city)
  )
    return undefined;
  const cited = citedQuote(raw, input);
  if (!cited) return undefined;
  const city = cityName(raw.city);
  const addresses = clauses(cited.quote).filter(
    (clause) =>
      /地址|校址|办学地点|教学地点|培养地点|所在城市/.test(clause) &&
      (clause.includes(`${city}市`) ||
        new RegExp(`${city}(?:[，,\\s]|[^，,。；;]{0,12}区)`).test(clause)),
  );
  if (!addresses.length) return undefined;
  const programLocal = addresses.some(
    (clause) => projectPosition(clause, input) >= 0,
  );
  if (!programLocal) {
    // A footer does not identify the candidate's campus when the page mentions
    // multiple campuses or programme-specific teaching locations.
    if (/校区|办学地点|教学地点|培养地点/.test(cited.source.excerpt))
      return undefined;
    if (!addresses.some((clause) => clause.includes(input.institutionName)))
      return undefined;
    if (addresses.length !== 1) return undefined;
  }
  return { city, quote: cited.quote, sourceId: String(raw.sourceId) };
}

function annualBudget(
  value: string,
): { upper?: number; lower?: number } | undefined {
  // These are the form's explicit annual-budget choices, not inferred amounts in notes.
  const normalized = value.replace(/\s/g, "").replace(/[—–~～至]/g, "-");
  const ranges: Record<string, { upper?: number; lower?: number }> = {
    "1万元以内": { upper: 10_000 },
    "1-2万元": { upper: 20_000 },
    "2-5万元": { upper: 50_000 },
    "5-10万元": { upper: 100_000 },
    "10万元以上": { lower: 100_000 },
  };
  return ranges[normalized];
}

function budgetCheck(
  input: RecommendationConstraintInput,
  tuition?: TuitionEvidence,
): RecommendationConstraintCheck {
  const check: RecommendationConstraintCheck = {
    field: "budget",
    status: "unknown",
    reason: "尚未查到可对应到该校具体专业的学费原文，年度预算暂不能比较。",
    sourceIds: tuition ? [tuition.sourceId] : [],
  };
  const budget = annualBudget(input.profile.budget);
  if (!budget)
    return { ...check, reason: "年度预算尚未明确，未代填预算或认定费用符合。" };
  if (!tuition) return check;
  if (String(tuition.year) !== String(input.targetYear))
    return {
      ...check,
      reason: `所列学费为${tuition.year}年历史或其他年度参考，不据此判断${input.targetYear}年是否符合预算。`,
    };
  if (tuition.period !== "academic_year")
    return {
      ...check,
      reason:
        "官网费用按全程、学期或学分计费，与年度预算口径不同；未推算学制、学期数或学分数。",
    };
  if (tuition.studyMode === "unspecified")
    return {
      ...check,
      reason:
        "学费原文未明确学习形式，须确认全日制或非全日制及其适用项目后再比较年度预算。",
    };
  const maximum = budget.upper ?? budget.lower!;
  if (tuition.amount <= maximum)
    return {
      ...check,
      status: "match",
      reason: `该${tuition.studyMode === "full_time" ? "全日制" : "非全日制"}项目${tuition.year}年度学费${tuition.amount.toLocaleString("zh-CN")}元未超过所选年度预算${budget.upper ? "上限" : "起点"}；仅比较学费，住宿和生活等总费用仍待核验。`,
    };
  if (!budget.upper)
    return {
      ...check,
      reason:
        "年度预算选择为10万元以上，未给出上限；不能将更高学费直接认定为超预算。",
    };
  return {
    ...check,
    status: "mismatch",
    reason: `该${tuition.studyMode === "full_time" ? "全日制" : "非全日制"}项目${tuition.year}年度学费${tuition.amount.toLocaleString("zh-CN")}元，已高于所选年度预算上限${maximum.toLocaleString("zh-CN")}元，且尚未包括住宿和生活等费用；需放宽预算条件，是否值得选择仍须综合本人其他目标判断。`,
  };
}

function cityCheck(
  input: RecommendationConstraintInput,
  location?: LocationEvidence,
): RecommendationConstraintCheck {
  const cities = input.profile.cities
    .filter(
      (city) =>
        city.trim() && !/^(?:不确定|不限|无偏好|未确定)$/.test(city.trim()),
    )
    .map(cityName);
  const check: RecommendationConstraintCheck = {
    field: "cities",
    status: "unknown",
    reason: "尚未查到该专业可明确适用的城市或校区地址，不能仅凭学校名称推断。",
    sourceIds: location ? [location.sourceId] : [],
  };
  if (!cities.length)
    return { ...check, reason: "尚未限定城市，未代填城市偏好或认定地域不符。" };
  if (!location) return check;
  if (cities.includes(location.city))
    return {
      ...check,
      status: "match",
      reason: `官网所列地址位于${location.city}，符合已选城市偏好；具体培养校区仍以当年项目安排为准。`,
    };
  return {
    ...check,
    status: "mismatch",
    reason: `官网所列地址位于${location.city}，不在偏好城市${cities.join("、")}内；需放宽城市条件，是否值得选择仍须综合本人其他目标判断。`,
  };
}

/** Soft preferences only: never restores a programme rejected by hard admissions guards. */
export function deriveRecommendationConstraints(
  input: RecommendationConstraintInput,
): Pick<
  RecommendationConstraints,
  "constraintChecks" | "tuition" | "location"
> {
  const tuition = checkedTuition(input);
  const location = checkedLocation(input);
  const constraintChecks = [
    budgetCheck(input, tuition),
    cityCheck(input, location),
  ];
  return {
    constraintChecks,
    ...(tuition ? { tuition } : {}),
    ...(location ? { location } : {}),
  };
}
