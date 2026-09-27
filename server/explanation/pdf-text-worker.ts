import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { PDFParse } from "pdf-parse";

const { bytes, limits } = await new Promise<{
  bytes: Uint8Array;
  limits: { maxPages: number; maxChars: number };
}>((resolve) => process.once("message", resolve));
// Resources come only from installed pdf.js assets, never from the document's URLs.
const parserRequire = createRequire(import.meta.resolve("pdf-parse"));
const assets = new URL(
  "./",
  pathToFileURL(parserRequire.resolve("pdfjs-dist/package.json")),
);
globalThis.fetch = async () => {
  throw new Error("Network unavailable in PDF text worker");
};
const parser = new PDFParse({
  data: bytes,
  isEvalSupported: false,
  useWorkerFetch: false,
  useWasm: false,
  disableAutoFetch: true,
  disableStream: true,
  disableRange: true,
  disableFontFace: true,
  useSystemFonts: false,
  enableXfa: false,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  maxImageSize: 1,
  stopAtErrors: true,
  verbosity: 0,
  cMapUrl: fileURLToPath(new URL("cmaps/", assets)).replaceAll("\\", "/"),
  cMapPacked: true,
  standardFontDataUrl: fileURLToPath(
    new URL("standard_fonts/", assets),
  ).replaceAll("\\", "/"),
});
let output: { text: string } | { error: string };
try {
  const info = await parser.getInfo();
  if (info.total > limits.maxPages) throw new Error("WEB_PDF_TOO_MANY_PAGES");
  const pages: string[] = [];
  let length = 0;
  for (let page = 1; page <= info.total; page++) {
    const result = await parser.getText({
      partial: [page],
      parseHyperlinks: false,
      pageJoiner: "",
      cellSeparator: " ",
    });
    const text = result.text.trim();
    length += text.length + 2;
    if (length > limits.maxChars) throw new Error("WEB_PDF_TEXT_TOO_LARGE");
    pages.push(text);
  }
  const text = pages.join("\n\n").trim();
  if (!text) throw new Error("WEB_PDF_EMPTY");
  output = { text };
} catch (error) {
  const code =
    error instanceof Error && /^WEB_PDF_/.test(error.message)
      ? error.message
      : "WEB_PDF_INVALID";
  output = { error: code };
} finally {
  await parser.destroy();
}
process.send!(output);
process.disconnect!();
