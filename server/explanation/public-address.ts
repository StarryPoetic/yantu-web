import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ModelError } from "./deepseek.ts";
import type { AddressResolver } from "./dns.ts";
import { resolveDnsWithRetry } from "./dns.ts";

/** Reject special-use networks; IPv4-mapped, tunnelling, and non-global IPv6 are denied. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const [prefix, second] = normalized.split(":");
    const subnet = Number.parseInt(second || "0", 16);
    // IANA reserves 2001::/23 and 2001:db8::/32, not the entire 2001::/16.
    // https://www.iana.org/assignments/iana-ipv6-special-registry
    // https://www.iana.org/assignments/ipv6-unicast-address-assignments
    return (
      /^[23][0-9a-f]{3}:/.test(normalized) &&
      !/[.%]/.test(normalized) &&
      !(prefix === "2001" && (subnet <= 0x1ff || subnet === 0xdb8)) &&
      !normalized.startsWith("2002:") &&
      !normalized.startsWith("3ffe:") &&
      !normalized.startsWith("3fff:")
    );
  }
  return false;
}

export async function resolvePublicAddress(
  host: string,
  resolver: AddressResolver = lookup,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ address: string; family: number }> {
  const addresses = await resolveDnsWithRetry(host, resolver, options);
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  )
    throw new ModelError("WEB_ADDRESS_BLOCKED");
  return addresses.find((entry) => entry.family === 4) ?? addresses[0];
}
