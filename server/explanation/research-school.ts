import type { WebSource } from "./web.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";

/** School navigation links identify peers, not the owner of this page. */
export function withoutSchoolLinks(text: string) {
  return text.replace(
    /(?:友情链接|相关链接|院校链接|兄弟院校|兄弟高校|兄弟学校)[\s\S]*?(?=学院地址|学校地址|联系地址|联系方式|联系我们|Copyright|版权所有|$)/gi,
    "",
  );
}

/** Identify the page's school subject; fetched pages require actual body evidence. */
export function sourceHasSchoolIdentity(source: WebSource, school: string) {
  if (school.length < 2) return false;
  const escaped = school.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const department =
    "[\\p{Script=Han}A-Za-z]{0,24}(?:学院|研究生院|研究院|研究所|中心|处)";
  const suffix = `(?!(?:\\s*(?:博士生导师|硕士生导师|博士导师|硕士导师|教授|教师|校友|等|城市学院)))(?=$|[\\s\\d年级:：,，.。;；()（）\\[\\]【】|｜—-]|硕士|博士|研究生|本科|招生|培养|专业|学科|学位|教育|简介|概况|官网|官方网站|网站|导航|学校|于|现有|拥有|开设|设|附属|目录|地址|校区|收费|学费|联系|电话|邮政|${department})`;
  if (
    source.kind !== "official_page" &&
    new RegExp(
      `(?:^|20\\d{2}[年级]?|[\\s:：|｜—-])${escaped}${suffix}`,
      "u",
    ).test(withoutSchoolLinks(source.title))
  )
    return true;
  const body = withoutSchoolLinks(source.excerpt);
  const ownerPrefix =
    "(?:学校名称|主办单位|版权所有|Copyright)\\s*[\\s:：©Ⓒ()cC\\d.,，—–-]*";
  const ownedSchool = new RegExp(
    `${ownerPrefix}${escaped}(?!城市学院)(?=$|[\\s,，.。;；:：]|${department})|${escaped}(?!城市学院)(?:\\s*${department})?\\s*版权所有`,
    "iu",
  );
  if (ownedSchool.test(body)) return true;
  // A body's explicit different copyright/organizer school outranks a quoted
  // partner title. Department names are kept; no school/domain map is inferred.
  if (
    new RegExp(
      `${ownerPrefix}[\\p{Script=Han}A-Za-z]{1,35}(?:大学|学院|科学院|研究院|研究所)|[\\p{Script=Han}A-Za-z]{1,35}(?:大学|学院|科学院|研究院|研究所)\\s*版权所有`,
      "iu",
    ).test(body)
  )
    return false;
  if (new RegExp(`^\\s*${escaped}${suffix}`, "u").test(body)) return true;
  // A masthead or actual document title may follow a short page/navigation label.
  // It remains in the fetched text itself; a search title cannot fill this gap.
  if (
    new RegExp(`(?:^|[\\s:：|｜—-])${escaped}${suffix}`, "u").test(
      body.slice(0, 300),
    )
  )
    return true;
  // Actual body headings can follow navigation or introductory text. Unlike a
  // bare name anywhere in a page, these explicitly name the school as the
  // subject of an academic document or institutional statement.
  const subjects = new RegExp(
    `${escaped}(?!\\s*(?:城市学院|博士生导师|硕士生导师|博士导师|硕士导师|教授|教师|校友))\\s*(?:20\\d{2}[年级]?\\s*)?[\\p{Script=Han}\\d（）()\\s]{0,28}?(?:硕士(?:研究生|专业学位)?(?:招生|培养|专业|学位)|研究生(?:招生|培养|专业)|招生(?:专业)?目录|专业(?:介绍|目录|招生目录|接受|报考|报名|招收|仅限|只招收|不招收)|培养方案|收费标准|学位授权|学校简介|现有|拥有|开设)`,
    "gu",
  );
  const direct = [...body.matchAll(subjects)].some((match) => {
    const preceding = body.slice(Math.max(0, match.index! - 24), match.index!);
    return !/(?:来自|毕业于|就读于|任职于|合作(?:单位|院校)?|伙伴(?:院校)?|转载|转发|参照|参考|访问|赴|与|和)\s*$/.test(
      preceding,
    );
  });
  return (
    direct || validatedSourceProvenance(source)?.institutionName === school
  );
}
