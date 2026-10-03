import {
  ModelError,
  type ModelMessage,
  type ModelRequestOptions,
} from "./deepseek.ts";
import type { ModelRuntime } from "./index.ts";

const repairable = new Set([
  "INVALID_RESEARCH_REPORT",
  "INVALID_RESEARCH_PLAN",
  "INVALID_RESEARCH_CITATION",
  "RESEARCH_DIRECTION_NOT_ALLOWED",
  "UNGROUNDED_PROFILE_FIT",
  "INSUFFICIENT_PROFILE_FIT",
  "UNGROUNDED_RESEARCH_FACT",
  "UNGROUNDED_RESEARCH_RECOMMENDATION",
  "UNSUPPORTED_RESEARCH_CLAIM",
]);

/** One structural repair and one confirmed temporary HTTP retry share the same ledger and cancellation checks. */
export async function generateResearchValue<T>(input: {
  runtime: ModelRuntime;
  subjectId: string;
  key: Record<string, unknown>;
  messages: ModelMessage[];
  validate: (raw: string) => T;
  options: ModelRequestOptions;
  beforeRepair: () => Promise<void>;
  beforeRetry?: () => Promise<void>;
}): Promise<{ value: T; cached: boolean }> {
  let retried = false;
  const run = async (
    key: Record<string, unknown>,
    messages: ModelMessage[],
    validate: (raw: string) => T,
  ) => {
    try {
      return await input.runtime.run(
        input.subjectId,
        key,
        messages,
        validate,
        input.options,
      );
    } catch (error) {
      if (
        !(error instanceof ModelError) ||
        error.code !== "PROVIDER_TEMPORARY_UNAVAILABLE" ||
        retried
      )
        throw error;
      retried = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      // Re-check the live session/profile after the backoff, before reserving tokens again.
      await (input.beforeRetry ?? input.beforeRepair)();
      return input.runtime.run(
        input.subjectId,
        { ...key, retry: 1 },
        messages,
        validate,
        input.options,
      );
    }
  };
  let rejectedReply = "";
  let failure: ModelError;
  try {
    return await run(input.key, input.messages, (raw) => {
      try {
        return input.validate(raw);
      } catch (error) {
        rejectedReply = raw;
        throw error;
      }
    });
  } catch (error) {
    if (
      !(error instanceof ModelError) ||
      !repairable.has(error.code) ||
      !rejectedReply
    )
      throw error;
    failure = error;
  }
  // Error metadata comes from our validators. Do not echo arbitrary model text as instructions.
  const issues =
    "issues" in failure && Array.isArray(failure.issues)
      ? JSON.stringify(failure.issues).slice(0, 1400)
      : failure.code;
  const instruction: ModelMessage = {
    role: "user",
    content: `上一份结构化结果未通过系统校验。请根据原始画像、目录与证据重新输出完整JSON，仅修正错误，不新增未经引用的学校事实。校验反馈：${issues}。引用的画像数值必须与原值相同；没有目标学校或专业是正常探索需求，请主动规划，不要要求用户先选出答案。`,
  };
  const limit = input.options.thinking ? 24000 : 16000;
  const context = [...input.messages, instruction];
  const withReply: ModelMessage[] = [
    ...input.messages,
    { role: "assistant", content: rejectedReply },
    instruction,
  ];
  // Near the context limit, regenerate from the original evidence rather than truncate JSON or sources.
  const messages =
    JSON.stringify(withReply).length <= limit ? withReply : context;
  if (JSON.stringify(messages).length > limit) throw failure;
  await input.beforeRepair();
  return run(
    { ...input.key, repair: 1, validation: failure.code },
    messages,
    input.validate,
  );
}
