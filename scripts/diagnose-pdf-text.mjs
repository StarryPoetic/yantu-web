import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Fixed, offline workload. Run explicitly; this is not part of the normal test suite.
// Only PDF tests execute, so no application server, .env, model or search is loaded.
const root = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = await mkdtemp(join(tmpdir(), "yantu-pdf-diagnostic-"));
const startedAt = new Date().toISOString();
const runs = [];
async function run(mode, round, slot) {
  const started = performance.now();
  const runStartedAt = new Date().toISOString();
  const child = spawn(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "--test-timeout=60000",
      "tests/backend/pdf-text.test.ts",
    ],
    {
      cwd: root,
      windowsHide: true,
      env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const { code, signal, error } = await new Promise((resolve) => {
    let error;
    child.once("error", (failure) => (error = failure.code ?? "SPAWN_ERROR"));
    child.once("close", (code, signal) => resolve({ code, signal, error }));
  });
  const log = join(outputDirectory, `${mode}-${round}-${slot}.tap`);
  await writeFile(log, output);
  const result = {
    mode,
    round,
    slot,
    startedAt: runStartedAt,
    endedAt: new Date().toISOString(),
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    code,
    signal,
    ...(error ? { error } : {}),
    // This includes pdfText's child startup, IPC and parsing; it is not pure parser time.
    firstPdfTestMs: Number(output.match(/duration_ms: ([\d.]+)/)?.[1]) || null,
    passed: Number(output.match(/^# pass (\d+)$/m)?.[1]) || 0,
    failed: Number(output.match(/^# fail (\d+)$/m)?.[1]) || 0,
    log,
  };
  runs.push(result);
  console.log(JSON.stringify(result));
}

for (let round = 1; round <= 3; round++) await run("single", round, 1);
for (let round = 1; round <= 2; round++)
  await Promise.all(
    Array.from({ length: 4 }, (_, slot) => run("parallel", round, slot + 1)),
  );

const summary = {
  startedAt,
  endedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  availableParallelism: availableParallelism(),
  workload:
    "three sequential files followed by two batches of four PDF test files",
  limitation:
    "PDF-only contention; does not reproduce the complete backend suite or locate worker internal phases",
  runs,
};
const summaryPath = join(outputDirectory, "summary.json");
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Summary: ${summaryPath}`);
if (runs.some((run) => run.code !== 0 || run.failed || !run.passed))
  process.exitCode = 1;
