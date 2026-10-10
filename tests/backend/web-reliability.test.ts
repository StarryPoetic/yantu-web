import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import {
  createHttpsReader,
  decodeWebText,
  registrableDomain,
  readSourceMetadata,
} from "../../server/explanation/web.ts";
import {
  researchAttachments,
  researchLocationLinks,
} from "../../server/explanation/research-pages.ts";
import { researchReason } from "../../shared/research-status.ts";
import { probeSites } from "../../scripts/probe-school-sites.mjs";

type Reply = {
  status?: number;
  headers?: Record<string, string>;
  bytes?: Buffer;
  error?: string;
};
function fixture(
  replies: Reply[],
  addresses = [{ address: "8.8.8.8", family: 4 }],
) {
  const resolved: string[] = [];
  const requests: { url: URL; options: any; http: boolean; body?: string }[] =
    [];
  const request = (http: boolean) =>
    ((url: URL, options: any, callback: any) => {
      const item = {
        url,
        options,
        http,
        body: undefined as string | undefined,
      };
      requests.push(item);
      const reply = replies.shift()!;
      const req = Object.assign(new EventEmitter(), {
        destroy() {},
        end(body?: string) {
          item.body = body;
        },
      });
      queueMicrotask(() => {
        if (reply.error) {
          req.emit(
            "error",
            Object.assign(new Error("mock"), { code: reply.error }),
          );
          return;
        }
        const response = Object.assign(new EventEmitter(), {
          statusCode: reply.status ?? 200,
          headers: { "content-type": "text/html", ...reply.headers },
          destroy() {},
        });
        callback(response);
        response.emit("data", reply.bytes ?? Buffer.from("<p>学校招生</p>"));
        response.emit("end");
      });
      return req;
    }) as never;
  const reader = createHttpsReader({
    resolver: async (host) => {
      resolved.push(host);
      return addresses;
    },
    request: request(false),
    httpRequest: request(true),
  });
  return { reader, resolved, requests };
}
const options = {
  allowedHosts: ["grs.school.edu.cn"],
  maxRedirects: 3,
  allowHttp: true,
};
const initial = "https://grs.school.edu.cn/";

test("registrable domains preserve CN compound suffixes and school ownership", () => {
  for (const suffix of [
    "edu.cn",
    "com.cn",
    "org.cn",
    "gov.cn",
    "ac.cn",
    "net.cn",
  ])
    assert.equal(registrableDomain(`a.b.school.${suffix}`), `school.${suffix}`);
  assert.equal(registrableDomain("a.school.org"), "school.org");
});

test("research follows relative and same-school subdomain redirects with fresh DNS and pinned IP on every hop", async () => {
  const { reader, resolved, requests } = fixture([
    { status: 302, headers: { location: "/admissions/" } },
    {
      status: 301,
      headers: { location: "https://yjs.school.edu.cn/2027/catalog.html" },
    },
    {},
  ]);
  const result = await reader(initial, options);
  assert.deepEqual(resolved, [
    "grs.school.edu.cn",
    "grs.school.edu.cn",
    "yjs.school.edu.cn",
  ]);
  assert.equal(result.finalUrl, "https://yjs.school.edu.cn/2027/catalog.html");
  assert.deepEqual(result.redirects, [
    "https://grs.school.edu.cn/admissions/",
    result.finalUrl,
  ]);
  assert.equal(result.transport, "https");
  for (const request of requests) {
    assert.equal(request.options.servername, request.url.hostname);
    assert.equal(request.options.rejectUnauthorized, true);
    request.options.lookup(
      request.url.hostname,
      { all: true },
      (err: unknown, list: unknown) => {
        assert.equal(err, null);
        assert.deepEqual(list, [{ address: "8.8.8.8", family: 4 }]);
      },
    );
    assert.equal(
      request.options.headers["User-Agent"],
      "Mozilla/5.0 (compatible; YantuEvidence/1.1)",
    );
    assert.equal(request.options.headers["Accept-Language"], "zh-CN,zh;q=0.9");
  }
});

test("cross-school, unapproved same-domain hosts, unsafe protocols and credentials never connect", async () => {
  for (const location of [
    "https://other.edu.cn/",
    "https://127.0.0.1/",
    "https://user:pw@yjs.school.edu.cn/",
    "https://@yjs.school.edu.cn/",
    "https://yjs.school.edu.cn:443/",
    "http://yjs.school.edu.cn:80/",
    "//yjs.school.edu.cn:443/",
    "file://yjs.school.edu.cn/page",
  ]) {
    const f = fixture([{ status: 302, headers: { location } }]);
    await assert.rejects(f.reader(initial, options), {
      code:
        location.includes("other.edu") || location.includes("127.0")
          ? "WEB_REDIRECT_CROSS_SITE"
          : "WEB_HOST_NOT_ALLOWED",
    });
    assert.equal(f.requests.length, 1);
  }
  const f = fixture([
    { status: 302, headers: { location: "https://b.school.com/page" } },
  ]);
  await assert.rejects(
    f.reader("https://a.school.com/", {
      ...options,
      allowedHosts: ["a.school.com"],
    }),
    { code: "WEB_REDIRECT_CROSS_SITE" },
  );
});

test("private DNS after a redirect is blocked before opening its connection", async () => {
  let calls = 0;
  const secure = createHttpsReader({
    resolver: async () => [
      { address: ++calls === 1 ? "8.8.8.8" : "10.0.0.1", family: 4 },
    ],
    request: ((url: URL, opts: any, callback: any) => {
      const req = Object.assign(new EventEmitter(), { destroy() {}, end() {} });
      queueMicrotask(() =>
        callback(
          Object.assign(new EventEmitter(), {
            statusCode: 302,
            headers: { location: "https://yjs.school.edu.cn/" },
            destroy() {},
          }),
        ),
      );
      return req;
    }) as never,
  });
  await assert.rejects(secure(initial, options), {
    code: "WEB_ADDRESS_BLOCKED",
  });
  assert.equal(calls, 2);
});

test("default paths refuse redirects; three hops succeed, a fourth or a loop fails", async () => {
  await assert.rejects(
    fixture([{ status: 302, headers: { location: "/next" } }]).reader(initial, {
      allowedHosts: options.allowedHosts,
    }),
    { code: "WEB_REDIRECT_BLOCKED" },
  );
  const hops = [1, 2, 3].map((i) => ({
    status: 302,
    headers: { location: `/step${i}` },
  }));
  assert.equal(
    (await fixture([...hops, {}]).reader(initial, options)).redirects?.length,
    3,
  );
  await assert.rejects(
    fixture([...hops, { status: 302, headers: { location: "/four" } }]).reader(
      initial,
      options,
    ),
    { code: "WEB_REDIRECT_LIMIT" },
  );
  await assert.rejects(
    fixture([
      { status: 302, headers: { location: "/loop" } },
      { status: 302, headers: { location: "/" } },
    ]).reader(initial, options),
    { code: "WEB_REDIRECT_LIMIT" },
  );
});

test("HTTP is academic research only, sends no credentials, and marks mixed-transport chains", async () => {
  for (const [url, opts] of [
    ["http://grs.school.edu.cn/", { allowedHosts: options.allowedHosts }],
    [
      "http://yz.chsi.com.cn/",
      { ...options, allowedHosts: ["yz.chsi.com.cn"] },
    ],
  ] as const)
    await assert.rejects(
      fixture([]).reader(url, {
        ...opts,
        allowedHosts: [...opts.allowedHosts],
      }),
      { code: "WEB_HOST_NOT_ALLOWED" },
    );
  const f = fixture([
    { status: 302, headers: { location: "https://grs.school.edu.cn/secure" } },
    {},
  ]);
  const result = await f.reader("http://grs.school.edu.cn/", {
    ...options,
    headers: { Cookie: "secret", Authorization: "secret" },
    body: "secret",
  });
  assert.deepEqual(
    f.requests.map((r) => r.http),
    [true, false],
  );
  assert.ok(
    f.requests.every(
      (r) =>
        !r.options.headers.Cookie &&
        !r.options.headers.Authorization &&
        !r.body,
    ),
  );
  assert.equal(result.transport, "http");
  assert.match(
    readSourceMetadata(result, "http://grs.school.edu.cn/").retrievalNote!,
    /明文传输.*待核验/,
  );
  const downgrade = [
    { status: 302, headers: { location: "http://grs.school.edu.cn/plain" } },
    {},
  ];
  assert.equal(
    (await fixture([...downgrade]).reader(initial, options)).transport,
    "http",
  );
  await assert.rejects(
    fixture([...downgrade]).reader(initial, { ...options, allowHttp: false }),
    { code: "WEB_HOST_NOT_ALLOWED" },
  );
});

test("GBK charset declarations, HTML meta and undeclared fallback recover Chinese", () => {
  const chinese = Buffer.from("d1a7d0a3d5d0c9fad1a7b7d1", "hex"); // 学校招生学费
  for (const alias of ["gbk", "gb2312", "gb_2312-80", "x-gbk", "gb18030"])
    assert.equal(
      decodeWebText(chinese, `text/html; charset=${alias}`).text,
      "学校招生学费",
    );
  for (const meta of [
    '<meta charset="gbk">',
    '<meta http-equiv="Content-Type" content="text/html; charset=gb2312">',
  ])
    assert.ok(
      decodeWebText(
        Buffer.concat([Buffer.from(meta), chinese]),
        "text/html",
      ).text.endsWith("学校招生学费"),
    );
  assert.equal(decodeWebText(chinese, "text/html").text, "学校招生学费");
  const bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("学校招生"),
  ]);
  assert.equal(decodeWebText(bom, "text/html; charset=gbk").text, "学校招生");
  assert.equal(
    decodeWebText(Buffer.from("学校招生"), "text/html; charset=unknown").text,
    "学校招生",
  );
  assert.equal(
    decodeWebText(
      Buffer.from([0xbe, 0xc7, 0xb6, 0x4f]),
      "text/html; charset=big5",
    ).text,
    "學費",
  );
});

test("GBK is decoded after bounded decompression in the injected reader", async () => {
  const bytes = Buffer.from("d1a7d0a3d5d0c9fad1a7b7d1", "hex");
  for (const headers of [
    { "content-type": "text/html; charset=gb2312" },
    { "content-type": "text/html" },
  ]) {
    const result = await fixture([
      {
        headers: { ...headers, "content-encoding": "gzip" },
        bytes: gzipSync(bytes),
      },
    ]).reader(initial, options);
    assert.equal(result.text, "学校招生学费");
    assert.equal(result.encoding, "gb18030");
  }
});

test("gzip, x-gzip, deflate and br decode under separate compressed and expanded limits", async () => {
  const text = "学校招生资料";
  for (const [encoding, compress] of [
    ["gzip", gzipSync],
    ["x-gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ] as const) {
    const f = fixture([
      {
        headers: { "content-encoding": encoding },
        bytes: compress(Buffer.from(text)),
      },
    ]);
    assert.equal((await f.reader(initial, options)).text, text);
    await assert.rejects(
      fixture([
        {
          headers: { "content-encoding": encoding },
          bytes: compress(Buffer.alloc(1000, 65)),
        },
      ]).reader(initial, { ...options, maxBytes: 100 }),
      { code: "WEB_TOO_LARGE" },
    );
    await assert.rejects(
      fixture([
        {
          headers: { "content-encoding": encoding },
          bytes: Buffer.from("broken"),
        },
      ]).reader(initial, options),
      { code: "WEB_DECODE_FAILED" },
    );
  }
});

test("HTTP and network errors retain specific failure codes with Chinese user messages", async () => {
  for (const status of [403, 404, 410, 429, 500, 502, 503, 504, 418, 501]) {
    const code =
      status === 418
        ? "HTTP_4XX"
        : status === 501
          ? "HTTP_5XX"
          : `HTTP_${status}`;
    await assert.rejects(fixture([{ status }]).reader(initial, options), {
      code,
    });
    assert.match(researchReason(code), /[\p{Script=Han}]/u);
  }
  for (const [error, code] of [
    ["ECONNRESET", "WEB_CONNECTION_RESET"],
    ["ECONNREFUSED", "WEB_CONNECTION_REFUSED"],
    ["ENETUNREACH", "WEB_UNAVAILABLE"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "WEB_TLS_CERT"],
    ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "WEB_TLS_CERT"],
    ["CERT_HAS_EXPIRED", "WEB_TLS_CERT"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "WEB_TLS_CERT"],
  ]) {
    await assert.rejects(
      fixture([{ error }]).reader(initial, options),
      (err: any) =>
        err.code === code && (code !== "WEB_TLS_CERT" || err.tlsCode === error),
    );
    assert.match(researchReason(code), /[\p{Script=Han}]/u);
  }
});

test("relative document and location links use final URL while preserving original source URL", () => {
  const parent = {
    id: "parent",
    url: initial,
    finalUrl: "http://yjs.school.edu.cn/admissions/2027/index.html",
    transport: "http" as const,
    title: "学校硕士招生",
    kind: "official_page" as const,
    verified: false as const,
    excerpt: "学校招生",
    retrievedAt: new Date().toISOString(),
  };
  assert.equal(
    researchAttachments(
      parent,
      '<a href="catalog.pdf">2027硕士招生专业目录</a>',
    )[0].url,
    "http://yjs.school.edu.cn/admissions/2027/catalog.pdf",
  );
  assert.equal(
    researchLocationLinks(parent, '<a href="campus.html">校区地址</a>')[0].url,
    "http://yjs.school.edu.cn/admissions/2027/campus.html",
  );
  assert.equal(parent.url, initial);
});

test("probe has at most four readers and serializes each host; aggregates safe failure details", async () => {
  let active = 0,
    peak = 0;
  const hosts = new Set<string>();
  const schools = new Set<string>();
  const report = await probeSites(
    [
      "https://a.edu.cn/1",
      "http://a.edu.cn/2",
      "https://yjs.a.edu.cn/3",
      ...Array.from({ length: 7 }, (_, i) => `https://s${i}.edu.cn/`),
    ],
    {
      concurrency: 99,
      reader: async (url: string, opts: any) => {
        const host = new URL(url).hostname;
        const school = registrableDomain(host);
        assert.equal(schools.has(school), false);
        schools.add(school);
        assert.equal(hosts.has(host), false);
        hosts.add(host);
        peak = Math.max(peak, ++active);
        assert.equal(opts.maxRedirects, 3);
        assert.equal(opts.allowHttp, true);
        assert.equal(opts.maxBytes, 512000);
        await new Promise((resolve) => setTimeout(resolve, 2));
        --active;
        hosts.delete(host);
        schools.delete(school);
        if (host === "a.edu.cn")
          throw Object.assign(new Error("mock"), {
            code: "WEB_TLS_CERT",
            tlsCode: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          });
        return {
          text: "学校招生",
          contentType: "text/html",
          finalUrl: url,
          transport: "https",
          encoding: "utf-8",
        };
      },
    },
  );
  assert.ok(peak <= 4);
  assert.equal(report.summary.total, 10);
  assert.equal(report.summary.success, 8);
  assert.equal(report.summary.failures.WEB_TLS_CERT, 2);
  assert.equal(report.summary.tlsCodes.UNABLE_TO_VERIFY_LEAF_SIGNATURE, 2);
});
