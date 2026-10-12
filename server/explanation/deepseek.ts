import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { createDeepSeekTransport } from "./deepseek-transport.ts";
import type { DnsMode } from "./dns.ts";

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
  /** Server-owned cancellation; never serialized into the provider request. */
  signal?: AbortSignal;
  /** Internal accounting hooks, never sent to the provider. */
  onCall?: () => void;
  /** Server-owned collection lane; never sent to the provider or accepted from browser input. */
  researchParallel?: boolean;
  /** Internal collection headroom for the final analysis; never sent upstream. */
  finalTokenHeadroom?: number;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  format?: "json" | "text";
  maxOutputTokens?: number;
  model?: "deepseek-flash" | "deepseek-v4-pro";
  thinking?: boolean;
  reasoningEffort?: "low" | "high" | "max";
  /** Total request deadline; thinking also has a separate byte-idle timeout. */
  timeoutMs?: number;
}
export class ModelError extends Error {
  code: string;
  timeoutCause?: "request_deadline" | "byte_idle" | "cancelled";
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
  dnsMode?: DnsMode;
}

function providerHttpFailure(status: number): ModelError {
  if (status === 400 || status === 422)
    return new ModelError("PROVIDER_INVALID_REQUEST");
  if (status === 401 || status === 403)
    return new ModelError("PROVIDER_AUTH_FAILED");
  if (status === 402) return new ModelError("PROVIDER_BALANCE_INSUFFICIENT");
  if (status === 429) return new ModelError("RATE_LIMITED");
  if ([500, 502, 503, 504].includes(status))
    return new ModelError("PROVIDER_TEMPORARY_UNAVAILABLE");
  return new ModelError("PROVIDER_UNAVAILABLE");
}

function parseResponseJson(raw: string): Record<string, any> {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ModelError("INVALID_RESPONSE");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ModelError("INVALID_RESPONSE");
  return value;
}

function validUsage(value: unknown): value is {
  prompt_tokens: number;
  completion_tokens: number;
} {
  if (!value || typeof value !== "object") return false;
  const usage = value as Record<string, unknown>;
  return [usage.prompt_tokens, usage.completion_tokens].every(
    (count) => Number.isSafeInteger(count) && Number(count) >= 0,
  );
}

/** A total byte/deadline bound also covers streamed thinking and framing. */
async function* responseChunks(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  onBytes?: () => void,
) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ModelError("RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ModelError("INVALID_RESPONSE");
  let bytes = 0;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      void reader.cancel().catch(() => {});
      reject(new ModelError("MODEL_TIMEOUT"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    while (true) {
      if (signal.aborted) throw new ModelError("MODEL_TIMEOUT");
      const part = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new ModelError("MODEL_TIMEOUT");
      if (part.done) break;
      if (part.value.byteLength) onBytes?.();
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new ModelError("RESPONSE_TOO_LARGE");
      yield part.value;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Do not await an uncooperative transport's cancellation past the deadline.
    void reader.cancel().catch(() => {});
  }
}

/** Consume SSE internally; only final content and total usage leave this boundary. */
async function readThinkingStream(
  response: Response,
  model: string,
  signal: AbortSignal,
  onBytes: () => void,
): Promise<ModelReply> {
  if (
    !/^text\/event-stream(?:;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    void response.body?.cancel().catch(() => {});
    throw new ModelError("INVALID_RESPONSE");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let data: string[] = [];
  let content = "";
  let contentBytes = 0;
  let eventBytes = 0;
  let finished = false;
  let done = false;
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
  const event = () => {
    if (!data.length) return;
    const raw = data.join("\n");
    data = [];
    if (done) throw new ModelError("INVALID_RESPONSE");
    if (raw.trim() === "[DONE]") {
      done = true;
      return;
    }
    const chunk = parseResponseJson(raw);
    if (chunk.error || chunk.model !== model || !Array.isArray(chunk.choices))
      throw new ModelError("INVALID_RESPONSE");
    if (chunk.usage != null) {
      if (!validUsage(chunk.usage)) throw new ModelError("UNKNOWN_USAGE");
      if (
        usage &&
        (usage.prompt_tokens !== chunk.usage.prompt_tokens ||
          usage.completion_tokens !== chunk.usage.completion_tokens)
      )
        throw new ModelError("UNKNOWN_USAGE");
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens,
        completion_tokens: chunk.usage.completion_tokens,
      };
    }
    if (chunk.choices.length === 0) {
      if (!finished || !validUsage(chunk.usage))
        throw new ModelError("INVALID_RESPONSE");
      return;
    }
    if (chunk.choices.length !== 1 || finished)
      throw new ModelError("INCOMPLETE_RESPONSE");
    const choice = chunk.choices[0];
    const delta = choice?.delta;
    if (
      choice?.index !== 0 ||
      !delta ||
      typeof delta !== "object" ||
      Array.isArray(delta) ||
      (delta.role != null && delta.role !== "assistant") ||
      (delta.content != null && typeof delta.content !== "string") ||
      (delta.reasoning_content != null &&
        typeof delta.reasoning_content !== "string") ||
      (delta.tool_calls != null &&
        (!Array.isArray(delta.tool_calls) || delta.tool_calls.length)) ||
      delta.function_call != null
    )
      throw new ModelError("INCOMPLETE_RESPONSE");
    // reasoning_content is deliberately neither accumulated nor returned/logged.
    if (typeof delta.content === "string") {
      contentBytes += Buffer.byteLength(delta.content);
      if (contentBytes > 131072) throw new ModelError("RESPONSE_TOO_LARGE");
      content += delta.content;
    }
    if (choice.finish_reason != null) {
      if (choice.finish_reason !== "stop")
        throw new ModelError("INCOMPLETE_RESPONSE");
      finished = true;
    }
  };
  const line = (value: string) => {
    eventBytes += Buffer.byteLength(value) + 2;
    if (eventBytes > 65536) throw new ModelError("RESPONSE_TOO_LARGE");
    if (!value) {
      event();
      eventBytes = 0;
    } else if (value === "data") data.push("");
    else if (value.startsWith("data:"))
      data.push(value.slice(5).replace(/^ /, ""));
    // SSE comments/keepalives and unrelated protocol fields carry no model text.
  };
  const consume = (text: string, eof = false) => {
    pending += text;
    while (true) {
      const index = pending.search(/[\r\n]/);
      if (
        index < 0 ||
        (!eof && pending[index] === "\r" && index === pending.length - 1)
      )
        break;
      const length =
        pending[index] === "\r" && pending[index + 1] === "\n" ? 2 : 1;
      line(pending.slice(0, index));
      pending = pending.slice(index + length);
    }
    if (eventBytes + Buffer.byteLength(pending) > 65536)
      throw new ModelError("RESPONSE_TOO_LARGE");
    if (eof && pending) {
      line(pending);
      pending = "";
    }
    if (eof) event();
  };
  const decode = (bytes?: Uint8Array) => {
    try {
      return decoder.decode(bytes, { stream: bytes !== undefined });
    } catch {
      throw new ModelError("INVALID_RESPONSE");
    }
  };
  for await (const bytes of responseChunks(
    response,
    8388608,
    signal,
    onBytes,
  )) {
    // Bound text retained for an unfinished event even if a transport yields a large chunk.
    for (let offset = 0; offset < bytes.length; offset += 16384)
      consume(decode(bytes.subarray(offset, offset + 16384)));
    if (done) break;
  }
  consume(decode(), true);
  if (!done || !finished || !content.trim())
    throw new ModelError("INCOMPLETE_RESPONSE");
  if (!usage) throw new ModelError("UNKNOWN_USAGE");
  return {
    content,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    model,
  };
}

/** Called by the shared budget ledger too, so reserved output equals the provider cap. */
export function resolveModelRequest(options: ModelRequestOptions = {}) {
  if (
    (options.researchParallel !== undefined &&
      typeof options.researchParallel !== "boolean") ||
    (options.finalTokenHeadroom !== undefined &&
      (!Number.isSafeInteger(options.finalTokenHeadroom) ||
        options.finalTokenHeadroom < 0 ||
        options.finalTokenHeadroom > B.thinkingChars + B.finalOutputTokens)) ||
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
        options.timeoutMs > B.researchTotalTimeoutMs))
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

export function validateDeepSeekEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ModelError("UNSAFE_PROVIDER_ENDPOINT");
  }
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
  return url;
}

/** Server task code chooses an allowlisted model; browser input never controls routing or tools. */
export function createDeepSeekAdapter(
  config: DeepSeekConfig = {},
): ModelAdapter {
  const endpoint =
    config.endpoint ?? "https://api.deepseek.com/chat/completions";
  validateDeepSeekEndpoint(endpoint);
  if (
    config.dnsMode !== undefined &&
    !["system", "public-doh"].includes(config.dnsMode)
  )
    throw new ModelError("WEB_DNS_MODE_INVALID");
  const request =
    config.fetch ??
    (config.dnsMode === "public-doh"
      ? createDeepSeekTransport()
      : globalThis.fetch);
  return {
    async complete(messages, options = {}) {
      options.signal?.throwIfAborted();
      if (!config.enabled) throw new ModelError("MODEL_DISABLED");
      if (!config.apiKey) throw new ModelError("MODEL_NOT_CONFIGURED");
      const selected = resolveModelRequest(options);
      if (
        JSON.stringify(messages).length >
        (selected.thinking ? B.thinkingChars : B.normalChars)
      )
        throw new ModelError("EVIDENCE_TOO_LARGE");
      if (
        config.timeoutMs !== undefined &&
        (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)
      )
        throw new ModelError("INVALID_MODEL_OPTIONS");
      const controller = new AbortController();
      let timeoutCause: ModelError["timeoutCause"];
      const abort = () => {
        timeoutCause ??= "cancelled";
        controller.abort(options.signal?.reason);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(
        () => {
          timeoutCause ??= "request_deadline";
          controller.abort();
        },
        Math.min(
          selected.timeoutMs ??
            config.timeoutMs ??
            (selected.thinking ? B.thinkingTimeoutMs : B.normalTimeoutMs),
          selected.thinking ? B.researchTotalTimeoutMs : B.normalTimeoutMs,
        ),
      );
      let idleTimeout: ReturnType<typeof setTimeout> | undefined;
      const receivedBytes = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          timeoutCause ??= "byte_idle";
          controller.abort();
        }, B.thinkingIdleTimeoutMs);
      };
      // Count time to the first byte too. Reasoning, SSE framing and partial
      // events reset only the idle timer; they never extend the total deadline.
      if (selected.thinking) receivedBytes();
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
            stream: selected.thinking,
            ...(selected.thinking
              ? { stream_options: { include_usage: true } }
              : {}),
            temperature: 0,
            max_tokens: selected.maxOutputTokens,
            ...(options.format === "text"
              ? {}
              : { response_format: { type: "json_object" } }),
            messages,
          }),
        });
        if (!response.ok) {
          // Error bodies may contain credentials or request excerpts; never parse or expose them.
          void response.body?.cancel().catch(() => {});
          throw providerHttpFailure(response.status);
        }
        if (selected.thinking)
          return await readThinkingStream(
            response,
            selected.model,
            controller.signal,
            receivedBytes,
          );
        let raw = "";
        const decoder = new TextDecoder();
        for await (const bytes of responseChunks(
          response,
          65536,
          controller.signal,
        ))
          raw += decoder.decode(bytes, { stream: true });
        raw += decoder.decode();
        const result = parseResponseJson(raw);
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
        if (!validUsage(result.usage)) throw new ModelError("UNKNOWN_USAGE");
        return {
          content: choice.message.content,
          inputTokens: result.usage.prompt_tokens,
          outputTokens: result.usage.completion_tokens,
          model: result.model,
        };
      } catch (error) {
        if (controller.signal.aborted) {
          const failure = new ModelError("MODEL_TIMEOUT");
          failure.timeoutCause = timeoutCause;
          throw failure;
        }
        if (error instanceof ModelError) throw error;
        throw new ModelError("PROVIDER_NETWORK_ERROR");
      } finally {
        options.signal?.removeEventListener("abort", abort);
        clearTimeout(timeout);
        clearTimeout(idleTimeout);
      }
    },
  };
}
