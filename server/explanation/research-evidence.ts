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

/** Real body headings provide degree scope; a search title cannot supply missing evidence. */
function degreeHeadings(text: string) {
  return [
    ...text.matchAll(
      /(?:硕士(?:研究生|专业学位)?|博士(?:生|研究生|专业学位)?|本科(?:生)?|学士)[^。；;…\n]{0,28}?(?:招生(?:专业)?目录|专业目录|招生简章|专业介绍|培养方案|学位授权(?:点|学科|类别|名单|目录)?|学位授予(?:权|点|学科|类别|名单|目录)?)/g,
    ),
  ]
    .filter((match) => {
      const preceding = text.slice(
        Math.max(0, match.index! - 60),
        match.index!,
      );
      // Master's catalogues often explain symbols such as "▲表示博士学位授权点".
      // Such a legend describes the following master's rows; it does not start a
      // doctoral section. Real degree headings without a symbol legend still bound scope.
      return !/(?:带|标注|标记|标有|加注|[▲★☆*])[^。；;…\n]{0,18}(?:表示|代表|标示|为|是)[^。；;…\n]{0,6}$/.test(
        preceding,
      );
    })
    .map((match) => ({
      position: match.index!,
      end: match.index! + match[0].length,
      masters: /硕士/.test(match[0]) && !/博士|本科|学士/.test(match[0]),
    }));
}

function recruitmentPage(source: WebSource) {
  const url = new URL(source.url);
  return (
    /\/(?:job|jobs)\/(?:view|detail)(?:\/|$)/i.test(url.pathname) ||
    (/^(?:job|jobs|jy|career|careers|employment|zhaopin)\./i.test(
      url.hostname,
    ) &&
      /工程师|技术员|岗位|招聘|实习生|管培生|人才需求/.test(source.title))
  );
}

/** Restrictions belong to a programme clause, never an arbitrary following table row. */
function programPassages(excerpt: string, programName: string) {
  const clauses = excerpt
    .replace(/(?=\b(?:0[1-9]|1[0-4])\d{4}\b)/g, "\n")
    .split(/[。；;\n，,]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.flatMap((clause, index) => {
    if (!clause.includes(programName)) return [];
    const parts = [clause];
    for (const next of clauses.slice(index + 1, index + 4)) {
      // A short conditions note can sit between a programme and "本专业停招".
      // Never cross a new code/name row or an unrecognised clause to find a restriction.
      if (
        !/^(?:本专业|该专业|仅限|只招收|限招|不(?:接受|接收|招收)跨专业|禁止跨专业|具体(?:条件|要求)|详细(?:条件|要求)|报考(?:条件|要求))/.test(
          next,
        )
      )
        break;
      parts.push(next);
    }
    return [parts.join("；")];
  });
}
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
    (/博士(?:生|研究生|专业|招生|目录|培养)/.test(source.title) &&
      !/硕士/.test(source.title)) ||
    recruitmentPage(source)
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
    /硕士(?:研究生|专业学位)?(?:招生|专业|学位|培养|授权|授予|项目|学科)|硕士点|(?:招收|培养|授予)[^。；;…\n]{0,8}硕士|研究生(?:招生|培养|专业|课程|学位)|硕士(?:研究生)?\s*[）)]/;
  const headings = degreeHeadings(evidence);
  return windows.some(({ text: window, position }) => {
    const preceding = evidence.slice(0, position);
    const rowStart = Math.max(
      ...["。", "；", ";", "\n"].map((separator) =>
        preceding.lastIndexOf(separator),
      ),
    );
    const rowPrefix = preceding.slice(rowStart + 1);
    // Course lists on a genuine master's page describe teaching, not additional
    // degree programmes. A second, independently supported occurrence can still pass.
    if (
      /(?:课程(?:设置|列表|名称|目录|体系)|(?:必修|选修|核心|专业|主要|开设)课程|教学科目|参考书目)\s*(?:[:：]|包括|包含|有|为)/.test(
        rowPrefix,
      )
    )
      return false;
    const scope = headings
      .filter((heading) => heading.position <= position)
      .at(-1);
    const scopedWindow =
      scope && !scope.masters
        ? evidence.slice(
            Math.max(scope.end, position - 120),
            position + programName.length + 160,
          )
        : window;
    const substantive = scopedWindow.replace(
      /(?:网站)?导航[^。；;\n]*(?:[。；;\n]|$)/g,
      "",
    );
    const doctoral = /博士(?:生|研究生)?(?:招生|专业|培养|学位|项目)/.test(
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
    // A distant genuine master's heading applies to its rows until another degree
    // section starts. Do not reuse it for a subsequent undergraduate/doctoral table.
    const graduateHeading = scope?.masters ?? false;
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
  if (
    admissionEvidence(source, year, programName).admissionStatus !==
    "current_evidence"
  )
    return false;
  const major = String(profile.major ?? "").replace(/\s/g, "");
  if (!major) return false;
  return programPassages(source.excerpt, programName).some((context) => {
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
  });
}

export function sourcePriority(source: WebSource, discipline: Discipline) {
  const url = new URL(source.url);
  const content = `${source.title} ${source.excerpt}`;
  const programmeTitle =
    /培养方案|培养计划|专业介绍|招生简章|招生专业目录|硕士点|学位授权点/.test(
      source.title,
    );
  let score = url.hostname.endsWith(".edu.cn") ? 100 : -100;
  if (recruitmentPage(source)) score -= 1000;
  if (
    /(?:\/|_)(?:BS|boshi|phd|doctoral)(?:\/|_|\.|$)/i.test(url.pathname) ||
    /博士后/.test(source.title) ||
    (/博士(?:生|研究生)?/.test(source.title) && !/硕士/.test(source.title))
  )
    score -= 1000;
  if (
    /本科(?:专业|招生)|学士学位/.test(content) ||
    /\/bkjx|undergrad/i.test(url.pathname)
  )
    score -= 150;
  if (/硕士|研究生(?:培养|招生)/.test(content)) score += 20;
  if (programmeTitle) score += 70;
  if (/拟录取|录取名单|录取公示|录取通知|招聘|校友名册/.test(source.title))
    score -= 350;
  if (
    /导师.{0,20}(?:审核|审查|审定|遴选|资格)|(?:审核|审查|遴选).{0,10}导师/.test(
      source.title,
    )
  )
    score -= 350;
  // A school home page can identify a host, but navigation snippets are not
  // programme evidence and must not displace actual master's documents.
  if (
    !programmeTitle &&
    (/首页|主页|官方网站|\bhome\b/i.test(source.title) ||
      /^\/(?:index\.(?:html?|shtml|php|aspx))?\/?$/i.test(url.pathname))
  )
    score -= 250;
  if (content.includes(discipline.name)) score += 25;
  if (content.includes(discipline.code)) score += 40;
  if (/\.docx?(?:$|\?)/i.test(url.pathname)) score -= 100;
  return score;
}
export function admissionEvidence(
  source: WebSource,
  targetYear: string,
  programName?: string,
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
  // A directory may close one programme while continuing others. Without a
  // specific programme only an explicit school-wide closure excludes the page.
  const evidence = source.kind === "official_page" ? source.excerpt : all;
  const closure =
    /不(?:再)?招生|停招|(?:暂停|停止|取消|暂缓).{0,8}招生|不招收(?:硕士|研究生|本专业|该专业)(?:[。；，、\s]|$)/;
  if (
    /(?:全校|本校所有|全校所有|全部)(?:硕士|研究生|专业|学位|项目|招生|\s){0,8}(?:均|全部|一律)?(?:停招|暂停招生|停止招生|不再招生)/.test(
      evidence,
    ) ||
    (programName &&
      programPassages(evidence, programName).some((part) => closure.test(part)))
  )
    return {
      admissionStatus: "needs_verification",
      excluded: "资料含停招或不招生表述，暂不据此推荐该学校专业。",
    };
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
  const headerSize = Math.min(200, Math.floor(max / 4));
  const school =
    /[\p{Script=Han}A-Za-z]{1,30}(?:大学|科学院|研究院|研究所)/u.exec(
      excerpt,
    ) ?? /[\p{Script=Han}A-Za-z]{1,30}学院/u.exec(excerpt);
  // Prefer concrete six-digit programme rows to a broad discipline in navigation.
  const programmePositions = disciplines.flatMap((discipline) => {
    const codes = [
      ...excerpt.matchAll(new RegExp(`\\b${discipline.code}\\d{2}\\b`, "g")),
    ]
      .slice(0, 3)
      .map((match) => match.index!);
    if (codes.length) return codes;
    return [discipline.name, ...discipline.aliases]
      .map((term) => excerpt.indexOf(term))
      .filter((position) => position >= 0)
      .slice(0, 2);
  });
  const headings = degreeHeadings(excerpt);
  const scopedPositions = programmePositions.flatMap((position) => {
    const heading = headings.filter((item) => item.position <= position).at(-1);
    return heading ? [heading.position, position] : [position];
  });
  const anchors = [
    school ? school.index + school[0].length - 2 : undefined,
    ...scopedPositions,
    ...[
      ...excerpt.matchAll(/学费|收费标准|(?:校区|培养地点|学校地址|通讯地址)/g),
    ]
      .slice(0, 3)
      .map((match) => match.index!),
  ]
    .filter(
      (position): position is number =>
        position !== undefined && position >= headerSize,
    )
    .filter(
      (position, index, positions) =>
        positions.findIndex((other) => Math.abs(other - position) < 80) ===
        index,
    )
    .slice(0, Math.max(3, Math.min(8, Math.floor(max / 250))));
  if (!anchors.length) return excerpt.slice(0, max);
  const width = Math.floor(
    (max - headerSize - anchors.length * 3) / anchors.length,
  );
  const ranges = [
    [0, headerSize],
    ...anchors.map((position) => {
      const start = Math.max(0, position - Math.min(80, Math.floor(width / 4)));
      return [start, Math.min(excerpt.length, start + width)];
    }),
  ].sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged
    .map(([start, end]) => excerpt.slice(start, end))
    .join(" … ")
    .slice(0, max);
}
