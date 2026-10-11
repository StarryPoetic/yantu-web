import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { decodedResearchDocuments } from "../../server/explanation/research-encoded-documents.ts";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import { setTimeout as pause } from "node:timers/promises";
import { scopedAdmissionEvidence } from "../../server/explanation/research-evidence.ts";
import {
  realReplayFixture,
  combinedRealReplayFixture,
  replayDisciplines,
  runRealReplay,
} from "../helpers/research-real-replay.ts";
import {
  extractPriorityFacts,
  priorityCoverage,
  validatePriorityFacts,
} from "../../server/explanation/research-priority-facts.ts";
import {
  createSearchBudget,
  searchConfigFromEnvironment,
} from "../../server/explanation/search.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import {
  researchAttachments,
  academicDomain,
} from "../../server/explanation/research-pages.ts";
import { runRealReportReplay } from "../helpers/research-real-report-replay.ts";
import { programEntries } from "../../server/explanation/research-matching.ts";
import {
  replayAcceptanceCriteria,
  replayVerifiedCoverage,
} from "../helpers/research-replay-live.ts";
import {
  missingPriorityQueries,
  fairPriorityQueries,
  priorityQueryCategory,
} from "../../server/explanation/research-targeted.ts";
const fixture = realReplayFixture();
test("progress comparison cannot retain an old unquoted false-positive coverage ceiling", () => {
  const source = fixture.pages.find((p) => p.source)!.source!;
  const report = {
    sources: [source],
    recommendations: [
      {
        institutionName: "浙江理工大学",
        majorCode: "085501",
        programName: "机械工程",
        disciplineCode: "0855",
      },
    ],
    priorityFacts: [
      {
        field: "cityDevelopment",
        sourceId: source.id,
        quote: "原文没有的杭州产业发展999%",
      },
    ],
  } as unknown as Parameters<typeof replayVerifiedCoverage>[0];
  assert.equal(replayVerifiedCoverage(report).partialAverage, 0);
});
test("real closure section applies to its faculty row, not the same major in the following section", () => {
  const source = realReplayFixture("research-v3a6-run3.json").pages.find((p) =>
    p.url.endsWith("/1993.htm"),
  )!.source!;
  const scope = {
    institutionName: "浙江科技大学",
    programName: "机械",
    majorCode: "085500",
    disciplineCode: "0855",
    studyMode: "full_time" as const,
  };
  assert.equal(
    scopedAdmissionEvidence(source, "2027", {
      ...scope,
      collegeName: "生物与化学工程学院",
    }).exclusionKind,
    "closure",
  );
  assert.notEqual(
    scopedAdmissionEvidence(source, "2027", {
      ...scope,
      collegeName: "艺术设计与服装学院",
    }).exclusionKind,
    "closure",
  );
});
test("initial search throttling keeps page reads concurrent across schools", async () => {
  const f = prefilterFixture();
  const reader = f.config.reader!;
  let activeSearches = 0,
    peakSearches = 0,
    peakInitialReads = 0,
    targeted = false;
  const activeDomains = new Map<string, number>();
  f.config.reader = async (url, options) => {
    if (new URL(url).hostname === "api.search.brave.com") {
      const query = new URL(url).searchParams.get("q") ?? "";
      targeted ||= !/硕士招生(?:专业)?目录/.test(query);
      peakSearches = Math.max(peakSearches, ++activeSearches);
      await pause(5);
      activeSearches--;
    } else {
      const domain = academicDomain(url);
      activeDomains.set(domain, (activeDomains.get(domain) ?? 0) + 1);
      if (!targeted)
        peakInitialReads = Math.max(peakInitialReads, activeDomains.size);
      await pause(30);
      const remaining = activeDomains.get(domain)! - 1;
      if (remaining) activeDomains.set(domain, remaining);
      else activeDomains.delete(domain);
    }
    return reader(url, options);
  };
  await f.create().generate({
    subjectId: f.run.subjectId,
    run: f.run,
    strategy: "two-stage",
  });
  assert.equal(peakSearches, B.initialSearchConcurrency);
  assert.ok(
    peakInitialReads > 1,
    "page reads were serialized behind the search gate",
  );
});
test("saved employment article exposes its literal compressed PDF without executing scripts or accepting external links", () => {
  const markup = readFileSync(
    "tests/fixtures/research-encoded-employment.html",
    "utf8",
  );
  const source = realReplayFixture("research-v3a6-run2.json").pages.find((p) =>
    p.url.includes("aid/25530"),
  )!.source!;
  const links = researchAttachments(source, markup);
  assert.equal(links.length, 1);
  assert.match(
    decodeURI(links[0].url),
    /jyb\.zstu\.edu\.cn\/attachment\/zstu\/.*就业质量年度报告\.pdf$/,
  );
  const encode = (html: string) =>
    `Base64.decode(unzip("${deflateSync(Buffer.from(Buffer.from(html).toString("base64"))).toString("base64")}").substr(0)).substr(0)`;
  assert.equal(
    researchAttachments(
      source,
      encode('<a href="http://127.0.0.1/report.pdf">就业质量报告</a>'),
    ).length,
    0,
  );
  assert.equal(
    researchAttachments(
      source,
      encode('<a href="https://attacker.example/report.pdf">就业质量报告</a>'),
    ).length,
    0,
  );
  assert.equal(decodedResearchDocuments(encode("x".repeat(200000))), "");
  assert.equal(
    decodedResearchDocuments(
      'Base64.decode(unzip("junk").substr(0)).substr(0)',
    ),
    "",
  );
});
test("cumulative real corpus has an evidence audit for every unfilled recommended slot", async () => {
  const combined = combinedRealReplayFixture();
  const result = await runRealReportReplay(combined);
  const coverage = result.report.priorityCoverage!;
  const audit = JSON.parse(
    readFileSync("tests/fixtures/research-v3a6-audit.json", "utf8"),
  );
  const missing = coverage.schools.flatMap((school) => [
    ...school.missingScoreYears.map(
      (x) => `${school.schoolName}:${x.field}:${x.year}`,
    ),
    ...school.pending
      .filter((x) => x !== "cutoff" && x !== "admissionScore")
      .map((x) => `${school.schoolName}:${x}:`),
  ]);
  assert.deepEqual(
    new Set(
      audit.map(
        (x: { school: string; field: string; year?: number }) =>
          `${x.school}:${x.field}:${x.year ?? ""}`,
      ),
    ),
    new Set(missing),
  );
  assert.equal(result.searches, B.searches);
  assert.equal(result.peakSearches, B.initialSearchConcurrency);
  assert.equal(result.finalCalls, 1);
  assert.deepEqual(new Set(result.finalDirections), new Set(["0802", "0855"]));
  assert.ok(
    result.searchQueries.some((q) => /硕士招生专业目录 site:/.test(q)),
    "unknown programmes need graduate-site catalogue recovery before score queries",
  );
  assert.ok(
    result.report.recommendations.every(
      (r) =>
        !(
          r.institutionName === "浙江科技大学" &&
          r.majorCode === "085500" &&
          r.collegeName === "生物与化学工程学院"
        ),
    ),
  );
  assert.ok(combined.pages.filter((p) => p.source).length >= 210);
  assert.ok(coverage.confirmed >= 8);
  for (const row of audit) {
    assert.ok(row.evidence.length > 20);
    assert.ok(row.reviewedUrls.length > 0);
    assert.ok(
      row.reviewedUrls.every((url: string) =>
        combined.pages.some((p) => p.url === url && p.source),
      ),
    );
  }
});
test("an interrupted real run retains its search and public page checkpoint, never a fabricated final report", () => {
  const interrupted = realReplayFixture("research-v3a6-run2.json");
  assert.equal(interrupted.pages.length, 254);
  assert.equal(interrupted.pages.filter((p) => p.source).length, 102);
  assert.equal(interrupted.runs[0].queries.length, 45);
  const raw = JSON.parse(
    readFileSync("tests/fixtures/research-v3a6-run2.json", "utf8"),
  );
  assert.equal(raw.runs[0].reportSaved, false);
  assert.equal(raw.runs[0].metrics.acceptance.passed, false);
  assert.equal(raw.runs[0].metrics.forensicReconstruction, true);
});
test("paid acceptance uses field mean, five schools, deadline and a completed final analysis", () => {
  const input = {
    elapsedMs: 500000,
    recommendations: 5,
    status: "partial",
    finalCompleted: true,
    partialAverage: 0.6,
  };
  assert.equal(replayAcceptanceCriteria(input).passed, true);
  for (const delta of [
    { recommendations: 4 },
    { partialAverage: 0.599 },
    { elapsedMs: 600001 },
    { finalCompleted: false },
    { reason: "BUDGET_EXHAUSTED" },
  ])
    assert.equal(
      replayAcceptanceCriteria({ ...input, ...delta }).passed,
      false,
    );
});
test("queries keep official concrete major name and code rather than another selected discipline", () => {
  const mechanical = replayDisciplines().find((d) => d.code === "0855")!;
  const queries = missingPriorityQueries(
    "杭州电子科技大学",
    mechanical,
    "2027",
    [],
    { majorCode: "085500", programName: "机械", collegeName: "机械工程学院" },
  );
  assert.ok(queries.every((q) => !q.includes("080200")));
  assert.ok(
    queries
      .filter((q) => /复试|初试成绩/.test(q))
      .every((q) => q.includes("085500 机械 ")),
  );
  assert.ok(
    queries
      .filter((q) => /就业|生源/.test(q))
      .every((q) => !/085500|2026|机械工程学院/.test(q)),
  );
  for (const term of [
    "复试基本分数线",
    "报录统计",
    "生源质量",
    "学科评估",
    "就业质量报告",
  ])
    assert.ok(queries.some((q) => q.includes(term)));
});
test("many faculty variants cannot consume the allowance before every missing category gets a query", () => {
  const lists = Array.from({ length: 5 }, (_, i) =>
    missingPriorityQueries("浙江科技大学", replayDisciplines()[0], "2027", [], {
      majorCode: `08020${i}`,
      programName: "机械工程",
      collegeName: `学院${i}`,
    }),
  );
  assert.deepEqual(
    new Set(fairPriorityQueries(lists).slice(0, 5).map(priorityQueryCategory)),
    new Set(["scores", "competition", "background", "academic", "employment"]),
  );
  assert.ok(fairPriorityQueries(lists).every((q) => q.length < 60));
});
test("first new live corpus is retained and curriculum rows cannot count as city development", () => {
  const live = realReplayFixture("research-v3a6-run1.json");
  assert.equal(live.pages.length, 484);
  assert.equal(live.pages.filter((p) => p.source).length, 200);
  for (const p of live.pages.filter((p) =>
    /20250922001|20240930001|202309210001|0FDE6D936/.test(p.url),
  )) {
    assert.ok(p.source);
    assert.ok(
      !extractPriorityFacts(p.source!, replayDisciplines(), "2027").some(
        (f) => f.field === "cityDevelopment",
      ),
    );
  }
  const spaced = live.pages.find(
    (p) => p.url === "https://yzw.zust.edu.cn/info/1035/1986.htm",
  )!.source!;
  assert.ok(
    programEntries(spaced, replayDisciplines()).some(
      (p) =>
        p.majorCode === "080200" && p.collegeName === "智能制造与能源工程学院",
    ),
  );
});
test("real replay keeps 218 observed URLs; missing responses are not synthetic answers", () => {
  assert.equal(fixture.pages.length, 218);
  assert.equal(fixture.pages.filter((p) => p.source).length, 56);
  assert.equal(fixture.runs.flatMap((r) => r.queries).length, 120);
  assert.ok(fixture.pages.some((p) => !p.source));
  for (const p of fixture.pages) {
    if (p.source)
      assert.doesNotMatch(p.source.excerpt, /(?<!\d)\d{14,18}(?!\d)/);
  }
});
test("saved Hangzhou Dianzi PDF yields bounded admissions statistics, not invented recommendation zeros or cutoff", () => {
  const s = fixture.pages.find((p) => p.url.includes("bb749fd9"))!.source!;
  const facts = extractPriorityFacts(s, replayDisciplines(), "2027", {
    total: 350,
    maximum: 500,
  }).filter((f) => f.majorCode === "085500");
  assert.equal(
    facts.find((f) => f.field === "admittedCount")?.value.number,
    145,
  );
  assert.equal(
    facts.find((f) => f.field === "admittedCount")?.value.applicants,
    260,
  );
  assert.equal(
    facts.find((f) => f.field === "admissionScore")?.value.number,
    264,
  );
  assert.ok(
    facts.every((f) => f.collegeName === "机械工程学院" && !f.value.targetGap),
  );
  assert.ok(
    facts.every(
      (f) =>
        s.excerpt.includes(f.quote) &&
        f.evidenceQuotes?.every((q) => s.excerpt.includes(q)),
    ),
  );
  assert.ok(
    !facts.some((f) =>
      ["cutoff", "recommendationShare", "applicationAdmissionRatio"].includes(
        f.field,
      ),
    ),
  );
  assert.match(facts[0].value.population!, /士兵计划/);
  assert.equal(
    validatePriorityFacts(
      [
        {
          sourceId: s.id,
          field: "admittedCount",
          quote: "085500机械录取999人",
        },
      ],
      s,
      replayDisciplines(),
      "2027",
    ).length,
    0,
  );
});
test("real college-code header and employment policy negatives", () => {
  const s = fixture.pages.find((p) => p.url.endsWith("/8507.htm"))!.source!;
  const facts = extractPriorityFacts(s, replayDisciplines(), "2027");
  const entry = programEntries(s, replayDisciplines()).find(
    (p) => p.majorCode === "080200",
  );
  assert.equal(entry?.collegeName, "机械工程学院");
  assert.ok(s.excerpt.includes(entry!.catalogQuote));
  assert.equal(
    facts.find((f) => f.majorCode === "080200")?.collegeName,
    "机械工程学院",
  );
  for (const p of fixture.pages.filter((p) =>
    /3395.htm|8385.htm|577822/.test(p.url),
  )) {
    assert.ok(
      !extractPriorityFacts(p.source!, replayDisciplines(), "2027").some(
        (f) => f.field === "employment" || f.field === "cityDevelopment",
      ),
    );
  }
  const quote = "2026年机械工程硕士毕业生去向落实率：95%";
  const employment = { ...s, excerpt: `浙江理工大学\n${quote}` };
  const accepted = validatePriorityFacts(
    [{ field: "employment", sourceId: s.id, quote }],
    employment,
    replayDisciplines(),
    "2027",
  );
  assert.equal(accepted[0]?.value.employmentRate, 95);
});
test("full generation on the real public corpus calls final analysis and exports both coverage definitions", async () => {
  const { report, finalCalls, searches, peakSearches } =
    await runRealReportReplay();
  assert.equal(finalCalls, 1);
  assert.ok(report.recommendations.length > 0);
  assert.equal(
    report.recommendations.find((r) => r.institutionName === "浙江理工大学")
      ?.majorCode,
    "085501",
  );
  assert.ok(
    report.candidateAudit?.every((candidate) =>
      report.prefilter?.selected.some(
        (s) => s.institutionName === candidate.institutionName,
      ),
    ),
  );
  assert.ok(
    report.priorityFacts?.some(
      (f) => f.schoolName === "杭州电子科技大学" && f.field === "admittedCount",
    ),
  );
  assert.ok(
    report.priorityCoverage!.partialAverage >
      report.priorityCoverage!.completeAverage,
  );
  assert.match(
    report.limitations.join("\n"),
    /字段级部分覆盖率.*整类完整覆盖率/,
  );
  assert.ok(searches <= B.searches);
  assert.equal(peakSearches, B.initialSearchConcurrency);
  const audited = JSON.parse(
    readFileSync(
      new URL("../fixtures/research-real-replay-audit.json", import.meta.url),
      "utf8",
    ),
  ) as {
    school: string;
    field: string;
    year: number | null;
    reviewedUrls: string[];
    evidence: string;
  }[];
  const missing = report.priorityCoverage!.schools.flatMap((s) => [
    ...s.missingScoreYears.map((x) => `${s.schoolName}:${x.field}:${x.year}`),
    ...s.pending
      .filter((f) => !["cutoff", "admissionScore"].includes(f))
      .map((f) => `${s.schoolName}:${f}:null`),
  ]);
  assert.deepEqual(
    audited.map((x) => `${x.school}:${x.field}:${x.year}`).sort(),
    missing.sort(),
  );
  assert.ok(
    audited.every(
      (x) =>
        x.evidence.length > 20 &&
        x.reviewedUrls.every((url) =>
          fixture.pages.some((p) => p.url === url && p.source),
        ),
    ),
  );
  assert.ok(
    !report.sources.some(
      (s, i, all) => all.findIndex((p) => p.id === s.id) !== i,
    ),
  );
});
test("official historical-data URL in prose becomes a bounded same-school lead", () => {
  const s = fixture.pages.find((p) => p.url.includes("547458"))!.source!;
  assert.ok(
    researchAttachments(s, s.excerpt, {
      targetYear: "2027",
      maxLinks: 12,
    }).some((l) => l.url === "https://yzw.zjnu.edu.cn/wnzssj/list.htm"),
  );
  assert.ok(
    !researchAttachments(
      { ...s, excerpt: "历年招生数据 https://127.0.0.1/x.htm" },
      "",
    ).length,
  );
});
test("deployment legacy allowance supports all 72 requests without resetting ledger; zero remains disabled", () => {
  const config = searchConfigFromEnvironment({
    YANTU_SEARCH_USER_DAILY_REQUESTS: "60",
    YANTU_SEARCH_DAILY_REQUESTS: "300",
  });
  const budget = createSearchBudget(config);
  for (let i = 0; i < B.searches; i++) assert.ok(budget.claim("same", "day"));
  assert.equal(budget.claim("same", "day"), false);
  assert.equal(
    createSearchBudget(
      searchConfigFromEnvironment({ YANTU_SEARCH_USER_DAILY_REQUESTS: "0" }),
    ).claim("same", "day"),
    false,
  );
});
test("real replay drains saved leads, records unavailable bodies, and preserves partial versus complete coverage", async () => {
  const r = await runRealReplay(1);
  assert.equal(r.deniedSearches, 0);
  assert.ok(r.reads > 34, JSON.stringify(r));
  assert.ok(r.success > 16);
  assert.ok(r.uncapturedReads > 0);
  assert.ok(r.coverage.partialAverage > r.coverage.completeAverage);
  assert.ok(
    r.facts.some(
      (f) => f.schoolName === "杭州电子科技大学" && f.field === "admittedCount",
    ),
  );
  assert.equal(r.paidCalls, 0);
  assert.equal(priorityCoverage([], [], "2027").partialAverage, 0);
});
