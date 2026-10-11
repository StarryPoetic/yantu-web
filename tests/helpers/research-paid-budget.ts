import { Buffer } from "node:buffer";
import {
  ModelError,
  resolveModelRequest,
  type ModelMessage,
  type ModelRequestOptions,
} from "../../server/explanation/deepseek.ts";

/** Acceptance harness only. Peak, uncached rates leave room below the user's ¥10 ceiling. */
export const PAID_ACCEPTANCE_LIMIT = 9.5;
const price = (model: string, input: number, output: number) =>
  (input * (model === "deepseek-flash" ? 2 : 9) +
    output * (model === "deepseek-flash" ? 8 : 27)) /
  1e6;

export function createPaidAcceptanceBudget(
  previousCny = 0,
  ceiling = PAID_ACCEPTANCE_LIMIT,
  onChange: (state: ReturnType<typeof snapshot>) => void = () => {},
) {
  if (
    !Number.isFinite(previousCny) ||
    previousCny < 0 ||
    ceiling > PAID_ACCEPTANCE_LIMIT ||
    ceiling <= previousCny
  )
    throw new ModelError("BUDGET_EXHAUSTED");
  let spent = previousCny,
    unknown = 0,
    sequence = 0;
  const pending = new Map<number, number>();
  function snapshot() {
    const reservedCny = [...pending.values()].reduce((a, b) => a + b, 0);
    return {
      spentPeakCny: spent,
      unknownReservedCny: unknown,
      reservedCny,
      conservativeCny: spent + reservedCny,
      ceilingCny: ceiling,
    };
  }
  const check = (cost: number, final: boolean) => {
    if (snapshot().conservativeCny + cost > ceiling - (final ? 0 : 1.6))
      throw new ModelError("BUDGET_EXHAUSTED");
  };
  return {
    snapshot,
    search() {
      check(0.036, false);
      spent += 0.036;
      onChange(snapshot());
    },
    reserve(messages: ModelMessage[], options?: ModelRequestOptions) {
      const request = resolveModelRequest(options);
      // UTF-8 bytes plus framing is a conservative input-token envelope, never a measured usage value.
      const bound = price(
        request.model,
        Buffer.byteLength(JSON.stringify(messages), "utf8") + 2048,
        request.maxOutputTokens,
      );
      check(bound, request.thinking);
      const id = ++sequence;
      pending.set(id, bound);
      onChange(snapshot());
      let finished = false;
      return (usage?: { inputTokens: number; outputTokens: number }) => {
        if (finished) throw new Error("Reservation already settled");
        finished = true;
        pending.delete(id);
        if (
          usage &&
          [usage.inputTokens, usage.outputTokens].every(
            (v) => Number.isSafeInteger(v) && v >= 0,
          )
        )
          spent += price(request.model, usage.inputTokens, usage.outputTokens);
        else {
          spent += bound;
          unknown += bound;
        }
        onChange(snapshot());
      };
    },
  };
}

export function acceptanceCriteria(input: {
  elapsedMs: number;
  recommendations: number;
  status: string;
  reason?: string;
  failureStage?: string;
  finalCompleted: boolean;
  groups?: Record<string, { confirmed: number; total: number }>;
}) {
  const categories = [
    "scores",
    "competition",
    "background",
    "academic",
    "employment",
  ];
  const coverage = Object.fromEntries(
    categories.map((key) => {
      const g = input.groups?.[key];
      return [key, g && g.total > 0 ? g.confirmed / g.total : 0];
    }),
  );
  const averageCoverage =
    Object.values(coverage).reduce((a, b) => a + b, 0) / 5;
  const noTechnicalInterruption =
    input.finalCompleted &&
    !input.failureStage &&
    ["completed", "partial"].includes(input.status) &&
    !/TIMEOUT|MODEL_|PROVIDER_|BUDGET_|CONCURRENCY_|INVALID_|UNKNOWN_USAGE|INCOMPLETE_RESPONSE|VERIFY_FAILED/.test(
      input.reason ?? "",
    );
  return {
    coverage,
    averageCoverage,
    noTechnicalInterruption,
    passed:
      input.recommendations >= 5 &&
      averageCoverage >= 0.6 &&
      coverage.scores >= 0.6 &&
      input.elapsedMs <= 600000 &&
      noTechnicalInterruption,
  };
}
