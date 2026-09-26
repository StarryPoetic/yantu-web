export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ModelReply {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}
export interface ModelAdapter {
  complete(
    messages: ModelMessage[],
    options?: ModelRequestOptions,
  ): Promise<ModelReply>;
}
export interface ModelRequestOptions {
  format?: "json" | "text";
  maxOutputTokens?: number;
  model?: "deepseek-flash" | "deepseek-v4-pro";
  thinking?: boolean;
  reasoningEffort?: "low" | "high" | "max";
  timeoutMs?: number;
}
export class ModelError extends Error {
  code: string;
  constructor(code: string) {
    super("辅助模型暂不可用。");
    this.name = "ModelError";
    this.code = code;
  }
}

export interface DeepSeekConfig {
  enabled?: boolean;
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Called by the shared budget ledger too, so reserved output equals the provider cap. */
export function resolveModelRequest(options: ModelRequestOptions = {}) {
  if (
    (options.model !== undefined &&
      !["deepseek-flash", "deepseek-v4-pro"].includes(options.model)) ||
    (options.thinking !== undefined && typeof options.thinking !== "boolean") ||
    (options.reasoningEffort !== undefined &&
      !["low", "high", "max"].includes(options.reasoningEffort)) ||
    (options.format !== undefined &&
      !["json", "text"].includes(options.format)) ||
    (options.maxOutputTokens !== undefined &&
      (!Number.isSafeInteger(options.maxOutputTokens) ||
        options.maxOutputTokens < 1 ||
        options.maxOutputTokens > 16384)) ||
    (options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > 120000))
  )
    throw new ModelError("INVALID_MODEL_OPTIONS");
  return {
    model: options.model ?? "deepseek-flash",
    thinking: options.thinking ?? false,
    reasoningEffort: options.reasoningEffort ?? "high",
    maxOutputTokens: options.maxOutputTokens ?? 800,
    timeoutMs: options.timeoutMs,
  };
}

/** Server task code chooses an allowlisted model; browser input never controls routing or tools. */
export function createDeepSeekAdapter(
  config: DeepSeekConfig = {},
): ModelAdapter {
  const endpoint =
    config.endpoint ?? "https://api.deepseek.com/chat/completions";
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.deepseek.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/chat/completions", "/v1/chat/completions"].includes(url.pathname)
  )
    throw new ModelError("UNSAFE_PROVIDER_ENDPOINT");
  const request = config.fetch ?? globalThis.fetch;
  return {
    async complete(messages, options = {}) {
      if (!config.enabled) throw new ModelError("MODEL_DISABLED");
      if (!config.apiKey) throw new ModelError("MODEL_NOT_CONFIGURED");
      const selected = resolveModelRequest(options);
      if (JSON.stringify(messages).length > (selected.thinking ? 24000 : 16000))
        throw new ModelError("EVIDENCE_TOO_LARGE");
      if (
        config.timeoutMs !== undefined &&
        (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)
      )
        throw new ModelError("INVALID_MODEL_OPTIONS");
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(
          selected.timeoutMs ?? config.timeoutMs ?? 30000,
          selected.thinking ? 120000 : 30000,
        ),
      );
      try {
        const response = await request(endpoint, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: selected.model,
            thinking: { type: selected.thinking ? "enabled" : "disabled" },
            ...(selected.thinking
              ? { reasoning_effort: selected.reasoningEffort }
              : {}),
            stream: false,
            temperature: 0,
            max_tokens: selected.maxOutputTokens,
            ...(options.format === "text"
              ? {}
              : { response_format: { type: "json_object" } }),
            messages,
          }),
        });
        if (!response.ok)
          throw new ModelError(
            response.status === 429
              ? "RATE_LIMITED"
              : response.status === 401 || response.status === 403
                ? "PROVIDER_AUTH_FAILED"
                : "PROVIDER_UNAVAILABLE",
          );
        const maxResponseBytes = selected.thinking ? 524288 : 65536;
        if (Number(response.headers.get("content-length")) > maxResponseBytes)
          throw new ModelError("RESPONSE_TOO_LARGE");
        const reader = response.body?.getReader();
        if (!reader) throw new ModelError("INVALID_RESPONSE");
        let raw = "";
        let bytes = 0;
        const decoder = new TextDecoder();
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxResponseBytes) {
            await reader.cancel();
            throw new ModelError("RESPONSE_TOO_LARGE");
          }
          raw += decoder.decode(part.value, { stream: true });
        }
        raw += decoder.decode();
        const result = JSON.parse(raw);
        const choice = result.choices?.[0];
        if (
          result.model !== selected.model ||
          result.choices?.length !== 1 ||
          choice?.finish_reason !== "stop" ||
          choice.message?.tool_calls?.length ||
          typeof choice.message?.content !== "string" ||
          !choice.message.content.trim()
        )
          throw new ModelError("INCOMPLETE_RESPONSE");
        if (
          ![result.usage?.prompt_tokens, result.usage?.completion_tokens].every(
            (value) => Number.isInteger(value) && value >= 0,
          )
        )
          throw new ModelError("UNKNOWN_USAGE");
        return {
          content: choice.message.content,
          inputTokens: result.usage.prompt_tokens,
          outputTokens: result.usage.completion_tokens,
          model: result.model,
        };
      } catch (error) {
        if (error instanceof ModelError) throw error;
        throw new ModelError(
          controller.signal.aborted ? "MODEL_TIMEOUT" : "PROVIDER_UNAVAILABLE",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
