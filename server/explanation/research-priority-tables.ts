import { createHash } from "node:crypto";
import { researchTextRows } from "./research-table-text.ts";
import type { WebSource } from "./web.ts";
import type { Discipline } from "../disciplines/types.ts";
import type {
  ResearchPriorityFact,
  ResearchPriorityField,
  ResearchTargetScore,
} from "../../shared/research-priority-facts.ts";
import { schoolRegistry } from "../schools/index.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";
import { isSchoolPage } from "./research-evidence.ts";
import { safeSourceYear } from "./research-years.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";
import { pdfAdmissionRows } from "./research-pdf-statistics.ts";
import { graduateEmploymentTableFacts } from "./research-employment-tables.ts";

const cells = (line: string) =>
  line
    .replace(/^第\d+行[：:]\s*/, "")
    .trim()
    .replace(/^\|\s*|\s*\|$/g, "")
    .split(/\s*[|｜\t]\s*|\s{2,}/)
    .map((s) => s.trim());
const privateHeader =
  /姓名|考号|考生(?:编号|号)|准考证|身份证|证件号码|联系电话|手机号|邮箱/;
/** Personal rows never reach checkpoints, libraries or model input. Unknown
 * roster layouts are discarded instead of guessing which cells are personal. */
export function redactAdmissionsText(text: string): string {
  if (!/拟录取|录取名单/.test(text) || !privateHeader.test(text)) return text;
  let header: string[] | undefined;
  const ids = new Set<string>();
  return text
    .split("\n")
    .flatMap((line) => {
      if (privateHeader.test(line)) {
        header = cells(line);
        // A labelled personal value is not a column heading.
        const safeHeader = header.every(
          (cell) =>
            !privateHeader.test(cell) ||
            /^(?:姓名|考号|考生编号|考生号|准考证号?|身份证号?|证件号码|联系电话|手机号|邮箱)$/.test(
              cell,
            ),
        );
        if (!safeHeader) header = [];
        return header.length > 1 ? [line] : [];
      }
      if (!header) return [line];
      if (/版权所有|Copyright|名单结束/.test(line)) {
        header = undefined;
        return [line];
      }
      const row = cells(line);
      if (row.length !== header.length || row.length < 2) return [];
      const idIndex = header.findIndex((h) =>
        /考号|考生(?:编号|号)|准考证|身份证/.test(h),
      );
      const key = idIndex >= 0 ? row[idIndex] : undefined;
      if (key && key !== "【个人信息已删除】") {
        if (ids.has(key)) return [];
        ids.add(key);
      }
      return [
        row
          .map((value, i) =>
            privateHeader.test(header![i]) ||
            !/学院|院系|专业(?:代码|名称)|学科(?:代码|名称)|录取(?:方式|类型|状态)|考试方式|初试(?:总分|成绩)|^结果$/.test(
              header![i],
            )
              ? "【个人信息已删除】"
              : value,
          )
          .join(" | "),
      ];
    })
    .join("\n");
}

export function tablePriorityFacts(
  source: WebSource,
  disciplines: readonly Discipline[],
  targetYear: string,
  target?: ResearchTargetScore,
): ResearchPriorityFact[] {
  return [
    ...graduateEmploymentTableFacts(source, targetYear),
    ...admissionTableFacts(source, disciplines, targetYear, target),
  ];
}
function admissionTableFacts(
  source: WebSource,
  disciplines: readonly Discipline[],
  targetYear: string,
  target?: ResearchTargetScore,
): ResearchPriorityFact[] {
  if (
    !/专业\s*代码|学科\s*代码|硕士研究生报考上线录取情况/.test(source.excerpt)
  )
    return [];
  if (!isSchoolPage(source)) return [];
  if (
    /(?:博士|本科)[^\n]{0,30}(?:招生|复试|录取|就业)/.test(
      source.title + "\n" + source.excerpt.split("\n")[0],
    )
  )
    return [];
  const school = schoolRegistry.byHost(new URL(source.url).hostname);
  if (!school || !sourceHasSchoolIdentity(source, school.name)) return [];
  const evidenceYears = [
    ...new Set(
      source.excerpt
        .split("\n")
        .filter((line) => !/发布时间|发布于|版权所有|Copyright/.test(line))
        .flatMap((line) =>
          [
            ...line.matchAll(
              /(?:^|[^0-9])(20\d{2})年[^。\n]{0,60}(?:复试|拟录取|录取名单|报录统计|学科评估|就业质量|生源质量)/g,
            ),
          ].map((m) => Number(m[1])),
        ),
    ),
  ];
  const year =
    evidenceYears.length === 1
      ? evidenceYears[0]
      : evidenceYears.length
        ? undefined
        : safeSourceYear(source);
  if (!year || year > Number(targetYear)) return [];
  const lines = researchTextRows(redactAdmissionsText(source.excerpt));
  const facts: ResearchPriorityFact[] = [];
  let header: string[] = [],
    headerQuote = "";
  const groups = new Map<
    string,
    {
      code: string;
      discipline: Discipline;
      college?: string;
      rows: number;
      examination: number;
      recommended: number;
      scores: number[];
      identity: string;
      header: string;
    }
  >();
  function add(
    field: ResearchPriorityField,
    discipline: Discipline,
    code: string,
    college: string | undefined,
    quote: string,
    value: ResearchPriorityFact["value"],
    evidenceQuotes: string[],
  ) {
    if (
      !quote ||
      quote.length > 600 ||
      ![quote, ...evidenceQuotes].every((q) => source.excerpt.includes(q)) ||
      /【个人信息已删除】/.test(quote)
    )
      return;
    if (
      [
        "cutoff",
        "admissionScore",
        "admittedCount",
        "recommendationShare",
        "applicationAdmissionRatio",
      ].includes(field) &&
      (!/硕士/.test(source.excerpt) ||
        ![...historicalReferenceYears(targetYear), Number(targetYear)].includes(
          year!,
        ))
    )
      return;
    const fact = {
      sourceTier: "school" as const,
      schoolName: school!.name,
      disciplineCode: discipline.code,
      programName: discipline.name,
      majorCode: code.length === 6 ? code : undefined,
      collegeName: college,
      scope: "program" as const,
      field,
      year: year!,
      quote,
      sourceId: source.id,
      sourceUrl: source.url,
      evidenceQuotes: [...new Set(evidenceQuotes)],
      value,
      status: "bound" as const,
      verified: false as const,
    };
    facts.push({
      id: createHash("sha256")
        .update(JSON.stringify(fact))
        .digest("hex")
        .slice(0, 20),
      ...fact,
    });
  }
  for (const row of pdfAdmissionRows(source.excerpt)) {
    const discipline = disciplines.find((d) => row.code.startsWith(d.code));
    if (!discipline) continue;
    const evidence = [
      row.header,
      ...(row.collegeQuote ? [row.collegeQuote] : []),
    ];
    add(
      "admissionScore",
      discipline,
      row.code,
      row.college,
      row.quote,
      {
        text: "官方录取最低分",
        number: row.minimum,
        population: row.population,
      },
      evidence,
    );
    if (row.admitted !== undefined)
      add(
        "admittedCount",
        discipline,
        row.code,
        row.college,
        row.quote,
        {
          text: "官方公布录取人数",
          number: row.admitted,
          applicants: row.applicants,
          population: row.population,
        },
        evidence,
      );
    if (row.recommended !== undefined && row.admitted)
      add(
        "recommendationShare",
        discipline,
        row.code,
        row.college,
        row.quote,
        {
          text: "官方汇总明确推免列占录取人数比例",
          number: (row.recommended / row.admitted) * 100,
          population: row.population,
        },
        evidence,
      );
  }
  for (const entry of lines) {
    const line = entry.line;
    const row = entry.cells ?? cells(line);
    if (row.length < 2) continue;
    // Normalize labels only: archived tables can split 专业 代码 or 单科 units.
    // Data cells and every quoted header/row remain the original literal text.
    const labels = row.map((cell) => cell.replace(/\s+/g, ""));
    const labelLine = labels.join("|");
    if (
      /专业(?:代码|名称)|学科(?:代码|名称)/.test(labelLine) &&
      /总分|单科|录取|成绩|评估|等级|报考|考试方式|就业率|去向落实率|主要去向|就业去向/.test(
        labelLine,
      )
    ) {
      header = labels;
      headerQuote = line;
      continue;
    }
    if (!header.length || row.length !== header.length) continue;
    const col = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));
    const schoolIndex = col(/^学校(?:名称)?$|^招生单位(?:名称)?$/);
    if (schoolIndex >= 0 && row[schoolIndex] !== school.name) continue;
    const codeIndex = col(/专业代码|学科代码/);
    const nameIndex = col(/专业名称|学科名称/);
    const identity =
      codeIndex >= 0 ? row[codeIndex] : nameIndex >= 0 ? row[nameIndex] : "";
    const code = identity.match(/\b(?:\d{6}|\d{4})\b/)?.[0];
    const discipline = disciplines.find((d) => code?.startsWith(d.code));
    if (
      !code ||
      !discipline ||
      ((code === discipline.code || code === `${discipline.code}00`) &&
        nameIndex >= 0 &&
        !row[nameIndex].includes(discipline.name))
    )
      continue;
    const collegeIndex = header.findIndex(
      (h) => /学院|院系/.test(h) && !/代码|编号/.test(h),
    );
    const college = collegeIndex >= 0 ? row[collegeIndex] : undefined;
    const number = (pattern: RegExp) => {
      const i = col(pattern);
      return i >= 0 && /^\d+(?:\.\d+)?$/.test(row[i])
        ? Number(row[i])
        : undefined;
    };
    const evidence = [headerQuote, identity];
    if (
      /复试/.test(source.excerpt) &&
      /分数线|基本.*要求|基本.*分数/.test(source.excerpt)
    ) {
      const total = number(/总分/);
      if (
        total !== undefined &&
        total > 0 &&
        total <= 500 &&
        !/拟录取|录取名单/.test(source.title)
      ) {
        const maximum = /满分\s*500/.test(headerQuote)
          ? 500
          : /满分\s*300/.test(headerQuote)
            ? 300
            : undefined;
        if (maximum && total > maximum) continue;
        add(
          "cutoff",
          discipline,
          code,
          college,
          line,
          {
            text: line,
            number: total,
            maximum,
            ...(target && target.maximum === maximum
              ? { targetGap: target.total - total }
              : {}),
            singleSubject: {
              maximum100: number(/单科.*(?:满分.*100|=100|≤100)/),
              above100: number(/单科.*(?:大于|>100|150)/),
            },
          },
          evidence,
        );
      }
    }
    if (/拟录取|录取名单/.test(source.excerpt)) {
      const modeIndex = col(/考试方式|录取方式|录取类型/);
      if (
        modeIndex < 0 ||
        !/^(?:统考|全国统考|推免|推荐免试)$/.test(row[modeIndex])
      )
        continue;
      const statusIndex = col(/录取状态|结果/);
      if (statusIndex >= 0 && !/^(?:拟录取|录取)$/.test(row[statusIndex]))
        continue;
      const key = JSON.stringify([code, college, headerQuote]);
      const group = groups.get(key) ?? {
        code,
        discipline,
        college,
        rows: 0,
        examination: 0,
        recommended: 0,
        scores: [],
        identity,
        header: headerQuote,
      };
      group.rows++;
      const recommended = /推免|推荐免试/.test(row[modeIndex]);
      if (recommended) group.recommended++;
      else group.examination++;
      const score = number(/初试(?:总分|成绩)/);
      if (!recommended && score !== undefined && score <= 500)
        group.scores.push(score);
      groups.set(key, group);
    }
    const gradeIndex = col(/评估.*(?:结果|等级)|^等级$/);
    if (gradeIndex >= 0 && /^[ABC][+-]?$/.test(row[gradeIndex]))
      add(
        "disciplineAssessment",
        discipline,
        code,
        college,
        line,
        { text: line, grade: row[gradeIndex] },
        evidence,
      );
    const rateIndex = col(/就业率|去向落实率/);
    const destinationIndex = col(/主要去向|就业去向|就业行业/);
    const rate =
      rateIndex >= 0 && /^\d+(?:\.\d+)?[%％]$/.test(row[rateIndex])
        ? Number(row[rateIndex].slice(0, -1))
        : undefined;
    if (
      /硕士.*毕业|毕业.*硕士/.test(source.title + source.excerpt) &&
      ((rate !== undefined && rate <= 100) || destinationIndex >= 0)
    )
      add(
        "employment",
        discipline,
        code,
        college,
        line,
        {
          text: line,
          ...(rate !== undefined && rate <= 100
            ? { employmentRate: rate }
            : {}),
          ...(destinationIndex >= 0
            ? { destinations: row[destinationIndex] }
            : {}),
        },
        evidence,
      );
    const applicants = number(/报考人数/),
      admitted = number(/录取人数/);
    if (applicants !== undefined && admitted !== undefined && admitted > 0)
      add(
        "applicationAdmissionRatio",
        discipline,
        code,
        college,
        line,
        { text: line, number: applicants / admitted },
        evidence,
      );
  }
  for (const group of groups.values()) {
    const statistics = {
      rows: group.rows,
      examination: group.examination,
      recommended: group.recommended,
      method: "published_roster_rows" as const,
    };
    const evidence = [group.header, group.identity];
    const addGroup = (
      field: ResearchPriorityField,
      value: ResearchPriorityFact["value"],
    ) =>
      add(
        field,
        group.discipline,
        group.code,
        group.college,
        group.header,
        { ...value, statistics },
        evidence,
      );
    addGroup("admittedCount", {
      text: "按本页公开名单行统计（不代表未公布批次或最终入学人数）",
      number: group.rows,
    });
    if (group.recommended && group.examination)
      addGroup("recommendationShare", {
        text: "本页名单中明确标记推免的比例",
        number: (group.recommended / group.rows) * 100,
      });
    if (group.scores.length === group.examination && group.scores.length) {
      const maximum = /满分\s*500/.test(group.header)
        ? 500
        : /满分\s*300/.test(group.header)
          ? 300
          : undefined;
      const score = Math.min(...group.scores);
      if (maximum && group.scores.some((s) => s > maximum)) continue;
      addGroup("admissionScore", {
        text: "本页统考拟录取初试最低分",
        number: score,
        maximum,
        ...(target && target.maximum === maximum
          ? { targetGap: target.total - score }
          : {}),
      });
    }
  }
  return facts;
}
