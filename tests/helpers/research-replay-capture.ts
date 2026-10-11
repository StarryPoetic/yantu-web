/** Offline only: exports public evidence, never account rows or credentials. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { redactAdmissionsText } from "../../server/explanation/research-priority-tables.ts";
import type { WebSource } from "../../server/explanation/web.ts";

export function replayPublicText(text: string) {
  // Unknown personal table layouts are removed by the production redactor.
  // Personnel/contact/footer prose is irrelevant to the admission evidence.
  return redactAdmissionsText(text)
    .split("\n")
    .filter(
      (line) =>
        !/联系人|联系电话|咨询电话|电子邮|邮箱|编辑[：:]|审核[：:]|作者[：:]|撰稿|通讯员|负责人|联系人姓名/.test(
          line,
        ),
    )
    .map((line) =>
      line
        .replace(
          /(?:姓名|考生姓名|联系人)\s*[：:]\s*[^\s，,。；;|]+/g,
          "个人信息已删除",
        )
        .replace(/(?<!\d)\d{10,18}[Xx]?(?!\d)/g, "【个人编号已删除】")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "【邮箱已删除】"),
    )
    .join("\n");
}
type Event = {
  event: string;
  n: number;
  query?: string;
  url?: string;
  code?: string;
};
type Snapshot = {
  searches: Record<
    string,
    { sources: WebSource[]; reason?: string; searchDispatched?: boolean }
  >;
  pages: Record<
    string,
    { text: string; contentType: string; finalUrl?: string }
  >;
  prefilter: { selected: { institutionName: string; domain: string }[] };
};
export function captureReplay(
  directories: string[],
  output: string,
  inventory?: string,
) {
  const pages = new Map<
    string,
    { url: string; title: string; source?: WebSource; capturedIn: string[] }
  >();
  const runs: object[] = [];
  const include = inventory
    ? new Set(
        [
          ...readFileSync(inventory, "utf8").matchAll(
            /^\| P\d+ \|[^\n]*?\]\((https?:[^)]+)\)/gm,
          ),
        ].map((m) => m[1]),
      )
    : undefined;
  const add = (s: WebSource, run: string, full = false) => {
    if (include && !include.has(s.url)) return;
    const previous = pages.get(s.url);
    const safeTitle = /联系方式|联系人|电话/.test(s.title)
      ? "官方联系方式页（个人信息省略）"
      : replayPublicText(s.title);
    const source = full
      ? {
          ...s,
          provenance: s.provenance
            ? {
                ...s.provenance,
                identityExcerpt: replayPublicText(s.provenance.identityExcerpt),
              }
            : undefined,
          title: safeTitle,
          excerpt: replayPublicText(s.excerpt),
          documentLinks: s.documentLinks?.map((l) => ({
            url: l.url,
            title: /联系方式|联系人|电话/.test(l.title)
              ? "官方联系方式"
              : replayPublicText(l.title),
          })),
        }
      : previous?.source;
    pages.set(s.url, {
      url: s.url,
      title: safeTitle,
      source,
      capturedIn: [...new Set([...(previous?.capturedIn ?? []), run])],
    });
  };
  for (const directory of directories) {
    const id = directory.replaceAll("\\", "/").split("/").at(-1)!;
    const cp: Snapshot = JSON.parse(
      readFileSync(resolve(directory, "checkpoint.json"), "utf8"),
    );
    const report = JSON.parse(
      readFileSync(resolve(directory, "report.json"), "utf8"),
    );
    const events: Event[] = readFileSync(
      resolve(directory, "events.ndjson"),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .map((s) => JSON.parse(s));
    const queries = events
      .filter((e) => e.event === "search-request")
      .map((e) => {
        const school = cp.prefilter.selected.find((s) =>
          e.query?.startsWith(s.institutionName),
        );
        const options = {
          sourcesOnly: true,
          upgradeAcademicHttp: true,
          search: { count: 10, includeDomains: [school?.domain] },
        };
        const request = {
          subjectId: "batch1-synthetic-hangzhou",
          question: e.query,
          search: true,
        };
        const key = createHash("sha256")
          .update(JSON.stringify({ request, options }))
          .digest("hex");
        const result = cp.searches[key];
        if (!result)
          throw new Error("Replay query is not joined to its saved result");
        for (const s of result.sources) add(s, id);
        return {
          n: e.n,
          query: e.query,
          domain: school?.domain,
          reason: result.reason,
          sources: result.sources
            .filter((s) => !include || include.has(s.url))
            .map((s) => ({
              ...s,
              title: /联系方式|电话/.test(s.title)
                ? "官方联系方式页"
                : replayPublicText(s.title),
              // Search summaries are discovery leads only; do not export personal snippets.
              excerpt: "检索摘要未作为正文；以保存页面为准。",
            })),
        };
      });
    for (const s of report.sources as WebSource[])
      add(s, id, s.kind === "official_page");
    const database = resolve(directory.replace(/-live[\\/]?$/, "-copy.sqlite"));
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      for (const row of db
        .prepare("SELECT payload FROM research_public_sources")
        .all()) {
        const s = JSON.parse(String(row.payload)) as WebSource;
        if (include?.has(s.url)) add(s, id + ":library", true);
      }
    } finally {
      db.close();
    }
    const reads = events
      .filter((e) => e.event === "read-request")
      .map((e) => ({
        url: e.url!,
        outcome:
          events.find(
            (v) => v.n === e.n && /read-(success|failed)/.test(v.event),
          )?.code ??
          (events.some((v) => v.n === e.n && v.event === "read-success")
            ? "success"
            : "unknown"),
      }));
    runs.push({
      id,
      queries,
      reads,
      recommendations: report.recommendations.map(
        (r: Record<string, unknown>) => ({
          institutionName: r.institutionName,
          disciplineCode: r.disciplineCode,
          majorCode: r.majorCode,
          collegeName: r.collegeName,
        }),
      ),
      historicalCoverage: report.priorityCoverage,
      metrics: JSON.parse(
        readFileSync(resolve(directory, "metrics.json"), "utf8"),
      ),
    });
  }
  for (const url of include ?? [])
    if (!pages.has(url))
      pages.set(url, { url, title: "官方入口（未保存正文）", capturedIn: [] });
  const result = {
    version: 1,
    policy:
      "saved-public-text-only; missing responses remain missing; no synthetic answers",
    pages: [...pages.values()].sort((a, b) => a.url.localeCompare(b.url)),
    runs,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  return {
    pages: pages.size,
    bodies: result.pages.filter((p) => p.source).length,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [output, inventory, ...directories] = process.argv.slice(2);
  console.log(
    captureReplay(
      directories,
      output,
      inventory === "all" ? undefined : inventory,
    ),
  );
}
