import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  researchExternalPolicy,
  researchSourceTier,
  RESEARCH_EXTERNAL_SOURCES,
} from "../../server/explanation/research-source-policy.ts";
import { createExternalResearchReader } from "../../server/explanation/research-external-reader.ts";
import {
  extractPriorityFacts,
  priorityCoverage,
  validatePriorityFacts,
  preferredPriorityFacts,
} from "../../server/explanation/research-priority-facts.ts";
import { extractProgramFacts } from "../../server/explanation/research-facts.ts";
import { collectExternalEvidence } from "../../server/explanation/research-external-collection.ts";
import { replayDisciplines } from "../helpers/research-real-replay.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import {
  externalPagePriority,
  externalSearchHosts,
} from "../../server/explanation/research-external-ranking.ts";
import { publicExternalText } from "../../server/explanation/research-external-text.ts";
import { realReplayFixture } from "../helpers/research-real-replay.ts";

const ds = replayDisciplines();
const program = {
  institutionName: "杭州电子科技大学",
  disciplineCode: "0855",
  majorCode: "085500",
  programName: "机械",
};
function source(tier: "authority" | "reference", excerpt: string): WebSource {
  return {
    id: tier,
    title: "合成政策用例，不纳入真实覆盖指标",
    url:
      tier === "authority"
        ? "https://yz.chsi.com.cn/kyzx/test.shtml"
        : "https://www.eol.cn/e_ky/test.shtml",
    excerpt,
    kind: tier === "authority" ? "authority_page" : "reference_page",
    verified: false,
    retrievedAt: "2026-10-12T00:00:00Z",
  };
}
const line = "杭州电子科技大学2026年硕士研究生085500机械报录比：4:1";

test("external whitelist is exact, documented, HTTPS only and excludes accounts, forums and marketing hosts", () => {
  assert.ok(RESEARCH_EXTERNAL_SOURCES.every((p) => p.reason.length > 12));
  assert.ok(
    RESEARCH_EXTERNAL_SOURCES.filter((p) => p.tier === "reference").length <= 8,
  );
  assert.equal(
    researchSourceTier("https://yz.chsi.com.cn/kyzx/a.shtml"),
    "authority",
  );
  assert.equal(researchSourceTier("https://yjs.hdu.edu.cn/a.htm"), "school");
  for (const url of [
    "http://www.eol.cn/e_ky/a",
    "https://www.eol.cn:443/e_ky/a",
    "https://www.eol.cn.evil.test/e_ky/a",
    "https://user@www.eol.cn/e_ky/a",
    "https://bbs.kaoyan.com/a",
    "https://ad.koolearn.com/a",
    "https://yz.kaoyan.com/forum/a",
    "https://yz.chsi.com.cn/user/a",
    "https://127.0.0.1/e_ky/a",
    "https://www.eol.cn/e_ky/%6cogin/a",
  ])
    assert.equal(researchExternalPolicy(url), undefined, url);
});

test("authority/reference use literal quotes and source identity, never model supplied grades or numbers", () => {
  const s = source("reference", line);
  const facts = extractPriorityFacts(s, ds, "2027");
  assert.equal(facts.length, 1);
  assert.equal(facts[0].value.number, 4);
  assert.equal(facts[0].sourceTier, "reference");
  assert.equal(facts[0].verified, false);
  assert.deepEqual(
    validatePriorityFacts(
      [{ ...facts[0], value: { number: 999 }, sourceTier: "school" }],
      s,
      ds,
      "2027",
    ),
    facts,
  );
  assert.deepEqual(
    validatePriorityFacts(
      [{ ...facts[0], quote: line + "编造" }],
      s,
      ds,
      "2027",
    ),
    [],
  );
  assert.deepEqual(
    extractPriorityFacts(
      { ...s, url: "https://evil.example/a", finalUrl: s.url },
      ds,
      "2027",
    ),
    [],
  );
  assert.deepEqual(extractProgramFacts(s, [s], s.retrievedAt), []);
});

test("reference cannot provide academic grades, national lines, predictions or personal forum accounts", () => {
  for (const text of [
    "杭州电子科技大学2026年硕士研究生085500机械报录比约4:1-6:1",
    "杭州电子科技大学2026年硕士研究生085500机械国家线复试线：264",
    "杭州电子科技大学2026年硕士研究生085500机械预计复试线：300",
    "杭州电子科技大学2026年硕士研究生085500机械学长经验贴录取了2位双非同学",
    "杭州电子科技大学2017年第四轮学科评估0802机械工程评估等级：C+",
    "杭州电子科技大学2026年硕士研究生085500机械报录比：4:1。请先登录",
  ])
    assert.deepEqual(
      extractPriorityFacts(source("reference", text), ds, "2027"),
      [],
      text,
    );
});

test("embedded university names do not transfer facts between Hangzhou and Chengdu", () => {
  const s = source(
    "reference",
    line + "\n电子科技大学2026年硕士研究生085500机械报录比：9:1",
  );
  const facts = extractPriorityFacts(s, ds, "2027");
  assert.equal(
    facts.find((f) => f.schoolName === "杭州电子科技大学")?.value.number,
    4,
  );
  assert.equal(
    facts.find((f) => f.schoolName === "电子科技大学")?.value.number,
    9,
  );
});

test("tiers do not double count, official overrides reference, unrelated schools and majors do not bind", () => {
  const ref = extractPriorityFacts(source("reference", line), ds, "2027")[0];
  const auth = extractPriorityFacts(
    source("authority", line.replace("4:1", "3:1")),
    ds,
    "2027",
  )[0];
  const official = {
    ...auth,
    id: "school",
    sourceUrl: "https://yjs.hdu.edu.cn/a.htm",
    sourceTier: "school" as const,
  };
  assert.equal(
    preferredPriorityFacts([ref, auth, official], program)[0].id,
    "school",
  );
  const referenceOnly = priorityCoverage([ref], [program], "2027");
  assert.equal(referenceOnly.confirmed, 0);
  assert.equal(referenceOnly.byTier.reference.confirmed, 1);
  assert.equal(referenceOnly.combined.confirmed, 1);
  assert.equal(referenceOnly.combined.completeAverage, 0);
  const coverage = priorityCoverage(
    [ref, auth, official],
    [program, program],
    "2027",
  );
  assert.equal(coverage.byTier.school.confirmed, 1);
  assert.equal(coverage.byTier.authority.confirmed, 0);
  assert.equal(coverage.byTier.reference.confirmed, 0);
  assert.equal(coverage.confirmedCutoff.total, 3);
  assert.equal(
    priorityCoverage([ref], [{ ...program, majorCode: "085501" }], "2027")
      .combined.confirmed,
    0,
  );
  assert.equal(
    priorityCoverage(
      [ref],
      [{ ...program, institutionName: "浙江理工大学" }],
      "2027",
    ).combined.confirmed,
    0,
  );
});

test("external reader observes robots and rejects disallowed redirect before network request", async () => {
  const calls: string[] = [];
  const reader = createExternalResearchReader(
    async (url, options) => {
      calls.push(url);
      assert.equal(options.allowHttp, false);
      if (url.endsWith("robots.txt"))
        return {
          text: "User-agent: *\nDisallow: /e_ky/private",
          contentType: "text/plain",
        };
      await options.beforeRequest?.("https://www.eol.cn/e_ky/login/a");
      return { text: "unreachable", contentType: "text/plain" };
    },
    { now: () => 0, sleep: async () => {} },
  );
  const options = { allowedHosts: ["www.eol.cn"] };
  await assert.rejects(reader("https://www.eol.cn/e_ky/private/a", options), {
    code: "ROBOTS_DISALLOWED",
  });
  assert.equal(calls.length, 1);
  await assert.rejects(reader("https://www.eol.cn/e_ky/public/a", options), {
    code: "WEB_HOST_BLOCKED",
  });
  await assert.rejects(reader("http://www.eol.cn/e_ky/a", options), {
    code: "WEB_HOST_BLOCKED",
  });
});

test("external pass searches authority before reference and spends remaining budget on missing fields", async () => {
  const queries: string[] = [],
    tiers: string[] = [];
  const s = source("reference", line);
  const result = await collectExternalEvidence({
    sources: [],
    lookupKeys: [],
    subjectId: "offline",
    targetYear: "2027",
    maxRequests: 7,
    maxReads: 8,
    disciplines: ds,
    programs: [program],
    usedReads: new Map(),
    onProgress: async () => {},
    web: {
      clearSubject: () => {},
      answer: async (request, options) => {
        queries.push(request.question);
        tiers.push(
          options?.search?.includeDomains?.includes("www.eol.cn")
            ? "reference"
            : "authority",
        );
        return {
          status: "sources_only",
          points: [],
          notices: [],
          searched: true,
          needsSearch: false,
          answer: "",
          sources: options?.search?.includeDomains?.includes("www.eol.cn")
            ? [
                { ...s, kind: "search_snippet" },
                {
                  ...s,
                  url: s.url.replace("test.shtml", "second.shtml"),
                  kind: "search_snippet",
                },
              ]
            : [],
        };
      },
    } as Parameters<typeof collectExternalEvidence>[0]["web"],
    readPage: async () => ({ contentType: "text/plain", text: line }),
  });
  assert.deepEqual(tiers.slice(0, 3), ["authority", "authority", "authority"]);
  assert.ok(queries.some((q) => q.includes("就业")));
  assert.ok(
    queries
      .filter((q) => q.includes("复试分数线"))
      .every((q) => q.includes("085500 机械")),
  );
  assert.equal(result.requestCount, 7);
  assert.equal(result.readCount, 2);
  assert.equal(
    new Set(result.sources.map((s) => s.id)).size,
    2,
    "each query's web-1 source must be rebased to its URL",
  );
  assert.equal(result.sources[0].kind, "reference_page");
  assert.equal(
    extractPriorityFacts(result.sources[0], ds, "2027")[0].sourceTier,
    "reference",
  );
});

test("real commercial replay excerpt is a negative fixture, not synthetic evidence for coverage", () => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/research-source-policy-public.json", "utf8"),
  );
  for (const page of fixture.pages)
    assert.deepEqual(extractPriorityFacts(page, ds, "2027"), []);
});

test("fifth real run rejects stale and wrong-school external results before spending reads", () => {
  const fifth = realReplayFixture("research-v3a6-run5.json");
  assert.equal(fifth.runs[0].queries.length, 68);
  assert.equal(fifth.runs[0].reads.length, 180);
  const pages = fifth.pages.flatMap((p) => (p.source ? [p.source] : []));
  const old = pages.find((s) => s.url.includes("546313019400c"))!;
  assert.equal(
    externalPagePriority(
      old,
      "浙江理工大学",
      [program],
      ["applicationAdmissionRatio"],
      "2027",
    ),
    -1,
  );
  const stale = pages.find((s) => s.url.includes("5ee89bb9c9ad7"))!;
  assert.equal(
    externalPagePriority(
      stale,
      "浙江师范大学",
      [
        {
          disciplineCode: "0802",
          majorCode: "080200",
          programName: "机械工程",
        },
      ],
      ["cutoff"],
      "2027",
    ),
    -1,
  );
  const wrong = pages.find((s) => s.url.includes("1874486"))!;
  assert.equal(
    externalPagePriority(
      wrong,
      "浙江师范大学",
      [program],
      ["applicationAdmissionRatio"],
      "2027",
    ),
    -1,
  );
  const countsOnly = pages.find((s) => s.url.includes("1874506"))!;
  assert.match(countsOnly.excerpt, /总录取人数：90人/);
  assert.deepEqual(
    extractPriorityFacts(countsOnly, ds, "2027"),
    [],
    "title says ratio but body has no applicant denominator; do not invent it",
  );
  assert.deepEqual(externalSearchHosts("authority", ["disciplineAssessment"]), [
    "www.cdgdc.edu.cn",
    "cdgdc.edu.cn",
    "www.moe.gov.cn",
  ]);
});

test("external article snapshots discard forum feeds and contact cells but preserve statistical evidence", () => {
  assert.equal(
    publicExternalText(
      "统计原文\n学院 | 联系人 | 电话\n机械工程学院 | 马 老师 | 86843366\n作者\n测试姓名\n报录比：4:1\n浙江师范大学论坛新帖：更多\n个人经历和姓名",
    ),
    "统计原文\n报录比：4:1",
  );
});

test("sixth real run rejects stale years without 年 and unrelated catalogues across every fallback category", () => {
  const sixth = realReplayFixture("research-v3a6-run6.json");
  assert.equal(sixth.runs[0].queries.length, 72);
  assert.equal(sixth.runs[0].reads.length, 180);
  for (const [needle, school] of [
    ["1403991.html", "浙江师范大学"],
    ["1664577.html", "杭州电子科技大学"],
    ["1641286.html", "杭州电子科技大学"],
    ["1085055", "杭州电子科技大学"],
  ]) {
    const page = sixth.pages.find((p) => p.url.includes(needle))?.source;
    assert.ok(page, needle);
    for (const fields of [
      ["cutoff"],
      ["employment"],
      ["undergraduateAdmission"],
      ["applicationAdmissionRatio"],
    ] as const)
      assert.equal(
        externalPagePriority(page, school, [program], fields, "2027"),
        -1,
        page.title,
      );
  }
  assert.equal(
    externalPagePriority(
      source("reference", "杭州电子科技大学公开目录"),
      program.institutionName,
      [program],
      ["employment"],
      "2027",
    ),
    -1,
  );
  assert.ok(
    externalPagePriority(
      source("reference", "杭州电子科技大学2025届硕士毕业生就业率95%"),
      program.institutionName,
      [program],
      ["employment"],
      "2027",
    ) >= 0,
  );
});
