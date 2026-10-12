import { getDisciplineCatalog } from "../disciplines/index.ts";

/** Titles rank leads only; they never establish facts or admission eligibility. */
export function researchDocumentPriority(
  title: string,
  program?: string,
  url = "",
) {
  if (
    /\/bszs\//i.test(url) ||
    /本科(?:专业|招生|录取)|[（(]本科[)）]|普通类招生结果|强基计划|三位一体/.test(
      title,
    )
  )
    return -100;
  if (
    /硕博连读|博士|博后|博士后/.test(title) &&
    !/硕士招生专业目录/.test(title)
  )
    return -100;
  if (program && /学院/.test(title) && !title.includes(program)) {
    if (
      /机械/.test(program) &&
      /生物与化学|法学院|外国语|会计学院|财税学院|集成电路学院|人工智能学院/.test(
        title,
      )
    )
      return -50;
    const other = getDisciplineCatalog().items.some(
      (d) =>
        !program.includes(d.name) &&
        d.name.length >= 3 &&
        title.includes(d.name),
    );
    if (other) return -50;
  }
  if (/招生(?:专业)?目录|专业目录/.test(title)) return 100;
  if (/复试.*(?:分数|基本要求)|分数线/.test(title)) return 95;
  if (/拟录取|录取名单/.test(title)) return 90;
  if (/报录|录取统计|招生统计|推免.*比例/.test(title)) return 85;
  if (/报考上线录取|历年.*(?:招生|录取|数据)|复试.*(?:细则|办法)/.test(title))
    return 85;
  if (/招生简章|招生章程/.test(title)) return 80;
  if (/学科评估|专业排名/.test(title)) return 75;
  if (/学科概况|学科介绍|学科建设/.test(title)) return 65;
  if (/就业.*报告|就业质量|就业去向/.test(title)) return 70;
  if (/初试|考试科目|学费|收费|培养地点|校区|培养方案|生源|跨考/.test(title))
    return 50;
  if (/首页|导航|通知公告|信息公开|招生信息|学校概况|学院首页/.test(title))
    return -10;
  return 0;
}
