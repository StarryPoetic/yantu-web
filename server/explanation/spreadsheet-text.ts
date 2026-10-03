import { fork } from "node:child_process";
import { ModelError } from "./deepseek.ts";

export const spreadsheetTextLimits: Readonly<
  Record<
    | "maxBytes"
    | "maxExpandedBytes"
    | "maxEntryBytes"
    | "maxEntries"
    | "maxSheets"
    | "maxRows"
    | "maxColumns"
    | "maxCellChars"
    | "maxChars"
    | "timeoutMs",
    number
  >
> = Object.freeze({
  maxBytes: 5000000,
  maxExpandedBytes: 20000000,
  maxEntryBytes: 5000000,
  maxEntries: 2000,
  maxSheets: 40,
  maxRows: 4000,
  maxColumns: 64,
  maxCellChars: 8000,
  maxChars: 200000,
  timeoutMs: 5000,
});

type Limits = Partial<
  Pick<
    typeof spreadsheetTextLimits,
    | "maxSheets"
    | "maxRows"
    | "maxColumns"
    | "maxCellChars"
    | "maxChars"
    | "timeoutMs"
  >
>;

/** Inert official document bytes only: no URLs, files, formulas or credentials. */
export async function spreadsheetText(
  data: Uint8Array,
  options: Limits = {},
): Promise<string> {
  if (!data.length || data.length > spreadsheetTextLimits.maxBytes)
    throw new ModelError("WEB_TOO_LARGE");
  const signature = Buffer.from(data.subarray(0, 8)).toString("hex");
  if (!signature.startsWith("504b0304") && signature !== "d0cf11e0a1b11ae1")
    throw new ModelError("WEB_SPREADSHEET_INVALID");
  const limits = { ...spreadsheetTextLimits };
  for (const key of [
    "maxSheets",
    "maxRows",
    "maxColumns",
    "maxCellChars",
    "maxChars",
    "timeoutMs",
  ] as const) {
    const value = options[key] ?? limits[key];
    if (!Number.isInteger(value) || value < 1 || value > limits[key])
      throw new ModelError("WEB_SPREADSHEET_LIMIT_INVALID");
    limits[key] = value;
  }
  return new Promise((resolve, reject) => {
    const worker = fork(
      new URL("./spreadsheet-text-worker.ts", import.meta.url),
      {
        execArgv: ["--max-old-space-size=128", "--max-semi-space-size=16"],
        env: process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {},
        serialization: "advanced",
        silent: true,
        windowsHide: true,
      },
    );
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
      () => finish(new ModelError("WEB_SPREADSHEET_TIMEOUT")),
      limits.timeoutMs,
    );
    worker.once("message", (message: { text?: unknown; error?: unknown }) => {
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
            [
              "WEB_SPREADSHEET_INVALID",
              "WEB_SPREADSHEET_TOO_LARGE",
              "WEB_SPREADSHEET_EMPTY",
            ].includes(message.error)
              ? message.error
              : "WEB_SPREADSHEET_INVALID",
          ),
        );
    });
    worker.once("error", () =>
      finish(new ModelError("WEB_SPREADSHEET_INVALID")),
    );
    worker.once("exit", () =>
      finish(new ModelError("WEB_SPREADSHEET_INVALID")),
    );
    worker.send({ bytes: Uint8Array.from(data), limits });
  });
}
