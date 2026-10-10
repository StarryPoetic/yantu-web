import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import {
  normalizeAttachedEvidence,
  validatedSourceProvenance,
} from "../../server/explanation/research-provenance.ts";
import { safeSourceYear } from "../../server/explanation/research-years.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const time = Date.parse("2026-10-04T08:00:00Z");
const school = "杭州电子科技大学";
const request = { disciplineCodes: ["0802"], targetYear: "2027" };
function source(overrides: Partial<WebSource> = {}): WebSource {
  return {
    id: "research-1",
    title: "官网招生目录",
    url: "https://grs.hdu.edu.cn/catalog.htm",
    retrievedAt: new Date(time - 1000).toISOString(),
    excerpt: `${school}\n2026年硕士研究生招生专业目录。\n080200 机械工程 ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合`,
    kind: "official_page",
    verified: false,
    ...overrides,
  };
}
function memory() {
  const store = new Store();
  return {
    store,
    library: createResearchEvidenceLibrary(store, { now: () => time }),
  };
}

test("labelled academic HTTP evidence keeps final URL, warning and TLS diagnostics across SQLite restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "yantu-http-library-"));
  const path = join(directory, "public.sqlite");
  let store = new Store(path);
  try {
    const library = createResearchEvidenceLibrary(store, { now: () => time });
    library.save(
      source({
        url: "http://grs.hdu.edu.cn/catalog.htm",
        finalUrl: "https://yjs.hdu.edu.cn/2026/catalog.htm",
        transport: "http",
      }),
    );
    library.recordAttempt({
      url: "https://grs.hdu.edu.cn/",
      status: "failed",
      reason: "WEB_TLS_CERT",
      tlsCode: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      attemptedAt: new Date(time).toISOString(),
    });
    store.close();
    store = new Store(path);
    const reopened = createResearchEvidenceLibrary(store, { now: () => time });
    const loaded = reopened.load(request)[0];
    assert.equal(loaded.url, "http://grs.hdu.edu.cn/catalog.htm");
    assert.equal(loaded.finalUrl, "https://yjs.hdu.edu.cn/2026/catalog.htm");
    assert.equal(loaded.transport, "http");
    assert.equal(loaded.verified, false);
    assert.match(loaded.retrievalNote!, /明文传输.*待核验.*复用/);
    assert.equal(
      reopened.attempts()[0].tlsCode,
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("new read failure codes survive persistence and certificate details are sanitized", () => {
  const { store, library } = memory();
  try {
    const codes = [
      "WEB_REDIRECT_CROSS_SITE",
      "WEB_REDIRECT_LIMIT",
      "WEB_DECODE_FAILED",
      "WEB_CONNECTION_RESET",
      "WEB_CONNECTION_REFUSED",
      "WEB_TLS_CERT",
      "HTTP_410",
      "HTTP_4XX",
      "HTTP_5XX",
      "WEB_DNS_INVALID_RESPONSE",
    ];
    for (const [i, reason] of codes.entries())
      library.recordAttempt({
        url: `https://grs.hdu.edu.cn/${i}`,
        status: "failed",
        reason,
        tlsCode: "PRIVATE detail",
        attemptedAt: new Date(time).toISOString(),
      });
    assert.deepEqual(
      library
        .attempts()
        .map((a) => a.reason)
        .sort(),
      [...codes].sort(),
    );
    assert.ok(library.attempts().every((a) => a.tlsCode === undefined));
    library.save(
      source({ finalUrl: "https://yzb.pku.edu.cn/other", transport: "https" }),
    );
    assert.equal(library.load(request)[0].finalUrl, undefined);
  } finally {
    store.close();
  }
});

test("public evidence survives SQLite restart and is reusable without any user or guidance context", () => {
  const directory = mkdtempSync(join(tmpdir(), "yantu-public-library-"));
  const path = join(directory, "public.sqlite");
  let store = new Store(path);
  try {
    const first = createResearchEvidenceLibrary(store, { now: () => time });
    first.save(source());
    const a = first.load(request);
    assert.equal(a.length, 1);
    assert.match(a[0].id, /^library-[a-f0-9]{24}$/);
    store.close();
    store = new Store(path);
    const second = createResearchEvidenceLibrary(store, { now: () => time });
    const b = second.load(request);
    assert.deepEqual(b, a);
    assert.equal(b[0].verified, false);
    assert.equal(b[0].retrievedAt, source().retrievedAt);
    assert.match(b[0].retrievalNote!, /不代表新抓取/);
    assert.deepEqual(
      second.load({ ...request, disciplineCodes: ["0301"] }),
      [],
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("only explicit public transport fields persist; private and model extensions never enter SQLite", () => {
  const { store, library } = memory();
  try {
    library.save({
      ...source(),
      subjectId: "PRIVATE_ACCOUNT",
      profile: { city: "PRIVATE_CITY" },
      question: "PRIVATE_QUERY",
      recommendations: "PRIVATE_MODEL",
      retrievalNote: "PRIVATE_PROVIDER_DETAIL",
      library: { secret: "PRIVATE_CACHE" },
    } as unknown as WebSource);
    const payload = store.db
      .prepare("SELECT payload FROM research_public_sources")
      .get()!.payload as string;
    assert.doesNotMatch(payload, /PRIVATE_/);
    const loaded = library.load(request)[0];
    assert.equal(loaded.excerpt, source().excerpt);
    assert.deepEqual(
      Object.keys(JSON.parse(payload)).sort(),
      [
        "id",
        "title",
        "url",
        "retrievedAt",
        "excerpt",
        "kind",
        "verified",
        "transport",
      ].sort(),
    );
    library.recordAttempt({
      url: source().url,
      status: "failed",
      attemptedAt: new Date(time).toISOString(),
      reason: "PROFILE_PRIVATE_ACCOUNT HTTP detail",
    });
    assert.equal(library.attempts()[0].reason, "READ_FAILED");
    const diagnostic = JSON.stringify(
      store.db.prepare("SELECT * FROM research_public_read_attempts").all(),
    );
    assert.doesNotMatch(diagnostic, /PRIVATE_/);
  } finally {
    store.close();
  }
});

test("search snippets, promoted verification, unsafe hosts, secrets and empty error bodies cannot enter the library", () => {
  const { store, library } = memory();
  try {
    const invalid = [
      source({ kind: "search_snippet" }),
      source({ verified: true } as unknown as Partial<WebSource>),
      source({ excerpt: " \n " }),
      source({ excerpt: "403 Forbidden" }),
      source({ excerpt: "验证码：请完成验证后再访问" }),
      ...[
        "http://www.chsi.com.cn/page",
        "https://localhost/page",
        "https://127.0.0.1/page",
        "https://grs.hdu.edu.cn.evil.com/page",
        "https://u:p@grs.hdu.edu.cn/page",
        "https://grs.hdu.edu.cn:8080/page",
        "https://grs.hdu.edu.cn/page?token=PRIVATE",
        "https://grs.hdu.edu.cn/search?query=PRIVATE",
        "https://grs.hdu.edu.cn/search?searchKeyword=PRIVATE",
        "https://grs.hdu.edu.cn/page;jsessionid=PRIVATE",
        "https://www.chsi.com.cn/page",
      ].map((url) => source({ url })),
    ];
    for (const item of invalid) library.save(item);
    assert.deepEqual(library.load(request), []);
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS total FROM research_public_sources")
        .get()!.total,
      0,
    );
  } finally {
    store.close();
  }
});

test("explicit additional official hosts are exact and are rechecked when factory permissions change", () => {
  const store = new Store();
  try {
    const allowed = createResearchEvidenceLibrary(store, {
      now: () => time,
      allowedHosts: ["yz.chsi.com.cn"],
    });
    allowed.save(source({ url: "https://yz.chsi.com.cn/zsml?id=123#top" }));
    allowed.save(source({ url: "https://evil.yz.chsi.com.cn/catalog" }));
    assert.equal(allowed.load(request).length, 1);
    assert.equal(
      allowed.load(request)[0].url,
      "https://yz.chsi.com.cn/zsml?id=123",
    );
    assert.deepEqual(
      createResearchEvidenceLibrary(store, { now: () => time }).load(request),
      [],
    );
  } finally {
    store.close();
  }
});

test("failed reads, empty responses and older concurrent responses preserve the latest successful body", () => {
  const { store, library } = memory();
  try {
    library.save(source());
    const updated = source({
      retrievedAt: new Date(time).toISOString(),
      excerpt: source().excerpt.replace("201英语（一）", "204英语（二）"),
    });
    library.save(updated);
    library.save(
      source({ retrievedAt: new Date(time - 100).toISOString(), excerpt: "" }),
    );
    library.save(source());
    library.recordAttempt({
      url: updated.url,
      status: "failed",
      reason: "HTTP_403",
      attemptedAt: new Date(time).toISOString(),
    });
    const loaded = library.load(request);
    assert.equal(loaded[0].excerpt, updated.excerpt);
    assert.equal(loaded[0].retrievedAt, updated.retrievedAt);
    assert.equal(loaded[0].library!.version, 2);
    assert.equal(library.attempts()[0].reason, "HTTP_403");
  } finally {
    store.close();
  }
});

test("same URL content replacement refreshes related indexes and never leaves an obsolete programme behind", () => {
  const { store, library } = memory();
  try {
    library.save(source());
    const updated = source({
      excerpt: "南京大学\n2027年硕士研究生招生专业目录。\n030100 法学",
      retrievedAt: new Date(time).toISOString(),
    });
    library.save(updated);
    assert.deepEqual(library.load(request), []);
    assert.deepEqual(
      library.load({
        disciplineCodes: [],
        schoolNames: [school],
        targetYear: "2027",
      }),
      [],
    );
    const law = library.load({
      disciplineCodes: ["0301"],
      schoolNames: ["南京大学"],
      targetYear: "2027",
    });
    assert.equal(law.length, 1);
    assert.equal(law[0].excerpt, updated.excerpt);
    assert.equal(law[0].library!.version, 2);
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS total FROM research_public_sources")
        .get()!.total,
      1,
    );
  } finally {
    store.close();
  }
});

test("unchanged successful revalidation updates retrieval time without inflating version; cache save never refreshes itself", () => {
  let clock = time;
  const store = new Store();
  const library = createResearchEvidenceLibrary(store, { now: () => clock });
  try {
    library.save(source());
    const unchanged = source({ retrievedAt: new Date(time).toISOString() });
    library.save(unchanged);
    const original = library.load(request)[0];
    assert.equal(original.library!.version, 1);
    assert.equal(original.retrievedAt, unchanged.retrievedAt);
    clock += 10 * 24 * 60 * 60 * 1000;
    library.save(original);
    const cached = library.load(request)[0];
    assert.equal(cached.library!.storedAt, original.library!.storedAt);
    assert.equal(cached.library!.expiresAt, original.library!.expiresAt);
    assert.equal(cached.retrievedAt, original.retrievedAt);
  } finally {
    store.close();
  }
});

test("recall uses body-derived subjects and policy years, not search titles, copyright or unrelated school disciplines", () => {
  const { store, library } = memory();
  try {
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/old",
        excerpt: `${school}\n2023年硕士研究生招生专业目录。080200机械工程`,
      }),
    );
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/law",
        excerpt: `${school}\n2026年硕士研究生招生专业目录。030100法学`,
      }),
    );
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/policy",
        excerpt: `${school}\n2026年硕士研究生收费标准。全校学费每年8000元。`,
      }),
    );
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/fake-title",
        title: "2026年机械工程080200招生目录",
        excerpt: "大学通知。页面维护中。Copyright2026",
      }),
    );
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/mixed-old",
        excerpt: `${school}\n2023年硕士招生目录和2022年硕士招生目录：080200机械工程`,
      }),
    );
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/undated",
        title: "2027年目录",
        excerpt: `${school}\n080200机械工程招生要求。发布时间2027-01-01。版权所有2027`,
      }),
    );
    const loaded = library.load({ ...request, schoolNames: [school] });
    assert.deepEqual(
      new Set(loaded.map((item) => new URL(item.url).pathname)),
      new Set(["/policy", "/undated"]),
    );
    assert.equal(
      safeSourceYear(loaded.find((item) => item.url.endsWith("/undated"))!),
      undefined,
    );
    assert.deepEqual(
      library.load({ disciplineCodes: [], targetYear: "2027" }),
      [],
    );
    assert.deepEqual(library.load({ ...request, targetYear: "2027年" }), []);
  } finally {
    store.close();
  }
});

test("linked anonymous attachments preserve exact words, safe year and stable parent provenance across reuse", () => {
  const { store, library } = memory();
  try {
    const url = "https://grs.hdu.edu.cn/files/catalog.xlsx";
    const parent = source({
      excerpt: `${school}\n2027年硕士研究生招生专业目录。下载附件。`,
      documentLinks: [
        { url, title: "2027年硕士研究生招生专业目录.xlsx" },
        {
          url: "https://grs.hdu.edu.cn/file?token=PRIVATE",
          title: "PRIVATE_LINK",
        },
      ],
    });
    const child = normalizeAttachedEvidence(
      source({
        id: "child",
        url,
        parentSourceId: parent.id,
        excerpt:
          "080200 机械工程\n初试101思想政治理论 201英语一 301数学一 812机械工程综合",
      }),
      parent,
      "080200 机械工程\n初试101思想政治理论 201英语一 301数学一 812机械工程综合",
    );
    assert.ok(validatedSourceProvenance(child));
    library.save(parent);
    library.save(child);
    const loaded = library.load({ ...request, schoolNames: [school] });
    const savedParent = loaded.find((item) => item.url === parent.url)!;
    const savedChild = loaded.find((item) => item.url === child.url)!;
    assert.equal(savedParent.documentLinks!.length, 1);
    assert.equal(savedChild.excerpt, child.excerpt);
    assert.equal(savedChild.parentSourceId, savedParent.id);
    assert.equal(
      validatedSourceProvenance(savedChild)!.institutionName,
      school,
    );
    assert.equal(safeSourceYear(savedChild), 2027);
    assert.equal(savedChild.verified, false);
    library.save(savedChild);
    assert.equal(library.load(request)[0].library!.version, 1);
  } finally {
    store.close();
  }
});

test("target policies expire quickly, historical policies last longer, and stale evidence keeps its original fetch time", () => {
  let clock = time;
  const store = new Store();
  const library = createResearchEvidenceLibrary(store, { now: () => clock });
  try {
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/2027",
        excerpt: source().excerpt.replace("2026年", "2027年"),
      }),
    );
    library.save(source({ url: "https://grs.hdu.edu.cn/2026" }));
    assert.ok(
      library.load(request).every((item) => item.library!.status === "fresh"),
    );
    clock += 2 * 24 * 60 * 60 * 1000;
    const target = library
      .load(request)
      .find((item) => item.url.endsWith("2027"))!;
    const historical = library
      .load(request)
      .find((item) => item.url.endsWith("2026"))!;
    assert.equal(target.library!.status, "stale");
    assert.equal(historical.library!.status, "fresh");
    assert.equal(target.retrievedAt, source().retrievedAt);
    assert.match(target.retrievalNote!, /需重新读取官网确认/);
    clock += 30 * 24 * 60 * 60 * 1000;
    assert.ok(
      library.load(request).every((item) => item.library!.status === "stale"),
    );
  } finally {
    store.close();
  }
});

test("limits remain bounded and known current changes stay visible beside the historical baseline", () => {
  const { store, library } = memory();
  try {
    for (let index = 0; index < 50; index++)
      library.save(source({ url: `https://grs.hdu.edu.cn/history-${index}` }));
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/current",
        excerpt: source().excerpt.replace("2026年", "2027年"),
      }),
    );
    assert.equal(library.load({ ...request, maxSources: 1000 }).length, 40);
    assert.equal(library.load(request).length, 24);
    assert.deepEqual(library.load({ ...request, maxSources: 0 }), []);
    const pair = library.load({ ...request, maxSources: 2 });
    assert.equal(safeSourceYear(pair[0]), 2026);
    assert.equal(safeSourceYear(pair[1]), 2027);
    for (let index = 0; index < 260; index++)
      library.save(
        source({
          url: `https://grs.hdu.edu.cn/target-${index}`,
          excerpt: source().excerpt.replace("2026年", "2027年"),
        }),
      );
    assert.equal(
      safeSourceYear(library.load({ ...request, maxSources: 2 })[0]),
      2026,
    );
    library.save(
      source({
        url: "https://grs.hdu.edu.cn/cancellation",
        excerpt: `${school}\n2027年硕士研究生招生专业目录调整：080200机械工程暂停招生。`,
      }),
    );
    assert.match(
      library.load({ ...request, maxSources: 1 })[0].excerpt,
      /暂停招生/,
    );
  } finally {
    store.close();
  }
});

test("attempt diagnostics are bounded, filterable and independent from source retention", () => {
  const { store, library } = memory();
  try {
    library.save(source());
    for (let index = 0; index < 25; index++)
      library.recordAttempt({
        url: source().url,
        status: index === 24 ? "success" : "failed",
        reason: "TIMEOUT",
        attemptedAt: new Date(time - index * 1000).toISOString(),
      });
    library.recordAttempt({
      url: "https://grs.hdu.edu.cn/other",
      status: "failed",
      reason: "HTTP_404",
      attemptedAt: new Date(time).toISOString(),
    });
    library.recordAttempt({
      url: "https://grs.hdu.edu.cn/?query=PRIVATE",
      status: "failed",
      reason: "TIMEOUT",
      attemptedAt: new Date(time).toISOString(),
    });
    assert.equal(library.attempts([source().url]).length, 20);
    assert.equal(library.attempts().length, 21);
    assert.deepEqual(library.attempts([]), []);
    assert.deepEqual(
      library.attempts(["https://grs.hdu.edu.cn/?query=PRIVATE"]),
      [],
    );
    assert.equal(
      library.attempts(["https://grs.hdu.edu.cn/other"])[0].reason,
      "HTTP_404",
    );
    assert.equal(library.load(request)[0].excerpt, source().excerpt);
  } finally {
    store.close();
  }
});
