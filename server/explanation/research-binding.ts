import type { Discipline, GuidanceRun } from "../disciplines/types.ts";
import type { ResearchReport } from "./research.ts";
import type { PendingResearchEvidence } from "../../shared/research-recommendation.ts";
import type { WebSource } from "./web.ts";
import { deriveRecommendationConstraints } from "./research-constraints.ts";
import { extractProgramExams, programRowScope } from "./research-matching.ts";
import { isSchoolPage } from "./research-evidence.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";
import { researchContext } from "./research-planning.ts";
import { safeSourceYear } from "./research-years.ts";
import {
  normalizedEvidence,
  tuitionMoney,
  tuitionPassages,
} from "./research-tuition-passages.ts";
import {
  schoolRegistrableDomain,
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
} from "./research-school.ts";

type Recommendation = ResearchReport["recommendations"][number];
const trainingLocation =
  /(?:培养|办学|教学)(?:地点|地址|校区)|校区(?:地址|位于|坐落|所在地)|(?:地址|地点)[^。；;]{0,60}校区|在[^。；;]{0,30}校区(?:培养|学习|就读)/;

/** A cited identity anchors the domain; unrelated schools and unvalidated attachments are excluded. */
export function sameSchoolReadSources(
  item: Pick<Recommendation, "institutionName" | "citations">,
  sources: WebSource[],
) {
  const domains = new Set(
    sources
      .filter(
        (s) =>
          item.citations.includes(s.id) &&
          isSchoolPage(s) &&
          sourceHasSchoolIdentity(s, item.institutionName, sources),
      )
      .map((s) => schoolRegistrableDomain(s.url)),
  );
  return sources.filter(
    (s) =>
      isSchoolPage(s) &&
      domains.has(schoolRegistrableDomain(s.url)) &&
      sourceHasSchoolIdentity(s, item.institutionName, sources) &&
      (!(s.parentSourceId || s.provenance) ||
        validatedSourceProvenance(s)?.institutionName === item.institutionName),
  );
}

/** Bind with the existing scope/year/population validators; pending text never supplies a constraint. */
export function bindRecommendationEvidence(
  item: Recommendation,
  run: GuidanceRun,
  discipline: Discipline,
  sources: WebSource[],
  targetYear: string,
): Recommendation {
  const own = sameSchoolReadSources(item, sources);
  const profile = researchContext(run).profile;
  const scopes = own
    .flatMap((source) => {
      const body = withoutSchoolLinks(source.excerpt);
      const rows = [...body.matchAll(/\b(?:0[1-9]|1[0-4])\d{4}\b/g)];
      return rows.flatMap((row, index) => {
        if (
          !(item.majorCode
            ? row[0] === item.majorCode
            : row[0].startsWith(item.disciplineCode))
        )
          return [];
        const passage = body
          .slice(row.index! + row[0].length, rows[index + 1]?.index)
          .trim();
        if (!passage.startsWith(item.programName!)) return [];
        return [
          {
            ...programRowScope(body, row.index!, rows[index + 1]?.index),
            majorCode: row[0],
          },
        ];
      });
    })
    .filter(
      (scope) =>
        (!item.collegeName ||
          !scope.collegeName ||
          scope.collegeName === item.collegeName) &&
        (!item.studyMode ||
          item.studyMode === "unspecified" ||
          !scope.studyMode ||
          scope.studyMode === item.studyMode),
    );
  const ambiguousIdentity =
    (!item.majorCode && new Set(scopes.map((s) => s.majorCode)).size > 1) ||
    (!item.collegeName &&
      new Set(scopes.map((s) => s.collegeName).filter(Boolean)).size > 1) ||
    ((!item.studyMode || item.studyMode === "unspecified") &&
      new Set(scopes.map((s) => s.studyMode).filter(Boolean)).size > 1);
  // A unique coded row may supply missing identity even when the model omitted it.
  // Multiple faculties/modes stay unresolved instead of picking the first page.
  if (!ambiguousIdentity) {
    for (const field of ["majorCode", "collegeName", "studyMode"] as const) {
      const values = [...new Set(scopes.map((s) => s[field]).filter(Boolean))];
      if (
        (!item[field] || item[field] === "unspecified") &&
        values.length === 1
      )
        item = { ...item, [field]: values[0] };
    }
  }
  const applicable = ambiguousIdentity ? [] : own;
  const constraintInput = {
    institutionName: item.institutionName,
    programName: item.programName!,
    majorCode: item.majorCode,
    collegeName: item.collegeName,
    studyMode: item.studyMode,
    degreeType: item.degreeType,
    profile: {
      budget: String(profile.budget ?? ""),
      cities: Array.isArray(profile.cities) ? (profile.cities as string[]) : [],
    },
    targetYear,
    sources: applicable,
    citations: own.map((s) => s.id),
  };
  const constraints = deriveRecommendationConstraints(
    ambiguousIdentity
      ? { ...constraintInput, sources: own, schoolWideOnly: true, location: {} }
      : constraintInput,
  );
  const exams = extractProgramExams({
    institutionName: item.institutionName,
    programName: item.programName!,
    majorCode: item.majorCode,
    collegeName: item.collegeName,
    studyMode: item.studyMode,
    discipline,
    sources: applicable,
    targetYear,
    admissionScope: "program_row",
  });
  if (ambiguousIdentity) {
    exams.status = "ambiguous";
    exams.reason = "同名专业存在多个代码、学院或学习方式，尚未唯一归属。";
  }
  const pendingEvidence: PendingResearchEvidence[] = [];
  const bound = {
    tuition: !!constraints.tuition,
    location: !!constraints.location,
    exams:
      ["verified_current", "historical"].includes(exams.status) &&
      !!exams.subjects.length,
  };
  for (const source of own) {
    const body = withoutSchoolLinks(source.excerpt);
    // Keep literal continuous passages. Neither concatenated rows nor shortened ellipses are quotes.
    const passages = [...body.matchAll(/[^。；;\n]+/g)].map((match) =>
      match[0].trim(),
    );
    for (const field of ["exams", "tuition", "location"] as const) {
      if (bound[field]) continue;
      for (const passage of field === "tuition"
        ? tuitionPassages(body)
        : passages) {
        const projectAt = item.majorCode
          ? passage.indexOf(item.majorCode)
          : passage.indexOf(item.programName!);
        const related = projectAt >= 0 || passage.includes(item.programName!);
        if (
          !related &&
          (!/硕士|研究生/.test(body) ||
            /\b(?:0[1-9]|1[0-4])\d{4}\b/.test(passage))
        )
          continue;
        const marker = {
          exams: /初试|考试科目|①|②|③|④/,
          tuition: /学\s*费/,
          location: trainingLocation,
        }[field].exec(passage);
        if (!marker) continue;
        if (!related && field === "exams") continue;
        const start = Math.max(0, marker.index - 140);
        const quote = passage.slice(start, start + 300);
        if (!quote || quote.includes(" … ")) continue;
        if (
          field === "tuition" &&
          (!normalizedEvidence(quote).includes("学费") ||
            ![...quote.matchAll(tuitionMoney)].length)
        )
          continue;
        const year = safeSourceYear(source);
        pendingEvidence.push({
          field,
          quote,
          sourceId: source.id,
          ...(year ? { year } : {}),
          reason: pendingReason(
            field,
            passage,
            body,
            item,
            own,
            year,
            targetYear,
            exams,
          ),
        });
      }
    }
  }
  const unique = [
    ...new Map(
      pendingEvidence.map((e) => [
        `${e.field}:${e.sourceId}:${normalizedEvidence(e.quote)}`,
        e,
      ]),
    ).values(),
  ];
  const citations = [
    ...new Set([
      ...item.citations,
      ...[
        constraints.tuition?.sourceId,
        constraints.location?.sourceId,
        ...(constraints.location?.supportingEvidence ?? []).map(
          (e) => e.sourceId,
        ),
        exams.sourceId,
        ...(exams.history ?? []).map((e) => e.sourceId),
        ...unique.map((e) => e.sourceId),
      ].filter((id): id is string => !!id),
    ]),
  ];
  // Recompute instead of retaining stale model/inventory fields when a target-year conflict appears.
  const {
    tuition: _tuition,
    location: _location,
    pendingEvidence: _pending,
    ...rest
  } = item;
  return { ...rest, ...constraints, exams, pendingEvidence: unique, citations };
}

function pendingReason(
  field: PendingResearchEvidence["field"],
  passage: string,
  body: string,
  item: Recommendation,
  sources: WebSource[],
  year: number | undefined,
  targetYear: string,
  exams: NonNullable<Recommendation["exams"]>,
) {
  const reasons: string[] = [];
  const text = normalizedEvidence(passage);
  if (field === "exams" && exams.status === "ambiguous")
    reasons.push(exams.reason);
  if (field === "tuition") {
    if (
      (!item.studyMode || item.studyMode === "unspecified") &&
      /非全日制/.test(body) &&
      /全日制/.test(body.replaceAll("非全日制", ""))
    )
      reasons.push(
        "原文区分全日制与非全日制，而推荐未写明学习方式，不能选定其中一档。",
      );
    const tariffs = tuitionPassages(body);
    const amounts = new Set(
      tariffs.flatMap((row) =>
        [...row.matchAll(tuitionMoney)].map((m) => normalizedEvidence(m[0])),
      ),
    );
    if (amounts.size > 1)
      reasons.push("同一来源出现多个金额不同的档次，需核对各档适用范围。");
    if (/来华留学|留学生|港澳台|专项|定向|中外合作/.test(text))
      reasons.push("该费率涉及特殊人群，不能套用普通项目。");
    if (/全程|学期|学分/.test(text))
      reasons.push("原文按全程、学期或学分计费，不擅自换算年度费用。");
    if (
      sources.some(
        (s) =>
          s.excerpt !== body &&
          tuitionPassages(s.excerpt).some(
            (row) =>
              row.includes(item.programName!) &&
              [...row.matchAll(tuitionMoney)].some(
                (m) => !text.includes(normalizedEvidence(m[0])),
              ),
          ),
      )
    )
      reasons.push("相关来源出现不同金额，尚不能选定唯一学费。");
  }
  if (
    field === "location" &&
    new Set(
      [...body.matchAll(/[^。；;\n]+/g)]
        .filter((m) => trainingLocation.test(m[0]))
        .map((m) => normalizedEvidence(m[0])),
    ).size > 1
  )
    reasons.push("页面列出多个校区地址，尚不能确定该专业适用校区。");
  if (year === undefined)
    reasons.push("原文未明确适用年度，不能把发表日期当招生或收费年度。");
  else if (year < Number(targetYear))
    reasons.push(
      `原文年度${year}早于目标年度${targetYear}，目标年度适用情况仍待核验。`,
    );
  if (
    field === "tuition" &&
    (text.includes("学院") ||
      text.includes("专业") ||
      (!/我校|本校|全校|所有研究生|研究生学费(?:标准)?(?:均为|统一)/.test(
        text,
      ) &&
        !text.includes(item.programName!)))
  )
    reasons.push("无法确认适用学院或专业，不能借用分项金额。");
  if (!reasons.length)
    reasons.push(
      field === "location"
        ? "无法确认该专业适用的培养或办学地点。"
        : field === "exams"
          ? "无法确认该专业对应的学院、学习方式或考试组。"
          : "无法确认适用学院、专业或学习方式。",
    );
  return reasons.join("");
}
