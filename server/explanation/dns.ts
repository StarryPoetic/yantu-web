import { isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import { ModelError } from "./deepseek.ts";

export type DnsMode = "system" | "public-doh";
export type AddressResolver = (
  host: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;
const endpoint = "https://dns.alidns.com/resolve";
const maxBytes = 32768;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function dnsModeFromEnvironment(
  env: Record<string, string | undefined>,
): DnsMode {
  const mode = env.YANTU_DNS_MODE?.trim() || "system";
  if (mode !== "system" && mode !== "public-doh")
    throw new ModelError("WEB_DNS_MODE_INVALID");
  return mode;
}
function hostname(value: unknown): string {
  if (typeof value !== "string") throw new ModelError("WEB_DNS_HOST_INVALID");
  const host = value.toLowerCase().replace(/\.$/, "");
  if (
    host.length > 253 ||
    isIP(host) ||
    !host.includes(".") ||
    !host
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(host)
  )
    throw new ModelError("WEB_DNS_HOST_INVALID");
  return host;
}

/** Only addresses belonging to this question's bounded CNAME chain are accepted. No alias is fetched separately. */
function answers(raw: string, host: string, type: 1 | 28): LookupAddress[] {
  let response: unknown;
  try {
    response = JSON.parse(raw);
  } catch {
    throw new ModelError("WEB_DNS_INVALID_RESPONSE");
  }
  if (!record(response) || response.Status !== 0 || response.TC === true)
    throw new ModelError("WEB_DNS_INVALID_RESPONSE");
  const questions = Array.isArray(response.Question)
    ? response.Question
    : [response.Question];
  if (
    questions.length !== 1 ||
    !record(questions[0]) ||
    hostname(questions[0].name) !== host ||
    questions[0].type !== type
  )
    throw new ModelError("WEB_DNS_INVALID_RESPONSE");
  const entries = response.Answer ?? [];
  if (!Array.isArray(entries) || entries.length > 64)
    throw new ModelError("WEB_DNS_INVALID_RESPONSE");
  const aliases = new Map<string, string>();
  const addresses: Array<LookupAddress & { name: string }> = [];
  for (const entry of entries) {
    if (!record(entry)) throw new ModelError("WEB_DNS_INVALID_RESPONSE");
    const name = hostname(entry.name);
    if (entry.type === 5) {
      const target = hostname(entry.data);
      if (aliases.has(name) && aliases.get(name) !== target)
        throw new ModelError("WEB_DNS_INVALID_RESPONSE");
      aliases.set(name, target);
    } else if (
      entry.type === type &&
      typeof entry.data === "string" &&
      isIP(entry.data) === (type === 1 ? 4 : 6)
    ) {
      addresses.push({ name, address: entry.data, family: type === 1 ? 4 : 6 });
    } else throw new ModelError("WEB_DNS_INVALID_RESPONSE");
  }
  const chain = new Set<string>();
  let current = host;
  while (true) {
    if (chain.has(current) || chain.size > 8)
      throw new ModelError("WEB_DNS_INVALID_RESPONSE");
    chain.add(current);
    const next = aliases.get(current);
    if (!next) break;
    current = next;
  }
  if (
    [...aliases.keys()].some((name) => !chain.has(name)) ||
    addresses.some((item) => item.name !== current)
  )
    throw new ModelError("WEB_DNS_INVALID_RESPONSE");
  return addresses.map(({ address, family }) => ({ address, family }));
}

async function readJson(response: Response): Promise<string> {
  if (response.status !== 200 || response.redirected)
    throw new ModelError("WEB_DNS_UNAVAILABLE");
  if (
    !/^(application\/(?:dns-json|json))(;|$)/i.test(
      response.headers.get("content-type") ?? "",
    ) ||
    Number(response.headers.get("content-length")) > maxBytes ||
    !response.body
  )
    throw new ModelError("WEB_DNS_INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) throw new ModelError("WEB_DNS_INVALID_RESPONSE");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fixed TLS endpoint, no credentials or configurable DNS URL. Caller still applies all-public IP checks and pins the chosen address. */
export function createPublicDohResolver(
  dependencies: { fetch?: typeof fetch; timeoutMs?: number } = {},
): AddressResolver {
  const fetcher = dependencies.fetch ?? fetch;
  return async (value) => {
    const host = hostname(value);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = async (type: 1 | 28) => {
        const url = new URL(endpoint);
        url.searchParams.set("name", host);
        url.searchParams.set("type", String(type));
        const response = await fetcher(url, {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          headers: {
            Accept: "application/dns-json,application/json",
            "Accept-Encoding": "identity",
          },
          signal: controller.signal,
        });
        if (response.url && response.url !== url.href)
          throw new ModelError("WEB_DNS_UNAVAILABLE");
        return answers(await readJson(response), host, type);
      };
      return (
        await Promise.race([
          Promise.all([request(1), request(28)]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => {
                reject(new ModelError("WEB_DNS_TIMEOUT"));
                controller.abort();
              },
              Math.max(1, Math.min(dependencies.timeoutMs ?? 5000, 5000)),
            );
          }),
        ])
      ).flat();
    } catch (error) {
      if (error instanceof ModelError) throw error;
      throw new ModelError("WEB_DNS_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
