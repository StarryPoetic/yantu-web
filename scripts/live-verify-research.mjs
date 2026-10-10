import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Store } from "../server/store.ts";
import { schoolRegistry } from "../server/schools/index.ts";
import { createResearchEvidenceLibrary } from "../server/explanation/research-library.ts";
import { createResearchReportModule } from "../server/explanation/research.ts";
import {
  createDeepSeekAdapter,
  ModelError,
} from "../server/explanation/deepseek.ts";
import { createModelRuntime } from "../server/explanation/index.ts";
import {
  createHttpsReader,
  createWebAnswerModule,
} from "../server/explanation/web.ts";
import { dnsModeFromEnvironment } from "../server/explanation/dns.ts";
import {
  createSearchBudget,
  searchConfigFromEnvironment,
  searchRequest,
} from "../server/explanation/search.ts";
import { RESEARCH_BUDGET as B } from "../server/explanation/research-budget.ts";

// Deliberately no environment-file loading here: only the explicitly approved CLI loads it.
const usageLimit = {
  searches: B.searches,
  modelCalls: 6,
  inputCharsPerCall: B.thinkingChars,
  planningInputChars: B.normalChars,
  totalInputChars: 6 * B.thinkingChars,
  reads: B.reads,
};
export function safeFailureCode(error) {
  if (error instanceof ModelError) return error.code;
  if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 5)
    return "DATABASE_BUSY";
  if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 6)
    return "DATABASE_LOCKED";
  if (error.code === "EEXIST") return "PAID_ALREADY_STARTED";
  if (
    [
      "CITY_PROFILE_MISMATCH",
      "CONFIGURATION_MISSING",
      "LIVE_BUDGET_EXCEEDED",
    ].includes(error.message)
  )
    return error.message;
  return "LIVE_VERIFY_FAILED";
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      "confirm-paid": { type: "boolean" },
      rehearsal: { type: "boolean" },
      "dns-mode": { type: "string" },
    },
  });
  if (!values["confirm-paid"] && !values.rehearsal) {
    console.log(
      JSON.stringify({
        event: "consent-required",
        message:
          "未启动：将读取杭州画像快照、使用真实资料库和线上研究模块；付费运行必须显式传 --confirm-paid，零费用彩排传 --rehearsal。",
        upperBound: usageLimit,
      }),
    );
    return;
  }
  if (values["confirm-paid"] && values.rehearsal)
    throw new Error("MODE_CONFLICT");
  const rehearsal = !!values.rehearsal;
  const dnsMode = values["dns-mode"] ?? dnsModeFromEnvironment(process.env);
  if (!["system", "public-doh"].includes(dnsMode))
    throw new Error("INVALID_DNS_MODE");
  const directory = resolve(
    "var",
    `${rehearsal ? "rehearsal" : "live"}-verify-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await mkdir(directory, { recursive: true });
  const log = (event) => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    appendFileSync(resolve(directory, "events.ndjson"), line + "\n");
    console.log(line);
  };
  log({ event: "预计上限", rehearsal, dnsMode, upperBound: usageLimit });
  const started = Date.now();
  let store;
  const totals = {
    searches: 0,
    reads: 0,
    modelCalls: 0,
    inputChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    peakConcurrentReads: 0,
  };
  const controller = new AbortController();
  try {
    const run = JSON.parse(
      await readFile("var/research-tiered-current-run.json", "utf8"),
    );
    if (
      JSON.stringify(run.inputSnapshot.profile.cities) !==
      JSON.stringify(["杭州"])
    )
      throw new Error("CITY_PROFILE_MISMATCH");
    // Same configuration and factories as server/app.ts + server/routes/assistant.ts.
    const modelConfig = rehearsal
      ? { enabled: true, apiKey: "rehearsal-only" }
      : {
          enabled: process.env.YANTU_MODEL_ENABLED === "true",
          apiKey: process.env.DEEPSEEK_API_KEY,
        };
    const config = {
      ...modelConfig,
      dnsMode,
      userDailyTokens: Number(
        process.env.YANTU_MODEL_USER_DAILY_TOKENS ?? B.userDailyTokens,
      ),
      globalDailyTokens: Number(
        process.env.YANTU_MODEL_DAILY_TOKENS ?? B.globalDailyTokens,
      ),
    };
    const searchConfig = rehearsal
      ? {
          searchEnabled: true,
          searchProvider: "bocha",
          searchKey: "rehearsal-only",
          searchDailyRequestsPerUser: 60,
          searchDailyRequestsGlobal: 300,
        }
      : searchConfigFromEnvironment(process.env);
    const missing = [];
    if (!config.enabled) missing.push("MODEL_DISABLED");
    if (!config.apiKey) missing.push("MODEL_NOT_CONFIGURED");
    if (!searchConfig.searchEnabled) missing.push("SEARCH_DISABLED");
    if (!searchConfig.searchKey) missing.push("SEARCH_NOT_CONFIGURED");
    if (!rehearsal && searchConfig.searchProvider !== "bocha")
      missing.push("BOCHA_REQUIRED");
    if (missing.length) {
      log({ event: "configuration-missing", codes: missing });
      throw new Error("CONFIGURATION_MISSING");
    }
    const adapter = rehearsal
      ? {
          async complete(messages) {
            return {
              content: JSON.stringify(
                messages[0].content.includes("research-direction-plan")
                  ? { directions: [], followUpQuestions: [] }
                  : {
                      summary:
                        "零费用彩排：模型未提出推荐，保留服务端从真实公开证据推导的结果。",
                      facts: [],
                      recommendations: [],
                      limitations: [],
                    },
              ),
              inputTokens: 0,
              outputTokens: 0,
              model: "deepseek-v4-pro",
            };
          },
        }
      : createDeepSeekAdapter(config);
    const runtime = createModelRuntime({
      ...config,
      adapter: {
        async complete(messages, options) {
          controller.signal.throwIfAborted();
          const n = ++totals.modelCalls,
            chars = JSON.stringify(messages).length;
          if (
            n > usageLimit.modelCalls ||
            chars > (options?.thinking ? B.thinkingChars : B.normalChars)
          ) {
            controller.abort(new Error("LIVE_BUDGET_EXCEEDED"));
            throw controller.signal.reason;
          }
          totals.inputChars += chars;
          log({
            event: "model-request",
            n,
            inputChars: chars,
            simulated: rehearsal,
          });
          try {
            const reply = await adapter.complete(messages, options);
            totals.inputTokens += reply.inputTokens;
            totals.outputTokens += reply.outputTokens;
            // Private raw replies support counting every proposed recommendation, even rejected ones.
            await writeFile(
              resolve(directory, `model-reply-${n}.json`),
              JSON.stringify(reply, null, 2),
            );
            log({
              event: "model-reply",
              n,
              inputTokens: reply.inputTokens,
              outputTokens: reply.outputTokens,
              simulated: rehearsal,
            });
            return reply;
          } catch (error) {
            log({
              event: "model-failed",
              n,
              code: error.code ?? "MODEL_UNAVAILABLE",
            });
            throw error;
          }
        },
      },
    });
    const http = createHttpsReader({ dnsMode });
    const searchHost = new URL(
      searchRequest(
        searchConfig.searchProvider,
        searchConfig.searchKey,
        "verification",
      ).url,
    ).hostname;
    let activeReads = 0;
    const reader = async (url, options) => {
      controller.signal.throwIfAborted();
      const host = new URL(url).hostname;
      const isSearch = host === searchHost;
      const n = isSearch ? ++totals.searches : ++totals.reads;
      if (isSearch && n > B.searches) {
        controller.abort(new Error("LIVE_BUDGET_EXCEEDED"));
        throw controller.signal.reason;
      }
      if (!isSearch) {
        activeReads++;
        totals.peakConcurrentReads = Math.max(
          totals.peakConcurrentReads,
          activeReads,
        );
      }
      // Query/request bodies are omitted: logs cannot expose profile text or credentials.
      log({
        event: isSearch ? "search-request" : "read-request",
        n,
        host,
        simulated: isSearch && rehearsal,
      });
      try {
        const result =
          isSearch && rehearsal
            ? {
                contentType: "application/json",
                text: JSON.stringify({
                  code: 200,
                  data: { webPages: { value: [] } },
                }),
              }
            : await http(url, options);
        if (!isSearch)
          await writeFile(
            resolve(directory, `web-${n}.json`),
            JSON.stringify({ url, result }, null, 2),
          );
        log({
          event: isSearch ? "search-result" : "read-result",
          n,
          host,
          status: "success",
          redirectCount: result.redirects?.length ?? 0,
          transport: result.transport ?? new URL(url).protocol.slice(0, -1),
          decodedTextBytes: Buffer.byteLength(result.text),
          byteMeaning: "UTF-8 decoded text, not wire bytes",
        });
        return result;
      } catch (error) {
        log({
          event: isSearch ? "search-result" : "read-result",
          n,
          host,
          status: "failed",
          code: error.code ?? "WEB_UNAVAILABLE",
          tlsCode: error.tlsCode,
          redirectCount: null,
          transport: new URL(url).protocol.slice(0, -1),
          decodedTextBytes: null,
          metadataNote:
            "Reader does not return byte/redirect metadata on failure",
        });
        throw error;
      } finally {
        if (!isSearch) activeReads--;
      }
    };
    store = new Store("var/yantu.sqlite");
    const allowedHosts = process.env.YANTU_OFFICIAL_HOSTS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const publicLibrary = createResearchEvidenceLibrary(store, {
      allowedHosts,
    });
    const library = {
      ...publicLibrary,
      load(input) {
        const sources = publicLibrary.load(input);
        writeFileSync(
          resolve(directory, "library-recall.json"),
          JSON.stringify(sources, null, 2),
        );
        log({
          event: "library-recall",
          sources: sources.length,
          schools: [
            ...new Set(
              sources
                .map(
                  (source) =>
                    schoolRegistry.byHost(new URL(source.url).hostname)?.name,
                )
                .filter(Boolean),
            ),
          ],
        });
        return sources;
      },
    };
    const webConfig = {
      ...config,
      runtime,
      ...searchConfig,
      searchBudget: createSearchBudget(searchConfig),
      reader,
      ...(allowedHosts ? { allowedHosts } : {}),
    };
    const web = createWebAnswerModule(webConfig);
    const engine = createResearchReportModule(
      {
        ...webConfig,
        researchModel: process.env.YANTU_RESEARCH_MODEL ?? "deepseek-v4-pro",
        researchEffort: process.env.YANTU_RESEARCH_EFFORT ?? "high",
        researchTimeoutMs: Number(
          process.env.YANTU_RESEARCH_TIMEOUT_MS ?? 120000,
        ),
        researchMaxOutputTokens: Number(
          process.env.YANTU_RESEARCH_MAX_OUTPUT_TOKENS ?? B.finalOutputTokens,
        ),
      },
      { runtime, web, library },
    );
    if (!engine.getReadiness().ready) throw new Error("CONFIGURATION_MISSING");
    log({ event: "library-before", ...library.coverageStats() });
    if (!rehearsal) {
      // Persist an exclusive marker BEFORE any billable request; a failed run is never auto-restarted.
      const lock = await open("var/phase7-paid-run.lock", "wx");
      await lock.writeFile(
        JSON.stringify({ directory, startedAt: new Date().toISOString() }),
      );
      await lock.close();
    }
    const report = await engine.generate({
      subjectId: run.subjectId,
      run,
      signal: controller.signal,
      checkLive: () => controller.signal.throwIfAborted(),
      onProgress: (stage) => log({ event: "stage", stage }),
    });
    await writeFile(
      resolve(directory, "report.json"),
      JSON.stringify(report, null, 2),
    );
    const summary = {
      event: "result",
      rehearsal,
      elapsedMs: Date.now() - started,
      status: report.status,
      reason: report.reason,
      totals,
      usage: report.usage,
      coverage: report.coverage,
      evidenceCoverage: {
        ...library.coverageStats(),
        reused: report.evidenceCoverage?.reusedSourceCount,
        freshReads: report.evidenceCoverage?.supplementedSourceCount,
      },
    };
    await writeFile(
      resolve(directory, "summary.json"),
      JSON.stringify(summary, null, 2),
    );
    log(summary);
    if (report.status === "blocked") process.exitCode = 1;
  } catch (error) {
    // Never print arbitrary error messages/objects from a provider or configuration.
    log({
      event: "stopped",
      code: safeFailureCode(error),
      elapsedMs: Date.now() - started,
      totals,
    });
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch {
    console.error(
      "未启动：请核对 --confirm-paid / --rehearsal 与 --dns-mode system|public-doh 参数。",
    );
    process.exitCode = 1;
  }
}
