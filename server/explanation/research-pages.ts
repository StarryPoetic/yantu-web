import type { Discipline } from "../disciplines/types.ts";
import type { WebSource } from "./web.ts";
import { sourcePriority } from "./research-evidence.ts";

export function academicDomain(url: string) {
  const host = new URL(url).hostname;
  return host.endsWith(".edu.cn") ? host.split(".").slice(-3).join(".") : host;
}

/** Give each observed school a turn before spending reads on its other pages. */
export function researchReadingOrder(
  sources: WebSource[],
  sourceDirections: Map<string, string>,
  disciplines: Discipline[],
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
      return sourcePriority(source, discipline) + Math.min(30, year - 2000);
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
  const pages: WebSource[] = [];
  for (let round = 0; round < sources.length; round++) {
    for (const group of groups.values()) {
      if (group[round]) pages.push(group[round]);
    }
  }
  return { pages, firstRoundCount: groups.size };
}

/** Only linked school PDFs; navigation, cross-school links and executable URLs cannot expand a crawl. */
export function researchAttachments(parent: WebSource, html: string) {
  const parentUrl = new URL(parent.url);
  if (!parentUrl.hostname.endsWith(".edu.cn")) return [];
  const clean = html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, " ");
  const links: { url: string; title: string; score: number }[] = [];
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
        !/\.pdf$/i.test(url.pathname)
      )
        continue;
      url.hash = "";
      const label = match[3]
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (/本科|博士|录取名单|拟录取|导师|就业|招聘/.test(label)) continue;
      if (
        !/硕士|研究生|招生专业|培养方案|学费|收费标准|收费项目/.test(label) &&
        !(
          (!label || /附件|下载/.test(label)) &&
          /硕士|研究生|学费|收费/.test(parent.title)
        )
      )
        continue;
      if (links.some((link) => link.url === url.href)) continue;
      links.push({
        url: url.href,
        title: (label || `${parent.title}附件`).slice(0, 200),
        score: /招生专业|专业目录|学费|收费/.test(label) ? 2 : 1,
      });
    } catch {
      // Invalid href is data, not a reason to discard the parent school's evidence.
    }
  }
  return links.sort((a, b) => b.score - a.score).slice(0, 2);
}
