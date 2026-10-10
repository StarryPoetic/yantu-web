import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import {
  robotsAllows,
  createPoliteReader,
} from "../../server/explanation/robots.ts";
import { probeChsi } from "../../server/explanation/chsi-probe.ts";
import {
  isSchoolPage,
  sourcePriority,
} from "../../server/explanation/research-evidence.ts";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import { schoolRegistry } from "../../server/schools/index.ts";
import type { SchoolRegistryEntry } from "../../server/schools/index.ts";
import {
  prefetchSchools,
  parseArguments,
  discoverLinks,
} from "../../scripts/prefetch-schools.mjs";
import type { WebReader, WebSource } from "../../server/explanation/web.ts";

const school = schoolRegistry.byName("杭州电子科技大学")!;
const root = "https://grs.hdu.edu.cn/";
const catalogue =
  "杭州电子科技大学2027年硕士研究生招生专业目录。\n080200 机械工程 全日制 ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合";
function fakeClock() {
  let clock = Date.parse("2026-10-11T00:00:00Z");
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}
function registryFor(schools = [school]) {
  return {
    ...schoolRegistry,
    schools,
    discoveryUrls: (s: SchoolRegistryEntry) => [
      `https://grs.${s.registrableDomain}/`,
    ],
  };
}

test("robots respects wildcard, project UA precedence, merged groups, longest-match Allow, queries and malformed responses", () => {
  const text =
    "User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\nAllow: /public.pdf$";
  assert.equal(robotsAllows(text, `${root}private/a`), false);
  assert.equal(robotsAllows(text, `${root}private/public`), true);
  assert.equal(robotsAllows(text, `${root}a.pdf`), false);
  assert.equal(robotsAllows(text, `${root}public.pdf`), true);
  assert.equal(robotsAllows(text, `${root}a.pdf?download=1`), true);
  assert.equal(
    robotsAllows(
      "User-agent: *\nDisallow: /\nUser-agent: YantuEvidence\nAllow: /allowed\nDisallow: /\nUser-agent: YantuEvidence\nAllow: /second",
      `${root}second`,
    ),
    true,
  );
  assert.equal(robotsAllows("User-agent: *\nDisallow:", root), true);
  assert.throws(() => robotsAllows("<html>Access denied</html>", root));
  assert.throws(() => robotsAllows("User-agent: *\nDisallow: invalid", root));
});

test("prefetch records robots prohibit/5xx/timeout, allows 404, serializes each host with one-second fake-clock gaps", async () => {
  for (const status of [
    "404",
    "500",
    "timeout",
    "disallow",
    "allow",
  ] as const) {
    const clock = fakeClock(),
      store = new Store();
    const library = createResearchEvidenceLibrary(store, clock);
    const requests: { url: string; at: number }[] = [];
    const reader: WebReader = async (url) => {
      requests.push({ url, at: clock.now() });
      if (url.endsWith("robots.txt")) {
        if (["404", "500", "timeout"].includes(status))
          throw Object.assign(new Error(), {
            code: status === "timeout" ? "WEB_TIMEOUT" : `HTTP_${status}`,
          });
        return {
          text: `User-agent: *\n${status === "disallow" ? "Disallow: /" : "Allow: /"}`,
          contentType: "text/plain",
        };
      }
      return {
        text: `<title>硕士研究生招生</title>${catalogue}<a href='/catalog'>招生专业目录</a>`,
        contentType: "text/html",
      };
    };
    try {
      const summary = await prefetchSchools(
        { school: [school.name], maxPagesPerSchool: 2 },
        { registry: registryFor(), library, reader, ...clock },
      );
      if (["404", "allow"].includes(status)) {
        assert.equal(summary.successfulPages, 2);
        assert.ok(
          requests.every((r, i) => !i || r.at - requests[i - 1].at >= 1000),
        );
        assert.ok(summary.factsByField.catalog.bound > 0);
      } else {
        assert.equal(summary.successfulPages, 0);
        assert.equal(summary.robotsSkipped, 1);
        assert.equal(requests.length, 1);
        assert.equal(
          library.attempts()[0].reason,
          status === "disallow" ? "ROBOTS_DISALLOWED" : "ROBOTS_UNAVAILABLE",
        );
      }
    } finally {
      store.close();
    }
  }
});

test("only actual same-school relevant links and depth two are read; fresh pages skip unless refreshed; no search/model calls", async () => {
  const store = new Store(),
    clock = fakeClock(),
    library = createResearchEvidenceLibrary(store, clock);
  const reads: string[] = [];
  const reader: WebReader = async (url) => {
    reads.push(url);
    if (url.endsWith("robots.txt"))
      return { text: "User-agent: *\nAllow: /", contentType: "text/plain" };
    const path = new URL(url).pathname;
    const next = path === "/" ? "/one" : path === "/one" ? "/two" : "/three";
    return {
      text: `${catalogue}<a href='${next}'>研究生招生简章</a><a href='https://zju.edu.cn/foreign'>硕士招生简章</a><a href='http://127.0.0.1/internal'>研究生招生</a><a href='/news'>学校新闻</a>`,
      contentType: "text/html",
    };
  };
  try {
    const dependencies = {
      registry: registryFor(),
      library,
      reader,
      ...clock,
      search: () => assert.fail("paid search"),
      model: () => assert.fail("model"),
    };
    assert.equal(
      (await prefetchSchools({ school: [school.name] }, dependencies))
        .successfulPages,
      3,
    );
    assert.ok(
      !reads.some((url) => /three|foreign|127\.0\.0\.1|news/.test(url)),
    );
    assert.equal(
      (await prefetchSchools({ school: [school.name] }, dependencies))
        .skippedFreshPages,
      1,
    );
    assert.equal(
      (
        await prefetchSchools(
          { school: [school.name], refresh: true },
          dependencies,
        )
      ).successfulPages,
      3,
    );
    const links = discoverLinks(
      `<a href='/file.pdf'>附件下载</a><a href='/file.xlsx'>收费标准附件</a>`,
      root,
      school,
      "硕士招生目录",
    );
    assert.equal(links.length, 2);
    assert.ok(links.every((l) => l.attachment));
  } finally {
    store.close();
  }
});

test("global host concurrency stays at four and no host overlaps while multiple schools are queued", async () => {
  const schools = schoolRegistry.schools
    .filter((s) => s.registrableDomain.endsWith(".edu.cn"))
    .slice(0, 9);
  const clock = fakeClock(),
    store = new Store(),
    library = createResearchEvidenceLibrary(store, clock);
  let active = 0,
    peak = 0;
  const hosts = new Set<string>();
  const reader: WebReader = async (url) => {
    const host = new URL(url).hostname;
    assert.equal(hosts.has(host), false);
    hosts.add(host);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    hosts.delete(host);
    active--;
    return {
      text: url.endsWith("robots.txt")
        ? "User-agent: *\nAllow: /"
        : "学校招生导航",
      contentType: "text/plain",
    };
  };
  try {
    const summary = await prefetchSchools(
      { maxPagesPerSchool: 1 },
      { registry: registryFor(schools), library, reader, ...clock },
    );
    assert.equal(summary.attemptedSchools, 9);
    assert.equal(summary.successfulPages, 9);
    assert.equal(peak, 4);
  } finally {
    store.close();
  }
});

test("linked PDF and spreadsheet use the existing parsers' reader options and validated public parent provenance", async () => {
  const store = new Store(),
    clock = fakeClock(),
    library = createResearchEvidenceLibrary(store, clock);
  const reader: WebReader = async (url, options) => {
    if (url.endsWith("robots.txt"))
      return { text: "User-agent: *\nAllow: /", contentType: "text/plain" };
    if (/\.(pdf|xlsx)$/.test(url)) {
      assert.equal(options.allowPdf, true);
      assert.equal(options.allowSpreadsheet, true);
      assert.equal(options.maxPdfBytes, 5000000);
      assert.equal(options.maxSpreadsheetBytes, 5000000);
      return {
        text: "机械工程学院\n080200 机械工程 全日制 ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合",
        contentType: url.endsWith("pdf")
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }
    return {
      text: "<title>杭州电子科技大学2027年硕士研究生招生专业目录</title>杭州电子科技大学2027年硕士研究生招生专业目录。<a href='/catalogue.pdf'>2027年硕士研究生招生专业目录附件</a><a href='/catalogue.xlsx'>2027年硕士研究生招生专业目录表格</a>",
      contentType: "text/html",
    };
  };
  try {
    const summary = await prefetchSchools(
      { maxPagesPerSchool: 3 },
      { registry: registryFor(), library, reader, ...clock },
    );
    assert.equal(summary.successfulPages, 3);
    assert.equal(summary.factsByField.catalog.bound, 2);
    assert.equal(summary.factsByField.exams.bound, 2);
    const sources = library.load({
      disciplineCodes: ["0802"],
      schoolNames: [school.name],
      targetYear: "2027",
    });
    assert.ok(
      sources
        .filter((s) => /\.(pdf|xlsx)$/.test(s.url))
        .every((s) => s.provenance?.institutionName === school.name),
    );
  } finally {
    store.close();
  }
});

test("redirect hops check robots before connection, including an initially allowed school's other host", async () => {
  const reads: string[] = [],
    clock = fakeClock();
  const reader: WebReader = async (url, options) => {
    reads.push(url);
    if (url.endsWith("robots.txt"))
      return {
        text: new URL(url).hostname.startsWith("blocked")
          ? "User-agent: *\nDisallow: /"
          : "User-agent: *\nAllow: /",
        contentType: "text/plain",
      };
    await options.beforeRequest?.(url);
    await options.beforeRequest?.("https://blocked.hdu.edu.cn/catalog");
    assert.fail("forbidden redirected page must never connect");
  };
  await assert.rejects(
    createPoliteReader(reader, clock)(root, {
      allowedHosts: ["grs.hdu.edu.cn"],
    }),
    { code: "ROBOTS_DISALLOWED" },
  );
  assert.ok(reads.includes("https://blocked.hdu.edu.cn/robots.txt"));
});

test("dry-run opens no database and makes no reader/search/model requests; CLI validates DNS, filters and page bounds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prefetch-dry-")),
    path = join(dir, "unused.sqlite");
  try {
    const args = parseArguments([
      "--city",
      "杭州",
      "--province",
      "浙江",
      "--school",
      school.name,
      "--school",
      "浙江大学",
      "--discipline",
      "0802",
      "--max-pages-per-school",
      "2",
      "--db",
      path,
      "--dns-mode",
      "public-doh",
      "--dry-run",
    ]);
    assert.equal(args.dnsMode, "public-doh");
    const summary = await prefetchSchools(args, {
      reader: () => assert.fail("dry read"),
      search: () => assert.fail("search"),
      model: () => assert.fail("model"),
    });
    assert.equal(summary.attemptedSchools, 2);
    assert.equal(summary.successfulPages, 0);
    assert.equal(existsSync(path), false);
    for (const args of [
      ["--dns-mode", "proxy"],
      ["--max-pages-per-school", "0"],
      ["--school"],
      ["--discipline", "080200"],
    ])
      assert.throws(() => parseArguments(args));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CHSI robots prohibition, JS templates and unavailable pages safely degrade; platform never becomes a school domain or fact", async () => {
  for (const mode of ["dynamic", "blocked", "unavailable"]) {
    const reads: string[] = [];
    const reader: WebReader = async (url) => {
      reads.push(url);
      if (url.endsWith("robots.txt"))
        return {
          text:
            mode === "blocked"
              ? "User-agent: *\nDisallow: /"
              : "User-agent: *\nAllow: /",
          contentType: "text/plain",
        };
      if (mode === "unavailable")
        throw Object.assign(new Error(), { code: "HTTP_503" });
      return {
        text: "硕士专业目录 {{curYear}} {{item.zydm}} 数据加载中",
        contentType: "text/html",
      };
    };
    const result = await probeChsi(reader, fakeClock());
    assert.ok(result.every((r) => r.status === "safe_fallback"));
    if (mode === "blocked") assert.equal(reads.length, 1);
  }
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, {
      allowedHosts: ["yz.chsi.com.cn"],
    });
  try {
    for (const excerpt of [
      catalogue,
      catalogue.replace("杭州电子科技大学", "未登记大学"),
    ]) {
      const source: WebSource = {
        id: "chsi",
        url: "https://yz.chsi.com.cn/zsml/",
        title: "硕士专业目录",
        excerpt,
        kind: "official_page",
        verified: false,
        retrievedAt: new Date().toISOString(),
      };
      assert.equal(isSchoolPage(source), false);
      assert.ok(
        sourcePriority(
          source,
          getDisciplineCatalog().items.find((d) => d.code === "0802")!,
        ) < 100,
      );
      library.save(source);
      assert.deepEqual(library.queryFacts({ targetYear: "2027" }), []);
    }
    assert.equal(schoolRegistry.byHost("yz.chsi.com.cn"), undefined);
  } finally {
    store.close();
  }
});
