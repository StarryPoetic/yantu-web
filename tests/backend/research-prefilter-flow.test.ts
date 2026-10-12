import test from "node:test";
import assert from "node:assert/strict";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import { researchReportMarkdown } from "../../src/workspace/research-report.ts";
import { academicDomain } from "../../server/explanation/research-pages.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";

test("missing-content responses are diagnosed and never cached as usable official evidence", async () => {
  const f = prefilterFixture({
    cities: ["杭州"],
    schoolNames: ["杭州电子科技大学"],
  });
  const reader = f.config.reader!;
  f.config.reader = async (url, options) =>
    new URL(url).hostname === "api.search.brave.com"
      ? reader(url, options)
      : {
          contentType: "text/html",
          text: "<p>杭州电子科技大学</p><p>数据不存在或已过期</p>",
        };
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
    onCheckpoint: f.save,
  });
  assert.ok((report.usage?.reads.failuresByCode?.WEB_CONTENT_REMOVED ?? 0) > 0);
  assert.ok(
    !report.sources.some(
      (s) =>
        s.kind === "official_page" && s.excerpt.includes("数据不存在或已过期"),
    ),
  );
  assert.equal(Object.keys(f.checkpoint().pages).length, 0);
});

test("national discovery links cannot consume the main read budget across many schools", async () => {
  const f = prefilterFixture();
  const reader = f.config.reader!;
  f.config.reader = async (url, options) => {
    const response = await reader(url, options);
    if (new URL(url).hostname === "api.search.brave.com") {
      const data = JSON.parse(response.text);
      for (const result of data.web.results)
        result.title = result.title.replace(/2026.*$/, "招生信息首页");
      return { ...response, text: JSON.stringify(data) };
    }
    return response;
  };
  await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
  });
  assert.equal(f.counts.reads, B.discoveryReads);
  assert.equal(new Set(f.readDomains).size, B.discoveryReads);
});

test("two-stage flow persists local scores before any paid call, reads only selected schools and continues collecting after ten", async () => {
  const f = prefilterFixture();
  const complete = f.config.adapter!.complete;
  f.config.adapter = {
    async complete(messages, options) {
      if (!options?.thinking) return complete(messages, options);
      assert.ok(messages[0].content.includes("目标为10所不同学校"));
      const sources = JSON.parse(messages[1].content).sources as {
        id: string;
      }[];
      assert.ok(
        sources.every((source) =>
          f
            .checkpoint()
            .report!.sources.some(
              (saved) =>
                saved.id === source.id &&
                f
                  .checkpoint()
                  .prefilter!.selected.some(
                    (s) => academicDomain(saved.url) === s.domain,
                  ),
            ),
        ),
      );
      return complete(messages, options);
    },
  };
  let first = true;
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
    onCheckpoint: (cp) => {
      if (cp.prefilter && first) {
        first = false;
        assert.deepEqual(f.counts, {
          searches: 0,
          reads: 0,
          models: 0,
          inputChars: 0,
        });
      }
      f.save(cp);
    },
  });
  assert.equal(first, false);
  assert.equal(report.prefilter!.selected.length, 179);
  assert.equal(report.recommendations.length, 10);
  assert.equal(report.coverage!.targetMin, 10);
  assert.equal(report.coverage!.targetMax, 10);
  assert.ok(
    report.coverage!.shortfallReasons.every((s) => !s.includes("尚未达到")),
  );
  assert.equal(f.counts.searches, B.searches);
  for (const school of report.prefilter!.selected) {
    assert.ok(
      f.questions.some((query) => query.includes(school.institutionName)),
      `${school.institutionName} must appear in a real grouped search request`,
    );
  }
  const directoryQueries = f.questions.filter((q) =>
    q.includes("硕士招生目录"),
  );
  assert.ok(directoryQueries.length > 0);
  assert.ok(
    directoryQueries.every((q) => !/报录比|双非|学科评估|就业去向/.test(q)),
  );
  assert.ok(f.questions.some((q) => q.includes("复试基本分数线")));
  assert.equal(f.counts.reads, 12);
  assert.equal(f.counts.models, 2);
  assert.ok(f.counts.searches <= B.searches && f.counts.reads < B.reads);
  assert.deepEqual(
    f.readDomains,
    report.prefilter!.selected.slice(0, 12).map((s) => s.domain),
  );
  assert.ok(
    report.sources.every((s) =>
      report.prefilter!.selected.some(
        (c) => academicDomain(s.url) === c.domain,
      ),
    ),
  );
  assert.match(researchReportMarkdown(report, f.run, false), /筛选依据/);
});
test("fewer than ten grounded schools remains partial with explicit shortfall and unchanged budgets", async () => {
  const f = prefilterFixture({ available: 3 });
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
  });
  assert.equal(report.recommendations.length, 3);
  assert.equal(report.status, "partial");
  assert.ok(report.coverage!.shortfallReasons.some((s) => s.includes("10所")));
  assert.ok(f.counts.searches <= B.searches && f.counts.reads <= B.reads);
});

test("all schools retain collection opportunities even when basic fields are complete", async () => {
  const complete = prefilterFixture({
    completeFields: true,
    duplicatePages: true,
  });
  const partial = prefilterFixture({ duplicatePages: true });
  const full = await complete.create().generate({
    strategy: "two-stage",
    subjectId: complete.run.subjectId,
    run: complete.run,
  });
  const limited = await partial.create().generate({
    strategy: "two-stage",
    subjectId: partial.run.subjectId,
    run: partial.run,
  });
  // Discovery initially exposes eight schools; the larger targeted budget
  // recovers the remaining four catalogues and fills the ten-school display.
  assert.equal(full.recommendations.length, B.finalSchools);
  assert.ok(
    full.recommendations.every((r) => r.tuition && r.location && r.exams),
  );
  assert.equal(complete.counts.reads, 36);
  assert.equal(partial.counts.reads, 36);
  assert.equal(limited.recommendations.length, B.finalSchools);
  for (const school of full.prefilter!.selected)
    assert.ok(
      complete.questions.some((q) => q.includes(school.institutionName)),
    );
});
test("zero evidence still exposes the saved prefilter and explains the ten-school shortfall without a model call", async () => {
  const f = prefilterFixture({ available: 0 });
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
  });
  assert.equal(report.recommendations.length, 0);
  assert.ok(report.prefilter);
  assert.equal(report.coverage!.targetMin, 10);
  assert.ok(report.coverage!.shortfallReasons.length);
  assert.equal(f.counts.models, 1);
});

test("national mode is not treated as an unmatched city in the final report", async () => {
  const f = prefilterFixture({ cities: ["全国"] });
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
  });
  assert.deepEqual(report.prefilter!.cities, []);
  assert.equal(report.status, "partial");
  assert.equal(report.recommendations.length, 10);
  assert.equal(report.coverage!.preferredCities, undefined);
  assert.ok(
    report.recommendations.every((r) =>
      r.constraintChecks!.some(
        (c) =>
          c.field === "cities" &&
          c.status === "unknown" &&
          c.reason.includes("尚未限定城市"),
      ),
    ),
  );
});
test("retry reuses exact shortlist and evidence despite changed local facts, with zero new search/read charges", async () => {
  const f = prefilterFixture({ failModel: true });
  const first = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
    onCheckpoint: f.save,
  });
  assert.equal(first.reason, "MODEL_TIMEOUT");
  const before = { ...f.counts };
  const original = f.library.queryFacts;
  // Recalculation would rank completely different schools; the saved shortlist must win.
  f.library.queryFacts = () => [];
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
    mode: "retry",
    checkpoint: f.checkpoint(),
    previousReport: first,
    onCheckpoint: f.save,
  });
  f.library.queryFacts = original;
  assert.deepEqual(report.prefilter, first.prefilter);
  assert.equal(report.recommendations.length, 10);
  assert.equal(f.counts.searches, before.searches);
  assert.equal(f.counts.reads, before.reads);
  assert.equal(report.usage!.searches.paid, 0);
  assert.equal(report.usage!.reads.reads, 0);
});

for (const useFlash of [true, false])
  test(`collection deadline reserves one final Pro call and resumes (Flash=${useFlash})`, async () => {
    const f = prefilterFixture();
    const reader = f.config.reader!;
    let searches = 0;
    f.config.researchTotalTimeoutMs = 9000;
    f.config.researchUseFlash = useFlash;
    f.config.reader = async (url, options) => {
      if (new URL(url).hostname === "api.search.brave.com" && ++searches === 2)
        return new Promise(() => {});
      return reader(url, options);
    };
    const report = await f.create().generate({
      strategy: "two-stage",
      subjectId: f.run.subjectId,
      run: f.run,
      onCheckpoint: f.save,
    });
    assert.equal(report.reason, "RESEARCH_COLLECTION_TIMEOUT");
    assert.equal(
      report.usage!.model.byModel?.["deepseek-v4-pro"]?.calls,
      useFlash ? 1 : 2,
    );
    assert.ok(report.prefilter);
    assert.equal(report.recommendations.length, 8);
    assert.equal(report.usage!.searches.paid, 2);
    assert.equal(report.coverage!.targetMin, 10);
    assert.ok(
      report.coverage!.shortfallReasons.some((s) => s.includes("尚未达到10所")),
    );
    assert.ok(f.checkpoint().prefilter);
    assert.notEqual(f.checkpoint().evidenceReady, true);
    f.config.reader = reader;
    f.config.researchTotalTimeoutMs = 10000;
    const resumed = await f.create().generate({
      strategy: "two-stage",
      subjectId: f.run.subjectId,
      run: f.run,
      mode: "retry",
      checkpoint: f.checkpoint(),
      previousReport: report,
      onCheckpoint: f.save,
    });
    assert.equal(resumed.recommendations.length, 10);
    assert.equal(f.counts.reads, 12);
    assert.equal(f.counts.searches, B.searches);
    assert.equal(resumed.usage!.searches.paid, B.searches - 1);
    assert.equal(resumed.usage!.reads.reads, 4);
  });

test("collection deadline retains a later final-analysis timeout and never silently retries it", async () => {
  const f = prefilterFixture();
  const reader = f.config.reader!;
  const adapter = f.config.adapter!;
  let searches = 0,
    finalCalls = 0;
  f.config.researchTotalTimeoutMs = 9000;
  f.config.reader = async (url, options) => {
    if (new URL(url).hostname === "api.search.brave.com" && ++searches === 2)
      return new Promise(() => {});
    return reader(url, options);
  };
  f.config.adapter = {
    complete: async (messages, options) => {
      if (options?.thinking) {
        finalCalls++;
        throw new ModelError("MODEL_TIMEOUT");
      }
      return adapter.complete(messages, options);
    },
  };
  const report = await f.create().generate({
    strategy: "two-stage",
    subjectId: f.run.subjectId,
    run: f.run,
    onCheckpoint: f.save,
  });
  assert.equal(finalCalls, 1);
  assert.equal(report.reason, "MODEL_TIMEOUT");
  assert.equal(report.failureStage, "analyzing");
  assert.equal(report.status, "partial");
  assert.ok(report.recommendations.length > 0);
  assert.notEqual(f.checkpoint().evidenceReady, true);
});
