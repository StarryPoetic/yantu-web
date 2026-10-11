import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { researchTextRows } from "./research-table-text.ts";
import signals from "../../knowledge/disciplines/signals.json" with { type: "json" };
import {
  affirmativePreference,
  explicitDegreeConstraint,
} from "../../shared/profile-preferences.ts";
import type { Discipline, GuidanceRun } from "../disciplines/types.ts";
import type { ResearchReport } from "./research.ts";
import type { WebSource } from "./web.ts";
import type {
  DemandMatch,
  ResearchExamEvidence,
  ResearchCandidateAudit,
  ResearchProgramAlternative,
  ResearchHistoricalExamEvidence,
  ResearchReferenceBasis,
} from "../../shared/research-matching.ts";
import {
  researchContext,
  profileFitEvidence,
  researchDirectory,
  type ResearchPlan,
} from "./research-planning.ts";
import {
  sourceHasSchoolIdentity,
  normalizeInstitutionName,
  isConcreteProgramName,
  schoolRegistrableDomain,
  withoutSchoolLinks,
} from "./research-school.ts";
import {
  admissionEvidence,
  isSchoolPage,
  supportsProgram,
  scopedAdmissionEvidence,
  scopedKnownAdmissionConflict,
  scopedProgramPassages,
} from "./research-evidence.ts";
import { deriveRecommendationConstraints } from "./research-constraints.ts";
import { deriveResearchDecision } from "./research-decision.ts";
import {
  researchSubjectAdvice,
  compareExamAdvice,
} from "./research-subject-advice.ts";
import { safeSourceYear } from "./research-years.ts";
import { researchYearPriority } from "../../shared/research-years.ts";

type Recommendation = ResearchReport["recommendations"][number] & {
  referenceBasis?: ResearchReferenceBasis;
};
const normalized = (value: unknown) => String(value ?? "").replace(/\s/g, "");
const meaningful = (value: unknown) =>
  !!normalized(value) &&
  !/不确定|未确定|尚未|无偏好|不限/.test(normalized(value));
/** Product vocabulary only connects stated interests/background to investigation leads. */
function codesFor(value: unknown) {
  const text = normalized(affirmativePreference(value)).replace(
    /机械设计制造(?:及其)?自动化|机械设计制造及其自动化/g,
    "机械制造",
  );
  return new Set(
    signals.connections.flatMap(({ terms, codes }) =>
      terms.some((term) => text.includes(term)) ? codes : [],
    ),
  );
}
function desiredDegree(profile: Record<string, unknown>) {
  const constraint = explicitDegreeConstraint(
    profile.degreePreference,
    profile.notes,
  );
  if (constraint) return constraint;
  const preference = affirmativePreference(profile.degreePreference);
  if (/学硕|学术/.test(preference) && !/专硕|专业学位/.test(preference))
    return "academic";
  if (/专硕|专业学位/.test(preference) && !/学硕|学术/.test(preference))
    return "professional";
  const goal = affirmativePreference(profile.studyGoal);
  const academic = /科研|读博|博士|学术研究|研究训练/.test(goal);
  const professional = /就业|工程实践|行业|职业|应用实践/.test(goal);
  return academic === professional
    ? null
    : academic
      ? "academic"
      : "professional";
}

/** Same saved profile produces the same direction plan; model wording cannot erase a route. */
export function createDemandPlan(run: GuidanceRun): ResearchPlan {
  const { allowed } = researchDirectory(run);
  const profile = researchContext(run).profile;
  const target = codesFor(profile.targetMajor);
  const goal = codesFor(profile.studyGoal);
  const background = codesFor(profile.major);
  const confirmed = run.inputSnapshot.confirmedMajorId;
  const selected = allowed.filter(
    (d) =>
      target.has(d.code) ||
      goal.has(d.code) ||
      d.code === confirmed ||
      (!target.size && !goal.size && background.has(d.code)),
  );
  const ordered = [...selected].sort(
    (a, b) =>
      Number(target.has(b.code)) - Number(target.has(a.code)) ||
      Number(goal.has(b.code)) - Number(goal.has(a.code)) ||
      a.code.localeCompare(b.code),
  );
  const fields = profileFitEvidence(profile);
  return {
    directions: ordered.slice(0, 6).map((d) => ({
      disciplineCode: d.code,
      rationale: target.has(d.code)
        ? "按你填写的兴趣调查，并同步比较相关学术与专业学位路线。"
        : goal.has(d.code)
          ? "按你填写的读研目标调查，具体培养内容另行核验。"
          : "按所学专业关键词建立调查线索，同时比较学术与专业学位；关键词关联不等于适合或允许报考。",
      fitReasons: fields
        .filter((f) =>
          [
            "targetMajor",
            "studyGoal",
            "major",
            "cities",
            "degreePreference",
            "hours",
            "crossMajor",
            "budget",
          ].includes(f.profileField),
        )
        .slice(0, 4)
        .map((f) => ({
          ...f,
          reason: "使用当前保存的偏好建立调查范围，学校事实须另行核验。",
        })),
      searchSchools: [],
    })),
    followUpQuestions: [],
  };
}

import {
  programRowScope,
  programNamePattern,
} from "./research-program-scope.ts";
export { programRowScope } from "./research-program-scope.ts";

const entryCache = new WeakMap<
  WebSource,
  {
    text: string;
    title: string;
    values: Map<string, ReturnType<typeof parseProgramEntries>>;
  }
>();
export function programEntries(
  source: WebSource,
  disciplines: readonly Discipline[],
) {
  let cache = entryCache.get(source);
  if (!cache || cache.text !== source.excerpt || cache.title !== source.title) {
    cache = { text: source.excerpt, title: source.title, values: new Map() };
    entryCache.set(source, cache);
  }
  const key = JSON.stringify(
    disciplines.map((d) => [d.code, d.name, d.aliases]),
  );
  let entries = cache.values.get(key);
  if (!entries) {
    entries = parseProgramEntries(source, disciplines);
    cache.values.set(key, entries);
  }
  return entries.map((entry) => ({
    ...entry,
    discipline: disciplines.find((d) => entry.majorCode.startsWith(d.code))!,
  }));
}

/** Shared deterministic catalogue row discovery, independent of any user or model. */
function parseProgramEntries(
  source: WebSource,
  disciplines: readonly Discipline[],
) {
  const body = withoutSchoolLinks(source.excerpt);
  // Older saved HTML stores each cell on a separate physical line. Recognise
  // only explicit header-aligned rows; do not join arbitrary adjacent prose.
  const vertical: ({
    discipline: Discipline;
    programName: string;
    majorCode: string;
    catalogQuote: string;
  } & ReturnType<typeof programRowScope>)[] = [];
  let columns: string[] = [];
  for (const row of researchTextRows(body)) {
    if (!row.cells) continue;
    if (row.cells.includes("专业代码") && row.cells.includes("专业名称")) {
      columns = row.cells;
      continue;
    }
    if (!columns.length || row.cells.length !== columns.length) continue;
    const majorCode = row.cells[columns.indexOf("专业代码")];
    const programName = row.cells[columns.indexOf("专业名称")];
    const discipline = disciplines.find(
      (d) => /^\d{6}$/.test(majorCode) && majorCode.startsWith(d.code),
    );
    const collegeIndex = columns.findIndex((c) =>
      /学院名称|院系名称|^学院$|^院系$/.test(c),
    );
    if (discipline && isConcreteProgramName(programName))
      vertical.push({
        discipline,
        programName,
        majorCode,
        catalogQuote: row.line,
        studyMode: undefined,
        collegeName: collegeIndex >= 0 ? row.cells[collegeIndex] : undefined,
      });
  }
  const rows = [
    ...body.matchAll(
      /\b((?:0[1-9]|1[0-4])\d{4})\b[ \t|:：()（）\[\]【】-]*([\p{Script=Han}]{2,30})/gu,
    ),
  ];
  const entries = rows.flatMap((row, index) => {
    const discipline = disciplines.find((d) => row[1].startsWith(d.code));
    const programName = row[2].replace(
      /(?:专业学位|学术学位|全日制|非全日制|硕士|(?:正常|继续|恢复)?招生|初试|考试科目|学费).*$/,
      "",
    );
    if (!discipline || !isConcreteProgramName(programName)) return [];
    const start =
      Math.max(
        body.lastIndexOf("\n", row.index!),
        body.lastIndexOf("。", row.index!),
        body.lastIndexOf("；", row.index!),
      ) + 1;
    const boundaries = [
      body.indexOf("\n", row.index!),
      body.indexOf("。", row.index!),
    ].filter((position) => position >= 0);
    const end = boundaries.length ? Math.min(...boundaries) : body.length;
    const prefix = body.slice(start, row.index!);
    if (
      prefix.trim() &&
      !/招生(?:专业)?目录\s*[:：]\s*$/.test(prefix) &&
      !/(?:学院|研究院|研究所|学部|中心)\s*[|:：]?\s*$/.test(prefix) &&
      !/^[\s|\d①②③④]+$/.test(prefix)
    )
      return [];
    if (/报考|考生|录取|提及/.test(prefix)) return [];
    const officialName =
      row[1] === `${discipline.code}00` &&
      [discipline.name, ...discipline.aliases].includes(programName)
        ? discipline.name
        : programName;
    return [
      {
        discipline,
        programName: officialName,
        majorCode: row[1],
        catalogQuote: body
          .slice(start, end < 0 ? body.length : end)
          .trim()
          .slice(0, 300),
        ...programRowScope(body, row.index!, rows[index + 1]?.index),
      },
    ];
  });
  return /招生(?:专业)?目录/.test(`${source.title}\n${body}`) ||
    entries.length >= 2
    ? [...entries, ...vertical]
    : vertical.length >= 2
      ? vertical
      : [];
}

/** Referrals do not establish any examination subject. */
export function hasConcreteExamSubjects(text: string) {
  return /思想\s*政治\s*理论|英语\s*[（(]?[一二][）)]?|数学\s*[（(]?[一二三][）)]?|管理类综合(?:能力)?|经济类综合(?:能力)?|(?:^|[^\d])[1-9]\d{2}\s*[\p{Script=Han}]{2,30}/u.test(
    text,
  );
}

export function extractProgramExams(input: {
  institutionName: string;
  programName: string;
  majorCode?: string;
  collegeName?: string;
  studyMode?: Recommendation["studyMode"];
  discipline: Discipline;
  sources: WebSource[];
  targetYear: string;
  /** Opt-in after programme code/college/mode binding: a sibling row's closure cannot exclude this row. */
  admissionScope?: "program_row";
}): ResearchExamEvidence {
  const unknown: ResearchExamEvidence = {
    status: "unknown",
    subjects: [],
    reason:
      "尚未取得能对应这个专业的初试科目原文；不能按学硕或专硕名称推定数一、数二、英一或英二。",
  };
  const found: ResearchExamEvidence[] = [];
  const scopes = new Map<
    ResearchExamEvidence,
    ReturnType<typeof programRowScope>
  >();
  for (const source of input.sources) {
    if (
      !isSchoolPage(source) ||
      !supportsProgram(
        source,
        input.institutionName,
        input.programName,
        input.discipline,
        input.sources,
      ) ||
      admissionEvidence(
        source,
        input.targetYear,
        input.admissionScope === "program_row" ? undefined : input.programName,
      ).excluded
    )
      continue;
    const sourceYear = safeSourceYear(source);
    // An undated body (even with a 2027 search title or copyright) cannot label an exam route.
    if (sourceYear === undefined || sourceYear > Number(input.targetYear))
      continue;
    const body = withoutSchoolLinks(source.excerpt);
    // Self-defined/interdisciplinary rows also terminate the preceding route,
    // even when that neighbouring code is not a national catalogue identity.
    const rows = [...body.matchAll(/\b(?:0[1-9]|1[0-4])\d{2}[0-9A-Z]{2}\b/g)];
    for (let i = 0; i < rows.length; i++) {
      const start = rows[i].index!;
      if (!rows[i][0].startsWith(input.discipline.code)) continue;
      if (input.majorCode && rows[i][0] !== input.majorCode) continue;
      const scope = programRowScope(body, start, rows[i + 1]?.index);
      if (input.collegeName && scope.collegeName !== input.collegeName)
        continue;
      if (
        input.studyMode &&
        input.studyMode !== "unspecified" &&
        scope.studyMode !== input.studyMode
      )
        continue;
      const passage = body
        .slice(start, rows[i + 1]?.index ?? Math.min(body.length, start + 1400))
        .split(" … ")[0];
      if (
        input.admissionScope === "program_row" &&
        /不(?:再)?招生|停招|(?:暂停|停止|取消|暂缓).{0,8}招生|不招收(?:硕士|研究生|本专业|该专业)(?:[。；，、\s]|$)/.test(
          passage,
        )
      )
        continue;
      const afterCode = passage
        .slice(rows[i][0].length)
        .replace(/^[\s|:：\[\]【】-]*/, "")
        .replace(/^[（(](?:专业学位|学术学位|学术型)[）)]\s*/, "")
        .replace(/^[\s|:：()（）\[\]【】-]*/, "");
      const escapedName = programNamePattern(input.programName, rows[i][0]);
      if (
        !new RegExp(
          `^${escapedName}(?=$|[\\s|（(]|学术学位|专业学位|非?全日制|\\d|①|②|③|④)`,
          "u",
        ).test(afterCode) ||
        !/初试|考试科目|统考|①|②|③|④/.test(
          `${body.slice(Math.max(0, start - 200), start)} ${passage}`,
        )
      )
        continue;
      const initialPassage = passage.split(
        /复试|同等学力|加试|参考书目|参考课程|课程设置|培养内容/,
      )[0];
      const subjects = [
        ...initialPassage.matchAll(
          /(?:^|[^\d])(101|199|201|202|203|204|301|302|303|408)\s*[（(]?\s*(思想政治理论|管理类综合(?:能力)?|英语\s*[（(]?[一二][）)]?|俄语|日语|数学\s*[（(]?[一二三][）)]?|计算机(?:学科)?专业基础(?:综合)?)/g,
        ),
      ].map((m) => ({ code: m[1], name: m[2].replace(/\s/g, "") }));
      const names: Record<string, string> = {
        "101": "思想政治理论",
        "199": "管理类综合能力",
        "201": "英语一",
        "202": "俄语",
        "203": "日语",
        "204": "英语二",
        "301": "数学一",
        "302": "数学二",
        "303": "数学三",
        "408": "计算机学科专业基础综合",
      };
      if (
        subjects.some(
          (s) =>
            !s.name
              .replace(/[（）()]/g, "")
              .startsWith(names[s.code].replace("能力", "")),
        )
      )
        continue;
      const unique = [
        ...new Map(
          subjects.map((s) => [s.code, { code: s.code, name: names[s.code] }]),
        ).values(),
      ];
      // Self-set subjects require an explicit initial-exam slot, not a course/reference-list mention.
      for (const match of initialPassage.matchAll(
        /[①②③④]\s*([1-9]\d{2})\s*([^①②③④|\n。；;]{2,80})/g,
      )) {
        if (
          !names[match[1]] &&
          !unique.some((subject) => subject.code === match[1])
        )
          unique.push({ code: match[1], name: match[2].trim() });
      }
      if (!unique.length) continue;
      const math = unique.filter((s) => /^30/.test(s.code));
      const english = unique.filter((s) =>
        ["201", "202", "203", "204"].includes(s.code),
      );
      const current =
        sourceYear === Number(input.targetYear) &&
        admissionEvidence(
          source,
          input.targetYear,
          input.admissionScope === "program_row"
            ? undefined
            : input.programName,
        ).admissionStatus === "current_evidence";
      found.push({
        status:
          math.length > 1 || english.length > 1
            ? "ambiguous"
            : current
              ? "verified_current"
              : "historical",
        year: sourceYear,
        subjects: unique,
        quote: passage.trim(),
        sourceId: source.id,
        reason:
          math.length > 1 || english.length > 1
            ? "同一专业出现多个科目组合，需按方向、学习方式或考试组确认，暂不选定。"
            : current
              ? "已在目标年度官网专业条目中读到这些初试科目；方向、学习方式和考试组仍需核对完整目录。"
              : `这是${sourceYear}年官网初试科目，可用于历史准备路线比较，不能作为目标年度科目安排。`,
      });
      scopes.set(found.at(-1)!, scope);
    }
  }
  const subjectIdentity = (subjects: ResearchExamEvidence["subjects"]) =>
    JSON.stringify(
      [...subjects].sort(
        (a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name),
      ),
    );
  const resolveYear = (
    pool: ResearchExamEvidence[],
  ): ResearchExamEvidence | undefined => {
    if (!pool.length) return undefined;
    const sorted = [...pool].sort(
      (a, b) =>
        (a.sourceId ?? "").localeCompare(b.sourceId ?? "") ||
        (a.quote ?? "").localeCompare(b.quote ?? ""),
    );
    if (
      new Set(pool.map((record) => subjectIdentity(record.subjects))).size >
        1 ||
      (!input.collegeName &&
        new Set(
          pool.map((record) => scopes.get(record)?.collegeName).filter(Boolean),
        ).size > 1) ||
      ((!input.studyMode || input.studyMode === "unspecified") &&
        new Set(
          pool.map((record) => scopes.get(record)?.studyMode).filter(Boolean),
        ).size > 1)
    )
      return {
        status: "ambiguous",
        year: sorted[0].year,
        subjects: [],
        reason: `${sorted[0].year}年同一专业的官网条目存在不同科目组合；需要核对方向、学习形式或考试组后再确定。`,
      };
    return sorted[0];
  };
  const history: ResearchHistoricalExamEvidence[] = [
    ...new Set(
      found.flatMap((record) =>
        record.year !== undefined && record.year < Number(input.targetYear)
          ? [record.year]
          : [],
      ),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .map((year) => {
      const record = resolveYear(found.filter((item) => item.year === year))!;
      return {
        ...record,
        year,
        status: record.status === "ambiguous" ? "ambiguous" : "historical",
      };
    });
  const current = resolveYear(
    found.filter(
      (record) =>
        record.year === Number(input.targetYear) &&
        (record.status === "verified_current" || record.status === "ambiguous"),
    ),
  );
  const selected = current ?? history[0] ?? unknown;
  if (!history.length) return selected;
  const comparisons: [number, ResearchExamEvidence][] = [...history]
    .reverse()
    .map((record) => [record.year, record]);
  if (current?.status === "verified_current")
    comparisons.push([Number(input.targetYear), current]);
  const historicalChanges: NonNullable<
    ResearchExamEvidence["historicalChanges"]
  > = [];
  for (let index = 1; index < comparisons.length; index++) {
    const [fromYear, before] = comparisons[index - 1];
    const [toYear, after] = comparisons[index];
    if (
      before.status === "ambiguous" ||
      after.status === "ambiguous" ||
      subjectIdentity(before.subjects) === subjectIdentity(after.subjects)
    )
      continue;
    const slots = (record: ResearchExamEvidence) =>
      new Map(
        record.subjects.flatMap((subject) => {
          const labelled = record.quote?.match(
            new RegExp(`([①②③④])\\s*${subject.code}(?!\\d)`),
          )?.[1];
          const slot =
            labelled ??
            (["201", "202", "203", "204"].includes(subject.code)
              ? "②"
              : /^30[123]$/.test(subject.code)
                ? "③"
                : subject.code === "101" || subject.code === "199"
                  ? "①"
                  : subject.code === "408"
                    ? "④"
                    : undefined);
          return slot ? [[slot, subject] as const] : [];
        }),
      );
    const beforeSlots = slots(before),
      afterSlots = slots(after);
    const changes = [...beforeSlots].flatMap(([slot, subject]) => {
      const next = afterSlots.get(slot);
      return next && (next.code !== subject.code || next.name !== subject.name)
        ? [{ before: subject, after: next }]
        : [];
    });
    // A longer excerpt is not proof that an unobserved subject was newly introduced.
    if (!changes.length) continue;
    const describe = (subjects: ResearchExamEvidence["subjects"]) =>
      subjects.map((subject) => `${subject.code} ${subject.name}`).join("、");
    historicalChanges.push({
      fromYear,
      toYear,
      sourceIds: [
        ...new Set(
          [before.sourceId, after.sourceId].filter((id): id is string => !!id),
        ),
      ],
      summary: `${fromYear}年至${toYear}年，两年都明确列出的初试科目由“${describe(changes.map((change) => change.before))}”变为“${describe(changes.map((change) => change.after))}”；未读到的科目不计作变化。${toYear === Number(input.targetYear) ? "目标年度要求与历史参考分别保留，以目标年度具体专业目录为准。" : "这是已核验历史年度之间的变化，不推定目标年度延续其中任一组合。"}`,
    });
  }
  return {
    ...selected,
    historicalReference: history[0],
    history,
    ...(historicalChanges.length ? { historicalChanges } : {}),
  };
}

export function evaluateDemandMatch(
  item: Recommendation,
  run: GuidanceRun,
  discipline: Discipline,
): { match: DemandMatch; tier: "preferred" | "alternative" | "exploratory" } {
  const profile = researchContext(run).profile;
  const target = codesFor(profile.targetMajor);
  const background = codesFor(profile.major);
  const goal = codesFor(profile.studyGoal);
  const requestedDegree = desiredDegree(profile);
  const citations = item.citations;
  const factors: DemandMatch["factors"] = [];
  const subjectMatch = compareExamAdvice(
    researchSubjectAdvice(run),
    item.exams,
  );
  for (const check of item.constraintChecks ?? [])
    factors.push({
      ...check,
      label: check.field === "cities" ? "意向城市" : "年度预算",
    });
  factors.push({
    field: "targetMajor",
    label: "专业兴趣",
    status: !meaningful(profile.targetMajor)
      ? "not_requested"
      : target.has(discipline.code)
        ? "match"
        : target.size
          ? "mismatch"
          : "unknown",
    reason: !meaningful(profile.targetMajor)
      ? "尚未指定具体兴趣，可继续比较相关方向。"
      : target.has(discipline.code)
        ? "该方向与当前填写的兴趣关键词有关联；仍需对照培养内容确认。"
        : "尚未确认该方向与当前兴趣的对应关系。",
    sourceIds: citations,
  });
  factors.push({
    field: "major",
    label: "已有专业基础",
    status: background.has(discipline.code) ? "match" : "unknown",
    reason: background.has(discipline.code)
      ? "本科专业关键词与此方向有关联，可优先核对已学课程；这不是能力或报考资格判断。"
      : "需要对照已学课程与专业课大纲，确定补修成本；愿意跨考不等于学校允许报考。",
    sourceIds: citations,
  });
  factors.push({
    field: "degreePreference",
    label: "培养路线",
    status: !requestedDegree
      ? "not_requested"
      : discipline.degreeType === requestedDegree
        ? "match"
        : "mismatch",
    reason: !requestedDegree
      ? "当前未明确倾向学术或专业学位，两条路线同时保留比较。"
      : discipline.degreeType === requestedDegree
        ? "符合当前培养偏好或读研目标的路线线索，具体培养方式仍需看学校方案。"
        : "与当前培养偏好或读研目标的路线线索有差异，可作为另一种培养路线比较。",
    sourceIds: citations,
  });
  factors.push({
    field: "hours",
    label: "准备时间与测评",
    status: "unknown",
    reason:
      "需结合该专业实际考试科目、专项诊断和可投入时间安排；小题量练习不能判定能否考上或淘汰学校。",
    sourceIds: [],
  });
  const city = factors.find((f) => f.field === "cities");
  factors.push(...subjectMatch.factors);
  const directionMatch =
    target.has(discipline.code) ||
    goal.has(discipline.code) ||
    (!target.size && !goal.size && background.has(discipline.code));
  const citiesRequested =
    Array.isArray(profile.cities) &&
    profile.cities.some(
      (city) =>
        typeof city === "string" &&
        city.trim() &&
        !/^(?:全国|不确定|不限(?:城市)?|无偏好|未确定)$/.test(city.trim()),
    );
  const preferenceConflict =
    (target.size > 0 && !target.has(discipline.code)) ||
    (requestedDegree !== null && requestedDegree !== discipline.degreeType);
  const tier =
    directionMatch &&
    !preferenceConflict &&
    (!citiesRequested || city?.status === "match")
      ? "preferred"
      : directionMatch || background.has(discipline.code)
        ? "alternative"
        : "exploratory";
  const summary =
    tier === "preferred"
      ? "与明确方向线索及已核验地域偏好一致，列为优先比较；费用、考试准备和年度资格缺口逐项保留。"
      : tier === "alternative"
        ? "有方向或课程关联，但城市、兴趣或培养路线仍有差异／待核验，列为备选并说明取舍。"
        : "暂未形成明确需求关联，保留为探索选择，需进一步比较兴趣和补修成本。";
  return {
    tier,
    match: {
      ruleVersion: "demand-match-v1",
      factors,
      summary,
      ...(subjectMatch.factors.length
        ? { subjectAdviceBonus: subjectMatch.bonus }
        : {}),
    },
  };
}

function sourceMatchesProgramScope(
  source: WebSource,
  item: Recommendation,
  discipline: Discipline,
) {
  if (
    !item.majorCode &&
    !item.collegeName &&
    (!item.studyMode || item.studyMode === "unspecified")
  )
    return true;
  // A programme-wide notice may restrict all routes, but cannot prove a missing explicit code.
  if (
    item.majorCode &&
    !new RegExp(`\\b${item.majorCode}\\b`).test(
      withoutSchoolLinks(source.excerpt),
    )
  )
    return false;
  return (
    scopedProgramPassages(source, {
      ...item,
      programName: item.programName!,
      disciplineCode: discipline.code,
    }).length > 0
  );
}

function currentProgramConflict(
  source: WebSource,
  item: Pick<
    Recommendation,
    | "institutionName"
    | "programName"
    | "majorCode"
    | "collegeName"
    | "studyMode"
  >,
  discipline: Discipline,
  profile: Record<string, unknown>,
  year: string,
) {
  if (
    !isSchoolPage(source) ||
    !sourceHasSchoolIdentity(source, item.institutionName) ||
    safeSourceYear(source) !== Number(year) ||
    !item.programName
  )
    return false;
  const scope = {
    ...item,
    programName: item.programName,
    disciplineCode: discipline.code,
  };
  const wholePage = admissionEvidence(source, year);
  if (wholePage.exclusionKind === "closure") return true;
  if (scopedAdmissionEvidence(source, year, scope).exclusionKind === "closure")
    return true;
  if (
    !supportsProgram(source, item.institutionName, item.programName, discipline)
  )
    return false;
  return scopedKnownAdmissionConflict(source, scope, discipline, profile, year);
}

/** The most recent supported historical programme is the baseline; current facts remain separate. */
function programReferenceBasis(
  item: Recommendation,
  discipline: Discipline,
  sources: WebSource[],
  targetYear: string,
): ResearchReferenceBasis | undefined {
  const usable = sources
    .filter(
      (source) =>
        isSchoolPage(source) &&
        supportsProgram(
          source,
          item.institutionName,
          item.programName!,
          discipline,
        ) &&
        !scopedAdmissionEvidence(source, targetYear, {
          ...item,
          programName: item.programName!,
          disciplineCode: discipline.code,
        }).excluded &&
        sourceMatchesProgramScope(source, item, discipline),
    )
    .flatMap((source) => {
      const year = safeSourceYear(source);
      return year !== undefined && year <= Number(targetYear)
        ? [{ source, year }]
        : [];
    });
  const historical = usable
    .filter((item) => item.year < Number(targetYear))
    .sort((a, b) => b.year - a.year);
  const year =
    historical[0]?.year ??
    usable.find((item) => item.year === Number(targetYear))?.year;
  if (year === undefined) return undefined;
  return {
    year,
    sourceIds: usable
      .filter((item) => item.year === year)
      .map((item) => item.source.id)
      .sort(),
    reason:
      year < Number(targetYear)
        ? `使用最近可核验的${year}年历史专业条目作为比较基线；目标${targetYear}年的实际考试科目和报考条件独立核验，历史条目不代表本年度仍开放。`
        : `当前仅读到${targetYear}年对应专业的年度资料，作为目标年度辅助证据；未形成可核验历史基线，需继续补充前三年的对应条目。`,
  };
}

/** Reads all supported coded programs before model recommendations; omissions cannot hide a school. */
export function buildEvidenceCandidates(input: {
  run: GuidanceRun;
  disciplines: Discipline[];
  sources: WebSource[];
  targetYear: string;
  schoolNames?: string[];
  schoolNamesOnly?: boolean;
}): { recommendations: Recommendation[]; audit: ResearchCandidateAudit[] } {
  const profile = researchContext(input.run).profile;
  const discovered = new Set(input.schoolNames ?? []);
  for (const source of input.schoolNamesOnly ? [] : input.sources) {
    for (const match of withoutSchoolLinks(source.excerpt).matchAll(
      /(?:^|[\s:：。；|｜])([\p{Script=Han}]{2,20}(?:大学|学院|研究院|研究所))(?=\s|\d|年|硕士|研究生|招生|专业|学科|版权所有|$)/gu,
    )) {
      if (sourceHasSchoolIdentity(source, match[1])) discovered.add(match[1]);
    }
  }
  const recommendations: Recommendation[] = [];
  const audit: ResearchCandidateAudit[] = [];
  const names = new Set<string>();
  for (const name of discovered) {
    const normalized = normalizeInstitutionName(
      name,
      input.sources.filter((s) => sourceHasSchoolIdentity(s, name)),
      input.sources,
    );
    if (normalized) names.add(normalized.institutionName);
    else
      audit.push({
        institutionName: name,
        status: "excluded",
        reasons: ["无法确定该学院所属招生单位，未将下属学院作为独立学校推荐。"],
        sourceIds: input.sources
          .filter((s) => sourceHasSchoolIdentity(s, name))
          .map((s) => s.id),
      });
  }
  for (const institutionName of [...names].sort()) {
    const schoolSources = input.sources.filter((s) =>
      sourceHasSchoolIdentity(s, institutionName, input.sources),
    );
    let excluded = false;
    let added = false;
    const seen = new Set<string>();
    for (const source of schoolSources
      .filter(isSchoolPage)
      .sort(
        (a, b) =>
          researchYearPriority(safeSourceYear(b), input.targetYear) -
            researchYearPriority(safeSourceYear(a), input.targetYear) ||
          (safeSourceYear(b) ?? 0) - (safeSourceYear(a) ?? 0) ||
          a.id.localeCompare(b.id),
      )) {
      for (const {
        discipline,
        programName,
        majorCode,
        collegeName,
        studyMode,
      } of programEntries(source, input.disciplines)) {
        const key = `${majorCode}:${programName}:${collegeName ?? ""}:${studyMode ?? ""}`;
        if (
          seen.has(key) ||
          !supportsProgram(
            source,
            institutionName,
            programName,
            discipline,
            input.sources,
          )
        )
          continue;
        const programScope = {
          institutionName,
          programName,
          majorCode,
          collegeName,
          studyMode,
          disciplineCode: discipline.code,
        };
        const scope = scopedAdmissionEvidence(
          source,
          input.targetYear,
          programScope,
          input.sources,
        );
        if (!scope.scopeMatched) continue;
        const currentConflict = input.sources.some((other) =>
          currentProgramConflict(
            other,
            programScope,
            discipline,
            profile,
            input.targetYear,
          ),
        );
        if (scope.excluded || currentConflict) {
          excluded = true;
          continue;
        }
        seen.add(key);
        const citations = [source.id];
        const constraints = deriveRecommendationConstraints({
          profile: {
            budget: String(profile.budget ?? ""),
            cities: Array.isArray(profile.cities)
              ? (profile.cities as string[])
              : [],
          },
          institutionName,
          programName,
          collegeName,
          majorCode,
          degreeType: discipline.degreeType,
          studyMode,
          targetYear: input.targetYear,
          citations,
          sources: input.sources,
        });
        for (const evidence of [constraints.location, constraints.tuition])
          if (evidence && !citations.includes(evidence.sourceId))
            citations.push(evidence.sourceId);
        for (const check of constraints.constraintChecks)
          for (const sourceId of check.sourceIds)
            if (!citations.includes(sourceId)) citations.push(sourceId);
        const fitReasons = profileFitEvidence(profile)
          .filter((f) =>
            [
              "major",
              "targetMajor",
              "cities",
              "degreePreference",
              "studyGoal",
              "hours",
              "budget",
              "crossMajor",
            ].includes(f.profileField),
          )
          .slice(0, 6)
          .map((f) => ({
            ...f,
            reason:
              f.profileField === "cities"
                ? constraints.constraintChecks.find(
                    (c) => c.field === "cities",
                  )!.reason
                : f.profileField === "budget"
                  ? constraints.constraintChecks.find(
                      (c) => c.field === "budget",
                    )!.reason
                  : f.profileField === "major"
                    ? "对照已学课程和官网专业条目，核实能复用哪些基础与需要补修哪些内容；关键词关联只是调查线索。"
                    : f.profileField === "targetMajor"
                      ? "以你当前明确的兴趣为比较依据，需对照实际培养内容确认。"
                      : f.profileField === "hours"
                        ? "用你可投入的时间安排专业课和公共课诊断，再评估具体准备成本。"
                        : f.profileField === "crossMajor"
                          ? "依据你当前跨专业意愿比较课程差距，招生资格另外核验。"
                          : "依据当前培养偏好或读研目标，同时比较学术与实践训练内容。",
          }));
        if (fitReasons.length < 2) continue;
        const item: Recommendation = {
          institutionName,
          disciplineCode: discipline.code,
          programName,
          majorCode,
          ...(collegeName ? { collegeName } : {}),
          ...(studyMode ? { studyMode } : {}),
          degreeType: discipline.degreeType,
          ...constraints,
          fitReasons,
          rationale:
            "官网专业条目支持该学校与专业存在；按当前保存的兴趣、课程背景和地域偏好逐项比较，培养内容关联属于初步判断。",
          preparation: [
            "先核对完整招生目录的初试科目、方向和学习方式，再安排公共课与专业课专项诊断。",
          ],
          tradeoffs: [
            "当前资料尚不能确定完整课程差距和准备进度，需要补充专项诊断与培养方案。",
          ],
          uncertainties: [
            "报考条件、方向／考试组、培养校区及年度费用须逐项确认；已读到项目不等于资格通过。",
          ],
          admissionStatus: scope.admissionStatus,
          citations,
        };
        const referenceBasis = programReferenceBasis(
          item,
          discipline,
          input.sources,
          input.targetYear,
        );
        if (referenceBasis) {
          item.referenceBasis = referenceBasis;
          for (const id of referenceBasis.sourceIds)
            if (!item.citations.includes(id)) item.citations.push(id);
        }
        const currentSources = input.sources.filter(
          (other) =>
            isSchoolPage(other) &&
            safeSourceYear(other) === Number(input.targetYear) &&
            supportsProgram(other, institutionName, programName, discipline) &&
            sourceMatchesProgramScope(other, item, discipline) &&
            scopedAdmissionEvidence(other, input.targetYear, programScope)
              .admissionStatus === "current_evidence" &&
            !scopedAdmissionEvidence(other, input.targetYear, programScope)
              .excluded,
        );
        if (currentSources.length) {
          item.admissionStatus = "current_evidence";
          for (const source of currentSources)
            if (!item.citations.includes(source.id))
              item.citations.push(source.id);
        }
        const exams = extractProgramExams({
          institutionName,
          programName,
          majorCode,
          collegeName,
          studyMode,
          discipline,
          sources: input.sources,
          targetYear: input.targetYear,
          admissionScope: "program_row",
        });
        for (const id of [
          exams.sourceId,
          ...(exams.history ?? []).map((record) => record.sourceId),
          ...(exams.historicalChanges ?? []).flatMap(
            (change) => change.sourceIds,
          ),
        ])
          if (id && !item.citations.includes(id)) item.citations.push(id);
        const match = evaluateDemandMatch(
          { ...item, exams },
          input.run,
          discipline,
        );
        Object.assign(item, match, {
          tierReasons: [
            match.match.summary,
            ...constraints.constraintChecks
              .filter((c) => c.status !== "match")
              .map((c) => c.reason),
          ],
          exams,
        });
        recommendations.push(item);
        added = true;
      }
    }
    audit.push({
      institutionName,
      status: added
        ? "recommended"
        : excluded
          ? "excluded"
          : "awaiting_evidence",
      reasons: [
        added
          ? "已读取可支持具体硕士专业的官网条目，按相同需求规则比较。"
          : excluded
            ? "已读条目有停招、示例或明确年度资格冲突；未以待核验掩盖已知冲突。"
            : schoolSources.some(isSchoolPage)
              ? "已读取该校官网，但尚未解析到与本次方向对应且可核验的硕士专业条目；不能据此判定不适合。"
              : "尚未读到可核验的学校专业正文；搜索摘要不是排除或推荐依据。",
      ],
      sourceIds: schoolSources.map((s) => s.id),
    });
  }
  return { recommendations, audit };
}

function independentRoutes(
  items: Recommendation[],
  run: GuidanceRun,
  sources: WebSource[],
  year: string,
): Recommendation[] {
  const profile = researchContext(run).profile;
  return items.flatMap(({ programAlternatives, ...main }) => [
    main,
    ...(programAlternatives ?? []).map((route) => {
      // Legacy route cards may lack their own constraints. Read their own programme evidence;
      // a school-level main card is never proof of a different programme's campus or fees.
      const constraints = route.constraintChecks
        ? {}
        : deriveRecommendationConstraints({
            profile: {
              budget: String(profile.budget ?? ""),
              cities: Array.isArray(profile.cities)
                ? (profile.cities as string[])
                : [],
            },
            institutionName: main.institutionName,
            programName: route.programName,
            collegeName: route.collegeName,
            majorCode: route.majorCode,
            degreeType: route.degreeType,
            studyMode: route.studyMode,
            targetYear: year,
            citations: route.citations,
            sources,
          });
      return {
        ...route,
        ...constraints,
        institutionName: main.institutionName,
        rationale:
          route.rationale ??
          "按这条专业路线自己的官网证据和当前需求逐项比较，缺少的资料另行核验。",
        preparation: route.preparation ?? [],
        uncertainties: route.uncertainties ?? [],
      };
    }),
  ]);
}

function sameProgram(a: Recommendation, b: Recommendation) {
  return (
    a.institutionName === b.institutionName &&
    a.disciplineCode === b.disciplineCode &&
    a.programName === b.programName
  );
}
function compatibleProgram(a: Recommendation, b: Recommendation) {
  return (
    sameProgram(a, b) &&
    ["majorCode", "collegeName", "studyMode"].every(
      (field) =>
        !a[field as keyof Recommendation] ||
        !b[field as keyof Recommendation] ||
        a[field as keyof Recommendation] === b[field as keyof Recommendation],
    ) &&
    (!a.location || !b.location || a.location.city === b.location.city) &&
    (!a.tuition ||
      !b.tuition ||
      a.tuition.studyMode === "unspecified" ||
      b.tuition.studyMode === "unspecified" ||
      a.tuition.studyMode === b.tuition.studyMode)
  );
}

/** Merge only observations of the same programme identity, filling facts a model card omitted. */
function consolidatePrograms(items: Recommendation[]): Recommendation[] {
  const identitySpecificity = (item: Recommendation) =>
    [
      item.majorCode,
      item.collegeName,
      item.studyMode,
      item.location?.city,
    ].filter(Boolean).length;
  const candidates: Recommendation[] = [];
  // Fully identified inventory entries come first so a generic card cannot fuse two colleges.
  for (const item of [...items].sort(
    (a, b) => identitySpecificity(b) - identitySpecificity(a),
  )) {
    const matches = candidates.flatMap((other, index) =>
      compatibleProgram(item, other) ? [index] : [],
    );
    if (matches.length > 1) continue;
    if (!matches.length) {
      candidates.push({ ...item });
      continue;
    }
    const index = matches[0];
    const previous = candidates[index];
    const combined = { ...previous };
    for (const field of [
      "majorCode",
      "collegeName",
      "studyMode",
      "location",
      "tuition",
      "admissionStatus",
    ] as const)
      if (!combined[field] && item[field])
        Object.assign(combined, { [field]: item[field] });
    const checks = new Map(
      (previous.constraintChecks ?? []).map((check) => [check.field, check]),
    );
    for (const check of item.constraintChecks ?? [])
      if (
        !checks.has(check.field) ||
        checks.get(check.field)!.status === "unknown"
      )
        checks.set(check.field, check);
    combined.constraintChecks = [...checks.values()];
    combined.citations = [
      ...new Set([...previous.citations, ...item.citations]),
    ];
    combined.preparation = [
      ...new Set([...previous.preparation, ...item.preparation]),
    ];
    combined.uncertainties = [
      ...new Set([...previous.uncertainties, ...item.uncertainties]),
    ];
    combined.tradeoffs = [
      ...new Set([...(previous.tradeoffs ?? []), ...(item.tradeoffs ?? [])]),
    ];
    combined.fitReasons = [
      ...new Map(
        [...(previous.fitReasons ?? []), ...(item.fitReasons ?? [])].map(
          (reason) => [JSON.stringify(reason), reason],
        ),
      ).values(),
    ];
    candidates[index] = combined;
  }
  return candidates;
}

/** Rule ordering + stable identity tie-break; one main choice with same-school routes exposed. */
export function rankDemandCandidates(
  items: Recommendation[],
  run: GuidanceRun,
  disciplines: Discipline[],
  sources: WebSource[],
  year: string,
) {
  const observations = deriveResearchDecision(run).assessments;
  const ranked = consolidatePrograms(
    independentRoutes(items, run, sources, year),
  ).flatMap((item) => {
    const discipline = disciplines.find((d) => d.code === item.disciplineCode);
    if (!discipline || !item.programName) return [];
    if (
      sources.some((source) =>
        currentProgramConflict(
          source,
          item,
          discipline,
          researchContext(run).profile,
          year,
        ),
      )
    )
      return [];
    const exams = extractProgramExams({
      institutionName: item.institutionName,
      programName: item.programName,
      majorCode: item.majorCode,
      collegeName: item.collegeName,
      studyMode: item.studyMode,
      discipline,
      sources: sources.filter((source) =>
        item.citations.some((id) =>
          sources.some(
            (anchor) =>
              anchor.id === id &&
              sourceHasSchoolIdentity(anchor, item.institutionName, sources) &&
              schoolRegistrableDomain(anchor.url) ===
                schoolRegistrableDomain(source.url),
          ),
        ),
      ),
      targetYear: year,
      admissionScope: "program_row",
    });
    const referenceBasis = programReferenceBasis(
      item,
      discipline,
      sources,
      year,
    );
    const examSourceIds = [
      exams.sourceId,
      ...(exams.history ?? []).map((record) => record.sourceId),
      ...(exams.historicalChanges ?? []).flatMap((change) => change.sourceIds),
    ].filter((id): id is string => !!id);
    const citations = [
      ...new Set([
        ...item.citations,
        ...(referenceBasis?.sourceIds ?? []),
        ...examSourceIds,
      ]),
    ];
    const evaluated = evaluateDemandMatch(
      { ...item, citations, exams },
      run,
      discipline,
    );
    const tasks = observations
      .filter(
        (observation) =>
          observation.weakPoints.length &&
          (exams.status !== "verified_current" ||
            exams.subjects.some((subject) =>
              observation.module === "math"
                ? /^30[123]$/.test(subject.code)
                : ["201", "204"].includes(subject.code),
            )),
      )
      .map(
        (observation) =>
          `${observation.status === "local_diagnosis" ? "测评准备线索" : "练习回顾"}：${observation.nextSteps[0]}`,
      );
    return [
      {
        ...item,
        referenceBasis,
        citations,
        programName: item.programName,
        degreeType: discipline.degreeType,
        constraintChecks: item.constraintChecks ?? [],
        fitReasons: item.fitReasons ?? [],
        tradeoffs: item.tradeoffs ?? [],
        admissionStatus:
          item.admissionStatus ?? ("needs_verification" as const),
        preparation: [...new Set([...item.preparation, ...tasks])].slice(0, 7),
        uncertainties: [
          ...new Set([
            ...item.uncertainties,
            ...evaluated.match.factors
              .filter(
                (factor) =>
                  factor.field.startsWith("assessment-") &&
                  factor.status === "mismatch",
              )
              .map((factor) => factor.reason),
          ]),
        ],
        ...evaluated,
        tierReasons: [
          evaluated.match.summary,
          ...(item.constraintChecks ?? [])
            .filter((c) => c.status !== "match")
            .map((c) => c.reason),
        ],
        exams,
      },
    ];
  });
  const tierOrder = { preferred: 0, alternative: 1, exploratory: 2 };
  const preferenceScore = (match: DemandMatch) =>
    (match.subjectAdviceBonus ?? 0) +
    match.factors.filter(
      (factor) =>
        factor.status === "match" && !factor.field.startsWith("assessment-"),
    ).length;
  const targetProgramName = researchContext(run).profile.targetMajor;
  ranked.sort(
    (a, b) =>
      tierOrder[a.tier] - tierOrder[b.tier] ||
      Number(
        b.match.factors.some(
          (f) => f.field === "cities" && f.status === "match",
        ),
      ) -
        Number(
          a.match.factors.some(
            (f) => f.field === "cities" && f.status === "match",
          ),
        ) ||
      preferenceScore(b.match) - preferenceScore(a.match) ||
      Number(b.programName === targetProgramName) -
        Number(a.programName === targetProgramName) ||
      a.institutionName.localeCompare(b.institutionName, "zh-CN") ||
      a.disciplineCode.localeCompare(b.disciplineCode) ||
      a.programName!.localeCompare(b.programName!, "zh-CN") ||
      (a.majorCode ?? "").localeCompare(b.majorCode ?? "") ||
      (a.collegeName ?? "").localeCompare(b.collegeName ?? "", "zh-CN") ||
      (a.studyMode ?? "").localeCompare(b.studyMode ?? "") ||
      (a.location?.city ?? "").localeCompare(b.location?.city ?? "", "zh-CN"),
  );
  return ranked
    .filter(
      (item, index) =>
        ranked.findIndex(
          (other) => other.institutionName === item.institutionName,
        ) === index,
    )
    .slice(0, B.finalSchools)
    .map((item) => ({
      ...item,
      programAlternatives: ranked
        .filter(
          (other) =>
            other.institutionName === item.institutionName && other !== item,
        )
        .slice(0, 3)
        .map(
          (other): ResearchProgramAlternative => ({
            programName: other.programName,
            disciplineCode: other.disciplineCode,
            ...(other.majorCode ? { majorCode: other.majorCode } : {}),
            ...(other.collegeName ? { collegeName: other.collegeName } : {}),
            ...(other.studyMode ? { studyMode: other.studyMode } : {}),
            degreeType: other.degreeType!,
            ...(other.location ? { location: other.location } : {}),
            ...(other.tuition ? { tuition: other.tuition } : {}),
            tierReasons: other.tierReasons,
            constraintChecks: other.constraintChecks,
            fitReasons: other.fitReasons,
            rationale: other.rationale,
            preparation: other.preparation,
            tradeoffs: other.tradeoffs,
            uncertainties: other.uncertainties,
            admissionStatus: other.admissionStatus,
            ...(other.referenceBasis
              ? { referenceBasis: other.referenceBasis }
              : {}),
            exams: other.exams,
            match: other.match,
            tier: other.tier,
            citations: other.citations,
          }),
        ),
    }));
}
