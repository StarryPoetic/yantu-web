import { realReplayFixture } from "./research-real-replay.ts";
import { createResearchReportModule } from "../../server/explanation/research.ts";
import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import { extractProgramFacts } from "../../server/explanation/research-facts.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";
import { schoolRegistry } from "../../server/schools/index.ts";
import { setImmediate } from "node:timers/promises";

/** Complete report path. The model contributes no invented admission facts. */
export async function runRealReportReplay(fixture = realReplayFixture()) {
  const sources = fixture.pages.flatMap((p) => (p.source ? [p.source] : []));
  const facts = sources.flatMap((s) =>
    extractProgramFacts(s, [s], "2026-10-12T00:00:00Z"),
  );
  let finalCalls = 0,
    reads = 0,
    searches = 0,
    activeSearches = 0,
    peakSearches = 0;
  let finalDirections: string[] = [];
  const searchQueries: string[] = [];
  const run = generateGuidance({
    subjectId: "batch1-synthetic-hangzhou",
    guidanceRunId: "real-replay",
    generatedAt: "2026-10-12T00:00:00Z",
    profile: {
      ...blankProfile(),
      university: "合成本科院校",
      major: "机械工程",
      targetMajor: "机械工程",
      cities: ["杭州"],
      budget: "1万元以内",
      crossMajor: "不接受跨专业",
      studyGoal: "专业实践与行业就业",
      year: "2027",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "0802",
    excludedMajorIds: [],
    assessments: [],
  });
  const report = await createResearchReportModule(
    {
      enabled: true,
      apiKey: "offline",
      searchEnabled: true,
      searchProvider: "bocha",
      searchKey: "offline",
      userDailyTokens: B.userDailyTokens,
      globalDailyTokens: B.globalDailyTokens,
      now: () => Date.parse(run.generatedAt),
      adapter: {
        async complete(_messages, options) {
          if (options?.thinking) {
            finalCalls++;
            finalDirections = JSON.parse(_messages[1].content).directions.map(
              (d: { code: string }) => d.code,
            );
          }
          return {
            model: options?.model ?? "deepseek-flash",
            inputTokens: 0,
            outputTokens: 0,
            content: JSON.stringify(
              options?.thinking
                ? {
                    summary: "离线真实响应回放，未提供模型招生事实。",
                    facts: [],
                    recommendations: [],
                    limitations: [],
                  }
                : { focus: [0, 0, 0, 0, 0], facts: [], factIds: [] },
            ),
          };
        },
      },
      reader: async (url, options) => {
        if (new URL(url).hostname === "api.bocha.cn") {
          searches++;
          activeSearches++;
          peakSearches = Math.max(peakSearches, activeSearches);
          await setImmediate();
          activeSearches--;
          const q = JSON.parse(options.body ?? "{}").query ?? "";
          searchQueries.push(q);
          const saved = fixture.runs
            .flatMap((r) => r.queries)
            .find((r) => r.query === q);
          return {
            contentType: "application/json",
            text: JSON.stringify({
              code: 200,
              data: {
                webPages: {
                  value: (saved?.sources ?? []).map((s) => ({
                    url: s.url,
                    name: s.title,
                    snippet: s.excerpt,
                  })),
                },
              },
            }),
          };
        }
        reads++;
        const s = sources.find((s) => s.url === url);
        if (!s) throw new ModelError("WEB_UNAVAILABLE");
        return { contentType: "text/plain", text: s.excerpt };
      },
    },
    {
      library: {
        load: () => structuredClone(sources),
        queryFacts: () => facts,
        coverageStats: () => ({
          librarySchoolCount: new Set(
            sources
              .map((s) => schoolRegistry.byHost(new URL(s.url).hostname)?.name)
              .filter(Boolean),
          ).size,
          libraryProgramCount: facts.filter((f) => f.field === "catalog")
            .length,
        }),
        isFresh: (url) => sources.some((s) => s.url === url),
        save: () => {},
        saveIncremental: async () => {},
        flush: async () => {},
        recordAttempt: () => {},
        attempts: () => [],
      },
    },
  ).generate({
    subjectId: run.subjectId,
    run,
    strategy: "two-stage",
    targetScore: { total: 350, maximum: 500 },
  });
  return {
    report,
    finalCalls,
    reads,
    searches,
    peakSearches,
    finalDirections,
    searchQueries,
  };
}
