import type { WebSource } from "./web.ts";
import type { Discipline } from "../disciplines/types.ts";

export interface AdmissionEvidence {
  excluded?: string;
  admissionStatus: "current_evidence" | "needs_verification";
  notice?: string;
}
export const isSchoolPage = (source: WebSource) =>
  source.kind === "official_page" &&
  !/(^|\.)chsi\.com\.cn$/.test(new URL(source.url).hostname);
export function supportsProgram(
  source: WebSource,
  institutionName: string,
  programName: string,
  discipline: Discipline,
) {
  const evidence = (
    source.kind === "official_page"
      ? source.excerpt
      : `${source.title} ${source.excerpt}`
  ).replace(
    /(?:友情链接|相关链接|院校链接)[\s\S]*?(?=学院地址|学校地址|联系地址|Copyright|版权所有|$)/gi,
    "",
  );
  if (
    /(?:\/|_)(?:BS|boshi|phd|doctoral)(?:\/|_|\.|$)/i.test(
      new URL(source.url).pathname,
    ) ||
    (/博士(?:研究生|专业|招生|目录|培养)/.test(source.title) &&
      !/硕士/.test(source.title))
  )
    return false;
  if (
    programName.length < 2 ||
    /^(?:专业|学科|硕士|研究生|研究方向|硕士研究生)$/.test(programName) ||
    !evidence.includes(institutionName)
  )
    return false;
  const escaped = programName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const windows = [...evidence.matchAll(new RegExp(escaped, "g"))]
    .slice(0, 12)
    .map((match) => ({
      position: match.index!,
      text: evidence.slice(
        Math.max(0, match.index! - 120),
        match.index! + programName.length + 160,
      ),
    }));
  const graduate =
    /硕士(?:研究生)?(?:招生|专业|学位|培养|授权|项目|学科)|硕士点|(?:招收|培养).{0,8}硕士|研究生(?:招生|培养|专业|课程|学位)|硕士(?:研究生)?\s*[）)]/;
  const graduateHeading =
    /硕士(?:研究生)?.{0,24}(?:招生简章|招生目录|招生专业目录|专业介绍|培养方案)/.test(
      evidence.slice(0, 250),
    );
  return windows.some(({ text: window, position }) => {
    const substantive = window.replace(
      /(?:网站)?导航[^。；;\n]*(?:[。；;\n]|$)/g,
      "",
    );
    const doctoral =
      /博士(?:研究生)?(?:招生|专业|培养|学位|项目)|博士生培养/.test(
        substantive,
      );
    const localGraduate =
      graduate.test(substantive) && (!doctoral || /硕士/.test(substantive));
    if (doctoral && !/硕士/.test(substantive)) return false;
    if (/本科(?:专业|招生|培养)|学士学位/.test(window) && !localGraduate)
      return false;
    const origin = Math.max(0, position - 70);
    const nearby = evidence.slice(origin, position + programName.length + 70);
    const codes = [...nearby.matchAll(/\b(?:0[1-9]|1[0-4])\d{4}\b/g)]
      .map((match) => {
        const start = origin + match.index!;
        const gap =
          start < position
            ? evidence.slice(start + match[0].length, position)
            : evidence.slice(position + programName.length, start);
        return { code: match[0], gap };
      })
      .filter(({ gap }) =>
        /^[\s:：()（）\[\]【】-]*(?:(?:专业名称|专业代码)[\s:：]*)?$/.test(gap),
      )
      .sort((a, b) => a.gap.length - b.gap.length);
    if (codes.length && !codes[0].code.startsWith(discipline.code))
      return false;
    const codeNearName = new RegExp(
      `\\b${discipline.code}\\d{0,2}\\b[^。；;…]{0,40}${escaped}|${escaped}[^。；;…]{0,40}\\b${discipline.code}\\d{0,2}\\b`,
    ).test(window);
    const related =
      programName.includes(discipline.name) ||
      discipline.aliases.some(
        (alias) => alias.length >= 2 && programName.includes(alias),
      ) ||
      codeNearName;
    return related && (localGraduate || graduateHeading);
  });
}

/** Only directly stated current restrictions can reject a profile; historical rules remain risks. */
export function knownAdmissionConflict(
  source: WebSource,
  programName: string,
  discipline: Discipline,
  profile: Record<string, unknown>,
  year: string,
) {
  if (admissionEvidence(source, year).admissionStatus !== "current_evidence")
    return false;
  const major = String(profile.major ?? "").replace(/\s/g, "");
  const position = source.excerpt.indexOf(programName);
  if (!major || position < 0) return false;
  const context = source.excerpt.slice(
    Math.max(0, position - 80),
    position + programName.length + 400,
  );
  const only =
    /(?:仅限|只招收|限招)([\p{Script=Han}、（）()]{2,35}?)(?:专业)?本科(?:毕业生|背景|专业|考生)/u.exec(
      context,
    )?.[1];
  if (only && !/相关|相近|大类|类|等|本校/.test(only)) {
    const choices = only
      .replace(/专业$/, "")
      .split(/[、与或]/)
      .filter(Boolean);
    if (
      choices.length &&
      choices.every(
        (choice) => !major.includes(choice) && !choice.includes(major),
      )
    )
      return true;
  }
  return (
    /不(?:接受|接收|招收)跨专业|禁止跨专业/.test(context) &&
    ![programName, discipline.name, ...discipline.aliases].some(
      (term) =>
        term.length >= 2 && (major.includes(term) || term.includes(major)),
    )
  );
}

export function sourcePriority(source: WebSource, discipline: Discipline) {
  const url = new URL(source.url);
  const content = `${source.title} ${source.excerpt}`;
  let score = url.hostname.endsWith(".edu.cn") ? 100 : -100;
  if (
    /(?:\/|_)(?:BS|boshi|phd|doctoral)(?:\/|_|\.|$)/i.test(url.pathname) ||
    /博士(?:专业|招生|目录)/.test(source.title)
  )
    score -= 1000;
  if (
    /本科(?:专业|招生)|学士学位/.test(content) ||
    /\/bkjx|undergrad/i.test(url.pathname)
  )
    score -= 150;
  if (/硕士|研究生(?:培养|招生)/.test(content)) score += 20;
  if (/培养方案|专业介绍|招生简章|招生专业目录/.test(source.title)) score += 70;
  if (/拟录取|录取名单|录取公示|招聘|校友名册/.test(source.title)) score -= 250;
  if (content.includes(discipline.name)) score += 25;
  if (content.includes(discipline.code)) score += 40;
  if (/\.docx?(?:$|\?)/i.test(url.pathname)) score -= 100;
  return score;
}
export function admissionEvidence(
  source: WebSource,
  targetYear: string,
): AdmissionEvidence {
  const all = `${source.title} ${source.excerpt}`;
  if (
    /示例(?:数据|资料|页面|内容|说明)|测试(?:数据|资料|页面|内容|说明)|演示(?:数据|资料|页面|内容|说明)|(?:仅供|仅为|用于|作为|本页为|本文为).{0,8}(?:示例|演示|测试)|不代表实际招生|非真实招生|虚构(?:招生|院校|学校|资料)/.test(
      all,
    )
  )
    return {
      admissionStatus: "needs_verification",
      excluded: "资料含明确示例或测试标记，不能证明真实学校专业。",
    };
  // Conditional restrictions such as 不招收同等学力考生 are not a closure notice.
  if (
    /不(?:再)?招生|停招|(?:暂停|停止|取消|暂缓).{0,8}招生|不招收(?:硕士|研究生|本专业|该专业)(?:[。；，、\s]|$)/.test(
      all,
    )
  )
    return {
      admissionStatus: "needs_verification",
      excluded: "资料含停招或不招生表述，暂不据此推荐该学校专业。",
    };
  const evidence = source.kind === "official_page" ? source.excerpt : all;
  const years = new Set(
    [
      ...evidence.matchAll(
        /(?:^|[^0-9])(20\d{2})(?:\s*(?:年(?:度)?|级)\s*[^0-9。！？\n]{0,32}?|\s*(?=招生|招收|报考|硕士|研究生)[^0-9。！？\n]{0,32}?)(?:招生|招收|报考|硕士研究生考试)/g,
      ),
    ].map((match) => match[1]),
  );
  if (
    isSchoolPage(source) &&
    /^20\d{2}$/.test(targetYear) &&
    years.size === 1 &&
    years.has(targetYear)
  )
    return { admissionStatus: "current_evidence" };
  return {
    admissionStatus: "needs_verification",
    notice:
      "可参考这份资料了解学校与专业；目标年度的招生、资格、学费和考试安排仍待官网核验。",
  };
}

/** Retain a title/header plus actual matching passages, rather than only navigation text. */
export function compactEvidence(
  excerpt: string,
  disciplines: Discipline[],
  max: number,
) {
  if (excerpt.length <= max) return excerpt;
  const parts = [excerpt.slice(0, Math.min(200, Math.floor(max / 4)))];
  const tailSize = Math.min(300, Math.floor(max / 4));
  const terms = [
    ...disciplines.flatMap((item) => [item.name, item.code]),
    "硕士",
    "专业介绍",
    "招生",
  ];
  let remaining = max - parts[0].length - tailSize - 15;
  const positions = [
    ...new Set(
      terms
        .map((term) => excerpt.indexOf(term, 250))
        .filter((index) => index >= 250),
    ),
  ].slice(0, 3);
  for (const position of positions) {
    if (remaining < 100) break;
    const part = excerpt.slice(
      Math.max(250, position - 80),
      Math.max(250, position - 80) +
        Math.floor(remaining / (positions.length || 1)),
    );
    parts.push(part);
    remaining -= part.length;
  }
  parts.push(excerpt.slice(-(Math.max(0, remaining) + tailSize)));
  return parts.join(" … ").slice(0, max);
}
