import test from "node:test";
import assert from "node:assert/strict";
import {
  createResearchCollector,
  collectionModelOptions,
} from "../../server/explanation/research-collection.ts";
import {
  extractPriorityFacts,
  validatePriorityFacts,
  priorityCoverage,
  PRIORITY_SEARCH_TERMS,
} from "../../server/explanation/research-priority-facts.ts";
import { RESEARCH_PRIORITY_FIELDS } from "../../shared/research-priority-facts.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import { prefilterFixture } from "../helpers/research-prefilter-fixture.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import { Store } from "../../server/store.ts";
import { schoolRegistry } from "../../server/schools/index.ts";

const disciplines = getDisciplineCatalog().items.filter((d) =>
  ["0802", "0855"].includes(d.code),
);
const source: WebSource = {
  id: "official",
  url: "https://grs.hdu.edu.cn/2026/info",
  title: "杭州电子科技大学2026年硕士研究生招生信息",
  kind: "official_page",
  verified: false,
  retrievedAt: "2026-10-11T00:00:00Z",
  excerpt:
    "杭州电子科技大学2026年硕士研究生招生信息\n" +
    [
      "2026年080200机械工程复试线：330分，满分500分。",
      "2026年080200机械工程录取最低分：340分，满分500分。",
      "2026年080200机械工程报录比：5:1。",
      "2026年080200机械工程实际录取：30人。",
      "2026年080200机械工程推免占比：20%。",
      "2026年080200机械工程录取学生包括双非本科毕业生。",
      "2026年080200机械工程录取学生包括跨专业考生。",
      "2026年080200机械工程学科评估为B+。",
      "2026年080200机械工程专业排名第20。",
      "2026年080200机械工程硕士毕业生就业去向：制造行业。",
      "2026年080200机械工程服务杭州城市发展与制造产业。",
    ].join("\n"),
};

test("saved target totals are owner scoped, dated, non-example and never inferred from assessments", () => {
  const store = new Store();
  try {
    const library = createResearchEvidenceLibrary(store);
    const plan = {
      subjectId: "owner",
      totalTargetScore: 350,
      totalMaxScore: 500,
      status: "valid",
      errors: [],
      programSnapshot: {
        isExample: false,
        identity: { targetAdmissionYear: 2027 },
      },
    };
    store.put("owner", "plan", "current", plan);
    assert.deepEqual(library.targetScore!("owner", "2027"), {
      total: 350,
      maximum: 500,
    });
    assert.equal(library.targetScore!("other", "2027"), undefined);
    assert.equal(library.targetScore!("owner", "2028"), undefined);
    store.put("owner", "plan", "current", { ...plan, totalTargetScore: null });
    assert.equal(library.targetScore!("owner", "2027"), undefined);
    store.put("owner", "plan", "current", {
      ...plan,
      programSnapshot: { ...plan.programSnapshot, isExample: true },
    });
    assert.equal(library.targetScore!("owner", "2027"), undefined);
  } finally {
    store.close();
  }
});

test("full collection flow retains three years and all five categories, with compact grounded Pro input and per-model usage", async () => {
  const fixture = prefilterFixture();
  const reader = fixture.config.reader!;
  fixture.config.reader = async (url, options) => {
    const result = await reader(url, options);
    const school = schoolRegistry.byHost(new URL(url).hostname);
    if (!school) return result;
    const text = [2026, 2025, 2024]
      .map((year) =>
        source.excerpt
          .replaceAll("杭州电子科技大学", school.name)
          .replaceAll("服务杭州", `服务${school.city}`)
          .replaceAll("2026", String(year)),
      )
      .join("\n");
    return { ...result, text: result.text + `<pre>${text}</pre>` };
  };
  const complete = fixture.config.adapter!.complete;
  fixture.config.adapter = {
    async complete(messages, options) {
      assert.equal(
        options?.model,
        options?.thinking ? "deepseek-v4-pro" : "deepseek-flash",
      );
      if (options?.thinking) {
        const data = JSON.parse(messages[1].content);
        assert.ok(data.priorityFacts.length > 0);
        assert.ok(
          data.priorityFacts.every((f: { sourceId: string }) =>
            data.sources.some((s: { id: string }) => s.id === f.sourceId),
          ),
        );
        assert.ok(JSON.stringify(messages).length <= 40000);
      }
      return complete(messages, options);
    },
  };
  const report = await fixture.create().generate({
    subjectId: fixture.run.subjectId,
    run: fixture.run,
    strategy: "two-stage",
    targetScore: { total: 350, maximum: 500 },
  });
  assert.equal(report.recommendations.length, 10);
  assert.ok(
    report.priorityFacts!.every((f) =>
      report.sources
        .find((s) => s.id === f.sourceId)
        ?.excerpt.includes(f.quote),
    ),
  );
  assert.equal(report.priorityCoverage!.groups.scores.confirmed, 10);
  for (const category of Object.values(report.priorityCoverage!.groups))
    assert.equal(category.confirmed, 10);
  assert.equal(report.priorityCoverage!.pending, 0);
  assert.equal(report.usage!.model.byModel!["deepseek-v4-pro"].calls, 1);
  assert.ok(report.usage!.model.byModel!["deepseek-flash"].calls >= 14);
  assert.equal(
    report.usage!.model.inputTokens,
    Object.values(report.usage!.model.byModel!).reduce(
      (n, m) => n + m.inputTokens,
      0,
    ),
  );
});

test("all five categories bind literal original passages; numeric values and target gaps are derived by rules", () => {
  const facts = extractPriorityFacts(source, disciplines, "2027", {
    total: 350,
    maximum: 500,
  });
  assert.deepEqual(
    new Set(facts.map((f) => f.field)),
    new Set(RESEARCH_PRIORITY_FIELDS),
  );
  assert.equal(facts.find((f) => f.field === "cutoff")!.value.targetGap, 20);
  assert.ok(
    facts.every(
      (f) =>
        f.verified === false &&
        f.sourceId === source.id &&
        source.excerpt.includes(f.quote),
    ),
  );
  const metric = priorityCoverage(
    facts,
    [
      {
        institutionName: "杭州电子科技大学",
        disciplineCode: "0802",
        majorCode: "080200",
      },
    ],
    "2027",
  );
  assert.equal(
    metric.groups.scores.confirmed,
    0,
    "one year is not three-year score coverage",
  );
  assert.equal(metric.groups.competition.confirmed, 1);
  assert.equal(metric.groups.background.confirmed, 1);
  assert.equal(metric.groups.academic.confirmed, 1);
  assert.equal(metric.groups.employment.confirmed, 1);
});

test("Flash quotes, source IDs, years, school ownership and programme identities cannot be invented or spliced", () => {
  const quote = "2026年080200机械工程复试线：330分，满分500分";
  const valid = {
    field: "cutoff",
    quote,
    sourceId: source.id,
    value: { number: 999 },
  };
  assert.equal(
    validatePriorityFacts([valid], source, disciplines, "2027")[0].value.number,
    330,
  );
  for (const proposal of [
    { ...valid, quote: quote.replace("330", "320") },
    { ...valid, sourceId: "other" },
    { ...valid, field: "admittedCount" },
    { ...valid, quote: quote + " … 录取30人" },
  ])
    assert.deepEqual(
      validatePriorityFacts([proposal], source, disciplines, "2027"),
      [],
    );
  assert.deepEqual(
    validatePriorityFacts(
      [valid],
      { ...source, kind: "search_snippet" },
      disciplines,
      "2027",
    ),
    [],
  );
  assert.deepEqual(
    validatePriorityFacts(
      [valid],
      { ...source, url: "https://www.zju.edu.cn/info" },
      disciplines,
      "2027",
    ),
    [],
  );
  assert.deepEqual(
    validatePriorityFacts([valid], source, disciplines, "2025"),
    [],
  );
  assert.equal(
    validatePriorityFacts([valid], source, disciplines, "2027", {
      total: 250,
      maximum: 300,
    })[0].value.targetGap,
    undefined,
  );
});

test("collector uses bounded parallel Flash with shared accounting; the switch routes every collection phase to Pro", async () => {
  for (const useFlash of [true, false]) {
    let active = 0,
      peak = 0,
      calls = 0,
      retries = 0;
    const names: string[] = [];
    const runtime = createModelRuntime({
      adapter: {
        async complete(messages, options) {
          peak = Math.max(peak, ++active);
          calls++;
          names.push(options!.model!);
          assert.equal(options!.thinking, false);
          assert.equal(options!.timeoutMs, 30000);
          await new Promise((resolve) => setTimeout(resolve, 3));
          active--;
          const body = JSON.parse(messages[1].content);
          const content = messages[0].content.includes("research-query-plan")
            ? { focus: [99, 0, 0, 0, 0] }
            : messages[0].content.includes("research-school-summary")
              ? {
                  factIds: [
                    "invented",
                    ...body.map((f: { id: string }) => f.id),
                  ],
                }
              : {
                  facts: [
                    {
                      field: "cutoff",
                      sourceId: body.sourceId,
                      quote: "2026年080200机械工程复试线：330分，满分500分",
                    },
                  ],
                };
          return {
            content: JSON.stringify(content),
            inputTokens: 20,
            outputTokens: 10,
            model: options!.model!,
          };
        },
      },
    });
    const collector = createResearchCollector({
      runtime,
      subjectId: "owner",
      useFlash,
      check: () => {},
      beforeRetry: async () => {
        retries++;
      },
      onFailure: (code) => assert.fail(code),
    });
    assert.deepEqual(await collector.plan(disciplines, [2026, 2025, 2024]), [
      ...PRIORITY_SEARCH_TERMS,
    ]);
    const result = await collector.extract(
      Array.from({ length: 6 }, (_, i) => ({
        ...source,
        id: `page-${i}`,
        url: source.url + i,
      })),
      disciplines,
      "2027",
    );
    assert.equal(peak, 4);
    assert.equal(retries, 0);
    assert.ok(calls >= 8);
    assert.ok(
      names.every(
        (n) => n === (useFlash ? "deepseek-flash" : "deepseek-v4-pro"),
      ),
    );
    assert.equal(
      result.facts.length,
      RESEARCH_PRIORITY_FIELDS.length,
      "same-school duplicate pages are merged without dropping different fields",
    );
    assert.equal(result.summarizedFacts, result.facts.length);
  }
  assert.equal(collectionModelOptions().model, "deepseek-flash");
});

test("temporary errors get at most one authorised retry; timeout and quota errors retain deterministic facts without retry", async () => {
  for (const code of [
    "MODEL_TIMEOUT",
    "BUDGET_EXHAUSTED",
    "PROVIDER_TEMPORARY_UNAVAILABLE",
  ]) {
    let calls = 0,
      retries = 0;
    const runtime = createModelRuntime({
      adapter: {
        async complete() {
          calls++;
          throw new ModelError(code);
        },
      },
    });
    const collector = createResearchCollector({
      runtime,
      subjectId: "owner",
      check: () => {},
      beforeRetry: async () => {
        if (retries++) throw new ModelError(code);
      },
      onFailure: () => {},
    });
    await collector.plan(disciplines, [2026, 2025, 2024]);
    assert.equal(calls, code === "PROVIDER_TEMPORARY_UNAVAILABLE" ? 2 : 1);
    const facts = (await collector.extract([source], disciplines, "2027"))
      .facts;
    assert.ok(facts.length > 0);
    if (code !== "PROVIDER_TEMPORARY_UNAVAILABLE") assert.equal(calls, 1);
  }
});
