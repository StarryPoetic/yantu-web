import { createPoliteReader } from "./robots.ts";
import { webPageText, type WebReader } from "./web.ts";

/** Public GET only. Dynamic rows, login and verification screens are not facts. */
export async function probeChsi(reader: WebReader, clock = {}) {
  const polite = createPoliteReader(reader, clock);
  const results = [];
  for (const url of [
    "https://yz.chsi.com.cn/zsml/",
    "https://yz.chsi.com.cn/sch/",
  ]) {
    try {
      const page = await polite(url, {
        allowedHosts: ["yz.chsi.com.cn"],
        maxRedirects: 0,
        timeoutMs: 10000,
        maxBytes: 512000,
      });
      const text = webPageText(page.text);
      const dynamic = /\{\{[^}]+\}\}|数据加载中|验证码|登录后/.test(text);
      const staticProgram = !dynamic && /\b(?:0[1-9]|1[0-4])\d{4}\b/.test(text);
      results.push({
        url,
        status: staticProgram ? "static_program" : "safe_fallback",
        reason: dynamic ? "SCRIPT_RENDERED_OR_LOGIN" : "NO_STATIC_PROGRAM_ROWS",
        textLength: text.length,
      });
    } catch (error) {
      results.push({
        url,
        status: "safe_fallback",
        reason: (error as { code?: string }).code ?? "WEB_UNAVAILABLE",
      });
    }
  }
  return results;
}
