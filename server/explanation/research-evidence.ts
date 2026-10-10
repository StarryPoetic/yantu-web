import type { WebSource } from "./web.ts";
import type { Discipline } from "../disciplines/types.ts";
import {
  sourceHasSchoolIdentity,
  isConcreteProgramName,
  withoutSchoolLinks,
} from "./research-school.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";
import { explicitAdmissionsYears } from "../../shared/research-years.ts";
import type { ResearchStudyMode } from "../../shared/research-recommendation.ts";
import { safeSourceYear } from "./research-years.ts";
import { programNamePattern } from "./research-program-scope.ts";

export interface AdmissionEvidence {
  excluded?: string;
  exclusionKind?: "sample" | "closure";
  admissionStatus: "current_evidence" | "needs_verification";
  notice?: string;
}

export interface AdmissionProgramScope {
  institutionName?: string;
  programName: string;
  disciplineCode?: string;
  majorCode?: string;
  collegeName?: string;
  studyMode?: ResearchStudyMode;
}

const closure =
  /不(?:再)?招生|停招|(?:暂停|停止|取消|暂缓).{0,8}招生|不招收(?:硕士|研究生|本专业|该专业)(?:[。；，、\s]|$)/;
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

function rowScope(body: string, start: number, end?: number) {
  const lineStart = body.lastIndexOf("\n", start);
  const prefix = body.slice(Math.max(0, lineStart + 1), start);
  const previous =
    lineStart < 0
      ? ""
      : body.slice(body.lastIndexOf("\n", lineStart - 1) + 1, lineStart).trim();
  const college =
    /(?:^|[|\s:：])\d{0,3}([\p{Script=Han}]{1,24}(?:学院|研究院|研究所|学部|中心))\s*\|?\s*$/u;
  const collegeName =
    prefix.match(college)?.[1] ??
    (prefix.trim() ? undefined : previous.match(college)?.[1]);
  const line = body
    .slice(start, end)
    .split(/\n|复试|参考课程|参考书目|培养内容|课程设置/)[0];
  const partTime = /非全日制/.test(line);
  const fullTime = /全日制/.test(line.replace(/非全日制/g, ""));
  return {
    collegeName,
    studyMode:
      partTime === fullTime ? undefined : partTime ? "part_time" : "full_time",
  };
}

/** Literal programme passages with code, faculty and learning-mode boundaries preserved. */
export function scopedProgramPassages(
  source: WebSource,
  scope: AdmissionProgramScope,
  sources: readonly WebSource[] = [],
): string[] {
  if (
    scope.institutionName &&
    !sourceHasSchoolIdentity(source, scope.institutionName, sources)
  )
    return [];
  const body = withoutSchoolLinks(source.excerpt);
  const rows = [...body.matchAll(/\b(?:0[1-9]|1[0-4])\d{4}\b/g)];
  const escaped = programNamePattern(scope.programName, scope.majorCode);
  const headings = degreeHeadings(body);
  if (rows.length)
    return rows.flatMap((row, index) => {
      if (
        (scope.majorCode && row[0] !== scope.majorCode) ||
        (scope.disciplineCode && !row[0].startsWith(scope.disciplineCode))
      )
        return [];
      const heading = headings
        .filter((item) => item.position <= row.index!)
        .at(-1);
      if (heading && !heading.masters) return [];
      const afterCode = body
        .slice(row.index! + row[0].length, rows[index + 1]?.index)
        .replace(
          /^[\s|:：()（）\[\]【】-]*(?:[（(](?:专业学位|学术学位|学术型)[）)]\s*)?/,
          "",
        );
      if (
        !new RegExp(
          `^${escaped}(?=$|[\\s|（(，,。；;]|学术学位|专业学位|非?全日制|\\d|①|②|③|④|正常招生)`,
          "u",
        ).test(afterCode)
      )
        return [];
      const actual = rowScope(body, row.index!, rows[index + 1]?.index);
      if (
        (scope.collegeName && actual.collegeName !== scope.collegeName) ||
        (scope.studyMode &&
          scope.studyMode !== "unspecified" &&
          actual.studyMode !== scope.studyMode)
      )
        return [];
      const next = rows[index + 1]?.index;
      const nextLine =
        next === undefined ? undefined : body.lastIndexOf("\n", next);
      const end =
        nextLine !== undefined && nextLine > row.index! ? nextLine : next;
      return [body.slice(row.index!, end).split(" … ")[0].trim()];
    });
  return programPassages(body, scope.programName).filter((passage) => {
    const colleges =
      passage.match(
        /[\p{Script=Han}]{1,24}(?:学院|研究院|研究所|学部|中心)/gu,
      ) ?? [];
    if (
      scope.collegeName &&
      colleges.length &&
      !passage.includes(scope.collegeName)
    )
      return false;
    // An unqualified programme-wide notice can apply to every college; a faculty-specific page cannot.
    if (scope.collegeName && !colleges.length) {
      const preceding = body.slice(0, body.indexOf(passage.split("；")[0]));
      const heading = [
        ...preceding.matchAll(
          /(?:^|[\n|\s:：])\d{0,3}([\p{Script=Han}]{1,24}(?:学院|研究院|研究所|学部))(?=\s|\||\n|20\d{2}|$)/gu,
        ),
      ].at(-1)?.[1];
      if (heading && !heading.endsWith(scope.collegeName)) return false;
    }
    const partTime = /非全日制/.test(passage);
    const fullTime = /全日制/.test(passage.replace(/非全日制/g, ""));
    return (
      !(scope.studyMode === "full_time" && partTime && !fullTime) &&
      !(scope.studyMode === "part_time" && fullTime && !partTime)
    );
  });
}

/** Page-wide invalidity stays global; a local restriction requires the requested programme scope. */
export function scopedAdmissionEvidence(
  source: WebSource,
  targetYear: string,
  scope: AdmissionProgramScope,
  sources: readonly WebSource[] = [],
): AdmissionEvidence & { scopeMatched: boolean } {
  if (
    scope.institutionName &&
    !sourceHasSchoolIdentity(source, scope.institutionName, sources)
  )
    return { admissionStatus: "needs_verification", scopeMatched: false };
  const wholePage = admissionEvidence(source, targetYear);
  if (wholePage.excluded) return { ...wholePage, scopeMatched: true };
  const passages = scopedProgramPassages(source, scope, sources);
  if (!passages.length)
    return {
      admissionStatus: "needs_verification",
      scopeMatched: false,
      notice:
        "尚未绑定到同一专业代码、学院和学习方式，其他条目的限制不能用于排除此项目。",
    };
  if (passages.some((passage) => closure.test(passage)))
    return {
      admissionStatus: "needs_verification",
      scopeMatched: true,
      exclusionKind: "closure",
      excluded: "对应专业代码、学院和学习方式的条目含停招或不招生表述。",
    };
  return { ...wholePage, scopeMatched: true };
}

function admissionConflictInPassage(
  context: string,
  programName: string,
  discipline: Discipline,
  profile: Record<string, unknown>,
) {
  const major = String(profile.major ?? "").replace(/\s/g, "");
  if (!major) return false;
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

/** Only a dated, owned current programme restriction can reject this particular profile. */
export function scopedKnownAdmissionConflict(
  source: WebSource,
  scope: AdmissionProgramScope,
  discipline: Discipline,
  profile: Record<string, unknown>,
  year: string,
) {
  if (
    !isSchoolPage(source) ||
    safeSourceYear(source) !== Number(year) ||
    scopedAdmissionEvidence(source, year, scope).exclusionKind === "sample"
  )
    return false;
  return scopedProgramPassages(source, scope).some((context) =>
    admissionConflictInPassage(context, scope.programName, discipline, profile),
  );
}
export function supportsProgram(
  source: WebSource,
  institutionName: string,
  programName: string,
  discipline: Discipline,
  sources: readonly WebSource[] = [],
) {
  const evidence = withoutSchoolLinks(
    source.kind === "official_page"
      ? source.excerpt
      : `${source.title} ${source.excerpt}`,
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
    !isConcreteProgramName(programName) ||
    !sourceHasSchoolIdentity(source, institutionName, sources)
  )
    return false;
  const escaped = programNamePattern(programName, `${discipline.code}00`);
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
    const graduateHeading =
      scope?.masters ??
      validatedSourceProvenance(source)?.mastersScope ??
      false;
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
  return programPassages(source.excerpt, programName).some((context) =>
    admissionConflictInPassage(context, programName, discipline, profile),
  );
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
      exclusionKind: "sample",
      excluded: "资料含明确示例或测试标记，不能证明真实学校专业。",
    };
  // A directory may close one programme while continuing others. Without a
  // specific programme only an explicit school-wide closure excludes the page.
  const evidence = source.kind === "official_page" ? source.excerpt : all;
  if (
    /(?:全校|本校所有|全校所有|全部)(?:硕士|研究生|专业|学位|项目|招生|\s){0,8}(?:均|全部|一律)?(?:停招|暂停招生|停止招生|不再招生)/.test(
      evidence,
    ) ||
    (programName &&
      programPassages(evidence, programName).some((part) => closure.test(part)))
  )
    return {
      admissionStatus: "needs_verification",
      exclusionKind: "closure",
      excluded: "资料含停招或不招生表述，暂不据此推荐该学校专业。",
    };
  const years = new Set(explicitAdmissionsYears(evidence).map(String));
  if (!years.size) {
    const inheritedYear = validatedSourceProvenance(source)?.admissionYear;
    if (inheritedYear && /^20\d{2}$/.test(inheritedYear))
      years.add(inheritedYear);
  }
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
  const locationMatches = [
    ...excerpt.matchAll(
      /(?:学校地址|学院地址|联系地址|通讯地址|通信地址|办公地址|办学地址|培养地点|学习地点|教学地点|校址|地址)\s*[:：]/g,
    ),
    ...excerpt.matchAll(/校区|培养地点|学校地址|通讯地址/g),
  ];
  const location = locationMatches.find((match) => {
    if (match.index! < headerSize) return false;
    const preceding = excerpt.slice(
      Math.max(0, match.index! - 120),
      match.index!,
    );
    const links = Math.max(
      preceding.lastIndexOf("友情链接"),
      preceding.lastIndexOf("相关链接"),
      preceding.lastIndexOf("院校链接"),
    );
    const contact = Math.max(
      ...["联系方式", "联系我们", "版权所有", "Copyright", "CONTACT"].map(
        (label) => preceding.lastIndexOf(label),
      ),
    );
    // Do not preferentially retain a peer school's address from a links clause.
    // This only selects source passages; it does not establish place ownership.
    return links < 0 || contact > links;
  })?.index;
  const anchors = [
    school ? school.index + school[0].length - 2 : undefined,
    ...scopedPositions,
    ...[...excerpt.matchAll(/学费|收费标准|收费项目/g)]
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
  // An address late in a long page must survive an already full programme/fee
  // anchor list. Share the same character budget instead of dropping its peers.
  if (
    location !== undefined &&
    !anchors.some((position) => Math.abs(position - location) < 80)
  )
    anchors.push(location);
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
