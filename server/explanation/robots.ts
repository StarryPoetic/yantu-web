import { ModelError } from "./index.ts";
import type { WebReader } from "./web.ts";

export const EVIDENCE_UA = "Mozilla/5.0 (compatible; YantuEvidence/1.1)";

/** RFC-style groups, most specific UA, longest rule, Allow wins equal specificity. */
export function robotsAllows(text: string, value: string): boolean {
  if (/<(?:html|!doctype)|\u0000/i.test(text))
    throw new ModelError("ROBOTS_UNDETERMINED");
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
  }[] = [];
  let group: (typeof groups)[number] | undefined;
  let sawRule = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) throw new ModelError("ROBOTS_UNDETERMINED");
    const key = match[1].toLowerCase(),
      path = match[2].trim();
    if (key === "user-agent") {
      if (!path) throw new ModelError("ROBOTS_UNDETERMINED");
      if (!group || sawRule) {
        group = { agents: [], rules: [] };
        groups.push(group);
        sawRule = false;
      }
      group.agents.push(path.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      if (!group || (path && !path.startsWith("/")))
        throw new ModelError("ROBOTS_UNDETERMINED");
      sawRule = true;
      if (path) group.rules.push({ allow: key === "allow", path });
    }
  }
  const rank = (g: (typeof groups)[number]) =>
    Math.max(
      -1,
      ...g.agents.map((a) =>
        a === "*" ? 0 : "yantuevidence".startsWith(a) ? a.length : -1,
      ),
    );
  const best = Math.max(-1, ...groups.map(rank));
  const url = new URL(value),
    target = url.pathname + url.search;
  const rules = groups
    .filter((g) => rank(g) === best && best >= 0)
    .flatMap((g) => g.rules)
    .filter((r) => {
      const expression = r.path
        .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*");
      return new RegExp(`^${expression}`).test(target);
    })
    .sort(
      (a, b) =>
        b.path.replace(/[*$]/g, "").length -
          a.path.replace(/[*$]/g, "").length ||
        Number(b.allow) - Number(a.allow),
    );
  return rules[0]?.allow ?? true;
}

/** Robots requests and every redirected page hop share the host's one-second schedule. */
export function createPoliteReader(
  reader: WebReader,
  clock: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const now = clock.now ?? Date.now;
  const sleep =
    clock.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const robots = new Map<string, Promise<string>>();
  const last = new Map<string, number>();
  const gates = new Map<string, Promise<void>>();
  const tick = async (host: string) => {
    const prior = gates.get(host) ?? Promise.resolve();
    const next = prior.then(async () => {
      const wait = 1000 - (now() - (last.get(host) ?? -Infinity));
      if (wait > 0) await sleep(wait);
      last.set(host, now());
    });
    gates.set(
      host,
      next.catch(() => {}),
    );
    await next;
  };
  const policy = (url: URL) => {
    if (!robots.has(url.host))
      robots.set(
        url.host,
        (async () => {
          await tick(url.host);
          try {
            const result = await reader(`${url.origin}/robots.txt`, {
              allowedHosts: [url.hostname],
              allowHttp: true,
              maxRedirects: 0,
              timeoutMs: 10000,
              maxBytes: 100000,
              headers: { "User-Agent": EVIDENCE_UA },
            });
            robotsAllows(result.text, url.href);
            return result.text;
          } catch (error) {
            if ((error as { code?: string }).code === "HTTP_404") return "";
            throw new ModelError("ROBOTS_UNAVAILABLE");
          }
        })(),
      );
    return robots.get(url.host)!;
  };
  const beforeRequest = async (value: string) => {
    const url = new URL(value);
    if (!robotsAllows(await policy(url), value))
      throw new ModelError("ROBOTS_DISALLOWED");
    await tick(url.host);
  };
  const polite: WebReader = async (url, options) => {
    // Injected readers in offline tests may not implement per-hop callbacks.
    await beforeRequest(url);
    let initial = true;
    return reader(url, {
      ...options,
      headers: { ...options.headers, "User-Agent": EVIDENCE_UA },
      beforeRequest: async (hop) => {
        if (initial && hop === url) initial = false;
        else await beforeRequest(hop);
        await options.beforeRequest?.(hop);
      },
    });
  };
  return polite;
}
