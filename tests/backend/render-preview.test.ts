import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
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
