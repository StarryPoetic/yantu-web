import { open, stat } from "node:fs/promises";
import { ModelError } from "../server/explanation/deepseek.ts";

export const completionLimit = {
  searches: 0,
  modelCalls: 2,
  inputCharsPerCall: 40000,
  planningInputChars: 16000,
  priorKnownTokens: 3918,
  combinedTokens: 50000,
  reads: 60,
};

export async function assertCompletionNotStarted(path) {
  try {
    await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new ModelError("MODEL_COMPLETION_ALREADY_STARTED");
}

export async function acquireCompletionLock(path, directory) {
  let lock;
  try {
    lock = await open(path, "wx");
    await lock.writeFile(
      JSON.stringify({ directory, startedAt: new Date().toISOString() }),
    );
  } catch (error) {
    if (error.code === "EEXIST")
      throw new ModelError("MODEL_COMPLETION_ALREADY_STARTED");
    throw error;
  } finally {
    await lock?.close();
  }
}

// Keep the shared runtime's reservations unchanged. For this approved completion,
// estimate provider input from actual planning usage without starving thinking output.
export function createCompletionModelGuard(
  adapter,
  { lock, log = () => {} } = {},
) {
  const phases = new Set();
  let usedTokens = completionLimit.priorKnownTokens;
  let measuredRatio;
  let failed = false;
  return {
    async complete(messages, options = {}) {
      const phase = messages[0]?.content.includes("research-direction-plan")
        ? "planning"
        : "final";
      const chars = JSON.stringify(messages).length;
      if (failed || phases.has(phase) || phases.size >= 2) {
        log({
          event: "model-blocked",
          phase,
          code: "BUDGET_EXHAUSTED",
          inputChars: chars,
        });
        throw new ModelError("BUDGET_EXHAUSTED");
      }
      if (chars > (phase === "planning" ? 16000 : 40000))
        throw new ModelError("EVIDENCE_TOO_LARGE");
      const estimatedTokenRatio =
        measuredRatio === undefined
          ? 0.5
          : Math.min(1, Math.max(measuredRatio * 1.5, 0.35));
      const estimatedInputTokens = Math.ceil(chars * estimatedTokenRatio);
      const maxOutputTokens = Math.min(
        options.maxOutputTokens ?? (phase === "planning" ? 4096 : 16384),
        completionLimit.combinedTokens - usedTokens - estimatedInputTokens,
      );
      log({
        event: "model-budget",
        phase,
        inputChars: chars,
        estimatedTokenRatio,
        estimatedInputTokens,
        maxOutputTokens,
        priorKnownTokens: usedTokens,
      });
      if (maxOutputTokens < (phase === "final" ? 12000 : 1))
        throw new ModelError("BUDGET_EXHAUSTED");
      if (!phases.size) await lock?.();
      phases.add(phase);
      try {
        const reply = await adapter.complete(messages, {
          ...options,
          maxOutputTokens,
        });
        usedTokens += reply.inputTokens + reply.outputTokens;
        if (phase === "planning" && reply.inputTokens > 0)
          measuredRatio = reply.inputTokens / chars;
        log({
          event: "model-budget-usage",
          phase,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          combinedKnownTokens: usedTokens,
        });
        return reply;
      } catch (error) {
        // Any failed provider request ends this paid attempt; no repair/retry
        // can accidentally consume the other phase's allowance.
        failed = true;
        throw error;
      }
    },
  };
}

/** A search-service host never reaches HTTP in completion or rehearsal mode. */
export function createSearchProtectedReader({
  http,
  searchHost,
  sources,
  searchResults,
}) {
  const normalize = (host) => host.toLowerCase().replace(/\.$/, "");
  return async (url, options) => {
    if (normalize(new URL(url).hostname) === normalize(searchHost)) {
      return {
        contentType: "application/json",
        text: JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: searchResults(
                sources(),
                JSON.parse(options?.body ?? "{}"),
              ),
            },
          },
        }),
      };
    }
    return http(url, options);
  };
}
