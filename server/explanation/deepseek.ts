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

/** Provider details stay here. No caller-supplied prompts, tools, URLs, or higher-cost routing. */
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
      if (JSON.stringify(messages).length > 16000)
        throw new ModelError("EVIDENCE_TOO_LARGE");
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(config.timeoutMs ?? 30000, 30000),
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
            model: "deepseek-flash",
            thinking: { type: "disabled" },
            stream: false,
            temperature: 0,
            max_tokens: Math.min(
              4096,
              Math.max(256, options.maxOutputTokens ?? 800),
            ),
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
        if (Number(response.headers.get("content-length")) > 65536)
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
          if (bytes > 65536) {
            await reader.cancel();
            throw new ModelError("RESPONSE_TOO_LARGE");
          }
          raw += decoder.decode(part.value, { stream: true });
        }
        raw += decoder.decode();
        const result = JSON.parse(raw);
        const choice = result.choices?.[0];
        if (
          result.model !== "deepseek-flash" ||
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
