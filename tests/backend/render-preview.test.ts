import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { renderPreviewEnvironment } from "../../scripts/render-preview.ts";

test("free Render entry binds publicly with secure, isolated, offline preview defaults", () => {
  const temporaryDirectory = resolve("var", "isolated-render-entry-test");
  const env = renderPreviewEnvironment(
    "https://yantu-test.onrender.com/",
    temporaryDirectory,
  );
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.HOST, "0.0.0.0");
  assert.equal(env.YANTU_ORIGIN, "https://yantu-test.onrender.com");
  assert.equal(
    env.YANTU_DATABASE_PATH,
    resolve(temporaryDirectory, "yantu-render-preview", "preview.sqlite"),
  );
  assert.equal(env.YANTU_PREVIEW_MODE, "true");
  assert.equal(env.YANTU_MODEL_ENABLED, "false");
  assert.equal(env.YANTU_SEARCH_ENABLED, "false");
  assert.equal(env.YANTU_ADMIN_CREDENTIALS, "[]");
  assert.equal(env.YANTU_BOOTSTRAP_ADMINS, "[]");
  assert.equal(env.YANTU_TRUSTED_PROXY_IPS, "");
});

test("Render entry rejects missing, insecure, credential-bearing and non-origin URLs", () => {
  for (const value of [
    undefined,
    "",
    "http://yantu.onrender.com",
    "https://onrender.com.evil.example",
    "https://example.com",
    "https://user:placeholder@yantu.onrender.com",
    "https://yantu.onrender.com:8080",
    "https://yantu.onrender.com/other",
    "https://yantu.onrender.com/?token=placeholder",
    "https://yantu.onrender.com/#fragment",
  ])
    assert.throws(() => renderPreviewEnvironment(value), /Render 测试站/);
  assert.throws(
    () => renderPreviewEnvironment("https://yantu.onrender.com", "relative"),
    /绝对路径/,
  );
});

test("Render preview configuration import never reads environment files or starts a server", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      new URL("../helpers/reject-env-files.mjs", import.meta.url).href,
      "--input-type=module",
      "-e",
      `const {renderPreviewEnvironment} = await import(${JSON.stringify(new URL("../../scripts/render-preview.ts", import.meta.url).href)});
       const config = renderPreviewEnvironment('https://preview.onrender.com');
       if(config.YANTU_MODEL_ENABLED !== 'false') throw new Error('Paid services enabled');
       console.log('isolated-render-preview');`,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  assert.match(output, /isolated-render-preview/);
});

test("Render Blueprint contains only one free web service without paid resources", async () => {
  const blueprint = await readFile(
    new URL("../../render.yaml", import.meta.url),
    "utf8",
  );
  const lines = blueprint
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"));
  assert.deepEqual(
    lines.filter((line) => /^\S/.test(line)),
    ["services:"],
  );
  assert.deepEqual(
    lines.filter((line) => /^  - /.test(line)),
    ["  - type: web"],
  );
  assert.deepEqual(
    lines.filter((line) => /^    plan:/.test(line)),
    ["    plan: free"],
  );
  assert.ok(lines.includes("    runtime: node"));
  assert.ok(lines.includes("    startCommand: node scripts/render-preview.ts"));
  assert.ok(lines.includes("    healthCheckPath: /api/v1/health"));
  assert.ok(lines.includes('    autoDeployTrigger: "off"'));
  assert.ok(
    !lines.some((line) =>
      /^\s*(?:disk|disks|databases|database|fromDatabase|fromService|numInstances|scaling):/.test(
        line,
      ),
    ),
  );
  assert.ok(
    !lines.some((line) => /[&*][\w-]+|<<:/.test(line)),
    "aliases must not conceal extra resources",
  );
});

test(
  "the actual Render entry starts an isolated production preview with Secure cookies and disabled providers",
  { timeout: 25_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "yantu-render-entry-"));
    // Reserve an OS-selected port, then release it immediately before starting the real entry.
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    assert.ok(address && typeof address !== "string");
    await new Promise<void>((resolveClose, reject) =>
      reservation.close((error) => (error ? reject(error) : resolveClose())),
    );
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "SystemRoot",
      "SYSTEMROOT",
      "WINDIR",
      "SystemDrive",
      "COMSPEC",
    ])
      if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, {
      RENDER_EXTERNAL_URL: "https://entry-test.onrender.com",
      PORT: String(address.port),
      TMP: directory,
      TEMP: directory,
      TMPDIR: directory,
    });
    const child = spawn(
      process.execPath,
      [
        "--import",
        new URL("../helpers/reject-env-files.mjs", import.meta.url).href,
        fileURLToPath(
          new URL("../../scripts/render-preview.ts", import.meta.url),
        ),
      ],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = once(child, "exit");
    let output = "";
    child.stdout.on("data", (value) => {
      output = (output + String(value)).slice(-8000);
    });
    child.stderr.on("data", (value) => {
      output = (output + String(value)).slice(-8000);
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      await exited;
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${address.port}`;
    let health: Response | undefined;
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(child.exitCode, null, output);
      try {
        health = await fetch(`${origin}/api/v1/health`, {
          signal: AbortSignal.timeout(500),
        });
      } catch {
        /* Wait only for this isolated child to bind its port. */
      }
      if (health) break;
      await delay(100);
    }
    assert.ok(health, `Preview entry did not start: ${output}`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).sampleData, true);
    const registered = await fetch(`${origin}/api/v1/auth/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: env.RENDER_EXTERNAL_URL!,
      },
      body: JSON.stringify({
        username: "render.entry.test",
        password: "isolated-test-password-123",
      }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie");
    assert.ok(cookie);
    assert.match(cookie, /(?:^|;)\s*Secure(?:;|$)/i);
    assert.match(cookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
    // Render terminates HTTPS before this HTTP listener; manually forward its Secure cookie.
    const headers = { cookie: cookie.split(";")[0] };
    const session = await fetch(`${origin}/api/v1/auth/session`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const account = await session.json();
    assert.equal(account.authenticated, true);
    assert.equal(account.features.previewMode, true);
    assert.equal(account.features.sampleData, true);
    assert.equal(account.features.modelEnabled, false);
    const readiness = await fetch(`${origin}/api/v1/research/status`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(readiness.status, 200);
    assert.equal((await readiness.json()).ready, false);
    assert.ok(!output.includes("ENV_FILE_ACCESS_FORBIDDEN"));
  },
);
