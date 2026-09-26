import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../server/app.ts";

test("production static delivery serves locally bundled math fonts and approved image formats", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yantu-static-"));
  const assets = [
    ["math.woff2", "font/woff2"],
    ["math.woff", "font/woff"],
    ["math.ttf", "font/ttf"],
    ["figure.webp", "image/webp"],
    ["figure.jpg", "image/jpeg"],
  ];
  for (const [file] of assets)
    await writeFile(join(directory, file), "local-test-asset");
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: false,
    staticDirectory: directory,
  });
  t.after(async () => {
    await app.close();
    for (const [file] of assets) await unlink(join(directory, file));
    await rmdir(directory);
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  for (const [file, mime] of assets) {
    const response: Response = await fetch(
      `http://127.0.0.1:${address.port}/${file}`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "local-test-asset");
  }
});

test("deleting personal data during a model response returns a cleared-state conflict without resurrecting a chat", async (t) => {
  const nativeFetch: typeof fetch = globalThis.fetch;
  const previousEnabled = process.env.YANTU_MODEL_ENABLED;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.YANTU_MODEL_ENABLED = "true";
  process.env.DEEPSEEK_API_KEY = "test-only-provider-credential";
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const providerStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith("https://api.deepseek.com/")) {
      started();
      await pending;
      return new Response(
        JSON.stringify({
          model: "deepseek-flash",
          choices: [
            {
              finish_reason: "stop",
              message: { content: "这是只应留在原会话中的回答。" },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 20 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return nativeFetch(input, options);
  };
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: undefined,
  });
  t.after(async () => {
    release();
    globalThis.fetch = nativeFetch;
    if (previousEnabled === undefined) delete process.env.YANTU_MODEL_ENABLED;
    else process.env.YANTU_MODEL_ENABLED = previousEnabled;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    await app.close();
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const guest = await nativeFetch(base + "/guest-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const session = await guest.json();
  const cookie = guest.headers.get("set-cookie")!.split(";")[0];
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await nativeFetch(base + path, {
      method,
      headers: {
        cookie,
        "x-csrf-token": session.csrfToken,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get("etag")!,
    };
  }
  const profile = await request("/me/profile");
  const preview = await request("/me/profile/deletion-preview");
  const conversation = await request("/assistant/conversation");
  const answering = request(
    "/assistant/conversation",
    "POST",
    { message: "请给我一个学习建议", allowSearch: false },
    { "if-match": conversation.etag },
  );
  await providerStarted;
  const deleted = await request("/me/profile", "DELETE", undefined, {
    "if-match": profile.etag,
    "deletion-scope-version": preview.body.deletionScopeVersion,
  });
  assert.equal(deleted.status, 202);
  release();
  const result = await answering;
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "data_deleted");
  assert.equal(JSON.stringify(result.body).includes("只应留在原会话"), false);
  assert.deepEqual(
    (await request("/assistant/conversation")).body.messages,
    [],
  );
});
