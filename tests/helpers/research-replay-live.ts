/** Explicit one-shot acceptance runner. Importing this file never loads credentials or starts work. */
import {
  openSync,
  closeSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../../server/store.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import {
  createResearchReportModule,
  type ResearchConfig,
  type ResearchReport,
} from "../../server/explanation/research.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import {
  createDeepSeekAdapter,
  ModelError,
} from "../../server/explanation/deepseek.ts";
import { createHttpsReader } from "../../server/explanation/web.ts";
import {
  searchConfigFromEnvironment,
  searchRequest,
} from "../../server/explanation/search.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import {
  priorityCoverage,
  validatePriorityFacts,
} from "../../server/explanation/research-priority-facts.ts";
import { execFileSync } from "node:child_process";
import { reportAvailability } from "../../src/workspace/research-report.ts";

export function replayAcceptanceCriteria(input: {
  elapsedMs: number;
  recommendations: number;
  status: string;
  reason?: string;
  failureStage?: string;
  finalCompleted: boolean;
  partialAverage?: number;
  confirmedCutoff?: number;
  confirmedAssessment?: number;
}) {
  const noTechnicalInterruption =
    input.finalCompleted &&
    !input.failureStage &&
    ["completed", "partial"].includes(input.status) &&
    !/TIMEOUT|MODEL_|PROVIDER_|BUDGET_|CONCURRENCY_|INVALID_|UNKNOWN_USAGE|INCOMPLETE_RESPONSE|VERIFY_FAILED/.test(
      input.reason ?? "",
    );
  return {
    noTechnicalInterruption,
    passed:
      input.recommendations >= 5 &&
      (input.partialAverage ?? 0) >= 0.6 &&
      (input.confirmedCutoff ?? 0) >= 0.6 &&
      (input.confirmedAssessment ?? 0) >= 0.6 &&
      input.elapsedMs <= 600000 &&
      noTechnicalInterruption,
  };
}
export interface ProviderUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  unknownCalls: number;
}
/** 2026-10-11 official price card, no cache discount assumed; peak is twice off-peak. */
export function researchCostEstimate(
  models: Record<string, ProviderUsage>,
  searches: number,
) {
  const byModel = Object.fromEntries(
    Object.entries(models).map(([name, m]) => [
      name,
      (m.inputTokens * (name === "deepseek-flash" ? 1 : 4.5) +
        m.outputTokens * (name === "deepseek-flash" ? 4 : 13.5)) /
        1e6,
    ]),
  );
  const knownModelCny = Object.values(byModel).reduce((a, b) => a + b, 0);
  return {
    byModelOffPeakCny: byModel,
    knownModelOffPeakCny: knownModelCny,
    knownModelPeakCny: knownModelCny * 2,
    searchEstimateCny: searches * 0.036,
    knownTotalOffPeakCny: knownModelCny + searches * 0.036,
    unknownModelCalls: Object.values(models).reduce(
      (n, m) => n + m.unknownCalls,
      0,
    ),
    billingNote:
      "按2026-10-11验证记录目录价估算（非实时账单），未减缓存优惠；无usage的请求计费未知，不等于0。",
  };
}
export function acquireBatchPaidLock(path: string) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        startedAt: new Date().toISOString(),
        policy: "one-run-no-relaunch",
      }),
    );
  } finally {
    closeSync(fd);
  }
}
type ProgressSnapshot = {
  recommendations: number;
  priorityCoverage?: ReturnType<typeof priorityCoverage>;
};
export function replayHasProgress(
  current: ProgressSnapshot,
  previous: ProgressSnapshot[],
) {
  const dimensions = (m: ProgressSnapshot) => [
    m.recommendations,
    m.priorityCoverage?.combined.partialAverage ?? 0,
    m.priorityCoverage?.confirmedCutoff.ratio ?? 0,
    m.priorityCoverage?.confirmedAssessment.ratio ?? 0,
  ];
  const before = previous.map(dimensions);
  return dimensions(current).some(
    (value, i) =>
      value > Math.max(i === 0 ? 3 : 0, ...before.map((row) => row[i])),
  );
}
/** Old extraction false positives must not become a fabricated progress ceiling. */
export function replayVerifiedCoverage(report: ResearchReport) {
  const disciplines = getDisciplineCatalog().items.filter((d) =>
    ["0802", "0855"].includes(d.code),
  );
  const facts = report.sources.flatMap((source) =>
    validatePriorityFacts(
      (report.priorityFacts ?? []).filter((f) => f.sourceId === source.id),
      source,
      disciplines,
      "2027",
    ),
  );
  return priorityCoverage(facts, report.recommendations, "2027");
}
export async function runBatchLive(args: string[]) {
  if (
    args.length !== 2 ||
    args[0] !== "--confirm-paid" ||
    !/^[1-9]\d?$/.test(args[1])
  )
    return { status: "not-started" };
  const index = Number(args[1]);
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  if (git("status", "--porcelain"))
    throw new Error("Commit checked changes first");
  const gitHead = git("rev-parse", "HEAD");
  const prefix = `var/v3a6-run${index}`;
  const previous = Array.from({ length: index - 1 }, (_, i) => {
    const directory = `var/v3a6-run${i + 1}-live`;
    const metrics = JSON.parse(
      readFileSync(`${directory}/metrics.json`, "utf8"),
    );
    if (existsSync(`${directory}/report.json`))
      metrics.priorityCoverage = replayVerifiedCoverage(
        JSON.parse(readFileSync(`${directory}/report.json`, "utf8")),
      );
    return metrics;
  });
  previous.forEach((m, i) => {
    m.progress = replayHasProgress(m, previous.slice(0, i));
  });
  if (previous.some((m) => m.acceptance?.passed))
    throw new Error("Already accepted");
  if (
    previous.length &&
    !git(
      "diff",
      "--name-only",
      previous.at(-1).gitHead,
      "HEAD",
      "--",
      "server/explanation",
      "shared",
    )
  )
    throw new Error(
      "Offline production repair required before another paid run",
    );
  if (previous.length >= 3 && previous.slice(-3).every((m) => !m.progress))
    throw new Error("Three runs without progress");
  mkdirSync("var", { recursive: true });
  acquireBatchPaidLock(resolve(prefix + "-paid-run.lock"));
  const directory = resolve(prefix + "-live");
  mkdirSync(directory, { recursive: true });
  const log = (event: object) => {
    appendFileSync(
      resolve(directory, "events.ndjson"),
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    );
  };
  const started = Date.now();
  const models: Record<string, ProviderUsage> = {};
  let finalCompleted = false;
  let searches = 0,
    reads = 0,
    successes = 0,
    modelCalls = 0;
  let store: Store | undefined,
    report: ResearchReport | undefined,
    failure: string | undefined;
  try {
    const { backupDatabase } = (await import(
      new URL("../../scripts/backup-database.mjs", import.meta.url).href
    )) as {
      backupDatabase: (source: string, destination: string) => Promise<unknown>;
    };
    await backupDatabase("var/yantu.sqlite", prefix + "-copy.sqlite");
    store = new Store(prefix + "-copy.sqlite");
    // The authorised CLI alone loads .env. Values are never printed or persisted.
    const config: ResearchConfig = {
      enabled: process.env.YANTU_MODEL_ENABLED === "true",
      apiKey: process.env.DEEPSEEK_API_KEY,
      dnsMode: "public-doh",
      ...searchConfigFromEnvironment(process.env),
      userDailyTokens: Number(
        process.env.YANTU_MODEL_USER_DAILY_TOKENS ?? B.userDailyTokens,
      ),
      globalDailyTokens: Number(
        process.env.YANTU_MODEL_DAILY_TOKENS ?? B.globalDailyTokens,
      ),
      researchModel: "deepseek-v4-pro",
      researchEffort: "high",
      researchUseFlash: true,
      researchTimeoutMs: B.thinkingTimeoutMs,
      researchTotalTimeoutMs: B.defaultResearchTotalTimeoutMs,
    };
    const adapter = createDeepSeekAdapter(config);
    const http = createHttpsReader({ dnsMode: "public-doh" });
    const searchHost = new URL(
      searchRequest(
        config.searchProvider!,
        config.searchKey ?? "",
        "verification",
      ).url,
    ).hostname;
    config.adapter = {
      async complete(messages, options) {
        if (++modelCalls > B.collectionPages + B.collectionSummaryCalls + 8)
          throw new ModelError("BUDGET_EXHAUSTED");
        const name = options?.model ?? "deepseek-flash";
        const usage = (models[name] ??= {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          unknownCalls: 0,
        });
        usage.calls++;
        log({
          event: "model-request",
          model: name,
          thinking: !!options?.thinking,
          inputChars: JSON.stringify(messages).length,
        });
        try {
          const reply = await adapter.complete(messages, options);
          if (options?.thinking) finalCompleted = true;
          usage.inputTokens += reply.inputTokens;
          usage.outputTokens += reply.outputTokens;
          log({
            event: "model-usage",
            model: name,
            inputTokens: reply.inputTokens,
            outputTokens: reply.outputTokens,
          });
          return reply;
        } catch (error) {
          usage.unknownCalls++;
          log({
            event: "model-failed",
            model: name,
            code:
              error instanceof ModelError ? error.code : "PROVIDER_UNAVAILABLE",
          });
          throw error;
        }
      },
    };
    config.reader = async (url, options) => {
      const search = new URL(url).hostname === searchHost;
      if (search ? searches >= B.searches : reads >= B.reads)
        throw new ModelError("WEB_BUDGET_EXHAUSTED");
      if (search) {
        searches++;
      } else reads++;
      log({
        event: search ? "search-request" : "read-request",
        n: search ? searches : reads,
        host: new URL(url).hostname,
        ...(search
          ? {
              query: options.body
                ? JSON.parse(options.body).query
                : new URL(url).searchParams.get("q"),
            }
          : { url }),
      });
      const requestNumber = search ? searches : reads;
      try {
        const response = await http(url, options);
        if (!search) successes++;
        log({
          event: search ? "search-success" : "read-success",
          n: requestNumber,
        });
        return response;
      } catch (error) {
        log({
          event: search ? "search-failed" : "read-failed",
          n: requestNumber,
          code: error instanceof ModelError ? error.code : "WEB_UNAVAILABLE",
        });
        throw error;
      }
    };
    const run = generateGuidance({
      subjectId: "batch1-synthetic-hangzhou",
      guidanceRunId: "batch1-synthetic-hangzhou",
      generatedAt: new Date().toISOString(),
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
    const engine = createResearchReportModule(config, {
      library: createResearchEvidenceLibrary(store),
    });
    if (!engine.getReadiness().ready)
      throw new ModelError("CONFIGURATION_MISSING");
    report = await engine.generate({
      subjectId: run.subjectId,
      run,
      strategy: "two-stage",
      targetScore: { total: 350, maximum: 500 },
      onCheckpoint: (checkpoint) => {
        writeFileSync(
          resolve(directory, "checkpoint.json"),
          JSON.stringify(checkpoint),
        );
      },
      onProgress: (stage, detail) => {
        log({ event: "stage", stage, detail });
      },
    });
    store.put(run.subjectId, "batch1-research-report", "current", report);
    writeFileSync(
      resolve(directory, "report.json"),
      JSON.stringify(report, null, 2),
    );
  } catch (error) {
    failure = error instanceof ModelError ? error.code : "VERIFY_FAILED";
    log({ event: "failed", code: failure });
  } finally {
    store?.close();
  }
  const availability = report ? reportAvailability(report) : undefined;
  const priorities = report
    ? priorityCoverage(
        report.priorityFacts ?? [],
        report.recommendations,
        "2027",
      )
    : undefined;
  const metrics = {
    elapsedMs: Date.now() - started,
    status: report?.status ?? "failed",
    reason: failure ?? report?.reason,
    failureStage: report?.failureStage,
    searches,
    reads,
    successfulReads: successes,
    failedReads: reads - successes,
    models,
    costs: researchCostEstimate(models, searches),
    gitHead,
    progress: replayHasProgress(
      {
        recommendations: new Set(
          report?.recommendations.map((r) => r.institutionName),
        ).size,
        priorityCoverage: priorities,
      },
      previous,
    ),
    acceptance: replayAcceptanceCriteria({
      elapsedMs: Date.now() - started,
      recommendations: new Set(
        report?.recommendations.map((r) => r.institutionName),
      ).size,
      status: report?.status ?? "failed",
      reason: failure ?? report?.reason,
      failureStage: report?.failureStage,
      finalCompleted,
      partialAverage: priorities?.combined.partialAverage,
      confirmedCutoff: priorities?.confirmedCutoff.ratio,
      confirmedAssessment: priorities?.confirmedAssessment.ratio,
    }),
    recommendations: report?.recommendations.length ?? 0,
    confirmed: availability?.confirmed ?? 0,
    pending: availability?.pending ?? 0,
    priorityCoverage: priorities,
    stillNeedsSupplement:
      !report || report.status !== "completed" || !!priorities?.pending,
    limitations: report?.limitations ?? [],
  };
  writeFileSync(
    resolve(directory, "metrics.json"),
    JSON.stringify(metrics, null, 2),
  );
  return metrics;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runBatchLive(process.argv.slice(2))
    .then((value) => console.log(JSON.stringify(value)))
    .catch(() => {
      console.log(
        JSON.stringify({
          status: "not-started",
          reason: "PAID_RUN_ALREADY_STARTED_OR_LOCK_FAILED",
        }),
      );
      process.exitCode = 1;
    });
}
