import test from "node:test";
import assert from "node:assert/strict";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import { RESEARCH_BUDGET as B } from "../../server/explanation/research-budget.ts";
import { researchReportMarkdown } from "../../src/workspace/research-report.ts";

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
                    (s) => new URL(saved.url).hostname === s.domain,
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
  assert.equal(f.counts.searches, 60);
  for (const school of report.prefilter!.selected) {
    assert.ok(
      f.questions.some((query) => query.includes(school.institutionName)),
      `${school.institutionName} must appear in a real grouped search request`,
    );
  }
  for (const term of ["复试线", "报录比", "双非", "学科评估", "就业去向"]) {
    assert.ok(f.questions.every((query) => query.includes(term)));
  }
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
        (c) => new URL(s.url).hostname === c.domain,
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
  assert.equal(full.recommendations.length, 10);
  assert.ok(
    full.recommendations.every((r) => r.tuition && r.location && r.exams),
  );
  assert.equal(complete.counts.reads, 13);
  assert.equal(partial.counts.reads, 13);
  assert.equal(limited.recommendations.length, 10);
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

test("total deadline during refinement retains completed school evidence, paid counts and the ten-school target", async () => {
  const f = prefilterFixture();
  const reader = f.config.reader!;
  let searches = 0;
  f.config.researchTotalTimeoutMs = 1500;
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
  assert.equal(report.reason, "RESEARCH_TOTAL_TIMEOUT");
  assert.ok(report.prefilter);
  assert.equal(report.recommendations.length, 5);
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
  assert.equal(f.counts.searches, 60);
  assert.equal(resumed.usage!.searches.paid, 58);
  assert.equal(resumed.usage!.reads.reads, 7);
});
