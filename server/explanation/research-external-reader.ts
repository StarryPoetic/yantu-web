import { createPoliteReader } from "./robots.ts";
import { ModelError } from "./deepseek.ts";
import type { WebReader } from "./web.ts";
import {
  researchExternalPolicy,
  RESEARCH_EXTERNAL_SOURCES,
} from "./research-source-policy.ts";

/** Separate opt-in channel: does not expand ordinary chat or user-supplied URL access. */
export function createExternalResearchReader(
  reader: WebReader,
  clock?: Parameters<typeof createPoliteReader>[1],
): WebReader {
  const gate = (value: string) => {
    const url = new URL(value);
    if (
      !researchExternalPolicy(value) &&
      !(
        url.protocol === "https:" &&
        url.pathname === "/robots.txt" &&
        !url.search &&
        !url.username &&
        !url.password &&
        !url.port &&
        RESEARCH_EXTERNAL_SOURCES.some((p) => p.host === url.hostname)
      )
    )
      throw new ModelError("WEB_HOST_BLOCKED");
  };
  const guarded: WebReader = async (value, options) => {
    gate(value);
    return reader(value, {
      ...options,
      allowHttp: false,
      beforeRequest: async (hop) => {
        gate(hop);
        await options.beforeRequest?.(hop);
      },
    });
  };
  const polite = createPoliteReader(guarded, clock);
  return async (value, options) => {
    if (!researchExternalPolicy(value))
      throw new ModelError("WEB_HOST_BLOCKED");
    return polite(value, { ...options, allowHttp: false });
  };
}
