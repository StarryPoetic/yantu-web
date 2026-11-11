import test from "node:test";
import assert from "node:assert/strict";
import {
  publicEvidenceId,
  repairResearchEvidence,
  reusableResearchSources,
} from "../../server/explanation/research-repair.ts";
import type {
  ResearchEvidenceGap,
  ResearchReadAttempt,
} from "../../shared/research-coverage.ts";
import type {
  WebSource,
  createWebAnswerModule,
} from "../../server/explanation/web.ts";
import { validatedSourceProvenance } from "../../server/explanation/research-provenance.ts";

const now = () => Date.parse("2026-10-04T00:00:00Z");
const page = (school = "示例研究大学", host = "example.edu.cn"): WebSource => ({
  id: "old-parent",
  url: `https://${host}/catalog`,
  title: `${school}2026年硕士招生专业目录`,
  excerpt: `${school}2026年硕士研究生招生专业目录\n法学院 030101 法学理论 全日制 初试：101思想政治理论 201英语一 611法学基础 811法学综合`,
  kind: "official_page",
  verified: false,
  retrievedAt: new Date(now()).toISOString(),
});
const gap = (school = "示例研究大学"): ResearchEvidenceGap => ({
  id: `${school}-exams`,
  institutionName: school,
  programName: "法学理论",
  majorCode: "030101",
  disciplineCode: "0301",
  field: "exams",
  targetYear: "2027",
  referenceYears: [2026, 2025, 2024],
  purpose: "missing_evidence",
  reason: "科目待补充",
  nextAction: "读取官方专业目录中的初试科目",
  sourceIds: [],
  references: [],
  priority: "high",
  attempts: [],
});
function web(sources: WebSource[] = [], questions: string[] = []) {
  return {
    answer: async (input: { question: string }) => {
      questions.push(input.question);
      return {
        status: "sources_only",
        answer: "",
        points: [],
        notices: [],
        sources,
        searched: true,
        needsSearch: true,
      };
    },
  } as unknown as ReturnType<typeof createWebAnswerModule>;
}
const base = () => ({
  subjectId: "student",
  gaps: [gap()],
  sources: [page()],
  targetYear: "2027",
  web: web(),
  maxRequests: 4,
  maxReads: 8,
  now,
  onProgress: async () => {},
  readPage: async () => ({
    text: "示例研究大学2026年硕士招生专业目录\n030101 法学理论 初试：101思想政治理论 201英语一 611法学基础 811法学综合",
    contentType: "text/plain",
  }),
});
function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("prefetch reserves failed reads before the outer reader records its cooldown", async () => {
  const attempts: ResearchReadAttempt[] = [];
  const urls: string[] = [];
  const candidates = Array.from({ length: 8 }, (_, i) => ({
    ...page(),
    url: `https://example.edu.cn/p${i}`,
    kind: "search_snippet" as const,
  }));
  const result = await repairResearchEvidence({
    ...base(),
    sources: [],
    attempts,
    maxReads: 3,
    maxRequests: 1,
    priorityDocuments: true,
    searchFirst: true,
    web: web(candidates),
    readPage: async (url) => {
      urls.push(url);
      // This is what the report's fetchPage does while a parallel wave runs.
      attempts.push({
        url,
        status: "failed",
        reason: "HTTP_404",
        attemptedAt: new Date(now()).toISOString(),
      });
      throw Object.assign(new Error("not found"), { code: "HTTP_404" });
    },
  });
  assert.equal(urls.length, 3);
  assert.equal(result.readCount, urls.length);
  assert.equal(result.attempts.length, urls.length);
  assert.ok(result.attempts.every((a) => a.reason === "HTTP_404"));
});

test("one failed prefetch cannot discard other reserved successes or overread their attachments", async () => {
  const attempts: ResearchReadAttempt[] = [];
  const saved: string[] = [],
    reads: string[] = [];
  const candidates = Array.from({ length: 5 }, (_, i) => ({
    ...page(),
    url: `https://example.edu.cn/p${i}`,
    kind: "search_snippet" as const,
  }));
  const result = await repairResearchEvidence({
    ...base(),
    sources: [],
    attempts,
    maxReads: 3,
    maxRequests: 1,
    priorityDocuments: true,
    searchFirst: true,
    web: web(candidates),
    onSource: (s) => {
      saved.push(s.url);
    },
    readPage: async (url) => {
      reads.push(url);
      if (url.endsWith("p0")) {
        attempts.push({
          url,
          status: "failed",
          reason: "HTTP_404",
          attemptedAt: new Date(now()).toISOString(),
        });
        throw Object.assign(new Error("missing"), { code: "HTTP_404" });
      }
      return {
        text: `<h1>${page().excerpt}</h1><a href="/more.pdf">硕士招生专业目录附件</a>`,
        contentType: "text/html",
      };
    },
  });
  assert.equal(reads.length, 3);
  assert.equal(result.readCount, 3);
  assert.deepEqual(
    saved,
    candidates.slice(1, 3).map((c) => c.url),
  );
  assert.equal(result.attempts.length, 3);
});

test("priority collection spends at most one discovery read per school and never reads doctoral materials", async () => {
  const titles = [
    "招生信息首页",
    "博士招生专业目录",
    "2024年硕士招生专业目录",
    "复试分数线",
    "导航首页",
    "拟录取名单",
    "2026年硕士招生专业目录",
  ];
  const sources = titles.map((title, i) => ({
    ...page(),
    title: `示例研究大学${title}`,
    url: `https://example.edu.cn/p${i}`,
    kind: "search_snippet" as const,
  }));
  const reads: string[] = [];
  const result = await repairResearchEvidence({
    ...base(),
    sources: [],
    priorityDocuments: true,
    web: web(sources),
    maxReads: 8,
    readPage: async (url) => {
      reads.push(url);
      return { text: page().excerpt, contentType: "text/plain" };
    },
  });
  assert.deepEqual(reads, [
    sources[6].url,
    sources[2].url,
    sources[3].url,
    sources[5].url,
    sources[0].url,
  ]);
  assert.equal(result.readCount, 5);
});

test("reused citations are rebased as a source graph without changing original retrieval time or words", () => {
  const parent = page();
  const child: WebSource = {
    ...parent,
    id: "old-child",
    url: "https://example.edu.cn/catalog.pdf",
    parentSourceId: parent.id,
    excerpt: "030101 法学理论",
    provenance: {
      institutionName: "示例研究大学",
      parentSourceId: parent.id,
      parentUrl: parent.url,
      identityExcerpt: parent.excerpt,
      linkedTitle: "2026年硕士招生目录",
      admissionYear: "2026",
      mastersScope: true,
    },
  };
  const values = reusableResearchSources(
    [
      parent,
      child,
      {
        ...parent,
        id: "snippet",
        url: "https://example.edu.cn/snippet",
        kind: "search_snippet",
      },
    ],
    now(),
  );
  assert.equal(values.length, 2);
  assert.equal(values[1].parentSourceId, publicEvidenceId(parent.url));
  assert.equal(values[1].provenance?.parentSourceId, values[0].id);
  assert.equal(values[1].retrievedAt, child.retrievedAt);
  assert.equal(values[1].excerpt, child.excerpt);
  assert.ok(validatedSourceProvenance(values[1]));
  assert.equal(values[0].library?.status, "fresh");
  assert.equal(
    reusableResearchSources([parent], now() + 2 * 86400000)[0].library?.status,
    "stale",
  );
});

test("continuation follows actual official attachments and keeps their independent quoted words", async () => {
  const parent = page();
  parent.excerpt = "示例研究大学2026年硕士研究生招生专业目录";
  parent.documentLinks = [
    { url: "https://example.edu.cn/catalog.pdf", title: "2026年硕士专业目录" },
  ];
  const result = await repairResearchEvidence({
    ...base(),
    sources: [parent],
    maxRequests: 0,
    readPage: async () => ({
      text: "030101 法学理论 初试：101思想政治理论 201英语一 611法学基础 811法学综合",
      contentType: "application/pdf",
    }),
  });
  assert.equal(result.readCount, 1);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[1].excerpt.startsWith("030101"), true);
  assert.ok(validatedSourceProvenance(result.sources[1]));
  assert.equal(result.attempts[0].status, "success");
});

test("already read links cannot hide a later unread attachment", async () => {
  const parent = page();
  parent.documentLinks = Array.from({ length: 5 }, (_, i) => ({
    url: `https://example.edu.cn/${i}.pdf`,
    title: "2026年硕士专业目录",
  }));
  const sources = [
    parent,
    ...parent.documentLinks
      .slice(0, 4)
      .map((link) => ({ ...page(), ...link, id: link.url })),
  ];
  const seen: string[] = [];
  const result = await repairResearchEvidence({
    ...base(),
    sources,
    maxRequests: 0,
    readPage: async (url) => {
      seen.push(url);
      return { text: "030101 法学理论", contentType: "application/pdf" };
    },
  });
  assert.deepEqual(seen, ["https://example.edu.cn/4.pdf"]);
  assert.equal(result.readCount, 1);
});

test("field resolution after reading avoids unnecessary search and skips later resolved gaps", async () => {
  const parent = page();
  parent.documentLinks = [
    { url: "https://example.edu.cn/exams.pdf", title: "2026年硕士初试科目" },
  ];
  const questions: string[] = [];
  const result = await repairResearchEvidence({
    ...base(),
    sources: [parent],
    gaps: [gap(), { ...gap(), id: "second" }],
    web: web([], questions),
    needsEvidence: (_gap, sources) => sources.length === 1,
  });
  assert.equal(result.readCount, 1);
  assert.equal(result.requestCount, 0);
  assert.deepEqual(questions, []);
});

test("saved lookup keys advance through historical years rather than repeating the same query", async () => {
  const questions: string[] = [];
  const first = await repairResearchEvidence({
    ...base(),
    web: web([], questions),
  });
  const next = await repairResearchEvidence({
    ...base(),
    web: web([], questions),
    lookupKeys: first.lookupKeys,
  });
  assert.match(questions[0], /2026年/);
  assert.match(questions[1], /2025年/);
  assert.equal(next.lookupKeys.length, 2);
});

test("read quotas reserve progress for other schools instead of exhausting all reads on one school", async () => {
  const first = page(),
    second = page("第二研究大学", "second.edu.cn");
  for (const source of [first, second])
    source.documentLinks = Array.from({ length: 8 }, (_, i) => ({
      url: new URL(`${i}.pdf`, source.url).href,
      title: "2026年硕士专业目录",
    }));
  const seen: string[] = [];
  const result = await repairResearchEvidence({
    ...base(),
    sources: [first, second],
    gaps: [gap(), gap("第二研究大学")],
    maxReads: 4,
    maxRequests: 0,
    readPage: async (url) => {
      seen.push(url);
      return { text: "030101 法学理论", contentType: "application/pdf" };
    },
  });
  assert.equal(result.readCount, 4);
  assert.equal(seen.filter((url) => url.includes("example.edu.cn")).length, 2);
  assert.equal(seen.filter((url) => url.includes("second.edu.cn")).length, 2);
});

test("temporary failures retain last valid evidence, record diagnostics and respect cooldown", async () => {
  const parent = page();
  parent.library = {
    status: "stale",
    storedAt: parent.retrievedAt,
    expiresAt: parent.retrievedAt,
    version: 1,
  };
  const snippet = { ...parent, kind: "search_snippet" as const };
  const error = Object.assign(new Error("timeout"), { code: "WEB_TIMEOUT" });
  const first = await repairResearchEvidence({
    ...base(),
    sources: [parent],
    web: web([snippet]),
    readPage: async () => {
      throw error;
    },
  });
  assert.equal(first.readCount, 1);
  assert.equal(first.sources[0].excerpt, parent.excerpt);
  assert.equal(first.attempts[0].reason, "WEB_TIMEOUT");
  const second = await repairResearchEvidence({
    ...base(),
    sources: first.sources,
    web: web([snippet]),
    attempts: first.attempts,
    lookupKeys: first.lookupKeys,
    readPage: async () => {
      throw error;
    },
  });
  assert.equal(second.readCount, 0);
});

test("empty documents stay unavailable and cancellation is propagated", async () => {
  const parent = page();
  const events: string[] = [];
  parent.documentLinks = [
    { url: "https://example.edu.cn/new.pdf", title: "硕士专业目录" },
  ];
  const result = await repairResearchEvidence({
    ...base(),
    sources: [parent],
    maxRequests: 0,
    onProgress: async (detail) => {
      events.push(detail);
    },
    readPage: async () => ({ text: "", contentType: "application/pdf" }),
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.attempts[0].reason, "WEB_EMPTY");
  assert.match(events[1], /原文读取返回.*等待内容核验/);
  assert.match(events[2], /原文整理未完成.*缺项保持待补/);
  await assert.rejects(
    repairResearchEvidence({
      ...base(),
      sources: [parent],
      maxRequests: 0,
      readPage: async () => {
        throw Object.assign(new Error("cancelled"), { code: "data_deleted" });
      },
    }),
    /cancelled/,
  );
});

test("search snippets cannot become evidence without an actual successful page read", async () => {
  const snippet = {
    ...page(),
    url: "https://example.edu.cn/new",
    id: "search-new",
    kind: "search_snippet" as const,
  };
  const result = await repairResearchEvidence({
    ...base(),
    sources: [],
    web: web([snippet]),
    readPage: async () => {
      throw new Error("unavailable");
    },
  });
  assert.equal(result.sources[0].kind, "search_snippet");
  assert.equal(result.attempts[0].status, "failed");
  assert.equal(
    result.sources.some((source) => source.kind === "official_page"),
    false,
  );
});

test("attachment read order gives the latest historical policy priority over auxiliary target-year policy", async () => {
  const parent = page();
  parent.documentLinks = [2027, 2024, 2025, 2026].map((year) => ({
    url: `https://example.edu.cn/${year}.pdf`,
    title: `${year}年硕士专业目录`,
  }));
  const seen: string[] = [];
  await repairResearchEvidence({
    ...base(),
    sources: [parent],
    maxReads: 1,
    maxRequests: 0,
    readPage: async (url) => {
      seen.push(url);
      return { text: "030101 法学理论", contentType: "application/pdf" };
    },
  });
  assert.deepEqual(seen, ["https://example.edu.cn/2026.pdf"]);
});

test("library gap opening reads different schools concurrently and records every result", async () => {
  const parents = [
    page("甲研究大学", "a.edu.cn"),
    page("乙研究大学", "b.edu.cn"),
  ].map((source, index) => ({
    ...source,
    id: `parent-${index}`,
    documentLinks: [
      { url: source.url + ".pdf", title: "2026年硕士专业目录初试科目" },
    ],
  }));
  let active = 0,
    peak = 0;
  const result = await repairResearchEvidence({
    ...base(),
    gaps: [gap("甲研究大学"), gap("乙研究大学")],
    sources: parents,
    maxRequests: 0,
    readPage: async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active--;
      return {
        text: "030101 法学理论 初试：101思想政治理论",
        contentType: "application/pdf",
      };
    },
  });
  assert.equal(peak, 2);
  assert.equal(result.readCount, 2);
  assert.equal(result.attempts.length, 2);
  assert.ok(result.attempts.every((attempt) => attempt.status === "success"));
});

for (const failed of [false, true])
  test(`opening read ${failed ? "failure" : "return"} is reported before a slower peer settles`, async () => {
    const parents = [
      page("甲研究大学", "a.edu.cn"),
      page("乙研究大学", "b.edu.cn"),
    ].map((source, index) => ({
      ...source,
      id: `parent-${index}`,
      documentLinks: [
        { url: source.url + ".pdf", title: "2026年硕士专业目录初试科目" },
      ],
    }));
    const slow = deferred();
    const fastReported = deferred();
    const events: string[] = [],
      started: string[] = [],
      saved: string[] = [];
    const attempts: ResearchReadAttempt[] = [];
    const pending = repairResearchEvidence({
      ...base(),
      gaps: [gap("甲研究大学"), gap("乙研究大学")],
      sources: parents,
      maxRequests: 0,
      maxReads: 2,
      onAttempt: (attempt) => attempts.push(attempt),
      onSource: (source) => {
        saved.push(source.url);
      },
      onProgress: async (detail) => {
        events.push(detail);
        if (
          detail.startsWith(failed ? "原文读取失败" : "原文读取返回") &&
          detail.includes("乙研究大学")
        )
          fastReported.resolve();
      },
      readPage: async (url) => {
        const school = url.includes("a.edu.cn") ? "甲研究大学" : "乙研究大学";
        assert.ok(
          events.some(
            (event) =>
              event.startsWith("提交原文读取任务") && event.includes(school),
          ),
        );
        started.push(url);
        if (school === "甲研究大学") await slow.promise;
        else if (failed)
          throw Object.assign(new Error("private body / token"), {
            code: "HTTP_404",
          });
        return { text: "030101 法学理论", contentType: "application/pdf" };
      },
    });
    // If the implementation fails before producing the event, surface its error
    // instead of leaving an unresolved event promise hanging in the test.
    pending.catch(fastReported.reject);
    try {
      await fastReported.promise;
      assert.equal(started.length, 2);
      assert.equal(
        events.filter(
          (event) =>
            event.startsWith("原文读取返回") && event.includes("甲研究大学"),
        ).length,
        0,
      );
      assert.equal(
        attempts.length,
        0,
        "source consumption remains ordered behind the pending wave",
      );
    } finally {
      slow.resolve();
    }
    const result = await pending;
    assert.equal(result.readCount, 2);
    assert.equal(result.requestCount, 0);
    assert.equal(result.attempts.length, 2);
    assert.deepEqual(
      saved,
      started.filter((url) => !failed || url.includes("a.edu.cn")),
    );
    assert.equal(
      events.filter((event) => event.startsWith("原文读取失败")).length,
      Number(failed),
    );
    assert.ok(
      events.every((event) => !/private body|token|https:|已补齐/.test(event)),
    );
  });

test("queued same-school reads report their start only when the reader is invoked", async () => {
  const parent = page();
  parent.documentLinks = [0, 1].map((index) => ({
    url: `https://example.edu.cn/${index}.pdf`,
    title: "2026年硕士专业目录初试科目",
  }));
  const firstStarted = deferred();
  const firstReleased = deferred();
  const events: string[] = [];
  const pending = repairResearchEvidence({
    ...base(),
    sources: [parent],
    maxRequests: 0,
    maxReads: 2,
    onProgress: async (detail) => {
      events.push(detail);
    },
    readPage: async (url) => {
      if (url.endsWith("/0.pdf")) {
        firstStarted.resolve();
        await firstReleased.promise;
      }
      return { text: "030101 法学理论", contentType: "application/pdf" };
    },
  });
  pending.catch(firstStarted.reject);
  try {
    await firstStarted.promise;
    assert.equal(
      events.filter((event) => event.startsWith("提交原文读取任务")).length,
      1,
    );
    assert.equal(
      events.filter((event) => event.startsWith("原文读取返回")).length,
      0,
    );
  } finally {
    firstReleased.resolve();
  }
  const result = await pending;
  assert.equal(result.readCount, 2);
  assert.match(events[0], /提交原文读取任务.*任务 1/);
  assert.match(events[1], /原文读取返回.*任务 1/);
  assert.match(events[2], /提交原文读取任务.*任务 2/);
  assert.match(events[3], /原文读取返回.*任务 2/);
});

test("progress persistence errors propagate instead of being recorded as unavailable evidence", async () => {
  const parent = page();
  parent.documentLinks = [{ url: parent.url + ".pdf", title: "硕士专业目录" }];
  const error = new Error("progress persistence unavailable");
  let reads = 0,
    attempts = 0;
  await assert.rejects(
    repairResearchEvidence({
      ...base(),
      sources: [parent],
      maxRequests: 0,
      onProgress: async () => {
        throw error;
      },
      onAttempt: () => {
        attempts++;
      },
      readPage: async () => {
        reads++;
        return { text: parent.excerpt, contentType: "text/plain" };
      },
    }),
    (received) => received === error,
  );
  assert.equal(reads, 0);
  assert.equal(attempts, 0);
});

test("cancelled reads have no false completion or ordinary failure event", async () => {
  const parent = page();
  parent.documentLinks = [{ url: parent.url + ".pdf", title: "硕士专业目录" }];
  const error = Object.assign(new Error("cancelled"), {
    code: "RESEARCH_CANCELLED",
  });
  const events: string[] = [];
  await assert.rejects(
    repairResearchEvidence({
      ...base(),
      sources: [parent],
      maxRequests: 0,
      onProgress: async (detail) => {
        events.push(detail);
      },
      readPage: async () => {
        throw error;
      },
    }),
    (received) => received === error,
  );
  assert.equal(events.length, 1);
  assert.match(events[0], /提交原文读取任务/);
});

test("search progress distinguishes returned leads, empty results, limits and failed tasks", async (t) => {
  for (const outcome of ["leads", "empty", "limited", "failed"] as const)
    await t.test(outcome, async () => {
      const events: string[] = [];
      const questions: string[] = [];
      const service = web(
        outcome === "leads" ? [{ ...page(), kind: "search_snippet" }] : [],
        questions,
      );
      const answer = service.answer;
      const error = new Error("provider URL contains private token");
      service.answer = async (...args) => {
        assert.match(events.at(-1)!, /提交缺项检索任务/);
        if (outcome === "failed") throw error;
        const result = await answer(...args);
        return outcome === "limited"
          ? { ...result, reason: "SEARCH_BUDGET_EXHAUSTED" }
          : result;
      };
      const pending = repairResearchEvidence({
        ...base(),
        maxRequests: 1,
        web: service,
        onProgress: async (detail) => {
          events.push(detail);
        },
      });
      if (outcome === "failed")
        await assert.rejects(pending, (received) => received === error);
      else {
        const result = await pending;
        assert.equal(result.requestCount, 1);
        assert.equal(result.readCount, 0);
        assert.equal(questions.length, 1);
      }
      assert.equal(events.length, 2);
      assert.match(
        events[1],
        outcome === "leads"
          ? /返回 1 条待核验线索/
          : outcome === "empty"
            ? /本轮未返回候选，缺项保持待补/
            : outcome === "limited"
              ? /返回受限/
              : /缺项检索失败/,
      );
      assert.ok(
        events.every((event) => !/private|token|https:|已补齐/.test(event)),
      );
    });
});

test("library-first opening and subsequent gap rounds prefer the requested city", async () => {
  const preferred = page("杭州电子科技大学", "hdu.edu.cn");
  const outside = page("西北大学", "nwu.edu.cn");
  for (const parent of [outside, preferred])
    parent.documentLinks = [0, 1].map((i) => ({
      url: parent.url + `-${i}.pdf`,
      title: "2026年硕士招生专业目录初试科目",
    }));
  const seen: string[] = [];
  const result = await repairResearchEvidence({
    ...base(),
    sources: [outside, preferred],
    gaps: [gap("西北大学"), gap("杭州电子科技大学")],
    preferences: { cities: ["杭州"] },
    maxReads: 2,
    maxRequests: 0,
    readPage: async (url) => {
      seen.push(url);
      return { text: "030101 法学理论", contentType: "application/pdf" };
    },
  });
  assert.equal(result.readCount, 2);
  assert.ok(seen[0].includes("hdu.edu.cn"));
});
