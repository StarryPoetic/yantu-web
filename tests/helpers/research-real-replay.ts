import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import { schoolRegistry } from "../../server/schools/index.ts";
import {
  extractPriorityFacts,
  priorityCoverage,
  deduplicatePriorityFacts,
} from "../../server/explanation/research-priority-facts.ts";
import { collectMissingPriorityEvidence } from "../../server/explanation/research-targeted.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import {
  createSearchBudget,
  searchConfigFromEnvironment,
} from "../../server/explanation/search.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";
import type {
  WebSource,
  createWebAnswerModule,
} from "../../server/explanation/web.ts";
import type { ResearchReadAttempt } from "../../shared/research-coverage.ts";
import type { ResearchPrefilter } from "../../shared/research-prefilter.ts";
export interface ReplayFixture {
  pages: {
    url: string;
    title: string;
    source?: WebSource;
    capturedIn: string[];
  }[];
  runs: {
    id: string;
    queries: {
      query: string;
      domain: string;
      sources: WebSource[];
      reason?: string;
    }[];
    reads: { url: string; outcome: string }[];
    recommendations: {
      institutionName: string;
      disciplineCode: string;
      majorCode?: string;
      collegeName?: string;
    }[];
  }[];
}
export const realReplayFixture = () =>
  JSON.parse(
    readFileSync(
      new URL("../fixtures/research-real-replay.json", import.meta.url),
      "utf8",
    ),
  ) as ReplayFixture;
export const replayDisciplines = () =>
  getDisciplineCatalog().items.filter((d) => ["0802", "0855"].includes(d.code));
export function replayCategory(q: string) {
  return /专业目录/.test(q)
    ? "catalog"
    : /报录/.test(q)
      ? "competition"
      : /生源|双非/.test(q)
        ? "background"
        : /学科评估/.test(q)
          ? "academic"
          : /就业/.test(q)
            ? "employment"
            : /初试成绩/.test(q)
              ? "admissionScore"
              : "cutoff";
}
/** Replays saved public responses only. An unseen query is not given ideal data:
 * at most an existing same-school/category/year result is reused, labelled below.
 * Every uncaptured URL fails; it never falls through to the network. */
export async function runRealReplay(runIndex = 1) {
  const fixture = realReplayFixture(),
    run = fixture.runs[runIndex];
  const started = performance.now();
  const bodies = new Map(
    fixture.pages.filter((p) => p.source).map((p) => [p.url, p.source!]),
  );
  const attempts: ResearchReadAttempt[] = [];
  const searchBudget = createSearchBudget(
    searchConfigFromEnvironment({
      YANTU_SEARCH_USER_DAILY_REQUESTS: "60",
      YANTU_SEARCH_DAILY_REQUESTS: "300",
    }),
  );
  const counts = {
    searches: 0,
    matchedQueries: 0,
    equivalentQueries: 0,
    uncapturedQueries: 0,
    deniedSearches: 0,
    reads: 0,
    success: 0,
    uncapturedReads: 0,
    failures: {} as Record<string, number>,
  };
  const allQueries = fixture.runs.flatMap((r) => r.queries);
  const selected = run.recommendations.map((r) => {
    const school = schoolRegistry.schools.find(
      (s) => s.name === r.institutionName,
    )!;
    return {
      institutionName: school.name,
      domain: school.registrableDomain,
      key: school.registrableDomain,
      city: school.city,
      score: 0,
      scores: [],
      excludedReasons: [],
    };
  }) as ResearchPrefilter["selected"];
  // All previously discovered leads are available to the backlog pass. Bodies are
  // only supplied when the scheduler actually reads their URL.
  const sources: WebSource[] = fixture.pages.map((p) => ({
    id: p.url,
    url: p.url,
    title: p.title,
    excerpt: "已保存检索/附件线索；正文尚未读取。",
    kind: "search_snippet",
    retrievedAt: "2026-10-12T00:00:00Z",
    verified: false,
  }));
  const web = {
    async answer(request: { question: string }) {
      if (!searchBudget.claim("replay", "2026-10-12")) {
        counts.deniedSearches++;
        return { sources: [], reason: "SEARCH_BUDGET_EXHAUSTED" };
      }
      counts.searches++;
      const exact = allQueries.find((q) => q.query === request.question);
      const school = selected.find((s) =>
        request.question.startsWith(s.institutionName),
      );
      const year = request.question.match(/20\d{2}年/)?.[0];
      const equivalent = allQueries.find(
        (q) =>
          q.domain === school?.domain &&
          replayCategory(q.query) === replayCategory(request.question) &&
          q.query.match(/20\d{2}年/)?.[0] === year &&
          q.query.match(/\b\d{6}\b/)?.[0] ===
            request.question.match(/\b\d{6}\b/)?.[0],
      );
      const recorded = exact ?? equivalent;
      if (exact) counts.matchedQueries++;
      else if (equivalent) counts.equivalentQueries++;
      else counts.uncapturedQueries++;
      return {
        sources: structuredClone(recorded?.sources ?? []),
        reason: recorded?.reason,
        searched: true,
        status: "sources_only",
        answer: "离线保存响应",
        points: [],
      };
    },
  } as unknown as ReturnType<typeof createWebAnswerModule>;
  const result = await collectMissingPriorityEvidence({
    subjectId: "replay",
    selected,
    disciplines: replayDisciplines(),
    priorityPrograms: run.recommendations,
    sources,
    targetYear: "2027",
    maxRequests: B.searches,
    maxReads: B.reads,
    web,
    attempts,
    onProgress: async () => {},
    onAttempt: (a) => attempts.push(a),
    now: () => Date.parse("2026-10-12T00:00:00Z"),
    readPage: async (url) => {
      counts.reads++;
      const failure = [...run.reads]
        .reverse()
        .find((r) => r.url === url && r.outcome !== "success");
      if (failure) {
        counts.failures[failure.outcome] =
          (counts.failures[failure.outcome] ?? 0) + 1;
        throw Object.assign(new Error("Saved failure"), {
          code: failure.outcome,
        });
      }
      const source = bodies.get(url);
      if (!source) {
        counts.uncapturedReads++;
        throw new ModelError("WEB_UNAVAILABLE");
      }
      counts.success++;
      const escape = (s: string) =>
        s
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll('"', "&quot;");
      return {
        contentType: "text/html",
        text:
          `<pre>${escape(source.excerpt)}</pre>` +
          (source.documentLinks ?? [])
            .map((l) => `<a href="${escape(l.url)}">${escape(l.title)}</a>`)
            .join(""),
        finalUrl: source.finalUrl,
      };
    },
  });
  const facts = deduplicatePriorityFacts(
    result.sources.flatMap((s) =>
      extractPriorityFacts(s, replayDisciplines(), "2027", {
        total: 350,
        maximum: 500,
      }),
    ),
  );
  // Separate extractor recall on all captured originals from acquisition recall.
  const availableFacts = deduplicatePriorityFacts(
    [...bodies.values()].flatMap((s) =>
      extractPriorityFacts(s, replayDisciplines(), "2027", {
        total: 350,
        maximum: 500,
      }),
    ),
  );
  const coverage = priorityCoverage(facts, run.recommendations, "2027");
  return {
    elapsedMs: Math.round(performance.now() - started),
    ...counts,
    pages: fixture.pages.length,
    capturedBodies: bodies.size,
    recommendations: run.recommendations.length,
    acceptedFacts: facts.length,
    readAttempts: attempts,
    boundPageDiagnostics: result.sources
      .filter((s) => /bb749fd9|b961454b|7eb59126/.test(s.url))
      .map((s) => ({ url: s.url, kind: s.kind, provenance: !!s.provenance })),
    availableFacts: availableFacts.length,
    coverage,
    availableCoverage: priorityCoverage(
      availableFacts,
      run.recommendations,
      "2027",
    ),
    missing: coverage.schools.map((r) => ({
      school: r.schoolName,
      fields: r.pending,
      years: r.missingScoreYears,
    })),
    facts,
    paidCalls: 0,
    estimatedCostCny: 0,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const results = await Promise.all([runRealReplay(0), runRealReplay(1)]);
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ facts, ...r }) => r)));
}
