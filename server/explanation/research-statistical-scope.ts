import type {
  ResearchPriorityFact,
  ResearchPriorityField,
} from "../../shared/research-priority-facts.ts";

type Value = ResearchPriorityFact["value"];
export function statisticalCollege(quote: string) {
  const names = statisticalColleges(quote);
  return names.length === 1 ? names[0] : undefined;
}
const statisticalColleges = (quote: string) => [
  ...new Set(
    [...quote.matchAll(/[\u4e00-\u9fff]{2,30}学院/g)].map((m) =>
      m[0].replace(/^.*(?:大学|年)/, ""),
    ),
  ),
];
const mixedPopulation = (quote: string) =>
  statisticalColleges(quote).length > 1 ||
  (quote.includes("非全日制") &&
    quote.replaceAll("非全日制", "").includes("全日制")) ||
  new Set([...quote.matchAll(/\b(20\d{2})[年届级]/g)].map((m) => m[1])).size >
    1;
const unreliable =
  /预测|预计|左右|约|估计|参考值|拟招生|招生计划|不歧视|友好|建议|例如|假设|网友|学长|经验贴|自述/;

export function ratioStatistics(
  field: ResearchPriorityField,
  quote: string,
): Partial<Value> | undefined {
  if (
    unreliable.test(quote) ||
    mixedPopulation(quote) ||
    /本科招生|博士招生/.test(quote) ||
    !/\b\d{6}\b/.test(quote) ||
    !/硕士|研究生/.test(quote) ||
    !/全日制/.test(quote)
  )
    return;
  const numerator =
    field === "applicationAdmissionRatio"
      ? quote.match(/一志愿报考人数[：:为\s]*(\d+)\s*人/)?.[1]
      : quote.match(/其中推免录取人数[：:为\s]*(\d+)\s*人/)?.[1];
  const denominator =
    field === "applicationAdmissionRatio"
      ? quote.match(/一志愿实际录取人数[：:为\s]*(\d+)\s*人/)?.[1]
      : quote.match(/实际录取总人数[：:为\s]*(\d+)\s*人/)?.[1];
  if (
    numerator === undefined ||
    denominator === undefined ||
    +denominator <= 0 ||
    (field === "recommendationShare" &&
      (+numerator > +denominator || /不含推免|不含已录取.*推免/.test(quote)))
  )
    return;
  const number =
    (+numerator / +denominator) * (field === "recommendationShare" ? 100 : 1);
  const published =
    field === "applicationAdmissionRatio"
      ? quote.match(/报录比[：:为\s]*(\d+(?:\.\d+)?)[：:比/]1/)?.[1]
      : quote.match(
          /推免(?:生)?(?:占比|比例)[：:为\s]*(\d+(?:\.\d+)?)\s*[%％]/,
        )?.[1];
  if (published === undefined || Math.abs(+published - number) > 0.005) return;
  return {
    number,
    population: `${quote.includes("非全日制") ? "非全日制" : "全日制"}硕士研究生；${field === "applicationAdmissionRatio" ? "同项目统考一志愿报考/实际录取" : "同项目实际录取全体（含推免）"}`,
    ratioBasis: {
      numerator: +numerator,
      denominator: +denominator,
      numeratorLabel:
        field === "applicationAdmissionRatio"
          ? "一志愿报考人数"
          : "推免录取人数",
      denominatorLabel:
        field === "applicationAdmissionRatio"
          ? "一志愿实际录取人数"
          : "实际录取总人数（含推免）",
    },
  };
}

export function backgroundStatistics(
  field: ResearchPriorityField,
  quote: string,
): Partial<Value> | undefined {
  if (
    unreliable.test(quote) ||
    mixedPopulation(quote) ||
    /报考|夏令营|申请|报名/.test(quote) ||
    /本科(?:招生|新生|录取工作)|博士招生|欢迎.*报考|允许.*报考/.test(quote) ||
    !/硕士(?:研究生)?(?:实际)?录取|硕士(?:研究生)?新生|研究生(?:实际)?录取/.test(
      quote,
    ) ||
    !/\b\d{6}\b/.test(quote)
  )
    return;
  const count =
    field === "undergraduateAdmission"
      ? quote.match(
          /(?:双非|非双一流|普通本科)(?:本科)?(?:毕业生|考生|生源|学生|新生|生)?(?:人数)?[：:为\s]*(\d+)\s*人/,
        )?.[1]
      : quote.match(
          /跨(?:专业|考)(?:考生|生源|学生|新生|生)?(?:人数)?[：:为\s]*(\d+)\s*人/,
        )?.[1];
  if (count === undefined) return;
  return {
    number: +count,
    population: "公开硕士录取群体人数；未给全体分母时不推算比例",
  };
}

/** Programme advertising cannot be relabelled as a faculty or graduate-school aggregate. */
export function graduateEmploymentScope(quote: string) {
  if (
    mixedPopulation(quote) ||
    !/硕士(?:研究生)?毕业生|研究生毕业生|毕业研究生/.test(quote) ||
    /本科|博士|定向|招聘|应当|预计|培养目标/.test(quote) ||
    /\b\d{6}\b/.test(quote)
  )
    return;
  const collegeName = statisticalCollege(quote);
  if (collegeName)
    return {
      collegeName,
      population: "学院毕业研究生统计；不等同目标专业就业率",
    };
  if (/研究生院|研院/.test(quote) && /全校(?:硕士|研究生)/.test(quote))
    return {
      collegeName: undefined,
      population: "研究生院公开全校硕士/研究生毕业生口径；不等同目标专业就业率",
    };
}
