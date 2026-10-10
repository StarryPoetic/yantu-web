import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import {
  createHttpsReader,
  type WebReader,
} from "../../server/explanation/web.ts";
import {
  createPoliteReader,
  robotsAllows,
  ROBOTS_MAX_BYTES,
} from "../../server/explanation/robots.ts";

const root = "http://school.edu.cn/";
const options = { allowedHosts: ["school.edu.cn"], allowHttp: true };
function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}
type Reply = {
  status?: number;
  headers?: Record<string, string>;
  text?: string;
  bytes?: Buffer;
};
function fixture(replies: Reply[], blockedHost?: string) {
  const reads: string[] = [],
    resolved: string[] = [];
  const request = ((
    url: URL,
    _options: unknown,
    callback: (response: unknown) => void,
  ) => {
    reads.push(url.href);
    const reply = replies.shift();
    assert.ok(reply, `unexpected request ${url.href}`);
    const req = Object.assign(new EventEmitter(), { destroy() {}, end() {} });
    queueMicrotask(() => {
      const response = Object.assign(
        Readable.from([reply.bytes ?? Buffer.from(reply.text ?? "")]),
        {
          statusCode: reply.status ?? 200,
          headers: { "content-type": "text/plain", ...reply.headers },
        },
      );
      callback(response);
    });
    return req;
  }) as never;
  const reader = createHttpsReader({
    resolver: async (host) => {
      resolved.push(host);
      return [
        { address: host === blockedHost ? "127.0.0.1" : "8.8.8.8", family: 4 },
      ];
    },
    request,
    httpRequest: request,
  });
  return {
    reader,
    reads,
    resolved,
    polite: createPoliteReader(reader, clock()),
  };
}

test("robots follows three same-school HTTP/HTTPS and www redirects, then applies rules to the original host and caches them", async () => {
  const f = fixture([
    { status: 301, headers: { location: "https://school.edu.cn/robots.txt" } },
    {
      status: 302,
      headers: { location: "https://www.school.edu.cn/robots.txt" },
    },
    { status: 307, headers: { location: "/rules.txt" } },
    { text: "User-agent: *\nDisallow: /private\nAllow: /private/public" },
    { text: "public catalogue" },
  ]);
  await assert.rejects(f.polite(`${root}private`, options), {
    code: "ROBOTS_DISALLOWED",
  });
  assert.equal(
    (await f.polite(`${root}private/public`, options)).text,
    "public catalogue",
  );
  assert.deepEqual(f.reads, [
    `${root}robots.txt`,
    "https://school.edu.cn/robots.txt",
    "https://www.school.edu.cn/robots.txt",
    "https://www.school.edu.cn/rules.txt",
    `${root}private/public`,
  ]);
  assert.equal(f.resolved.length, 5);
});

test("robots cross-site redirects are rejected before DNS/connection and a failed host policy is cached", async () => {
  const f = fixture([
    { status: 302, headers: { location: "https://other.edu.cn/robots.txt" } },
  ]);
  for (const path of ["one", "two"])
    await assert.rejects(f.polite(root + path, options), {
      code: "ROBOTS_UNAVAILABLE",
      robotsCause: "WEB_REDIRECT_CROSS_SITE",
    });
  assert.deepEqual(f.reads, [`${root}robots.txt`]);
  assert.deepEqual(f.resolved, ["school.edu.cn"]);
});

test("robots stops after three redirects and validates public addresses on redirected hops", async () => {
  const f = fixture(
    [1, 2, 3, 4].map((n) => ({
      status: 302,
      headers: { location: `/rules${n}` },
    })),
  );
  await assert.rejects(f.polite(root, options), {
    code: "ROBOTS_UNAVAILABLE",
    robotsCause: "WEB_REDIRECT_LIMIT",
  });
  assert.equal(f.reads.length, 4);
  const privateHop = fixture(
    [
      {
        status: 302,
        headers: { location: "https://private.school.edu.cn/robots.txt" },
      },
    ],
    "private.school.edu.cn",
  );
  await assert.rejects(privateHop.polite(root, options), {
    code: "ROBOTS_UNAVAILABLE",
    robotsCause: "WEB_ADDRESS_BLOCKED",
  });
  assert.deepEqual(privateHop.resolved, [
    "school.edu.cn",
    "private.school.edu.cn",
  ]);
  assert.deepEqual(privateHop.reads, [`${root}robots.txt`]);
});

test("2xx HTML soft-404, empty responses and non-text MIME without valid rules impose no restriction", async () => {
  for (const reply of [
    {
      text: "<!doctype html><html><body>学校首页</body></html>",
      headers: { "content-type": "text/html" },
    },
    { status: 204 },
    {
      status: 206,
      text: "not a robots rule",
      headers: { "content-type": "application/octet-stream" },
    },
  ]) {
    const f = fixture([reply, { text: "catalogue" }]);
    assert.equal((await f.polite(root, options)).text, "catalogue");
  }
});

test("invalid lines are ignored while valid rules, UA specificity, equal-length Allow and wildcard anchors remain effective", () => {
  const text =
    "<!doctype html>\rUser-agent: *\rDisallow: /\rUser-agent: Yantu\rDisallow: /short\rUser-agent: YantuEvidence\rbroken line\rDisallow: invalid\rUser-agent: <html>\rAllow: /same\rDisallow: /same\rDisallow: /secret\rDisallow: /bad\u0000path\rSitemap: /whatever\rDisallow: /*.pdf$\rAllow: /public.pdf$";
  assert.equal(robotsAllows(text, `${root}secret`), false);
  assert.equal(robotsAllows(text, `${root}same`), true);
  assert.equal(robotsAllows(text, `${root}short`), true);
  assert.equal(robotsAllows(text, `${root}file.pdf`), false);
  assert.equal(robotsAllows(text, `${root}public.pdf`), true);
  assert.equal(robotsAllows(text, `${root}file.pdf?x=1`), true);
});

test("all 4xx except 429 mean no restrictions; 429 and 5xx prohibit the host", async () => {
  for (const status of [
    401, 403, 404, 408, 410, 451, 429, 500, 502, 503, 504, 599,
  ]) {
    const f = fixture([{ status }, { text: "catalogue" }]);
    if (status < 500 && status !== 429)
      assert.equal((await f.polite(root, options)).text, "catalogue");
    else {
      await assert.rejects(f.polite(root, options), {
        code: "ROBOTS_UNAVAILABLE",
      });
      assert.equal(f.reads.length, 1);
    }
  }
});

test("timeouts, DNS and connection failures prohibit the host and preserve diagnostic codes", async () => {
  for (const code of [
    "WEB_TIMEOUT",
    "WEB_DNS_UNAVAILABLE",
    "WEB_CONNECTION_REFUSED",
    "WEB_CONNECTION_RESET",
  ]) {
    let calls = 0;
    const reader: WebReader = async () => {
      calls++;
      throw Object.assign(new Error(), { code });
    };
    const polite = createPoliteReader(reader, clock());
    await assert.rejects(polite(root, options), {
      code: "ROBOTS_UNAVAILABLE",
      robotsCause: code,
    });
    await assert.rejects(polite(root + "again", options), {
      code: "ROBOTS_UNAVAILABLE",
    });
    assert.equal(calls, 1);
  }
});

test("oversized robots responses parse a bounded decompressed prefix even with Content-Length and compression", async () => {
  const text =
    "User-agent: *\nDisallow: /secret\n" +
    "# padding\n".repeat(20000) +
    "Disallow: /later";
  assert.equal(robotsAllows(text, `${root}secret`), false);
  assert.equal(robotsAllows(text, `${root}later`), true);
  for (const [encoding, compress] of [
    ["identity", (bytes: Buffer) => bytes],
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ] as const) {
    const bytes = compress(Buffer.from(text));
    const f = fixture([
      {
        bytes,
        headers: {
          "content-encoding": encoding,
          "content-length": String(bytes.length),
        },
      },
      { text: "later catalogue" },
    ]);
    await assert.rejects(f.polite(root + "secret", options), {
      code: "ROBOTS_DISALLOWED",
    });
    assert.equal(
      (await f.polite(root + "later", options)).text,
      "later catalogue",
    );
    const raw = fixture([{ bytes, headers: { "content-encoding": encoding } }]);
    const result = await raw.reader(root + "robots.txt", {
      ...options,
      maxBytes: ROBOTS_MAX_BYTES,
      textPrefix: true,
    });
    assert.equal(Buffer.byteLength(result.text), ROBOTS_MAX_BYTES);
  }
  const normal = fixture([
    { text, headers: { "content-length": String(Buffer.byteLength(text)) } },
  ]);
  await assert.rejects(
    normal.reader(root, { ...options, maxBytes: ROBOTS_MAX_BYTES }),
    { code: "WEB_TOO_LARGE" },
  );
});
