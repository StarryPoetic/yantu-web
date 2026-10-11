import { inflateSync } from "node:zlib";

/** Decode a known public article template's literal payload, never execute JS.
 * Decoded links still go through the usual same-school URL/IP/read safeguards. */
export function decodedResearchDocuments(html: string): string {
  const documents: string[] = [];
  const pattern =
    /Base64\.decode\(unzip\("([A-Za-z0-9+/=]{4,65536})"\)\.substr\((\d{1,4})\)\)\.substr\((\d{1,4})\)/g;
  for (const match of html.matchAll(pattern)) {
    if (documents.length >= 4) break;
    try {
      const packed = inflateSync(Buffer.from(match[1], "base64"), {
        maxOutputLength: 131072,
      })
        .toString("utf8")
        .slice(Number(match[2]));
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(packed)) continue;
      const decoded = Buffer.from(packed, "base64")
        .toString("utf8")
        .slice(Number(match[3]));
      // Only discover literal document anchors, not scripts or remote frames.
      const anchors = [
        ...decoded.matchAll(
          /<a\b[^>]*\bhref\s*=\s*(["'])[^"']+\1[^>]*>[^]*?<\/a\s*>/gi,
        ),
      ].map((m) => m[0]);
      documents.push(...anchors.slice(0, 4 - documents.length));
    } catch {
      // Malformed payloads and compressed bombs do not widen the read surface.
    }
  }
  return documents.join("\n");
}
