import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import { schoolRegistry } from "../../server/schools/index.ts";
import {
  priorityFixturePages,
  matchingPriorityPages,
} from "../helpers/research-priority-fixture.ts";
import {
  extractPriorityFacts,
  priorityCoverage,
  validatePriorityFacts,
} from "../../server/explanation/research-priority-facts.ts";
import { redactAdmissionsText } from "../../server/explanation/research-priority-tables.ts";
import {
  missingPriorityQueries,
  collectMissingPriorityEvidence,
} from "../../server/explanation/research-targeted.ts";
import { createResearchCollector } from "../../server/explanation/research-collection.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import { createResilientPublicDohResolver } from "../../server/explanation/dns.ts";
import { resolvePublicAddress } from "../../server/explanation/public-address.ts";
import { researchDocumentPriority } from "../../server/explanation/research-document-priority.ts";
import type { WebSource } from "../../server/explanation/web.ts";
const discipline = getDisciplineCatalog().items.find((d) => d.code === "0802")!;
const school = schoolRegistry.schools.find(
  (s) => s.name === "杭州电子科技大学",
)!;
const pages = priorityFixturePages(school);
const source = (p: (typeof pages)[number]): WebSource => ({
  id: p.url,
  url: p.url,
  title: p.title,
  excerpt: p.text,
  kind: "official_page",
  verified: false,
  retrievedAt: "2026-10-11T00:00:00Z",
});
test("table cutoffs, anonymous roster statistics, assessment grades and employment retain literal provenance", () => {
  const facts = pages.flatMap((p) =>
    extractPriorityFacts(source(p), [discipline], "2027", {
      total: 350,
      maximum: 500,
    }),
  );
  const coverage = priorityCoverage(
    facts,
    [
      {
        institutionName: school.name,
        disciplineCode: "0802",
        majorCode: "080200",
      },
    ],
    "2027",
  );
  assert.equal(coverage.pending, 0);
  for (const g of Object.values(coverage.groups))
    assert.deepEqual(g, { confirmed: 1, total: 1 });
  const cutoff = facts.find((f) => f.field === "cutoff")!;
  assert.equal(cutoff.value.number, 330);
  assert.equal(cutoff.value.targetGap, 20);
  assert.deepEqual(cutoff.value.singleSubject, {
    maximum100: 50,
    above100: 75,
  });
  assert.equal(cutoff.collegeName, "机械工程学院");
  const otherCollege = priorityCoverage(
    facts,
    [
      {
        institutionName: school.name,
        disciplineCode: "0802",
        majorCode: "080200",
        collegeName: "其他学院",
      },
    ],
    "2027",
  );
  assert.equal(otherCollege.schoolsWithCutoff, 0);
  assert.equal(
    facts.find((f) => f.field === "admissionScore")!.value.number,
    340,
  );
  assert.deepEqual(
    facts.find((f) => f.field === "admittedCount")!.value.statistics,
    {
      rows: 3,
      examination: 2,
      recommended: 1,
      method: "published_roster_rows",
    },
  );
  assert.equal(
    facts.find((f) => f.field === "applicationAdmissionRatio")!.value.number,
    4,
  );
  assert.equal(
    facts.find((f) => f.field === "disciplineAssessment")!.value.grade,
    "B+",
  );
  assert.equal(
    facts.find((f) => f.field === "employment")!.value.employmentRate,
    96.5,
  );
  assert.match(
    facts.find((f) => f.field === "employment")!.value.destinations!,
    /制造业/,
  );
  assert.doesNotMatch(JSON.stringify(facts), /模拟[甲乙丙]|123456789/);
  for (const f of facts) {
    const s = source(pages.find((p) => p.url === f.sourceUrl)!);
    assert.ok(s.excerpt.includes(f.quote));
    assert.ok(f.evidenceQuotes?.every((q) => s.excerpt.includes(q)) ?? true);
    assert.equal(
      validatePriorityFacts(
        [
          {
            field: f.field,
            quote: f.quote,
            sourceId: s.id,
            value: { number: 999 },
          },
        ],
        s,
        [discipline],
        "2027",
      )[0]?.value.number,
      f.value.number,
    );
  }
});
test("roster privacy strips identifiers, deduplicates repeated IDs and rejects ambiguous/unbound tables", () => {
  const roster = pages.find((p) => p.url.endsWith("roster-2026"))!;
  const safe = redactAdmissionsText(roster.text);
  assert.doesNotMatch(safe, /模拟[甲乙丙]|123456789/);
  assert.equal(redactAdmissionsText(safe), safe);
  const bad = source({
    ...roster,
    text: roster.text.replaceAll("080200", "081100"),
  });
  assert.equal(extractPriorityFacts(bad, [discipline], "2027").length, 0);
  assert.equal(
    extractPriorityFacts(
      { ...source(roster), kind: "search_snippet" },
      [discipline],
      "2027",
    ).length,
    0,
  );
  assert.equal(
    extractPriorityFacts(source(roster), [discipline], "2025").length,
    0,
  );
  const duplicated = source({
    ...roster,
    text: roster.text.replace(
      "版权所有",
      roster.text.split("\n")[2] + "\n版权所有",
    ),
  });
  assert.equal(
    extractPriorityFacts(duplicated, [discipline], "2027").find(
      (f) => f.field === "admittedCount",
    )?.value.number,
    3,
  );
  assert.doesNotMatch(
    redactAdmissionsText("拟录取名单\n姓名 考生编号\n模拟甲 123456789000001"),
    /模拟甲|123456789/,
  );
  assert.doesNotMatch(
    redactAdmissionsText(
      "拟录取名单\n姓名：模拟甲 | 考生编号：123456789000001",
    ),
    /模拟甲|123456789/,
  );
  const cutoff = pages.find((p) => p.url.endsWith("scores-2026"))!;
  assert.equal(
    extractPriorityFacts(
      source({
        ...cutoff,
        title: cutoff.title.replaceAll("硕士", "博士"),
        text: cutoff.text.replaceAll("硕士", "博士"),
      }),
      [discipline],
      "2027",
    ).length,
    0,
  );
  assert.ok(
    extractPriorityFacts(
      source({ ...cutoff, text: cutoff.text.replaceAll("080200", "0802") }),
      [discipline],
      "2027",
    ).some((f) => f.field === "cutoff" && !f.majorCode),
  );
  const employment = pages.find((p) => p.url.endsWith("employment"))!;
  const employmentTable = source({
    ...employment,
    text: `${employment.title}\n专业代码 | 专业名称 | 就业率 | 主要去向\n080200 | 机械工程 | 96.5% | 制造业、科研院所`,
  });
  assert.equal(
    extractPriorityFacts(employmentTable, [discipline], "2027").find(
      (f) => f.field === "employment",
    )?.value.employmentRate,
    96.5,
  );
});
test("Flash first DNS failure retries once and still extracts tables with shared token accounting", async () => {
  let calls = 0,
    retries = 0;
  const diagnostics: string[] = [];
  const collector = createResearchCollector({
    subjectId: "offline",
    runtime: createModelRuntime({
      adapter: {
        async complete() {
          if (++calls === 1)
            throw Object.assign(new ModelError("PROVIDER_DNS_UNAVAILABLE"), {
              dnsCode: "WEB_DNS_TIMEOUT",
            });
          return {
            content: '{"facts":[],"focus":[0,0,0,0,0],"factIds":[]}',
            inputTokens: 20,
            outputTokens: 5,
            model: "deepseek-flash",
          };
        },
      },
    }),
    check() {},
    async beforeRetry() {
      retries++;
    },
    onFailure: (c) => diagnostics.push(c),
  });
  await collector.plan([discipline], [2026, 2025, 2024]);
  const result = await collector.extract(
    pages.map(source),
    [discipline],
    "2027",
  );
  assert.equal(retries, 1);
  assert.ok(calls > 3);
  assert.ok(diagnostics.includes("COLLECTION_RETRY_PROVIDER_DNS_UNAVAILABLE"));
  assert.ok(diagnostics.includes("COLLECTION_DNS_WEB_DNS_TIMEOUT"));
  assert.equal(
    priorityCoverage(
      result.facts,
      [{ institutionName: school.name, disciplineCode: "0802" }],
      "2027",
    ).pending,
    0,
  );
});
test("public DoH falls back on temporary failure but never accepts malformed or unsafe answers", async () => {
  const hosts: string[] = [];
  const resolver = createResilientPublicDohResolver({
    fetch: async (input) => {
      const u = new URL(String(input));
      hosts.push(u.hostname);
      if (u.hostname === "dns.alidns.com")
        throw new TypeError("offline outage");
      return new Response(
        JSON.stringify({
          Status: 0,
          Question: [
            {
              name: u.searchParams.get("name"),
              type: Number(u.searchParams.get("type")),
            },
          ],
          Answer:
            u.searchParams.get("type") === "1"
              ? [{ name: u.searchParams.get("name"), type: 1, data: "8.8.8.8" }]
              : [],
        }),
        { headers: { "content-type": "application/dns-json" } },
      );
    },
  });
  assert.deepEqual(
    await resolver("api.deepseek.com", { all: true, verbatim: true }),
    [{ address: "8.8.8.8", family: 4 }],
  );
  assert.ok(hosts.includes("cloudflare-dns.com"));
  let malformedCalls = 0;
  const malformed = createResilientPublicDohResolver({
    fetch: async () => {
      malformedCalls++;
      return new Response("not json");
    },
  });
  await assert.rejects(
    malformed("api.deepseek.com", { all: true, verbatim: true }),
  );
  assert.equal(malformedCalls, 2);
  const unsafeHosts: string[] = [];
  const unsafe = createResilientPublicDohResolver({
    fetch: async (input) => {
      const u = new URL(String(input));
      unsafeHosts.push(u.hostname);
      const type = Number(u.searchParams.get("type"));
      return new Response(
        JSON.stringify({
          Status: 0,
          Question: [{ name: "api.deepseek.com", type }],
          Answer:
            type === 1
              ? [{ name: "api.deepseek.com", type, data: "127.0.0.1" }]
              : [],
        }),
        { headers: { "content-type": "application/dns-json" } },
      );
    },
  });
  await assert.rejects(resolvePublicAddress("api.deepseek.com", unsafe), {
    code: "WEB_ADDRESS_BLOCKED",
  });
  assert.equal(unsafeHosts.length, 2);
  assert.ok(unsafeHosts.every((host) => host === "dns.alidns.com"));
});
test("missing queries omit confirmed categories but retain every missing score year", () => {
  const facts = pages.flatMap((p) =>
    extractPriorityFacts(source(p), [discipline], "2027"),
  );
  assert.deepEqual(
    missingPriorityQueries(school.name, discipline, "2027", facts),
    [],
  );
  const missing = missingPriorityQueries(
    school.name,
    discipline,
    "2027",
    facts.filter((f) => f.field !== "cutoff" || f.year !== 2024),
  );
  assert.equal(missing.length, 1);
  assert.match(missing[0], /2024年.*复试基本分数线/);
  assert.equal(
    researchDocumentPriority(
      "招生简章",
      "机械工程",
      "https://gradadmission.zstu.edu.cn/bszs/zsjz.htm",
    ),
    -100,
  );
  assert.equal(
    researchDocumentPriority("生物与化学工程学院硕士招生目录", "机械工程"),
    -50,
  );
});
test("whole flow keeps collecting missing categories with spare budget and never persists roster personal cells", async () => {
  const fixture = prefilterFixture({
    cities: ["杭州"],
    schoolNames: ["杭州电子科技大学", "浙江理工大学"],
  });
  const base = fixture.config.reader!;
  const synthetic = fixture.schools.flatMap(priorityFixturePages);
  fixture.config.reader = async (url, options) => {
    if (new URL(url).hostname === "api.search.brave.com") {
      const q = new URL(url).searchParams.get("q") ?? "";
      const named = fixture.schools.find((s) => q.includes(s.name));
      const found = named
        ? matchingPriorityPages(
            synthetic.filter((p) => p.title.startsWith(named.name)),
            q,
          )
        : [];
      if (found.length)
        return {
          contentType: "application/json",
          text: JSON.stringify({
            web: {
              results: found.map((p) => ({
                url: p.url,
                title: p.title,
                description: p.title,
              })),
            },
          }),
        };
    }
    const page = synthetic.find((p) => p.url === url);
    if (page) return { contentType: "text/plain", text: page.text };
    return base(url, options);
  };
  const report = await fixture.create().generate({
    subjectId: fixture.run.subjectId,
    run: fixture.run,
    strategy: "two-stage",
    onCheckpoint: fixture.save,
  });
  assert.ok(
    report.priorityCoverage,
    JSON.stringify({
      status: report.status,
      reason: report.reason,
      limitations: report.limitations,
    }),
  );
  assert.ok(
    report.priorityCoverage!.groups.scores.confirmed > 0,
    JSON.stringify({
      usage: report.usage,
      coverage: report.priorityCoverage,
      sources: report.sources
        .filter((s) => s.kind === "official_page")
        .map((s) => s.url),
      facts: report.priorityFacts?.map((f) => [f.field, f.year]),
      queries: fixture.questions,
    }),
  );
  for (const group of Object.values(report.priorityCoverage!.groups))
    assert.ok(group.confirmed > 0);
  assert.ok(
    report.usage!.searches.paid > 17,
    "continues after the initial school pass",
  );
  assert.ok(report.usage!.searches.paid <= 72);
  assert.doesNotMatch(
    JSON.stringify(fixture.checkpoint()),
    /模拟[甲乙丙]|123456789/,
  );
});

test("permanent Flash outage has bounded calls and explicit deterministic fallback", async () => {
  let calls = 0;
  const diagnostics: string[] = [];
  const collector = createResearchCollector({
    subjectId: "offline-outage",
    runtime: createModelRuntime({
      adapter: {
        async complete() {
          calls++;
          throw new ModelError("PROVIDER_NETWORK_ERROR");
        },
      },
    }),
    check() {},
    async beforeRetry() {},
    onFailure: (c) => diagnostics.push(c),
  });
  await collector.plan([discipline], [2026, 2025, 2024]);
  const result = await collector.extract(
    pages.map(source),
    [discipline],
    "2027",
  );
  assert.equal(calls, 2);
  assert.ok(
    diagnostics.includes("COLLECTION_FALLBACK_RULES_PROVIDER_NETWORK_ERROR"),
  );
  assert.equal(
    priorityCoverage(
      result.facts,
      [{ institutionName: school.name, disciplineCode: "0802" }],
      "2027",
    ).pending,
    0,
  );
});

test("transient page reads retry once within shared budgets; TLS and missing pages stay failures", async () => {
  for (const code of [
    "WEB_TIMEOUT",
    "WEB_CONNECTION_RESET",
    "WEB_TLS_CERT",
    "HTTP_404",
  ]) {
    const f = prefilterFixture({
      cities: ["杭州"],
      schoolNames: ["杭州电子科技大学"],
    });
    const base = f.config.reader!;
    let pageCalls = 0;
    const observedFailures: Record<string, number> = {};
    f.config.reader = async (url, options) => {
      try {
        if (new URL(url).hostname === "hdu.edu.cn" && ++pageCalls === 1)
          throw new ModelError(code);
        return await base(url, options);
      } catch (error) {
        const c = error instanceof ModelError ? error.code : "WEB_UNAVAILABLE";
        observedFailures[c] = (observedFailures[c] ?? 0) + 1;
        throw error;
      }
    };
    const r = await f.create().generate({
      subjectId: f.run.subjectId,
      run: f.run,
      strategy: "two-stage",
    });
    assert.equal(r.usage!.reads.failuresByCode![code], observedFailures[code]);
    if (["WEB_TIMEOUT", "WEB_CONNECTION_RESET"].includes(code)) {
      assert.equal(pageCalls, 2);
      assert.equal(r.usage!.reads.success, 1);
      assert.equal(r.recommendations.length, 1);
    } else {
      assert.equal(pageCalls, 1);
      assert.equal(r.usage!.reads.success, 0);
    }
  }
});

test("known official category links are still read after search allowance is spent", async () => {
  const page = pages.find((p) => p.url.endsWith("employment"))!;
  const seed = {
    ...source(pages[0]),
    documentLinks: [
      { url: page.url, title: page.title },
      { url: "https://hdu.edu.cn/catalog", title: "硕士专业目录" },
    ],
  };
  let reads = 0;
  const result = await collectMissingPriorityEvidence({
    subjectId: "offline-links",
    sources: [seed],
    disciplines: [discipline],
    targetYear: "2027",
    maxRequests: 0,
    maxReads: 5,
    selected: [
      {
        institutionName: school.name,
        key: school.name,
        domain: school.registrableDomain,
        city: school.city,
        score: 0,
        scores: [],
        excludedReasons: [],
      },
    ],
    web: {
      answer: async () => assert.fail("No search budget remains"),
    } as never,
    readPage: async (url) => {
      assert.equal(url, page.url);
      reads++;
      return { contentType: "text/plain", text: page.text };
    },
    onProgress: async () => {},
  });
  assert.equal(reads, 1);
  assert.equal(result.requestCount, 0);
  assert.equal(
    result.sources.find((s) => s.url === seed.url)!.documentLinks!.length,
    2,
  );
  assert.ok(result.sources.some((s) => s.url === page.url));
});
