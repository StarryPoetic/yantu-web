/** Offline comparison CLI. Uses only an existing SQLite COPY, synthetic profiles,
 * saved public pages, and fake search/model adapters. No environment/config loading. */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import type { Store } from "../../server/store.ts";
import type {
  ResearchConfig,
  ResearchReport,
} from "../../server/explanation/research.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const [root, database, output, strategy, onlyScenario] = process.argv.slice(2);
if (
  !root ||
  !database ||
  !output ||
  /(?:^|[\\/])yantu\.sqlite$/i.test(database)
)
  throw new Error(
    "Usage: node tests/helpers/research-prefilter-comparison.ts ROOT DATABASE_COPY OUTPUT before|after",
  );
const moduleAt = (path: string) =>
  import(pathToFileURL(resolve(root, path)).href);
const { createResearchReportModule } = await moduleAt(
  "server/explanation/research.ts",
);
const { createResearchEvidenceLibrary } = await moduleAt(
  "server/explanation/research-library.ts",
);
const { generateGuidance } = await moduleAt("server/disciplines/index.ts");
const { blankProfile } = await moduleAt("server/profile.ts");
const { schoolRegistry } = await moduleAt("server/schools/index.ts");
const { reportAvailability } = await moduleAt(
  "src/workspace/research-report.ts",
);
const { ModelError } = await moduleAt("server/explanation/deepseek.ts");
const db = new DatabaseSync(resolve(database), { readOnly: true });
const at = Date.parse("2026-10-11T10:00:00Z");
const sources = (
  db
    .prepare("SELECT payload FROM research_public_sources ORDER BY url")
    .all() as { payload: string }[]
).map((r) => JSON.parse(r.payload) as WebSource);
const results = [];
try {
  for (const [scenario, cities] of [
    ["杭州"],
    ["杭州", "南京", "西安"],
    ["全国"],
  ].entries()) {
    if (onlyScenario !== undefined && Number(onlyScenario) !== scenario)
      continue;
    const counts = {
      searches: 0,
      reads: 0,
      models: 0,
      inputChars: 0,
      finalInputChars: 0,
      perModel: {} as Record<
        string,
        {
          calls: number;
          estimatedInputTokens: number;
          estimatedOutputTokens: number;
        }
      >,
    };
    const library = createResearchEvidenceLibrary(
      {
        db,
        transaction() {
          throw new Error("Read-only comparison refuses migrations");
        },
      } as unknown as Store,
      { now: () => at, readOnly: true },
    );
    // Frozen library for both variants; simulated requests never mutate the copy.
    library.save = () => {};
    library.saveIncremental = async () => {};
    library.flush = async () => {};
    library.recordAttempt = () => {};
    const run = generateGuidance({
      subjectId: "offline-comparison",
      guidanceRunId: `comparison-${cities.join("-")}`,
      generatedAt: new Date(at).toISOString(),
      profile: {
        ...blankProfile(),
        major: "机械工程",
        targetMajor: "机械工程",
        studyGoal: "专业实践与行业就业",
        crossMajor: "不接受跨专业",
        budget: "1万元以内",
        cities,
      },
      profileVersion: 1,
      selectionVersion: 1,
      confirmedMajorId: "0802",
      excludedMajorIds: [],
      assessments: [],
    });
    const config: ResearchConfig = {
      enabled: true,
      apiKey: "offline-placeholder",
      searchEnabled: true,
      searchKey: "offline-placeholder",
      now: () => at,
      userDailyTokens: 1000000,
      globalDailyTokens: 2000000,
      searchDailyRequestsPerUser: 100,
      searchDailyRequestsGlobal: 500,
      adapter: {
        async complete(messages, options) {
          counts.models++;
          const size = JSON.stringify(messages).length;
          counts.inputChars += size;
          const planning = messages[0].content.includes(
            "research-direction-plan",
          );
          if (options?.thinking) counts.finalInputChars = size;
          const name = options?.model ?? "deepseek-v4-pro";
          const model = (counts.perModel[name] ??= {
            calls: 0,
            estimatedInputTokens: 0,
            estimatedOutputTokens: 0,
          });
          model.calls++;
          model.estimatedInputTokens += Math.ceil(size * 0.5);
          if (
            /research-(?:query-plan|page-extract|school-summary)-v1/.test(
              messages[0].content,
            )
          ) {
            const content = JSON.stringify({
              focus: [0, 0, 0, 0, 0],
              facts: [],
              factIds: [],
            });
            model.estimatedOutputTokens += Math.ceil(content.length * 0.5);
            return { model: name, inputTokens: 0, outputTokens: 0, content };
          }
          model.estimatedOutputTokens += 90;
          return {
            model: "deepseek-v4-pro",
            inputTokens: 0,
            outputTokens: 0,
            content: JSON.stringify(
              planning
                ? { directions: [], followUpQuestions: [] }
                : {
                    summary: "离线模拟：比较现有官网资料，未知字段仍待核验。",
                    facts: [],
                    recommendations: [],
                    limitations: ["仅验证流程，不代表真实模型解释质量。"],
                  },
            ),
          };
        },
      },
      reader: async (url) => {
        if (new URL(url).hostname === "api.search.brave.com") {
          counts.searches++;
          const query = new URL(url).searchParams.get("q") ?? "";
          const named = schoolRegistry.schools.find((s: { name: string }) =>
            query.includes(s.name),
          );
          const candidates = sources
            .filter(
              (s) =>
                !named ||
                schoolRegistry.byHost(new URL(s.url).hostname)?.name ===
                  named.name,
            )
            .map((s) => ({
              s,
              score:
                Number(/0802|机械工程/.test(s.excerpt)) * 100 +
                Number(/专业目录/.test(s.title)) * 10 +
                Number(/2026/.test(s.title)) * 3,
            }))
            .sort((a, b) => b.score - a.score || a.s.url.localeCompare(b.s.url))
            .slice(0, 10);
          return {
            contentType: "application/json",
            text: JSON.stringify({
              web: {
                results: candidates.map(({ s }) => ({
                  url: s.url,
                  title: s.title,
                  description: s.excerpt.slice(0, 500),
                })),
              },
            }),
          };
        }
        counts.reads++;
        const saved = sources.find(
          (s) =>
            s.url.replace(/^http:/, "https:") ===
              url.replace(/^http:/, "https:") || s.finalUrl === url,
        );
        if (!saved) throw new ModelError("WEB_UNAVAILABLE");
        // Plain saved text and known links stand in for a read, identically for both revisions.
        const escape = (s: string) =>
          s
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
        return {
          contentType: "text/html",
          text: `<pre>${escape(saved.excerpt)}</pre>${(saved.documentLinks ?? []).map((l) => `<a href="${escape(l.url)}">${escape(l.title)}</a>`).join("")}`,
          finalUrl: saved.finalUrl,
        };
      },
    };
    const started = performance.now();
    const report: ResearchReport = await createResearchReportModule(config, {
      library,
    }).generate({
      subjectId: run.subjectId,
      run,
      ...(strategy === "after" ? { strategy: "two-stage" } : {}),
    });
    const availability = reportAvailability(report);
    const official = report.recommendations.filter((r) =>
      r.citations.some((id) =>
        report.sources.some((s) => s.id === id && s.kind === "official_page"),
      ),
    ).length;
    const row = {
      cities,
      elapsedMs: Math.round(performance.now() - started),
      ...counts,
      status: report.status,
      reason: report.reason,
      recommendations: report.recommendations.length,
      officialRecommendations: official,
      confirmed: availability.confirmed,
      pending: availability.pending,
      confirmedRatio:
        availability.confirmed /
        (availability.confirmed + availability.pending || 1),
      selected: report.prefilter?.selected.length,
      priorityConfirmed: report.priorityCoverage?.confirmed ?? 0,
      priorityPending:
        report.priorityCoverage?.pending ?? report.recommendations.length * 15,
      schoolsWithCutoff: report.priorityCoverage?.schoolsWithCutoff ?? 0,
      categoryCoverage: report.priorityCoverage?.groups,
      paidTokens: 0,
      paidCostCny: 0,
      estimatedOffPeakModelCny: Object.entries(counts.perModel).reduce(
        (total, [name, m]) =>
          total +
          (m.estimatedInputTokens * (name === "deepseek-flash" ? 1 : 4.5) +
            m.estimatedOutputTokens * (name === "deepseek-flash" ? 4 : 13.5)) /
            1e6,
        0,
      ),
      estimatedSearchCny: counts.searches * 0.036,
    };
    results.push(row);
    writeFileSync(resolve(output), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(row));
  }
} finally {
  db.close();
}
