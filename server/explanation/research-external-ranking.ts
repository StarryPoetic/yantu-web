import type { WebSource } from "./web.ts";
import { schoolRegistry } from "../schools/index.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";
import { RESEARCH_EXTERNAL_SOURCES } from "./research-source-policy.ts";
import type { ResearchPriorityField } from "../../shared/research-priority-facts.ts";

export function externalSearchHosts(
  tier: "authority" | "reference",
  fields: readonly ResearchPriorityField[],
) {
  const hosts = RESEARCH_EXTERNAL_SOURCES.filter((p) => p.tier === tier).map(
    (p) => p.host,
  );
  if (tier === "reference") return hosts;
  return hosts.filter((host) =>
    fields.includes("disciplineAssessment")
      ? /cdgdc|moe\.gov/.test(host)
      : !host.includes("cdgdc"),
  );
}
/** Search snippets choose reads, never facts. Wrong school/year/programme is rejected before spending a read. */
export function externalPagePriority(
  source: WebSource,
  school: string,
  subjects: readonly {
    majorCode?: string;
    disciplineCode: string;
    programName?: string;
  }[],
  fields: readonly ResearchPriorityField[],
  year: string,
): number {
  const title = source.title;
  const assessment = fields.includes("disciplineAssessment");
  const named = schoolRegistry.schools.filter((s) => title.includes(s.name));
  if (named.length && !title.includes(school)) return -1;
  const publicMatrix = assessment && /第四轮|学科评估结果/.test(title);
  if (
    !title.includes(school) &&
    !source.excerpt.includes(school) &&
    !publicMatrix
  )
    return -1;
  if (/登录|经验|论坛|招生人数预测|预测分数|咨询|联系方式/.test(title))
    return -1;
  const explicitYears = [...title.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map(
    (m) => +m[1],
  );
  if (
    !assessment &&
    explicitYears.length &&
    !explicitYears.some((y) =>
      [...historicalReferenceYears(year), +year].includes(y),
    )
  )
    return -1;
  // A broad background query must not admit a catalogue, navigation page or
  // an unrelated professional degree just because the school name matches.
  if (
    /招生(?:专业)?目录|招生简章|招生章程|专业介绍|硕士点介绍|院校库|院校信息|首页/.test(
      title,
    )
  )
    return -1;
  const otherProgramme = title.match(/工商管理|会计|MBA|MPAcc/iu)?.[0];
  if (
    otherProgramme &&
    !subjects.some((s) => s.programName?.includes(otherProgramme))
  )
    return -1;
  const codes = [...title.matchAll(/\b(0[1-9]\d{4})\b/g)].map((m) => m[1]);
  if (
    codes.length &&
    !codes.some((code) =>
      subjects.some((s) =>
        s.majorCode ? s.majorCode === code : code.startsWith(s.disciplineCode),
      ),
    )
  )
    return -1;
  if (
    /报录比[：:]|分数线[：:]/.test(title) &&
    subjects.every((s) => s.programName && !title.includes(s.programName))
  )
    return -1;
  const patterns: Partial<Record<ResearchPriorityField, RegExp>> = {
    disciplineAssessment: /学科评估/,
    cutoff: /复试|分数线/,
    applicationAdmissionRatio: /报录|报考.*录取/,
    undergraduateAdmission: /生源|本科背景|双非/,
    crossMajorAdmission: /跨专业|跨考/,
    employment: /就业|毕业去向/,
  };
  const matches = (text: string) => fields.some((f) => patterns[f]?.test(text));
  if (!matches(title) && !matches(source.excerpt)) return -1;
  return (
    Number(title.includes(school)) * 4 +
    Number(matches(title)) * 4 -
    Number(/首页|院校信息|院校库|专业介绍/.test(title)) * 6
  );
}
