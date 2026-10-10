import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createHttpsReader,
  registrableDomain,
  webPageText,
} from "../server/explanation/web.ts";
import { createSchoolRegistry } from "../server/schools/index.ts";
import { normalizeCityName } from "../shared/cities.ts";
import { dnsModeFromEnvironment } from "../server/explanation/dns.ts";

export function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") options.write = true;
    else if (["--province", "--city", "--limit"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少值`);
      options[arg.slice(2)] = arg === "--limit" ? Number(value) : value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  )
    throw new Error("--limit 必须是正整数");
  return options;
}

/** Identity/accessibility only; never certifies programme facts. Reader failures remain failures. */
export async function verifyPage(school, url, reader) {
  if (!url) return { url, ok: null, skipped: true };
  try {
    const page = await reader(url, {
      allowedHosts: [new URL(url).hostname],
      maxRedirects: 3,
      allowHttp: true,
      maxBytes: 512000,
      timeoutMs: 10000,
    });
    if (
      registrableDomain(new URL(page.finalUrl ?? url).hostname) !==
      school.registrableDomain
    )
      return { url, ok: false, failureCode: "WEB_REDIRECT_CROSS_SITE" };
    const text = webPageText(page.text);
    const title = webPageText(
      page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
    );
    const matched = [school.name, ...school.aliases].some((name) =>
      `${title}\n${text.slice(0, 5000)}`.includes(name),
    );
    return {
      url,
      ok: matched,
      ...(matched ? {} : { failureCode: "NAME_NOT_FOUND" }),
      finalUrl: page.finalUrl ?? url,
      transport: page.transport,
      encoding: page.encoding,
    };
  } catch (error) {
    return { url, ok: false, failureCode: error.code ?? "WEB_UNAVAILABLE" };
  }
}

export async function verifyRegistry(registry, options = {}) {
  const loaded = createSchoolRegistry(registry);
  const selected = loaded.schools
    .filter(
      (s) =>
        (!options.province || s.province === options.province) &&
        (!options.city ||
          s.city === normalizeCityName(options.city) ||
          s.campusHints.some(
            (h) => h.city === normalizeCityName(options.city),
          )),
    )
    .slice(0, options.limit);
  const reader =
    options.reader ??
    createHttpsReader({ dnsMode: dnsModeFromEnvironment(process.env) });
  // Serialize the entire school domain, including redirects among subdomains.
  const queue = [...selected],
    results = [];
  const interval = options.intervalMs ?? 1000;
  const worker = async () => {
    for (let school; (school = queue.shift()); ) {
      const urls = [
        ...new Set(
          [
            school.homepage,
            school.graduateAdmissionsUrl,
            ...(school.discoveryUrls ?? []),
            ...(school.locationDiscoveryUrls ?? []),
          ].filter(Boolean),
        ),
      ];
      const pages = [];
      for (const url of urls) {
        if (pages.length && interval)
          await new Promise((resolve) => setTimeout(resolve, interval));
        pages.push(await verifyPage(school, url, reader));
      }
      const homepage = pages.find((p) => p.url === school.homepage);
      const graduate = pages.find(
        (p) => p.url === school.graduateAdmissionsUrl,
      );
      const verification = {
        checkedAt: new Date().toISOString(),
        homepageOk: homepage.ok,
        graduateAdmissionsOk: graduate?.ok ?? null,
        urls: {
          ...school.verification.urls,
          ...Object.fromEntries(pages.map((p) => [p.url, p.ok])),
        },
      };
      const failures = [
        ...new Set(
          pages.filter((p) => p.ok === false).map((p) => p.failureCode),
        ),
      ];
      if (failures.length) verification.failureCode = failures.join(";");
      results.push({ name: school.name, verification, pages });
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(6, options.concurrency ?? 6)) },
      worker,
    ),
  );
  results.sort(
    (a, b) =>
      selected.findIndex((s) => s.name === a.name) -
      selected.findIndex((s) => s.name === b.name),
  );
  const updates = new Map(results.map((r) => [r.name, r.verification]));
  const updated = {
    ...registry,
    schools: registry.schools.map((s) => ({
      ...s,
      verification: updates.get(s.name) ?? s.verification,
    })),
  };
  createSchoolRegistry(updated);
  return {
    registry: updated,
    results,
    summary: {
      total: results.length,
      homepageOk: results.filter((r) => r.verification.homepageOk).length,
      graduateTotal: selected.filter((s) => s.graduateAdmissionsUrl).length,
      graduateOk: results.filter((r) => r.verification.graduateAdmissionsOk)
        .length,
      pages: results.reduce((n, r) => n + r.pages.length, 0),
      pagesOk: results.reduce(
        (n, r) => n + r.pages.filter((p) => p.ok).length,
        0,
      ),
    },
  };
}

export async function runVerification(path, options = {}) {
  const report = await verifyRegistry(
    JSON.parse(await readFile(path, "utf8")),
    options,
  );
  if (options.write)
    await writeFile(path, JSON.stringify(report.registry, null, 2) + "\n");
  return report;
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const report = await runVerification(
    new URL("../knowledge/schools/registry.json", import.meta.url),
    parseArguments(process.argv.slice(2)),
  );
  for (const row of report.results) console.log(JSON.stringify(row));
  console.log(JSON.stringify({ summary: report.summary }));
}
