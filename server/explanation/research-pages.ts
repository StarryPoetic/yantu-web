import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { decodedResearchDocuments } from "./research-encoded-documents.ts";
import { schoolRegistry } from "../schools/index.ts";
import { researchSchoolPriorities } from "./research-school-priority.ts";
import type { Discipline } from "../disciplines/types.ts";
import type { WebSource } from "./web.ts";
import { sourcePriority } from "./research-evidence.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";
import {
  historicalReferenceYears,
  explicitAdmissionsYears,
  researchYearPriority,
  isTargetYearChange,
} from "../../shared/research-years.ts";

const policyDocument = (title: string) =>
  /招生(?:专业)?目录|专业目录|招生(?:章程|简章)|初试|考试(?:科目|安排|大纲)|培养(?:方案|政策)|学费|收费/.test(
    title,
  );
const discoveryYear = (title: string) => {
  const years = explicitAdmissionsYears(title);
  return years.length === 1 ? years[0] : undefined;
};

export function academicDomain(url: string) {
  const host = new URL(url).hostname;
  return host.endsWith(".edu.cn") ? host.split(".").slice(-3).join(".") : host;
}

/** Campus geography leads from real same-school links, independent of a city registry. */
export function researchLocationLinks(parent: WebSource, html: string) {
  if (!new URL(parent.url).hostname.endsWith(".edu.cn")) return [];
  const clean = html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, " ");
  const links: { url: string; title: string; score: number }[] = [];
  for (const match of clean.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([^]*?)<\/a\s*>/gi,
  )) {
    try {
      const title = match[3]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (
        !/校区(?:介绍|概况|地址|地图)|学校(?:简介|概况|地址)|地理位置|交通指南|联系我们|联系方式/.test(
          title,
        ) ||
        /兄弟|合作|外校|招生办|招办|登录/.test(title)
      )
        continue;
      const url = new URL(
        match[2].replace(/&amp;/gi, "&"),
        parent.finalUrl ?? parent.url,
      );
      if (
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && url.hostname.endsWith(".edu.cn"))) ||
        url.username ||
        url.password ||
        url.port ||
        url.href.length > 2048 ||
        academicDomain(url.href) !== academicDomain(parent.url) ||
        /\.(?:pdf|xlsx?|zip|exe|docx?)$/i.test(url.pathname)
      )
        continue;
      url.hash = "";
      if (links.some((link) => link.url === url.href)) continue;
      links.push({
        url: url.href,
        title: title.slice(0, 200),
        score: /校区/.test(title) ? 3 : /地址|地理|交通/.test(title) ? 2 : 1,
      });
    } catch {
      /* Malformed website links cannot expand the read surface. */
    }
  }
  return links
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, 2)
    .map(({ url, title }) => ({ url, title }));
}

/** Give each observed school a turn before spending reads on its other pages. */
export function researchReadingOrder(
  sources: WebSource[],
  sourceDirections: Map<string, string>,
  disciplines: Discipline[],
  preferences: {
    cities?: readonly string[];
    selectedSchool?: string;
    schoolHints?: readonly string[];
    targetYear?: string;
  } = {},
) {
  const groups = new Map<string, WebSource[]>();
  for (const source of sources) {
    const discipline = disciplines.find(
      (item) => item.code === sourceDirections.get(source.id),
    );
    if (!discipline || sourcePriority(source, discipline) < 100) continue;
    if (/本科(?:专业|招生)|专升本|继续教育/.test(source.title)) continue;
    const domain = academicDomain(source.url);
    const group = groups.get(domain) ?? [];
    group.push(source);
    groups.set(domain, group);
  }
  for (const group of groups.values()) {
    const score = (source: WebSource) => {
      const discipline = disciplines.find(
        (item) => item.code === sourceDirections.get(source.id),
      )!;
      const year = Number(source.title.match(/\b(20\d{2})\b/)?.[1] ?? 2000);
      const list =
        /\/(?:list\d*|index|project|newsList)\.(?:html?|aspx?|php)$/i.test(
          new URL(source.url).pathname,
        );
      const mastersDirectory =
        /硕士[^。；]{0,24}(?:招生(?:专业)?目录|专业目录|招生简章|招生章程)|硕士生招生专业目录/.test(
          source.title,
        );
      const programmeDetail =
        !list &&
        (source.title.includes(discipline.name) ||
          source.title.includes(discipline.code)) &&
        /硕士|研究生/.test(`${source.title} ${source.excerpt}`);
      return (
        sourcePriority(source, discipline) +
        (preferences.targetYear
          ? researchYearPriority(
              policyDocument(source.title)
                ? discoveryYear(source.title)
                : undefined,
              preferences.targetYear,
            ) * 100
          : Math.min(30, year - 2000)) +
        (preferences.targetYear &&
        isTargetYearChange(
          `${source.title}\n${source.excerpt}`,
          preferences.targetYear,
        )
          ? 20000
          : 0) +
        (mastersDirectory ? 90 : programmeDetail ? 60 : 0) -
        (list ? 50 : 0)
      );
    };
    group.sort((a, b) => {
      const first = !!a.retrievalNote?.startsWith("公开学校发现目录");
      const second = !!b.retrievalNote?.startsWith("公开学校发现目录");
      return first && second
        ? 0
        : Number(first) - Number(second) || score(b) - score(a);
    });
    if (historicalReferenceYears(preferences.targetYear ?? "").length) {
      const important = group.filter((source) =>
        isTargetYearChange(
          `${source.title}\n${source.excerpt}`,
          preferences.targetYear!,
        ),
      );
      const primary = [...important];
      for (const year of [
        ...historicalReferenceYears(preferences.targetYear!),
        Number(preferences.targetYear),
      ]) {
        const page = group.find(
          (source) =>
            !primary.includes(source) &&
            policyDocument(source.title) &&
            discoveryYear(source.title) === year,
        );
        if (page) primary.push(page);
      }
      group.splice(
        0,
        group.length,
        ...primary,
        ...group.filter((source) => !primary.includes(source)),
      );
      continue;
    }
    // A fee notice does not replace the primary programme evidence.
    const primary = group.findIndex(
      (source) => !/学费|收费标准|收费项目/.test(source.title),
    );
    if (primary > 0) group.unshift(...group.splice(primary, 1));
    const fee = group.findIndex(
      (source, index) =>
        index > 0 && /学费|收费标准|收费项目/.test(source.title),
    );
    if (fee > 1) group.splice(1, 0, ...group.splice(fee, 1));
  }
  const schoolPriority = researchSchoolPriorities(preferences);
  const groupPriority = (group: WebSource[]) =>
    Math.min(
      ...group.map((source) => {
        const seed = schoolRegistry.byHost(new URL(source.url).hostname);
        const owned = [
          preferences.selectedSchool,
          ...(preferences.schoolHints ?? []),
        ].find((name) => name && sourceHasSchoolIdentity(source, name));
        return schoolPriority.priority(owned ?? seed?.name);
      }),
    );
  const priorityDomains = [...groups.entries()]
    .filter(([, group]) =>
      schoolPriority.active
        ? groupPriority(group) < 3
        : group.some(
            (source) =>
              (preferences.cities ?? []).some(
                (city) =>
                  city.length >= 2 &&
                  `${source.title} ${source.excerpt}`.includes(city),
              ) ||
              (preferences.schoolHints ?? []).some((school) =>
                sourceHasSchoolIdentity(source, school),
              ),
          ),
    )
    .map(([domain]) => domain);
  const priority = new Set(priorityDomains);
  const orderedGroups = [...groups.entries()]
    .sort((a, b) => {
      const navigationOnly = (group: WebSource[]) =>
        group.every((source) =>
          source.retrievalNote?.startsWith("公开学校发现目录"),
        );
      return (
        (schoolPriority.active
          ? groupPriority(a[1]) - groupPriority(b[1])
          : 0) ||
        Number(navigationOnly(a[1])) - Number(navigationOnly(b[1])) ||
        Number(priority.has(b[0])) - Number(priority.has(a[0]))
      );
    })
    .map(([, group]) => group);
  const pages: WebSource[] = [];
  for (let round = 0; round < sources.length; round++) {
    for (const group of orderedGroups) {
      if (group[round]) pages.push(group[round]);
    }
  }
  return { pages, firstRoundCount: groups.size, priorityDomains };
}

/** Bounded linked documents; same-school provenance does not establish a programme fact. */
export function researchAttachments(
  parent: WebSource,
  html: string,
  options: { maxLinks?: number; targetYear?: string } = {},
) {
  const parentUrl = new URL(parent.finalUrl ?? parent.url);
  if (!parentUrl.hostname.endsWith(".edu.cn")) return [];
  const explicit = [
    ...parent.excerpt.matchAll(/https?\s*:\/\/[^\s<>"'，。；）)]+/g),
  ]
    .flatMap((m) => {
      const context = parent.excerpt.slice(Math.max(0, m.index - 100), m.index);
      return /历年|分数线|报考人数|录取人数|招生数据/.test(context)
        ? [`<a href="${m[0].replace(/\s/g, "")}">历年招生数据 报考录取统计</a>`]
        : [];
    })
    .join("");
  const clean = (html + explicit + decodedResearchDocuments(html))
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, " ");
  const links: {
    url: string;
    title: string;
    score: number;
    kind: "html" | "pdf" | "spreadsheet";
    parentSourceId: string;
  }[] = [];
  for (const match of clean.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([^]*?)<\/a\s*>/gi,
  )) {
    try {
      const value = match[2].replace(/&amp;/gi, "&");
      const url = new URL(value, parentUrl);
      if (
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && url.hostname.endsWith(".edu.cn"))) ||
        url.username ||
        url.password ||
        url.port ||
        url.href.length > 2048 ||
        academicDomain(url.href) !== academicDomain(parent.url) ||
        !/\.(?:pdf|xlsx?|s?html?)$/i.test(url.pathname)
      )
        continue;
      url.hash = "";
      const label = match[3]
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (/本科|博士|硕博连读|导师|招聘|留学|国际学生|来华|港澳台/.test(label))
        continue;
      if (
        !/硕士|研究生|招生专业|培养方案|学费|收费标准|收费项目|复试|拟录取|报录|报考录取|历年招生数据|学科评估|就业质量|就业.*报告|生源质量/.test(
          label,
        ) &&
        !(
          (!label || /附件|下载/.test(label)) &&
          /硕士|研究生|学费|收费/.test(parent.title)
        )
      )
        continue;
      const kind = /\.pdf$/i.test(url.pathname)
        ? "pdf"
        : /\.xlsx?$/i.test(url.pathname)
          ? "spreadsheet"
          : "html";
      // Detail pages can recover a directory hidden behind a search-result list.
      // Generic navigation, login routes and other list pages do not create a crawl.
      if (
        kind === "html" &&
        !/历年招生数据|复试|拟录取|报录|学科评估|就业.*报告|生源质量/.test(
          label,
        ) &&
        (!/硕士[^。；]{0,35}(?:招生|专业目录)|招生专业目录|研究生[^。；]{0,25}(?:招生|培养方案|学费|收费)/.test(
          label,
        ) ||
          /\/(?:list\d*|index|main|login)\.(?:html?|aspx?|php)$/i.test(
            url.pathname,
          ) ||
          !(/20\d{2}/.test(label) || /培养方案|专业介绍/.test(label)))
      )
        continue;
      if (links.some((link) => link.url === url.href)) continue;
      const year = Number(label.match(/20\d{2}/)?.[0] ?? 0);
      const target = Number(options.targetYear ?? 0);
      const directory = /招生专业|专业目录/.test(label);
      links.push({
        url: url.href,
        title: (label || `${parent.title}附件`).slice(0, 200),
        score:
          (directory
            ? 50
            : /招生(?:章程|简章)/.test(label)
              ? 40
              : /学费|收费/.test(label)
                ? 20
                : 10) +
          (historicalReferenceYears(options.targetYear ?? "").length
            ? researchYearPriority(
                policyDocument(label) ? discoveryYear(label) : undefined,
                options.targetYear!,
              ) *
                100 +
              (isTargetYearChange(label, options.targetYear!) ? 20000 : 0)
            : target && year === target
              ? 30
              : year
                ? Math.max(0, Math.min(20, year - 2010))
                : 0),
        kind,
        parentSourceId: parent.id,
      });
    } catch {
      // Invalid href is data, not a reason to discard the parent school's evidence.
    }
  }
  links.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const primary = options.targetYear
    ? links.filter((link) =>
        isTargetYearChange(link.title, options.targetYear!),
      )
    : [];
  if (options.targetYear)
    for (const year of [
      ...historicalReferenceYears(options.targetYear),
      Number(options.targetYear),
    ]) {
      const page = links.find(
        (link) =>
          !primary.includes(link) &&
          policyDocument(link.title) &&
          discoveryYear(link.title) === year,
      );
      if (page) primary.push(page);
    }
  return [...primary, ...links.filter((link) => !primary.includes(link))].slice(
    0,
    Math.min(B.attachmentLinks, Math.max(1, options.maxLinks ?? 2)),
  );
}
