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
import { CITY_OPTIONS, normalizeCityName } from "../../shared/cities.ts";
import {
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
} from "./research-school.ts";
import {
  deriveCampusLocation,
  isRestrictedCampusQuote,
} from "./research-campus.ts";
import { admissionEvidence } from "./research-evidence.ts";
import { safeSourceYear } from "./research-years.ts";
import { explicitAdmissionsYears } from "../../shared/research-years.ts";
import { programRowScope } from "./research-program-scope.ts";

export interface RecommendationConstraintInput {
  profile: Pick<Profile, "budget" | "cities">;
  targetYear: string | number;
  institutionName: string;
  programName: string;
  collegeName?: string;
  majorCode?: string;
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
const substantive = withoutSchoolLinks;

function literalScopeMatches(
  source: WebSource,
  row: string,
  input: RecommendationConstraintInput,
) {
  const rowAt = source.excerpt.indexOf(row);
  if (rowAt < 0) return false;
  const code = row.match(/\b(?:0[1-9]|1[0-4])\d{4}\b/);
  if (input.majorCode && code && code[0] !== input.majorCode) return false;
  const scope = programRowScope(
    source.excerpt,
    rowAt + (code?.index ?? Math.max(0, projectPosition(row, input))),
    rowAt + row.length,
  );
  if (
    input.collegeName &&
    scope.collegeName &&
    scope.collegeName !== input.collegeName
  )
    return false;
  if (
    input.studyMode &&
    input.studyMode !== "unspecified" &&
    scope.studyMode &&
    scope.studyMode !== input.studyMode
  )
    return false;
  return true;
}

function projectPosition(text: string, input: RecommendationConstraintInput) {
  let position = text.indexOf(input.programName);
  while (position >= 0) {
    const before = text.slice(0, position);
    const after = text.slice(position + input.programName.length);
    const starts =
      !/[\p{Script=Han}]$/u.test(before) ||
      before.endsWith(input.institutionName) ||
      /(?:全日制|非全日制|学术(?:型|学位)|专业学位)$/.test(before) ||
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
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname.endsWith(".edu.cn"))) ||
    /(^|\.)chsi\.com\.cn$/.test(url.hostname) ||
    !sourceHasSchoolIdentity(source, input.institutionName, input.sources) ||
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
    /^\s*(?:[/／·（(]\s*)?(?:(?:生|人)\s*[/／·]\s*)?(?:全(?:学|过)?程|学制内)/.test(
      after,
    )
  )
    found.push("program");
  return found.length === 1 ? found[0] : undefined;
}

/** PDF line breaks may wrap a single project row, but cannot supply another row's fee. */
function tuitionRows(quote: string, input: RecommendationConstraintInput) {
  const parts = [...quote.matchAll(/[^。；;\n]+/g)];
  return parts.flatMap((part, index) => {
    if (projectPosition(part[0], input) < 0) return [];
    let end = part.index! + part[0].length;
    for (const next of parts.slice(index + 1, index + 4)) {
      if (
        [...quote.slice(part.index!, end).matchAll(money)].length ||
        /\s\d+(?:,\d{3})*(?:\.\d+)?\s*$/.test(quote.slice(part.index!, end))
      )
        break;
      // Only a physical line wrap is joinable. A sentence/semicolon ends a row.
      if (!/^\s*\n\s*$/.test(quote.slice(end, next.index))) break;
      end = next.index! + next[0].length;
    }
    const raw = quote.slice(part.index!, end);
    const text = raw.trim();
    return [{ text, start: part.index! + raw.indexOf(text), end }];
  });
}

/** Regulatory document numbers are not the cohort to which tuition applies. */
function feeHeaders(text: string) {
  return [
    ...text.matchAll(
      /(20\d{2})\s*(?:年(?:度)?|级)\s*(?:全日制|非全日制)?(?:学术(?:型|学位)|专业学位)?(?:硕士(?:研究生)?|研究生)[^。；;\n]{0,35}?(?:学费(?:标准)?|收费(?:标准|项目)?|费用)/g,
    ),
  ].map((match) => ({
    year: Number(match[1]),
    start: match.index!,
    end: match.index! + match[0].length,
    text: match[0],
  }));
}

function rowHeader(source: WebSource, quote: string, rowStart: number) {
  // Quote and section association must be unambiguous in the actually read body.
  const first = source.excerpt.indexOf(quote);
  if (first < 0 || source.excerpt.indexOf(quote, first + quote.length) >= 0)
    return undefined;
  const position = first + rowStart;
  const header = feeHeaders(source.excerpt)
    .filter((item) => item.end <= position)
    .at(-1);
  if (!header) return undefined;
  const gap = source.excerpt.slice(header.end, position);
  if (
    / … |20\d{2}\s*(?:年(?:度)?|级)[^。；;\n]{0,20}?(?:学费|收费)|(?:^|\n)\s*(?:[一二三四五六七八九十]+、)?(?:本科(?:生)?|博士(?:生|研究生)?|来华留学|留学生|同等学力)/.test(
      gap,
    )
  )
    return undefined;
  return header;
}

function rowYear(
  source: WebSource,
  quote: string,
  row: string,
  rowStart: number,
) {
  const local = [
    ...new Set(
      [...row.matchAll(/(20\d{2})\s*(?:年(?:度)?|级)/g)].map((match) =>
        Number(match[1]),
      ),
    ),
  ];
  if (local.length) return local.length === 1 ? local[0] : undefined;
  return rowHeader(source, quote, rowStart)?.year;
}

function sectionText(source: WebSource, header: ReturnType<typeof rowHeader>) {
  if (!header) return "";
  const tail = source.excerpt.slice(header.end, header.end + 180);
  const inlineUnit = /^\s*[（(]\s*元[^）)\n]{1,25}[）)]/.exec(tail)?.[0] ?? "";
  const columns =
    /^\s*\n\s*((?:专业名称|专业代码|学习形式|学习方式|收费项目)[^\n。；;]{0,150})/.exec(
      tail,
    )?.[1] ?? "";
  return `${header.text}${inlineUnit}${[...columns.matchAll(money)].length ? "" : columns}`;
}

function degreeConflict(text: string, input: RecommendationConstraintInput) {
  return (
    (input.degreeType === "academic" && /专业学位|专硕/.test(text)) ||
    (input.degreeType === "professional" && /学术(?:型|学位)|学硕/.test(text))
  );
}

function headerPeriod(header: string) {
  const unit = /(?:学费|收费标准)[^。；;\n]{0,25}?元([^。；;\n]{0,25})/.exec(
    header,
  );
  return unit ? statedPeriod("", unit[1]) : undefined;
}

function tuitionAmounts(row: string, header: string, programAt: number) {
  const explicit = [...row.matchAll(money)];
  if (explicit.length || !headerPeriod(header)) return explicit;
  // A numeric table column needs an explicit yuan/unit header and one value;
  // an extra numeric duration, quota, or second mode's fee makes the row ambiguous.
  return [
    ...row
      .slice(programAt)
      .matchAll(/(?<![\d.,])(\d+(?:,\d{3})*(?:\.\d+)?)(?![\d.,])/g),
  ].map((match) => {
    match.index! += programAt;
    return match;
  });
}

const specialPopulation =
  "(?:(?:港澳台(?:地区)?|外国|国际)(?:学生|考生|研究生|硕士(?:研究生)?)|来华留学(?:生|研究生|硕士研究生)|外国留学生)";
const ordinaryPopulation =
  "(?:(?:普通统考|全国统考|境内|内地|大陆)(?:学生|考生|研究生|硕士(?:研究生)?)?)";

/** Identity-specific tariffs cannot establish ordinary domestic tuition. Navigation does not define a fee scope. */
function populationFeeConflict(
  source: WebSource,
  quote: string,
  rowStart: number,
) {
  const dedicated = new RegExp(
    `${specialPopulation}[^。；;\n]{0,24}(?:招生|招收|学费|收费)|(?:招收|招生|学费|收费)[^。；;\n]{0,24}${specialPopulation}`,
  );
  const titleSpecial = dedicated.test(source.title);
  const titleOrdinary = new RegExp(ordinaryPopulation).test(source.title);
  if (titleSpecial && !titleOrdinary) return true;
  const quoteAt = source.excerpt.indexOf(quote);
  if (quoteAt < 0 || source.excerpt.indexOf(quote, quoteAt + quote.length) >= 0)
    return true;
  const position = quoteAt + rowStart;
  const scopeBody = source.excerpt
    .replace(
      /(?:友情链接|相关链接|院校链接)[\s\S]*?(?=学院地址|学校地址|联系地址|Copyright|版权所有|$)/gi,
      (value) => " ".repeat(value.length),
    )
    .replace(/(?:网站)?导航[^。；;\n]*(?:[。；;\n]|$)/g, (value) =>
      " ".repeat(value.length),
    );
  const scopes: { position: number; special: boolean }[] = [];
  for (const [population, special] of [
    [specialPopulation, true],
    [ordinaryPopulation, false],
  ] as const) {
    // A continuous population-specific fee heading, or an isolated population
    // section in a fee document, applies until the next explicitly scoped section.
    const headings = new RegExp(
      `${population}[^。；;\n]{0,24}?(?:学费|收费(?:标准|项目)?)|(?:学费|收费(?:标准|项目)?)[^。；;\n]{0,20}?${population}|(?:^|\n)\\s*(?:[一二三四五六七八九十]+[、.]|\\d+[、.])?\\s*${population}\\s*(?=\n|$)`,
      "g",
    );
    for (const match of scopeBody.matchAll(headings)) {
      if (match.index! <= position)
        scopes.push({ position: match.index!, special });
    }
  }
  const scope = scopes.sort((a, b) => a.position - b.position).at(-1);
  // A mixed-identity title without a precise local scope remains unresolved.
  return scope?.special ?? titleSpecial;
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
  const { quote, source } = cited;
  const parts = clauses(quote);
  const header =
    parts
      .slice(
        0,
        parts.findIndex((part) => projectPosition(part, input) >= 0),
      )
      .slice(0, 3)
      .join("\n") || parts[0];
  const feeHeader =
    /学费|收费标准/.test(header) &&
    /硕士|研究生/.test(header) &&
    [...header.matchAll(money)].length === 0;
  // An explicit project row is required. A university-wide amount is never silently
  // assigned to every project, and amounts from adjacent programme rows cannot migrate.
  for (const row of tuitionRows(quote, input)) {
    const clause = row.text;
    if (!literalScopeMatches(source, clause, input)) continue;
    if (populationFeeConflict(source, quote, row.start)) continue;
    if (/博士|本科|同等学力|留学生|来华留学|旁听/.test(clause)) continue;
    const programAt = projectPosition(clause, input);
    if (programAt < 0) continue;
    const sectionHeader = rowHeader(source, quote, row.start);
    const applicableHeader = feeHeader
      ? header
      : sectionText(source, sectionHeader);
    const amounts = tuitionAmounts(clause, applicableHeader, programAt);
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
    // A category such as 电子信息 cannot inherit a named field/project's price.
    const projectDetails = between
      .replace(
        /非全日制|全日制|学术(?:型|学位)|专业学位|研究生|硕士|本专业|该专业|专业|类别|领域|学费|收费标准|收费|标准|每学年|每年|每学期|每学分|全程|总额|总计|学制内|为/g,
        "",
      )
      .replace(/[（(][A-Z.\s]+[）)]/g, "");
    if (/[\p{Script=Han}]{2,}/u.test(projectDetails)) continue;
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
      !/^(?:[^。；;\n]{0,160})(?:学费|收费标准)/.test(quote) &&
      !/学费|收费标准/.test(applicableHeader)
    )
      continue;
    // A nearby project statement cannot borrow a different year's heading.
    if (rowYear(source, quote, clause, row.start) !== raw.year) continue;
    const period =
      statedPeriod(
        clause.slice(0, match.index),
        clause.slice(match.index! + match[0].length),
      ) ?? (!/元/.test(match[0]) ? headerPeriod(applicableHeader) : undefined);
    if (period !== raw.period) continue;
    if (
      degreeConflict(clause, input) ||
      (feeHeader && degreeConflict(header, input)) ||
      (sectionHeader && degreeConflict(sectionHeader.text, input))
    )
      continue;
    const localModes = statedModes(clause);
    const evidenceModes = localModes.length
      ? localModes
      : feeHeader
        ? statedModes(header)
        : statedModes(sectionHeader?.text ?? "");
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

/** Recover an omitted model field from exact school/project text, never from a search snippet. */
function extractedTuitionCandidates(input: RecommendationConstraintInput) {
  const found: TuitionEvidence[] = [];
  for (const source of input.sources) {
    if (source.kind !== "official_page") continue;
    for (const row of tuitionRows(source.excerpt, input)) {
      if (!literalScopeMatches(source, row.text, input)) continue;
      const programAt = projectPosition(row.text, input);
      const section = rowHeader(source, row.text, 0);
      const header = sectionText(source, section);
      const amounts = tuitionAmounts(row.text, header, programAt);
      if (amounts.length !== 1) continue;
      const match = amounts[0];
      const year = rowYear(source, row.text, row.text, 0);
      const period =
        statedPeriod(
          row.text.slice(0, match.index),
          row.text.slice(match.index! + match[0].length),
        ) ?? (!/元/.test(match[0]) ? headerPeriod(header) : undefined);
      if (!year || !period) continue;
      const modes = statedModes(row.text);
      const studyMode = modes.length
        ? modes[0]
        : (statedModes(header)[0] ?? "unspecified");
      const scopeStart = section?.start ?? row.start;
      // A short continuous table quote includes its header. Longer tables use
      // the exact local row, whose year is checked against the read section.
      const quoted = source.excerpt.slice(scopeStart, row.end).trim();
      const quote =
        quoted.length <= 1800 && !quoted.includes(" … ") ? quoted : row.text;
      const value = checkedTuition({
        ...input,
        citations: [...new Set([...input.citations, source.id])],
        tuition: {
          amount: Number(match[1].replace(/,/g, "")) * (match[2] ? 10_000 : 1),
          currency: "CNY",
          period,
          year,
          studyMode,
          quote,
          sourceId: source.id,
        },
      });
      if (value) found.push(value);
    }
  }
  return found;
}

function selectedTuition(
  found: TuitionEvidence[],
  input: RecommendationConstraintInput,
) {
  const current = found.filter(
    (item) => String(item.year) === String(input.targetYear),
  );
  const historical = found.filter(
    (item) => item.year < Number(input.targetYear),
  );
  const latestHistorical = Math.max(...historical.map((item) => item.year));
  const candidates = current.length
    ? current
    : historical.length
      ? historical.filter((item) => item.year === latestHistorical)
      : found;
  const unique = new Set(
    candidates.map(
      (item) => `${item.year}:${item.amount}:${item.period}:${item.studyMode}`,
    ),
  );
  return unique.size === 1 ? candidates[0] : undefined;
}

function extractedTuition(input: RecommendationConstraintInput) {
  return selectedTuition(extractedTuitionCandidates(input), input);
}

function otherProjectOwner(prefix: string, institutionName: string) {
  if (/大学/.test(prefix.replaceAll(institutionName, ""))) return true;
  const externalRelation = /合作|联合(?:培养)?单位|外校|其他|别校|友校|独立/;
  const connectsOtherOwner = (text: string) =>
    /(?:^|科学院|研究院|研究所|学院)[\s的]*(?:与|和|及|对|邀请|联系|来自|到访)/.test(
      text,
    );
  for (const owner of prefix.matchAll(
    /[\p{Script=Han}]{1,30}(?:科学院|研究院|研究所|学院)/gu,
  )) {
    const throughOwner = prefix.slice(0, owner.index! + owner[0].length);
    const ownAt = throughOwner.lastIndexOf(institutionName);
    // An explicitly named school and its own college/institute remain usable;
    // a collaboration relation after that school names a separate owner.
    if (
      ownAt >= 0 &&
      !externalRelation.test(
        throughOwner.slice(ownAt + institutionName.length),
      ) &&
      !connectsOtherOwner(throughOwner.slice(ownAt + institutionName.length))
    )
      continue;
    if (
      /^(?:本校|我校|本大学|该校)(?:的|附属|下属|所属|直属)?/u.test(owner[0]) &&
      !externalRelation.test(owner[0]) &&
      !connectsOtherOwner(owner[0].replace(/^(?:本校|我校|本大学|该校)/, ""))
    )
      continue;
    // A labelled admissions faculty is an internal unit. A standalone named
    // college or institute has unresolved ownership and cannot borrow the title.
    if (
      /(?:招生院系|所属院系|培养院系|所属学院|培养学院|院系名称|院系|系所)\s*[:：]\s*$/.test(
        prefix.slice(0, owner.index),
      ) &&
      !externalRelation.test(owner[0])
    )
      continue;
    return true;
  }
  return false;
}

function programAddress(clause: string, input: RecommendationConstraintInput) {
  const programAt = projectPosition(clause, input);
  if (programAt < 0) return false;
  // The institution owning the local programme beats the surrounding page title.
  const prefix = clause.slice(0, programAt);
  const codedCollege =
    !!input.collegeName &&
    !!input.majorCode &&
    prefix.includes(input.majorCode) &&
    prefix.replace(input.majorCode, "").trim() === input.collegeName;
  if (otherProjectOwner(prefix, input.institutionName) && !codedCollege)
    return false;
  return [
    ...clause.matchAll(/地址|校址|办学地点|教学地点|培养地点|所在城市/g),
  ].some((match) => {
    if (match.index! < programAt || match.index! - programAt > 160)
      return false;
    const between = clause
      .slice(programAt + input.programName.length, match.index)
      .replaceAll(input.institutionName, "");
    if (/招生办|办公室|咨询|通讯|通信|联系/.test(between)) return false;
    return !/[\p{Script=Han}]{1,30}(?:大学|学院|研究院|研究所)|\b(?:0[1-9]|1[0-4])\d{4}\b|(?:[，,、]|\s)(?!全日制|非全日制|本专业|该专业|硕士)[\p{Script=Han}]{2,20}(?:专业|硕士)/u.test(
      between,
    );
  });
}

function addressCities(text: string) {
  return [
    ...new Set(
      CITY_OPTIONS.filter(({ name }) =>
        /[州盟区县]$/.test(name)
          ? text.includes(name)
          : text.includes(`${name}市`),
      ).map(({ name }) => name),
    ),
  ];
}

function schoolCopyright(text: string, institutionName: string) {
  const escaped = institutionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownerAfter = new RegExp(
    `^[\\s©:：()（）cC\\d–—.,，-]*${escaped}(?=$|[\\s:：,，.。;；]|[\\p{Script=Han}]{0,20}(?:学院|研究生院|研究院|研究所|中心|办公室|管理处))`,
    "u",
  );
  const ownerBefore = new RegExp(
    `${escaped}(?:[\\p{Script=Han}]{0,20}(?:学院|研究生院|研究院|研究所|中心|办公室|管理处))?[\\s©:：()（）cC\\d–—.,，-]*$`,
    "u",
  );
  const namedOwnerAfter =
    /^[\s©:：()（）cC\d–—.,，-]*[\p{Script=Han}]{1,30}(?:大学|科学院|研究院|研究所|学院)/u;
  const body = withoutSchoolLinks(text);
  return [...body.matchAll(/版权所有|Copyright/gi)].some((marker) => {
    const after = body.slice(
      marker.index! + marker[0].length,
      marker.index! + marker[0].length + 80,
    );
    if (ownerAfter.test(after)) return true;
    // An explicit owner after the marker wins over any earlier navigation name.
    if (namedOwnerAfter.test(after)) return false;
    const before = body.slice(Math.max(0, marker.index! - 80), marker.index);
    return (
      !/快速导航|学校主页|友情链接|兄弟院校|相关链接/.test(before) &&
      ownerBefore.test(before)
    );
  });
}

function schoolAddress(clause: string, input: RecommendationConstraintInput) {
  for (const match of clause.matchAll(
    /地址|校址|办学地点|教学地点|培养地点|所在城市/g,
  )) {
    const before = clause.slice(0, match.index);
    const ownAt = before.lastIndexOf(input.institutionName);
    if (
      ownAt >= 0 &&
      /^[\s：:、，,]*(?:学校|通讯|通信|联系)?\s*$/.test(
        before.slice(ownAt + input.institutionName.length),
      )
    )
      return true;
    // An owner printed after an address is usable only in a plain school footer;
    // another institution or programme named before it cannot borrow that footer.
    const after = clause.slice(match.index);
    if (
      !/[\p{Script=Han}]{1,30}(?:大学|学院|研究院|研究所)|硕士|专业|培养/u.test(
        before,
      ) &&
      schoolCopyright(after, input.institutionName)
    )
      return true;
  }
  return false;
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
  if (Array.isArray(raw.supportingEvidence)) {
    const derived = deriveCampusLocation(input);
    const claim = raw.supportingEvidence
      .map((passage) => {
        const value = record(passage);
        return JSON.stringify([value?.sourceId, value?.quote, value?.role]);
      })
      .sort();
    const proven = derived?.supportingEvidence
      ?.map((passage) =>
        JSON.stringify([passage.sourceId, passage.quote, passage.role]),
      )
      .sort();
    return derived &&
      raw.city === derived.city &&
      raw.sourceId === derived.sourceId &&
      raw.quote === derived.quote &&
      (raw.year === undefined || raw.year === derived.year) &&
      JSON.stringify(claim) === JSON.stringify(proven)
      ? derived
      : undefined;
  }
  const cited = citedQuote(raw, input);
  if (!cited) return undefined;
  const city = cityName(raw.city);
  const year = safeSourceYear(cited.source);
  if (
    year === undefined &&
    explicitAdmissionsYears(substantive(cited.source.excerpt)).length
  )
    return undefined;
  if (raw.year !== undefined && raw.year !== year) return undefined;
  const addresses = clauses(cited.quote).filter(
    (clause) =>
      /地址|校址|办学地点|教学地点|培养地点|所在城市/.test(clause) &&
      (clause.includes(`${city}市`) ||
        new RegExp(`${city}(?:[，,\\s]|[^，,。；;]{0,12}区)`).test(clause)),
  );
  if (!addresses.length) return undefined;
  if (addresses.some((clause) => isRestrictedCampusQuote(cited.source, clause)))
    return undefined;
  if (
    addresses.some((clause) =>
      /来华留学|留学生|外国学生|国际学生|港澳台|专项计划|中外合作/.test(clause),
    )
  )
    return undefined;
  if (
    addresses.some(
      (clause) => !literalScopeMatches(cited.source, clause, input),
    )
  )
    return undefined;
  if (
    addresses.some((clause) => {
      const firstAddress = /地址|校址|办学地点|教学地点|培养地点|所在城市/.exec(
        clause,
      )!;
      return addressCities(clause.slice(firstAddress.index)).length > 1;
    })
  )
    return undefined;
  const programLocal = addresses.some((clause) =>
    programAddress(clause, input),
  );
  if (year !== undefined && year !== Number(input.targetYear)) {
    if (year > Number(input.targetYear)) return undefined;
    const currentPages = input.sources.filter(
      (source) =>
        source.kind === "official_page" &&
        sourceHasSchoolIdentity(source, input.institutionName, input.sources) &&
        safeSourceYear(source) === Number(input.targetYear),
    );
    // Compare actual current programme addresses, never school names or generic
    // footers. An explicit old claim is rejected when newer evidence disagrees.
    for (const source of currentPages) {
      for (const clause of clauses(source.excerpt)) {
        if (!programAddress(clause, input)) continue;
        const currentCities = addressCities(clause);
        if (currentCities.length !== 1) continue;
        const current = checkedLocation({
          ...input,
          citations: [...new Set([...input.citations, source.id])],
          location: {
            city: currentCities[0],
            quote: clause,
            sourceId: source.id,
          },
        });
        if (current && current.city !== city) return undefined;
      }
    }
    if (
      currentPages.some(
        (source) =>
          /培养(?:所在)?校区|新生所在校区|(?:培养|教学|办学)(?:地点|地址)/.test(
            withoutSchoolLinks(source.excerpt),
          ) &&
          !clauses(source.excerpt).some((clause) =>
            programAddress(clause, input),
          ),
      )
    ) {
      const currentCampus = deriveCampusLocation({
        ...input,
        sources: input.sources.filter(
          (source) =>
            safeSourceYear(source) === Number(input.targetYear) ||
            safeSourceYear(source) === undefined,
        ),
      });
      if (!currentCampus || currentCampus.city !== city) return undefined;
    }
  }
  if (!programLocal) {
    // A footer does not identify the candidate's campus when the page mentions
    // multiple campuses or programme-specific teaching locations.
    if (/校区|办学地点|教学地点|培养(?:地点|地址)/.test(cited.source.excerpt))
      return undefined;
    // A plain footer on a different page cannot override an actual current
    // training-campus policy, including a policy whose possible cities differ.
    if (
      input.sources.some(
        (source) =>
          source.kind === "official_page" &&
          sourceHasSchoolIdentity(
            source,
            input.institutionName,
            input.sources,
          ) &&
          admissionEvidence(source, String(input.targetYear))
            .admissionStatus === "current_evidence" &&
          /培养(?:所在)?校区|新生所在校区|(?:培养|教学|办学)(?:地点|地址)/.test(
            withoutSchoolLinks(source.excerpt),
          ),
      )
    )
      return undefined;
    if (!addresses.some((clause) => schoolAddress(clause, input)))
      return undefined;
    if (addresses.length !== 1) return undefined;
  }
  return {
    city,
    ...(year !== undefined ? { year } : {}),
    quote: cited.quote,
    sourceId: String(raw.sourceId),
  };
}

/** An omitted model address can be recovered only from literal read school evidence. */
function extractedLocation(input: RecommendationConstraintInput) {
  const project: LocationEvidence[] = [];
  const school: LocationEvidence[] = [];
  for (const source of input.sources) {
    if (source.kind !== "official_page") continue;
    for (const clause of clauses(source.excerpt)) {
      const address = /地址|校址|办学地点|教学地点|培养地点|所在城市/.exec(
        clause,
      );
      if (!address) continue;
      const quote =
        clause.length <= 1800
          ? clause
          : clause.slice(Math.max(0, address.index - 160), address.index + 350);
      const candidates = [
        ...new Set([
          ...addressCities(clause.slice(address.index)),
          ...input.profile.cities
            .map(normalizeCityName)
            .filter((city) => city && quote.includes(`${city}市`)),
        ]),
      ];
      for (const city of candidates) {
        const value = checkedLocation({
          ...input,
          citations: [...new Set([...input.citations, source.id])],
          location: { city, quote, sourceId: source.id },
        });
        if (value)
          (programAddress(quote, input) ? project : school).push(value);
      }
    }
  }
  const available = project.length ? project : school;
  const current = available.filter(
    (value) => value.year === Number(input.targetYear),
  );
  const past = available.filter(
    (value) =>
      value.year !== undefined && value.year < Number(input.targetYear),
  );
  const latest = Math.max(...past.map((value) => value.year!));
  const found = current.length
    ? current
    : past.length
      ? past.filter((value) => value.year === latest)
      : available;
  return new Set(found.map((value) => value.city)).size === 1
    ? found[0]
    : undefined;
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
  if (tuition.year > Number(input.targetYear))
    return {
      ...check,
      reason: `所列学费为${tuition.year}年历史或其他年度参考，不据此判断${input.targetYear}年是否符合预算。`,
    };
  const reference =
    tuition.year < Number(input.targetYear)
      ? `依据${tuition.year}年历史学费作参考比较，${input.targetYear}年收费及适用条件仍待核对。`
      : "";
  if (tuition.period !== "academic_year")
    return {
      ...check,
      reason:
        reference +
        "官网费用按全程、学期或学分计费，与年度预算口径不同；未推算学制、学期数或学分数。",
    };
  if (tuition.studyMode === "unspecified")
    return {
      ...check,
      reason:
        reference +
        "学费原文未明确学习形式，须确认全日制或非全日制及其适用项目后再比较年度预算。",
    };
  const maximum = budget.upper ?? budget.lower!;
  if (tuition.amount <= maximum)
    return {
      ...check,
      status: "match",
      reason:
        reference +
        `该${tuition.studyMode === "full_time" ? "全日制" : "非全日制"}项目${tuition.year}年度学费${tuition.amount.toLocaleString("zh-CN")}元未超过所选年度预算${budget.upper ? "上限" : "起点"}；仅比较学费，住宿和生活等总费用仍待核验。`,
    };
  if (!budget.upper)
    return {
      ...check,
      reason:
        reference +
        "年度预算选择为10万元以上，未给出上限；不能将更高学费直接认定为超预算。",
    };
  return {
    ...check,
    status: "mismatch",
    reason:
      reference +
      `该${tuition.studyMode === "full_time" ? "全日制" : "非全日制"}项目${tuition.year}年度学费${tuition.amount.toLocaleString("zh-CN")}元，已高于所选年度预算上限${maximum.toLocaleString("zh-CN")}元，且尚未包括住宿和生活等费用；需放宽预算条件，是否值得选择仍须综合本人其他目标判断。`,
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
    sourceIds: location
      ? [
          ...new Set([
            location.sourceId,
            ...(location.supportingEvidence ?? []).map((item) => item.sourceId),
          ]),
        ]
      : [],
  };
  if (!cities.length)
    return { ...check, reason: "尚未限定城市，未代填城市偏好或认定地域不符。" };
  if (!location) return check;
  const reference =
    location.year !== undefined && location.year < Number(input.targetYear)
      ? `${location.year}年历史培养安排参考，${input.targetYear}年实际培养安排仍待核对。`
      : "";
  if (cities.includes(location.city))
    return {
      ...check,
      status: "match",
      reason:
        reference +
        `官网所列地址位于${location.city}，${reference ? "作为历史参考与已选城市偏好一致" : "符合已选城市偏好"}；具体培养校区仍以当年项目安排为准。`,
    };
  return {
    ...check,
    status: "mismatch",
    reason:
      reference +
      `官网所列地址位于${location.city}，${reference ? "该历史安排" : ""}不在偏好城市${cities.join("、")}内；需放宽城市条件，是否值得选择仍须综合本人其他目标判断。`,
  };
}

/** Soft preferences only: never restores a programme rejected by hard admissions guards. */
export function deriveRecommendationConstraints(
  input: RecommendationConstraintInput,
): Pick<
  RecommendationConstraints,
  "constraintChecks" | "tuition" | "location"
> {
  // Invalid explicit claims remain rejected; only a missing field is recoverable.
  let tuition =
    input.tuition === undefined
      ? extractedTuition(input)
      : checkedTuition(input);
  if (tuition && tuition.year < Number(input.targetYear)) {
    const current = extractedTuitionCandidates(input).filter(
      (item) => item.year === Number(input.targetYear),
    );
    if (current.length) tuition = selectedTuition(current, input);
  }
  const location =
    input.location === undefined
      ? (deriveCampusLocation(input) ?? extractedLocation(input))
      : checkedLocation(input);
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
