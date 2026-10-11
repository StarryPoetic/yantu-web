import test from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_BUDGET as B,
  researchReservation,
} from "../../server/explanation/research-budget.ts";
import {
  createResearchReader,
  orderedReadWave,
  sharedResearchRead,
} from "../../server/explanation/research-reader.ts";
import { selectModelFacts } from "../../server/explanation/research-model-facts.ts";
import type { ProgramFact } from "../../server/explanation/research-facts.ts";
import { createModelRuntime } from "../../server/explanation/index.ts";
import { reportMessages } from "../../server/explanation/research.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import type { WebSource } from "../../server/explanation/web.ts";

test("different reports share the same global network and redirect-host limits", async () => {
  let active = 0,
    peak = 0;
  const hosts = new Set<string>();
  const readers = Array.from({ length: 3 }, () =>
    createResearchReader((url, signal) =>
      sharedResearchRead(url, signal, async () => {
        const host = new URL(url).hostname;
        assert.equal(hosts.has(host), false);
        hosts.add(host);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 4));
        hosts.delete(host);
        active--;
        return url;
      }),
    ),
  );
  await Promise.all(
    readers.flatMap((reader) =>
      Array.from({ length: 10 }, (_, i) =>
        reader.read(`https://cross${i}.edu.cn/page`),
      ),
    ),
  );
  assert.equal(peak, B.concurrency);
  for (const reader of readers) assert.equal(reader.statistics.reads, 10);
});

test("final model input keeps facts ahead of excerpts, deduplicates source URLs and trims lower priorities within the JSON limit", () => {
  const run = generateGuidance({
    subjectId: "owner",
    guidanceRunId: "input-test",
    generatedAt: "2026-10-11T00:00:00Z",
    profile: {
      ...blankProfile(),
      year: "2027",
      major: "管理科学与工程",
      targetMajor: "管理科学与工程",
      studyGoal: "专业实践与行业就业",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "1201",
    excludedMajorIds: [],
    assessments: [],
  });
  const discipline = getDisciplineCatalog().items.find(
    (d) => d.code === "1201",
  )!;
  const sources: WebSource[] = Array.from({ length: B.candidates }, (_, i) => ({
    id: `source-${i}`,
    url: `https://s${i}.edu.cn/catalog`,
    title: "2027年硕士招生目录",
    excerpt:
      `学校${i}大学2027年硕士研究生管理科学与工程招生信息。` +
      "专业培养方案与初试学费说明。".repeat(1000),
    retrievedAt: "2026-10-11T00:00:00Z",
    kind: "official_page",
    verified: false,
  }));
  sources.push({ ...sources[0], id: "duplicate" });
  const primary = fact(2027, "bound", {
    sourceId: "source-0",
    sourceUrl: sources[0].url,
  });
  const pending = fact(2026, "pending", {
    field: "exams",
    sourceId: "source-0",
    sourceUrl: sources[0].url,
  });
  const facts = [
    primary,
    primary,
    pending,
    ...Array.from({ length: 200 }, (_, i) =>
      fact(2025, "pending", {
        majorCode: String(120200 + i),
        sourceId: "source-1",
        sourceUrl: sources[1].url,
        quote: "待确认原文".repeat(100),
      }),
    ),
  ];
  const messages = reportMessages(
    run,
    { directions: [], followUpQuestions: [] },
    [discipline],
    sources,
    "2027",
    facts,
  );
  assert.ok(
    JSON.stringify(messages).length <= B.thinkingChars - B.repairHeadroom,
  );
  assert.ok(
    messages[1].content.indexOf('"structuredFacts"') <
      messages[1].content.indexOf('"sources"'),
  );
  const input = JSON.parse(messages[1].content);
  assert.equal(input.structuredFacts[0].status, "bound");
  assert.ok(
    input.structuredFacts.some(
      (f: { status: string; confirmation: string }) =>
        f.status === "pending" && f.confirmation.includes("待确认"),
    ),
  );
  assert.equal(
    input.structuredFacts.filter(
      (f: { sourceId: string; field: string }) =>
        f.sourceId === primary.sourceId && f.field === primary.field,
    ).length,
    1,
  );
  assert.ok(input.sources.length <= B.modelSources);
  assert.equal(
    new Set(input.sources.map((s: { id: string }) => s.id)).size,
    input.sources.length,
  );
  assert.ok(!input.sources.some((s: { id: string }) => s.id === "duplicate"));
  assert.equal(facts.length, 203, "input pruning does not remove public facts");
});

test("shared scheduler bounds concurrency and serialises hosts; outcome merging is stable", async () => {
  let active = 0,
    peak = 0;
  const hosts = new Set<string>();
  const scheduler = createResearchReader(async (url) => {
    const host = new URL(url).hostname;
    assert.equal(hosts.has(host), false);
    hosts.add(host);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) =>
      setTimeout(resolve, url.endsWith("0") ? 20 : 3),
    );
    active--;
    hosts.delete(host);
    return url;
  });
  const urls = Array.from(
    { length: 20 },
    (_, i) => `https://s${i % 5}.edu.cn/${i}`,
  );
  const results: string[] = [];
  await orderedReadWave(
    urls,
    (url) => scheduler.read(url),
    async (_url, outcome) => {
      assert.equal(outcome.status, "fulfilled");
      if (outcome.status === "fulfilled") results.push(outcome.value);
    },
  );
  assert.deepEqual(results, urls);
  assert.equal(peak, B.concurrency);
  assert.equal(scheduler.statistics.reads, urls.length);
});

test("atomic reservations cannot exceed total/school/platform budgets and failures spend slots", async () => {
  let dispatched = 0;
  const scheduler = createResearchReader(async () => {
    dispatched++;
    throw new Error("offline failure");
  });
  await Promise.allSettled(
    Array.from({ length: 100 }, (_, i) =>
      scheduler.read(`https://s${i % 10}.edu.cn/${i}`),
    ),
  );
  assert.equal(dispatched, B.reads);
  assert.equal(scheduler.statistics.failed, B.reads);
  assert.ok(
    Object.values(scheduler.statistics.bySchool).every(
      (s) => s.reads <= B.schoolReads,
    ),
  );
  const school = createResearchReader(async () => "ok");
  await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) => school.read(`https://a.edu.cn/${i}`)),
  );
  assert.equal(school.statistics.reads, B.schoolReads);
  const platform = createResearchReader(async () => "ok");
  await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) =>
      platform.read(`https://yz.chsi.com.cn/${i}`),
    ),
  );
  assert.equal(platform.statistics.reads, B.platformReads);
});

test("read failures count dispatched requests and fixed codes, excluding rejected budget reservations", async () => {
  const scheduler = createResearchReader(async (url) => {
    if (Number(new URL(url).pathname.slice(1)) % 2)
      throw new ModelError("WEB_DNS_UNAVAILABLE");
    return "public text";
  });
  await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      scheduler.read(`https://stats.edu.cn/${i}`),
    ),
  );
  assert.equal(scheduler.statistics.reads, B.schoolReads);
  assert.equal(scheduler.statistics.success, 4);
  assert.equal(scheduler.statistics.failed, 4);
  assert.deepEqual(scheduler.statistics.failuresByCode, {
    WEB_DNS_UNAVAILABLE: 4,
  });
});

test("cancellation stops queued dispatch and aborts all in-flight readers", async () => {
  const controller = new AbortController();
  let dispatched = 0,
    aborted = 0;
  const scheduler = createResearchReader(async (_url, signal) => {
    dispatched++;
    return new Promise<string>((_resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted++;
          reject(signal.reason);
        },
        { once: true },
      ),
    );
  }, controller.signal);
  const result = Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      scheduler.read(`https://s${i}.edu.cn/page`),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await result;
  assert.equal(dispatched, B.concurrency);
  assert.equal(aborted, dispatched);
  await assert.rejects(scheduler.read("https://late.edu.cn/page"));
  assert.equal(scheduler.statistics.reads, dispatched);
});

const fact = (
  year: number,
  status: ProgramFact["status"],
  extra: Partial<ProgramFact> = {},
): ProgramFact => ({
  schoolName: "杭州电子科技大学",
  registrableDomain: "hdu.edu.cn",
  collegeName: "管理学院",
  majorCode: "120100",
  programName: "管理科学与工程",
  disciplineCode: "1201",
  degreeType: "academic",
  studyMode: "full_time",
  year,
  field: "tuition",
  value: { reason: "金额档次待确认" },
  quote: `${year}年学费原文`,
  sourceUrl: `https://grs.hdu.edu.cn/${year}`,
  sourceId: `source-${year}`,
  retrievedAt: "2026-10-11T00:00:00Z",
  extractedAt: "2026-10-11T00:00:00Z",
  extractor: "test",
  status,
  verified: false,
  ...extra,
});

test("pending pruning is by full programme identity/field, preferring target then latest, without mutating library", () => {
  const facts = [
    fact(2024, "pending"),
    fact(2025, "pending"),
    fact(2026, "pending"),
    fact(2027, "pending"),
    fact(2027, "pending"),
  ];
  const copy = structuredClone(facts);
  const selected = selectModelFacts(facts, ["1201"], "2027");
  assert.deepEqual(
    selected.map((f) => f.year),
    [2027, 2026],
  );
  assert.equal(selected.length, B.pendingPerField);
  assert.ok(
    selected.every(
      (f) => f.status === "pending" && f.confirmation.includes("待确认"),
    ),
  );
  assert.deepEqual(facts, copy);
  const bound = fact(2026, "bound");
  const pruned = selectModelFacts(
    [bound, ...facts.filter((f) => f.year! <= 2026)],
    ["1201"],
    "2027",
  );
  assert.deepEqual(
    pruned.map((f) => f.status),
    ["bound"],
  );
  const current = selectModelFacts(
    [
      fact(2027, "bound"),
      ...facts,
      fact(2027, "pending", { studyMode: "part_time" }),
      fact(2027, "pending", { field: "exams" }),
    ],
    ["1201"],
    "2027",
  );
  assert.equal(current.filter((f) => f.status === "pending").length, 2);
  assert.deepEqual(selectModelFacts(facts, ["0301"], "2027"), []);
});

test("school tariff scope and city-only campus annotations remain explicit", () => {
  const tuition = fact(2027, "bound", {
    value: {
      amount: 8000,
      currency: "CNY",
      period: "academic_year",
      year: 2027,
      studyMode: "full_time",
      scope: "school_degree_type",
      quote: "全日制学硕8000元",
      sourceId: "source-2027",
    },
  });
  const campus = fact(2027, "bound", {
    field: "campus",
    value: { city: "杭州", quote: "杭州地址", sourceId: "source-2027" },
  });
  const selected = selectModelFacts([tuition, campus], ["1201"], "2027");
  assert.equal(
    selected.find((f) => f.field === "tuition")?.scopeNote,
    "school_degree_type",
  );
  assert.match(
    selected.find((f) => f.field === "campus")!.scopeNote!,
    /仅城市级.*具体校区待确认/,
  );
});

test("model facts keep only applicable bound years and rank target pending before historical bound", () => {
  const facts = [
    fact(2025, "bound"),
    fact(2026, "bound"),
    fact(2027, "pending"),
    fact(2028, "bound", { targetYearApplicable: true }),
    fact(2027, "bound", { field: "exams" }),
    fact(2026, "bound", { field: "exams" }),
    fact(2027, "pending", { majorCode: "120200" }),
  ];
  const original = structuredClone(facts);
  const selected = selectModelFacts(facts, ["1201"], "2027");
  assert.deepEqual(
    selected.map((f) => [f.year, f.status]),
    [
      [2027, "bound"],
      [2027, "pending"],
      [2027, "pending"],
      [2026, "bound"],
    ],
  );
  assert.deepEqual(facts, original);
  assert.deepEqual(
    selectModelFacts(
      [fact(2025, "bound"), fact(2026, "bound"), fact(2027, "bound")],
      ["1201"],
      "2027",
    ).map((f) => f.year),
    [2027],
  );
  assert.deepEqual(
    selectModelFacts([fact(2028, "bound")], ["1201"], "2027"),
    [],
  );
});

test("character trimming preserves target pending ahead of many historical applicable facts", () => {
  const run = generateGuidance({
    subjectId: "owner",
    guidanceRunId: "target-pending",
    generatedAt: "2026-10-11T00:00:00Z",
    profile: {
      ...blankProfile(),
      year: "2027",
      major: "管理科学与工程",
      targetMajor: "管理科学与工程",
      studyGoal: "专业实践与行业就业",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "1201",
    excludedMajorIds: [],
    assessments: [],
  });
  const facts = Array.from({ length: 200 }, (_, i) =>
    [2025, 2026].map((year) =>
      fact(year, "bound", {
        majorCode: String(120200 + i),
        sourceId: "history",
        quote: "历史公开原文".repeat(100),
      }),
    ),
  ).flat();
  facts.push(fact(2027, "pending", { quote: "目标年度归属待确认原文" }));
  const input = JSON.parse(
    reportMessages(
      run,
      { directions: [], followUpQuestions: [] },
      [getDisciplineCatalog().items.find((item) => item.code === "1201")!],
      [
        {
          id: "history",
          url: "https://grs.hdu.edu.cn/history",
          title: "历史收费资料",
          excerpt: "杭州电子科技大学历史收费公开原文。",
          retrievedAt: run.generatedAt,
          kind: "official_page",
          verified: false,
        },
        {
          id: "source-2027",
          url: "https://grs.hdu.edu.cn/pending",
          title: "2027年收费资料",
          excerpt: "杭州电子科技大学2027年目标年度归属待确认原文。",
          retrievedAt: run.generatedAt,
          kind: "official_page",
          verified: false,
        },
      ],
      "2027",
      facts,
    )[1].content,
  );
  assert.equal(input.structuredFacts[0].quote, "目标年度归属待确认原文");
  assert.ok(
    input.structuredFacts.length < 201,
    "exercise the character-budget trimming path",
  );
  assert.ok(
    input.structuredFacts.every((f: { year: number }) => f.year !== 2025),
  );
});

test("a worst-case report including repairs, one retry and optional coverage fits default quota; actual rejected-response usage is recorded", async () => {
  const reserve = researchReservation();
  assert.equal(
    reserve.required,
    2 * (B.normalChars + B.planningOutputTokens) +
      3 * (B.thinkingChars + B.finalOutputTokens),
  );
  assert.ok(reserve.withCoverage <= B.userDailyTokens);
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const runtime = createModelRuntime({
    adapter: {
      async complete() {
        return {
          content: "ok",
          model: "deepseek-v4-pro",
          inputTokens: 120,
          outputTokens: 34,
        };
      },
    },
  });
  await assert.rejects(
    runtime.run(
      "owner",
      "bad",
      [{ role: "user", content: "test" }],
      () => {
        throw new Error("invalid report");
      },
      {
        onCall: () => usage.calls++,
        onUsage: (actual) => {
          usage.inputTokens += actual.inputTokens;
          usage.outputTokens += actual.outputTokens;
        },
      },
    ),
  );
  assert.deepEqual(usage, { calls: 1, inputTokens: 120, outputTokens: 34 });
  await assert.rejects(
    runtime.run(
      "owner",
      "oversized",
      [{ role: "user", content: "中".repeat(B.normalChars) }],
      (raw) => raw,
    ),
    { code: "EVIDENCE_TOO_LARGE" },
  );
});

test("hundreds of programme rows do not overflow city metadata or erase the original catalogue", () => {
  const run = generateGuidance({
    subjectId: "owner",
    guidanceRunId: "large-city-metadata",
    generatedAt: "2026-10-11T00:00:00Z",
    profile: {
      ...blankProfile(),
      year: "2027",
      major: "管理科学与工程",
      targetMajor: "管理科学与工程",
      studyGoal: "专业实践与行业就业",
      cities: ["杭州"],
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "1201",
    excludedMajorIds: [],
    assessments: [],
  });
  const discipline = getDisciplineCatalog().items.find(
    (item) => item.code === "1201",
  )!;
  const excerpt =
    "示例管理大学2026年硕士研究生招生专业目录。\n" +
    Array.from(
      { length: 300 },
      (_, i) =>
        `${String.fromCodePoint(0x4e00 + i)}管理学院 | 120100 管理科学与工程 学术学位 全日制 ①101思想政治理论②201英语一③303数学三④811管理学`,
    ).join("\n");
  const sources: WebSource[] = [
    {
      id: "large-directory",
      url: "https://yz.management.edu.cn/catalogue",
      title: "示例管理大学2026年硕士招生专业目录",
      excerpt,
      kind: "official_page",
      verified: false,
      retrievedAt: run.generatedAt,
    },
  ];
  const messages = reportMessages(
    run,
    { directions: [], followUpQuestions: [] },
    [discipline],
    sources,
    "2027",
  );
  assert.ok(
    JSON.stringify(messages).length <= B.thinkingChars - B.repairHeadroom,
  );
  const input = JSON.parse(messages[1].content);
  assert.equal(input.candidateCities.length, 1);
  assert.equal(input.candidateCities[0].institutionName, "示例管理大学");
  assert.ok(input.candidateCities[0].collegeName);
  assert.equal(input.candidateCities[0].cityVerification.status, "unknown");
  assert.equal(sources[0].excerpt, excerpt);
  assert.ok(
    input.sources.some(
      (source: { id: string }) => source.id === "large-directory",
    ),
  );
});
