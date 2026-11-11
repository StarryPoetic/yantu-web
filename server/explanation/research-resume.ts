import { ModelError } from "./deepseek.ts";
import type { ModelRuntime } from "./index.ts";
import type { WebAnswerResult, WebReadResult } from "./web.ts";
import type { ResearchReport } from "./research.ts";
import type { ResearchPrefilter } from "../../shared/research-prefilter.ts";
import type { ResearchSchoolPolicy } from "../../shared/research-policy.ts";
import type { ResearchSupplementState } from "./research-supplement-plan.ts";

/** Owned job data, never a cross-account cache or part of the public job response. */
export interface ResearchCheckpoint {
  version: 1;
  contextHash: string;
  schoolPolicy?: ResearchSchoolPolicy;
  models: Record<string, unknown>;
  searches: Record<string, WebAnswerResult>;
  pages: Record<string, WebReadResult>;
  report?: ResearchReport;
  evidenceReady?: boolean;
  prefilter?: ResearchPrefilter;
  operationMode?: "generate" | "supplement";
  supplement?: ResearchSupplementState;
}

/** A deadline also bounds adapters which ignore cancellation. Late results cannot be saved. */
export function researchDeadline(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const until = Date.now() + timeoutMs;
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new ModelError("RESEARCH_TOTAL_TIMEOUT")),
    timeoutMs,
  );
  const check = () => {
    if (Date.now() >= until && !controller.signal.aborted)
      controller.abort(new ModelError("RESEARCH_TOTAL_TIMEOUT"));
    controller.signal.throwIfAborted();
  };
  return {
    signal: controller.signal,
    check,
    remaining: () => Math.max(1, until - Date.now()),
    async wait<T>(promise: Promise<T>): Promise<T> {
      // The caller evaluates the operation before entering wait. An already
      // expired deadline must still observe its rejection (e.g. collector.check).
      void promise.catch(() => {});
      check();
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        promise
          .then(resolve, reject)
          .finally(() =>
            controller.signal.removeEventListener("abort", onAbort),
          );
      });
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export function resumedRuntime(
  runtime: ModelRuntime,
  saved: ResearchCheckpoint,
  keyHash: (key: unknown) => string,
  check: () => void,
  persist: () => Promise<void>,
): ModelRuntime {
  return {
    clearSubject: runtime.clearSubject,
    async run(subject, key, messages, validate, options) {
      check();
      const fingerprint = keyHash({ key, messages });
      if (Object.hasOwn(saved.models, fingerprint))
        return {
          value: structuredClone(saved.models[fingerprint]) as ReturnType<
            typeof validate
          >,
          cached: true,
        };
      const result = await runtime.run(
        subject,
        key,
        messages,
        validate,
        options,
      );
      check();
      saved.models[fingerprint] = structuredClone(result.value);
      await persist();
      return result;
    },
  };
}
