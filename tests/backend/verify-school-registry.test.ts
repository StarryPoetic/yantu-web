import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schoolRegistry } from "../../server/schools/index.ts";
import {
  parseArguments,
  verifyPage,
  verifyRegistry,
  runVerification,
} from "../../scripts/verify-school-registry.mjs";
import type { WebReader } from "../../server/explanation/web.ts";

test("free registry CLI validates province/city/limit/write flags without environment loading", () => {
  assert.deepEqual(
    parseArguments([
      "--province",
      "浙江",
      "--city",
      "杭州市",
      "--limit",
      "2",
      "--write",
    ]),
    { province: "浙江", city: "杭州市", limit: 2, write: true },
  );
  for (const args of [
    ["--limit", "0"],
    ["--limit", "2.5"],
    ["--city"],
    ["--unknown"],
  ])
    assert.throws(() => parseArguments(args));
});
test("verification checks name/domain and records reader failure rather than certifying admissions facts", async () => {
  const s = schoolRegistry.byName("榆林大学")!;
  const reader: WebReader = async (url, options) => {
    assert.equal(options.maxRedirects, 3);
    assert.equal(options.allowHttp, true);
    assert.equal(options.timeoutMs, 10000);
    assert.deepEqual(options.allowedHosts, [new URL(url).hostname]);
    return {
      contentType: "text/html",
      text: "<title>榆林学院</title><p>公开资料</p>",
      finalUrl: url,
    };
  };
  assert.equal((await verifyPage(s, s.homepage, reader)).ok, true);
  assert.equal((await verifyPage(s, null, reader)).ok, null);
  assert.equal(
    (
      await verifyPage(s, s.homepage, async () => ({
        contentType: "text/html",
        text: "<p>其他学校</p>",
      }))
    ).failureCode,
    "NAME_NOT_FOUND",
  );
  assert.equal(
    (
      await verifyPage(s, s.homepage, async () => ({
        contentType: "text/html",
        text: s.name,
        finalUrl: "https://attacker.example/",
      }))
    ).failureCode,
    "WEB_REDIRECT_CROSS_SITE",
  );
  assert.equal(
    (
      await verifyPage(s, s.homepage, async () => {
        throw Object.assign(new Error("fixture"), { code: "WEB_TLS_CERT" });
      })
    ).failureCode,
    "WEB_TLS_CERT",
  );
});
test("offline verifier serializes whole school domains, caps global concurrency at six and writes only selected summaries", async () => {
  const schools = schoolRegistry.schools
    .filter((s) => s.province === "浙江")
    .slice(0, 8)
    .map((s) => ({
      ...structuredClone(s),
      discoveryUrls: [],
      locationDiscoveryUrls: [],
    }));
  let active = 0,
    peak = 0;
  const hosts = new Set<string>();
  const reader: WebReader = async (url) => {
    const host = new URL(url).hostname;
    assert.ok(!hosts.has(host));
    hosts.add(host);
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    hosts.delete(host);
    active--;
    const owner = schoolRegistry.byHost(host)!;
    return {
      contentType: "text/html",
      text: `<title>${owner.name}</title>`,
      finalUrl: url,
    };
  };
  const report = await verifyRegistry(
    { schools },
    { reader, concurrency: 20, intervalMs: 0 },
  );
  assert.equal(report.summary.total, 8);
  assert.ok(peak > 1 && peak <= 6);
  assert.equal(report.summary.homepageOk, 8);
  const folder = await mkdtemp(join(tmpdir(), "school-registry-"));
  try {
    const file = join(folder, "registry.json");
    const original = JSON.stringify({ schools });
    await writeFile(file, original);
    await runVerification(file, {
      reader,
      province: "浙江",
      city: "杭州市",
      limit: 1,
      intervalMs: 0,
    });
    assert.equal(await readFile(file, "utf8"), original);
    await runVerification(file, {
      reader: async () => {
        throw Object.assign(new Error(), { code: "WEB_TIMEOUT" });
      },
      province: "浙江",
      city: "杭州",
      limit: 1,
      write: true,
      intervalMs: 0,
    });
    const updated = JSON.parse(await readFile(file, "utf8"));
    assert.equal(updated.schools[0].verification.homepageOk, false);
    assert.equal(updated.schools[0].verification.failureCode, "WEB_TIMEOUT");
    assert.deepEqual(updated.schools[1], schools[1]);
    assert.deepEqual(updated.schools[0].campusHints, schools[0].campusHints);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
