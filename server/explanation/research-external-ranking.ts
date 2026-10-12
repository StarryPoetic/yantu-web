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
  const explicitYears = [
    ...title.matchAll(/\b(20\d{2})\s*(?:年|考研|届)/g),
  ].map((m) => +m[1]);
  if (
    !assessment &&
    (fields.includes("cutoff") ||
      fields.includes("applicationAdmissionRatio")) &&
    explicitYears.length &&
    !explicitYears.some((y) =>
      [...historicalReferenceYears(year), +year].includes(y),
    )
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
  const category = assessment
    ? /学科评估/
    : fields.includes("cutoff")
      ? /复试|分数线/
      : fields.includes("employment") && fields.length === 1
        ? /就业|毕业去向/
        : /报录|录取|生源|跨专业|双非/;
  return (
    Number(title.includes(school)) * 4 +
    Number(category.test(title)) * 4 -
    Number(/首页|院校信息|院校库|专业介绍/.test(title)) * 6
  );
}
