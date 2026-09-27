import { fork } from "node:child_process";
import { ModelError } from "./deepseek.ts";

export const pdfTextLimits: Readonly<{
  maxBytes: number;
  maxPages: number;
  maxChars: number;
  timeoutMs: number;
}> = Object.freeze({
  maxBytes: 5000000,
  maxPages: 80,
  maxChars: 120000,
  timeoutMs: 5000,
});
type Limits = Partial<Omit<typeof pdfTextLimits, "maxBytes">>;

/** Parse downloaded bytes only; callers cannot select URLs, paths or executable code. */
export async function pdfText(
  data: Uint8Array,
  options: Limits = {},
): Promise<string> {
  if (!data.length || data.length > pdfTextLimits.maxBytes)
    throw new ModelError("WEB_TOO_LARGE");
  if (
    !/^%PDF-[12]\.\d/.test(Buffer.from(data.subarray(0, 8)).toString("ascii"))
  )
    throw new ModelError("WEB_PDF_INVALID");
  const limits = { ...pdfTextLimits };
  for (const key of ["maxPages", "maxChars", "timeoutMs"] as const) {
    const value = options[key] ?? limits[key];
    if (!Number.isInteger(value) || value < 1 || value > limits[key])
      throw new ModelError("WEB_PDF_LIMIT_INVALID");
    limits[key] = value;
  }
  return new Promise((resolve, reject) => {
    // A Node child isolates native parser teardown as well as CPU/memory exhaustion.
    // Only document bytes cross IPC; service credentials are not inherited.
    const worker = fork(new URL("./pdf-text-worker.ts", import.meta.url), {
      execArgv: ["--max-old-space-size=128", "--max-semi-space-size=16"],
      env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
      serialization: "advanced",
      silent: true,
      windowsHide: true,
    });
    worker.stdout!.resume();
    worker.stderr!.resume();
    let settled = false;
    const finish = (error?: ModelError, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.kill("SIGKILL");
      if (error) reject(error);
      else resolve(text!);
    };
    const timer = setTimeout(
      () => finish(new ModelError("WEB_PDF_TIMEOUT")),
      limits.timeoutMs,
    );
    worker.once("message", (message: { text?: unknown; error?: unknown }) => {
      const allowedErrors = [
        "WEB_PDF_INVALID",
        "WEB_PDF_TOO_MANY_PAGES",
        "WEB_PDF_TEXT_TOO_LARGE",
        "WEB_PDF_EMPTY",
      ];
      if (
        typeof message?.text === "string" &&
        message.text.trim() &&
        message.text.length <= limits.maxChars
      )
        finish(undefined, message.text);
      else
        finish(
          new ModelError(
            typeof message?.error === "string" &&
            allowedErrors.includes(message.error)
              ? message.error
              : "WEB_PDF_INVALID",
          ),
        );
    });
    worker.once("error", () => finish(new ModelError("WEB_PDF_INVALID")));
    worker.once("exit", () => finish(new ModelError("WEB_PDF_INVALID")));
    worker.send({ bytes: Uint8Array.from(data), limits });
  });
}
