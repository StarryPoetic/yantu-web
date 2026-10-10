import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createHttpsReader,
  registrableDomain,
} from "../server/explanation/web.ts";
import { dnsModeFromEnvironment } from "../server/explanation/dns.ts";

export async function probeSites(urls, { reader, concurrency = 4 } = {}) {
  reader ??= createHttpsReader({
    dnsMode: dnsModeFromEnvironment(process.env),
  });
  const groups = new Map();
  for (const [index, url] of urls.entries()) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      host = "invalid";
    }
    // Serialize a whole school so redirected requests from different subdomains cannot overlap on one host.
    const domain = registrableDomain(host);
    const group = groups.get(domain) ?? [];
    group.push({ index, url, host });
    groups.set(domain, group);
  }
  const queue = [...groups.values()];
  const results = [];
  async function worker() {
    for (let group; (group = queue.shift()); ) {
      for (const { index, url, host } of group) {
        try {
          const result = await reader(url, {
            allowedHosts: [host],
            maxRedirects: 3,
            allowHttp: true,
            maxBytes: 512000,
            timeoutMs: 8000,
            allowPdf: true,
            maxPdfBytes: 5000000,
            allowSpreadsheet: true,
            maxSpreadsheetBytes: 5000000,
          });
          results.push({
            index,
            url,
            status: "success",
            finalUrl: result.finalUrl,
            transport: result.transport,
            encoding: result.encoding,
          });
        } catch (error) {
          results.push({
            index,
            url,
            status: "failed",
            code: error.code ?? "WEB_UNAVAILABLE",
            ...(error.tlsCode ? { tlsCode: error.tlsCode } : {}),
          });
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, worker),
  );
  results.sort((a, b) => a.index - b.index);
  const failures = {};
  const tlsCodes = {};
  for (const result of results) {
    if (result.code) failures[result.code] = (failures[result.code] ?? 0) + 1;
    if (result.tlsCode)
      tlsCodes[result.tlsCode] = (tlsCodes[result.tlsCode] ?? 0) + 1;
  }
  const chainFailures =
    (tlsCodes.UNABLE_TO_VERIFY_LEAF_SIGNATURE ?? 0) +
    (tlsCodes.UNABLE_TO_GET_ISSUER_CERT_LOCALLY ?? 0);
  return {
    results,
    summary: {
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      failures,
      tlsCodes,
      chainFailureRatio: results.length ? chainFailures / results.length : 0,
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  let urls;
  if (args[0] === "--urls")
    urls = args
      .slice(1)
      .flatMap((arg) => arg.split(/[\s,]+/))
      .filter(Boolean);
  else if (args.length === 1)
    urls = (await readFile(args[0], "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  else
    throw new Error(
      "用法：node scripts/probe-school-sites.mjs URL列表文件，或 --urls URL ...；不加载 .env，不调用模型或搜索。",
    );
  if (!urls.length) throw new Error("URL 列表为空。");
  const report = await probeSites(urls);
  for (const result of report.results)
    process.stdout.write(JSON.stringify(result) + "\n");
  process.stdout.write(JSON.stringify({ summary: report.summary }) + "\n");
}
