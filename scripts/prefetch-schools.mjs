import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Store } from "../server/store.ts";
import { databasePathFromEnvironment } from "../server/config.ts";
import { dnsModeFromEnvironment } from "../server/explanation/dns.ts";
import { schoolRegistry } from "../server/schools/index.ts";
import { normalizeCityName } from "../shared/cities.ts";
import {
  createResearchEvidenceLibrary,
  publicPageKey,
} from "../server/explanation/research-library.ts";
import { createPoliteReader } from "../server/explanation/robots.ts";
import { normalizeAttachedEvidence } from "../server/explanation/research-provenance.ts";
import {
  createHttpsReader,
  registrableDomain,
  validateOutboundUrl,
  webPageText,
  readSourceMetadata,
} from "../server/explanation/web.ts";

export function parseArguments(args) {
  const options = { school: [], maxPagesPerSchool: 20 };
  const keys = {
    "--city": "city",
    "--province": "province",
    "--school": "school",
    "--discipline": "discipline",
    "--max-pages-per-school": "maxPagesPerSchool",
    "--db": "db",
    "--dns-mode": "dnsMode",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--refresh") options.refresh = true;
    else if (keys[arg]) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少值`);
      if (arg === "--school") options.school.push(value);
      else
        options[keys[arg]] =
          arg === "--max-pages-per-school" ? Number(value) : value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (
    !Number.isInteger(options.maxPagesPerSchool) ||
    options.maxPagesPerSchool < 1 ||
    options.maxPagesPerSchool > 100
  )
    throw new Error("页数必须为1至100的整数");
  if (options.dnsMode && !["system", "public-doh"].includes(options.dnsMode))
    throw new Error("--dns-mode 必须为 system 或 public-doh");
  if (options.discipline && !/^\d{4}$/.test(options.discipline))
    throw new Error("学科代码必须为四位数字");
  return options;
}

const relevant =
  /招生|专业目录|简章|章程|学费|收费|校区|培养(?:地点|地址)|复试|调剂|研究生院|研究生招生/;
/** Rank actual discovered URLs; attachments inherit their article's relevance. */
export function discoveryScore(link, targetYear, parentScore = 0) {
  const title = link.title ?? "";
  let score = 0;
  if (/专业目录|招生目录/.test(title)) score += 100;
  if (/章程|简章/.test(title)) score += 50;
  if (/学费|收费/.test(title)) score += 35;
  if (/硕士/.test(title)) score += 30;
  if (/研究生/.test(title)) score += 10;
  if (title.includes(String(targetYear))) score += 90;
  if (title.includes(String(Number(targetYear) - 1))) score += 20;
  if (/博士|港澳台|留学生|国际学生|本科|同等学力加试/.test(title)) score -= 160;
  for (const match of title.matchAll(/20\d{2}/g))
    if (Number(match[0]) < Number(targetYear) - 3) score -= 100;
  if (/\/list(?:\d+)?\.htm(?:$|\?)/.test(link.url)) score -= 20;
  if (link.attachment) score += Math.max(60, parentScore);
  return score;
}
/** Actual links only, same school, inert GET documents; no forms, invented URLs or off-site links. */
export function discoverLinks(html, base, school, parentTitle = "") {
  const links = [];
  const clean = html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, " ");
  for (const match of clean.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([^]*?)<\/a\s*>/gi,
  )) {
    try {
      const url = new URL(match[2].replace(/&amp;/gi, "&"), base);
      const title = webPageText(match[3]).trim().slice(0, 500);
      const attachment = /\.(?:pdf|xlsx?)$/i.test(url.pathname);
      if (
        registrableDomain(url.hostname) !== school.registrableDomain ||
        (!relevant.test(title) &&
          !(
            attachment &&
            /附件|下载|^$/.test(title) &&
            relevant.test(parentTitle)
          ))
      )
        continue;
      const safe = validateOutboundUrl(url.href, [url.hostname], {
        allowHttp: true,
      });
      safe.hash = "";
      // Public-source privacy policy also rejects query/search/token URLs at write time.
      if (
        /\/(?:login|logout|search)(?:[/.]|$)/i.test(safe.pathname) ||
        /(?:^|[?&])(?:q|query|keyword|token|sessionid|password|user)=/i.test(
          safe.search,
        )
      )
        continue;
      if (
        !links.some(
          (link) => publicPageKey(link.url) === publicPageKey(safe.href),
        )
      )
        links.push({
          url: safe.href,
          title: title || `${parentTitle}附件`,
          attachment,
        });
    } catch {
      /* An invalid link does not discard its parent. */
    }
  }
  return links;
}

export async function prefetchSchools(options = {}, dependencies = {}) {
  const registry = dependencies.registry ?? schoolRegistry;
  const names = (options.school ?? []).map(
    (n) => registry.byName(n)?.name ?? n,
  );
  if (names.some((n) => !registry.byName(n)))
    throw new Error("指定学校未登记在种子库");
  const schools = registry.schools.filter(
    (s) =>
      (!options.city ||
        registry
          .byCity(normalizeCityName(options.city))
          .some((c) => c.school.name === s.name)) &&
      (!options.province || s.province === options.province) &&
      (!names.length || names.includes(s.name)),
  );
  const summary = {
    attemptedSchools: schools.length,
    successfulPages: 0,
    skippedFreshPages: 0,
    failuresByCode: {},
    factsByField: {},
    robotsSkipped: 0,
    robotsDisallowed: 0,
    robotsUnavailable: 0,
    robotsUnavailableByCode: {},
    dryRun: !!options.dryRun,
  };
  if (options.dryRun) return summary;
  const ownedStore = dependencies.library
    ? undefined
    : new Store(options.db ?? databasePathFromEnvironment());
  const library =
    dependencies.library ??
    createResearchEvidenceLibrary(ownedStore, { now: dependencies.now });
  const reader = createPoliteReader(
    dependencies.reader ??
      createHttpsReader({
        dnsMode: options.dnsMode ?? dnsModeFromEnvironment(process.env),
      }),
    dependencies,
  );
  const now = dependencies.now ?? Date.now;
  const year = String(new Date(now()).getUTCFullYear() + 1);
  const queue = [...schools];
  const worker = async () => {
    for (let school; (school = queue.shift()); ) {
      const pages = registry
        .discoveryUrls(school)
        .map((url) => ({ url, depth: 0, score: 0 }));
      const seen = new Set();
      let attempted = 0;
      while (pages.length && attempted < (options.maxPagesPerSchool ?? 20)) {
        pages.sort((a, b) => b.score - a.score || a.depth - b.depth);
        const task = pages.shift(),
          key = publicPageKey(task.url);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!options.refresh && library.isFresh(task.url, year)) {
          summary.skippedFreshPages++;
          continue;
        }
        attempted++;
        try {
          if (
            registrableDomain(new URL(task.url).hostname) !==
            school.registrableDomain
          )
            throw Object.assign(new Error(), {
              code: "WEB_REDIRECT_CROSS_SITE",
            });
          const result = await reader(task.url, {
            allowedHosts: [new URL(task.url).hostname],
            allowHttp: true,
            maxRedirects: 3,
            allowPdf: true,
            maxPdfBytes: 5000000,
            allowSpreadsheet: true,
            maxSpreadsheetBytes: 5000000,
            timeoutMs: 10000,
            maxBytes: 512000,
          });
          if (
            registrableDomain(new URL(result.finalUrl ?? task.url).hostname) !==
            school.registrableDomain
          )
            throw Object.assign(new Error(), {
              code: "WEB_REDIRECT_CROSS_SITE",
            });
          const attachment = /^(?:application\/pdf|application\/vnd\.)/i.test(
            result.contentType,
          );
          const text = attachment
            ? result.text.trim()
            : webPageText(result.text);
          if (!text) throw Object.assign(new Error(), { code: "WEB_EMPTY" });
          const links = attachment
            ? []
            : discoverLinks(
                result.text,
                result.finalUrl ?? task.url,
                school,
                task.title,
              );
          const title = attachment
            ? task.title
            : (task.title ??
              webPageText(
                result.text.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1] ??
                  task.title ??
                  school.name,
              ));
          const retrievedAt = new Date(now()).toISOString();
          let source = {
            id: `prefetch-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
            title,
            url: task.url,
            excerpt: text,
            retrievedAt,
            kind: "official_page",
            verified: false,
            ...readSourceMetadata(result, task.url),
            documentLinks: links.map(({ url, title }) => ({ url, title })),
          };
          if (task.parent)
            source = normalizeAttachedEvidence(
              { ...source, parentSourceId: task.parent.id },
              task.parent,
              text,
            );
          library.save(source);
          library.recordAttempt({
            url: task.url,
            status: "success",
            attemptedAt: retrievedAt,
          });
          summary.successfulPages++;
          if (task.depth < 3)
            for (const link of links.slice(0, 100))
              if (!seen.has(publicPageKey(link.url))) {
                const score = discoveryScore(link, year, task.score);
                const existing = pages.find(
                  (p) => publicPageKey(p.url) === publicPageKey(link.url),
                );
                if (existing && existing.score >= score) continue;
                if (existing) pages.splice(pages.indexOf(existing), 1);
                pages.push({
                  ...link,
                  score,
                  depth: task.depth + 1,
                  parent: source,
                });
              }
        } catch (error) {
          const reason = error.code ?? "WEB_UNAVAILABLE";
          summary.failuresByCode[reason] =
            (summary.failuresByCode[reason] ?? 0) + 1;
          if (reason.startsWith("ROBOTS_")) summary.robotsSkipped++;
          if (reason === "ROBOTS_DISALLOWED") summary.robotsDisallowed++;
          if (reason === "ROBOTS_UNAVAILABLE") {
            summary.robotsUnavailable++;
            const cause = error.robotsCause ?? "WEB_UNAVAILABLE";
            summary.robotsUnavailableByCode[cause] =
              (summary.robotsUnavailableByCode[cause] ?? 0) + 1;
          }
          library.recordAttempt({
            url: task.url,
            status: "failed",
            reason,
            tlsCode: error.tlsCode,
            attemptedAt: new Date(now()).toISOString(),
          });
        }
      }
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, schools.length) }, worker),
    );
    for (const fact of schools.length
      ? library.queryFacts({
          schoolNames: schools.map((s) => s.name),
          disciplineCodes: options.discipline
            ? [options.discipline]
            : undefined,
          targetYear: year,
        })
      : []) {
      summary.factsByField[fact.field] ??= { bound: 0, pending: 0 };
      summary.factsByField[fact.field][fact.status]++;
    }
    return summary;
  } finally {
    ownedStore?.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await prefetchSchools(parseArguments(process.argv.slice(2))),
        null,
        2,
      ),
    );
  } catch {
    console.error("预抓取未完成：请检查参数、数据库路径与网络配置。");
    process.exitCode = 1;
  }
}
