import { createHash } from "node:crypto";
import type { WebSource } from "./web.ts";
import type { ResearchPriorityFact } from "../../shared/research-priority-facts.ts";
import { schoolRegistry } from "../schools/index.ts";

/** A chain uses the named document heading, not a publication date or footer link. */
export function chainDocumentYear(source: WebSource) {
  const heading = source.title.match(
    /(20\d{2})年(?:全国)?硕士研究生(?:招生专业目录|复试录取工作实施细则|招生考试考生进入复试的初试成绩基本要求)/,
  );
  if (heading && source.excerpt.slice(0, 1000).includes(heading[0]))
    return Number(heading[1]);
}

export type ChainPassage = { source: WebSource; quote: string };
export type NationalLineChain = {
  schoolName: string;
  collegeName: string;
  majorCode: string;
  year: number;
  identity?: ChainPassage;
  degree?: ChainPassage;
  applicability?: ChainPassage;
  nationalHeader?: ChainPassage;
  nationalColumns?: ChainPassage;
  nationalRow?: ChainPassage;
  region?: ChainPassage;
  exceptions?: ChainPassage;
};
const literal = (p?: ChainPassage): p is ChainPassage =>
  Boolean(p?.quote && p.source.excerpt.includes(p.quote));

/** Deliberately narrow: an explicit college-wide A-line execution statement,
 * a same-year full-time professional programme, and the original engineering
 * non-care row. A floor, a different region or a missing component never fills it.
 * Callers retain every passage: the statement itself does not contain the numbers.
 */
export function resolveNationalLineChain(input: NationalLineChain) {
  const missing: string[] = [];
  const { schoolName, collegeName, majorCode, year } = input;
  const owned = (p?: ChainPassage) =>
    literal(p) &&
    p.source.kind === "official_page" &&
    schoolRegistry.byHost(new URL(p.source.url).hostname)?.name ===
      schoolName &&
    chainDocumentYear(p.source) === year;
  const identity = input.identity;
  if (
    !owned(identity) ||
    !collegeName ||
    !/^0855\d{2}$/.test(majorCode) ||
    !identity!.quote.includes(collegeName) ||
    !new RegExp(`\\b${majorCode}(?!\\d)`).test(identity!.quote) ||
    (identity!.quote.match(/\b\d{6}\b/g) ?? []).length !== 1
  )
    missing.push("同年同学院六位专业代码身份");
  const degree = input.degree;
  if (
    !owned(degree) ||
    !literal(identity) ||
    degree!.source.url !== identity.source.url ||
    !/全日制专业学位/.test(degree!.quote) ||
    /非全日制/.test(degree!.quote) ||
    [
      ...identity.source.excerpt
        .slice(0, identity.source.excerpt.indexOf(identity.quote))
        .matchAll(/（[一二三四五]）[^\n]*(?:学术学位|专业学位)[^\n]*/g),
    ].at(-1)?.[0] !== degree!.quote
  )
    missing.push("该专业所在表段的全日制专业学位口径");
  const applicability = input.applicability;
  if (
    !owned(applicability) ||
    !collegeName ||
    !applicability!.source.title.includes(collegeName) ||
    !new RegExp(
      `复试分数线参照[^。\\n]*${year}年全国硕士研究生[^。\\n]*（A类考生国家线）执行`,
    ).test(applicability!.quote) ||
    /不低于|高于|另行|部分|例外|自行划定|调剂分数线/.test(applicability!.quote)
  )
    missing.push(
      "同年目标学院明确执行A区国家线的声明（最低资格或含未消除例外不算）",
    );
  const national = [
    input.nationalHeader,
    input.nationalColumns,
    input.nationalRow,
    input.region,
    input.exceptions,
  ];
  const authority = national.every(
    (p) =>
      literal(p) &&
      p.source.kind === "authority_page" &&
      new URL(p.source.url).hostname === "yz.chsi.com.cn" &&
      /来源：教育部/.test(p.source.excerpt) &&
      chainDocumentYear(p.source) === year &&
      p.source.url === input.nationalRow?.source.url,
  );
  const row = input.nationalRow?.quote.match(
    /^工学\[08\]\s*\|\s*其他学科专业\s*\|\s*(?:\|\s*)?(\d{3})\s*\|\s*(\d{2})\s*\|\s*(\d{2})\s*\|/,
  );
  if (
    !authority ||
    !row ||
    !/专业学位类别[^\n]*A类考生[^\n]*B类考生/.test(
      input.nationalHeader?.quote ?? "",
    ) ||
    !/总分\s*\|\s*单科[^|]*满分=100分[^|]*\|\s*单科[^|]*满分[>＞]100分/.test(
      input.nationalColumns?.quote ?? "",
    ) ||
    !/A类考生：[^。]*一区[^。]*浙江/.test(input.region?.quote ?? "") ||
    !/工学照顾专业/.test(input.exceptions?.quote ?? "") ||
    input.exceptions?.quote.includes("0855")
  )
    missing.push(
      "同年教育部工学其他专业A区数值原文、列头、浙江区域及照顾专业排除依据",
    );
  if (missing.length)
    return { status: "incomplete_chain" as const, missing, fact: undefined };
  const fact: ResearchPriorityFact = {
    id: createHash("sha256")
      .update(
        JSON.stringify([
          schoolName,
          collegeName,
          majorCode,
          year,
          national.map((p) => p!.quote),
          applicability!.quote,
        ]),
      )
      .digest("hex")
      .slice(0, 24),
    schoolName,
    collegeName,
    majorCode,
    disciplineCode: "0855",
    programName: "机械",
    scope: "program",
    field: "cutoff",
    year,
    quote: applicability!.quote,
    sourceId: applicability!.source.id,
    sourceUrl: applicability!.source.url,
    sourceTier: "school",
    value: {
      text: "同年专业身份、学院A线执行声明与教育部国家线原文关联",
      number: Number(row![1]),
      singleSubject: { maximum100: Number(row![2]), above100: Number(row![3]) },
      population:
        "全日制专业学位；学院执行A区国家线；普通考生口径，不延伸专项或录取最低分",
    },
    status: "bound",
    verified: false,
  };
  return { status: "complete_chain" as const, missing, fact };
}
