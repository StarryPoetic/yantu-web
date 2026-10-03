import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

export function normalizeIpAddress(value: string): string | null {
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6 || value.includes("%")) return null;
  const address = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/i.exec(address);
  if (!mapped) return address;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** A trusted single-hop proxy must overwrite this header with the actual peer IP. */
export function clientIpAddress(
  request: IncomingMessage,
  trustedProxyIps: readonly string[] = [],
): string {
  const remote = normalizeIpAddress(request.socket.remoteAddress ?? "");
  if (!remote) return "unknown";
  if (
    !trustedProxyIps.some((address) => normalizeIpAddress(address) === remote)
  )
    return remote;
  const forwarded = request.headers["x-forwarded-for"];
  if (forwarded === undefined) return remote;
  const address =
    typeof forwarded === "string" ? normalizeIpAddress(forwarded.trim()) : null;
  if (!address)
    throw new HttpError(
      400,
      "invalid_forwarded_ip",
      "代理必须提供一个有效的客户端 IP 地址。",
    );
  return address;
}

export class HttpError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "invalid_body", "请求必须是 JSON 对象。");
  return value as Record<string, unknown>;
}
export function fields(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length)
    throw new HttpError(400, "unknown_fields", "请求包含不支持的字段。", {
      fields: extra,
    });
}
export function text(
  value: unknown,
  name: string,
  max = 500,
  required = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new HttpError(422, "invalid_field", `${name}格式不正确。`);
  return value.trim();
}
export function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new HttpError(422, "invalid_field", `${name}超出允许范围。`);
  return Number(value);
}
export function matchEtag(header: string | string[] | undefined, etag: string) {
  if (!header)
    throw new HttpError(
      428,
      "precondition_required",
      "请先读取最新版本再保存。",
    );
  if (header !== etag)
    throw new HttpError(
      412,
      "version_conflict",
      "资料已在其他页面更新，请刷新后核对。",
    );
}
export async function readBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512_000)
      throw new HttpError(413, "body_too_large", "内容过大，请分批提交。");
    chunks.push(Buffer.from(chunk));
  }
  if (!size) return {};
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "json_required", "请使用 JSON 请求。");
  try {
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "JSON 内容无法读取。");
  }
}
export interface Reply {
  status?: number;
  body: unknown;
  etag?: string;
  headers?: Record<string, string>;
}
