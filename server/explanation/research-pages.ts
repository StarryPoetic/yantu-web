import type { Discipline } from "../disciplines/types.ts";
import type { WebSource } from "./web.ts";
import { sourcePriority } from "./research-evidence.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";

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
      const url = new URL(match[2].replace(/&amp;/gi, "&"), parent.url);
      if (
        url.protocol !== "https:" ||
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
    schoolHints?: readonly string[];
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
        Math.min(30, year - 2000) +
        (mastersDirectory ? 90 : programmeDetail ? 60 : 0) -
        (list ? 50 : 0)
      );
    };
    group.sort((a, b) => score(b) - score(a));
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
  const priorityDomains = [...groups.entries()]
    .filter(([, group]) =>
      group.some(
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
    .sort((a, b) => Number(priority.has(b[0])) - Number(priority.has(a[0])))
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
  const parentUrl = new URL(parent.url);
  if (!parentUrl.hostname.endsWith(".edu.cn")) return [];
  const clean = html
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
        url.protocol !== "https:" ||
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
      if (
        /本科|博士|录取名单|拟录取|导师|就业|招聘|推荐免试|推免|留学|国际学生|来华|港澳台/.test(
          label,
        )
      )
        continue;
      if (
        !/硕士|研究生|招生专业|培养方案|学费|收费标准|收费项目/.test(label) &&
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
          (target && year === target
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
  return links
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, Math.min(4, Math.max(1, options.maxLinks ?? 2)));
}
