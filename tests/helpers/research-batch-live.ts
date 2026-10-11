/** Explicit one-shot acceptance runner. Importing this file never loads credentials or starts work. */
import {
  openSync,
  closeSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../../server/store.ts";
import { generateGuidance } from "../../server/disciplines/index.ts";
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
import { priorityCoverage } from "../../server/explanation/research-priority-facts.ts";
import { reportAvailability } from "../../src/workspace/research-report.ts";

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
      "按公开目录价估算，未减缓存优惠；无usage的请求计费未知，不等于0。",
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
export async function runBatchLive(args: string[]) {
  if (args.length !== 1 || args[0] !== "--confirm-paid")
    return { status: "not-started" };
  mkdirSync("var", { recursive: true });
  acquireBatchPaidLock(resolve("var/batch1-paid-run.lock"));
  const directory = resolve("var/batch1-live");
  mkdirSync(directory, { recursive: true });
  const log = (event: object) => {
    appendFileSync(
      resolve(directory, "events.ndjson"),
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    );
  };
  const started = Date.now();
  const models: Record<string, ProviderUsage> = {};
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
    await backupDatabase("var/yantu.sqlite", "var/batch1-live-copy.sqlite");
    store = new Store("var/batch1-live-copy.sqlite");
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
      if (search) searches++;
      else reads++;
      log({
        event: search ? "search-request" : "read-request",
        n: search ? searches : reads,
        host: new URL(url).hostname,
      });
      const response = await http(url, options);
      if (!search) successes++;
      return response;
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
    models,
    costs: researchCostEstimate(models, searches),
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
