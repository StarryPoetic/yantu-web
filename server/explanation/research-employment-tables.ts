import { createHash } from "node:crypto";
import type { WebSource } from "./web.ts";
import type { ResearchPriorityFact } from "../../shared/research-priority-facts.ts";
import { schoolRegistry } from "../schools/index.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";
import { isSchoolPage } from "./research-evidence.ts";

/** Faculty graduate statistics are context, never a six-digit programme's employment rate. */
export function graduateEmploymentTableFacts(
  source: WebSource,
  targetYear: string,
): ResearchPriorityFact[] {
  if (!isSchoolPage(source)) return [];
  const school = schoolRegistry.byHost(new URL(source.url).hostname);
  if (!school || !sourceHasSchoolIdentity(source, school.name)) return [];
  const result: ResearchPriorityFact[] = [];
  let section: { year: number; title: string; header?: string } | undefined;
  for (const raw of source.excerpt.split("\n")) {
    const line = raw.trim();
    const title = line.match(
      /^表\s*[\d\s-]+\s*学校\s*(20\d{2})\s*届毕业(研究生|硕士)分学院毕业去向落实率$/,
    );
    if (title) {
      section =
        +title[1] <= +targetYear ? { year: +title[1], title: line } : undefined;
      continue;
    }
    if (!section) continue;
    if (
      /^表\s*\d|^（[一二三四五六七八九十]+）|毕业研究生总体|本科/.test(line)
    ) {
      section = undefined;
      continue;
    }
    if (/^学院\s+毕业生人数\s+落实去向人数\s+毕业去向落实率$/.test(line)) {
      section.header = line;
      continue;
    }
    if (!section.header) continue;
    const row = line.match(
      /^\d+\s+([^\d]+学院(?:（[^）]+）)?)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%$/,
    );
    if (!row) continue;
    const total = +row[2],
      settled = +row[3],
      rate = +row[4];
    if (
      !total ||
      settled > total ||
      rate > 100 ||
      Math.abs((settled / total) * 100 - rate) > 0.011
    )
      continue;
    const fact: Omit<ResearchPriorityFact, "id"> = {
      sourceTier: "school",
      schoolName: school.name,
      collegeName: row[1].trim(),
      scope: "school",
      field: "employment",
      year: section.year,
      quote: line,
      evidenceQuotes: [section.title, section.header],
      sourceId: source.id,
      sourceUrl: source.url,
      value: {
        text: `${section.title}；${line}（学院毕业研究生口径，非专业专属、非硕士单独口径）`,
        employmentRate: rate,
        population: "学院毕业研究生，不推断为六位专业或硕士单独统计",
      },
      status: "bound",
      verified: false,
    };
    result.push({
      id: createHash("sha256")
        .update(JSON.stringify(fact))
        .digest("hex")
        .slice(0, 20),
      ...fact,
    });
  }
  return result;
}
