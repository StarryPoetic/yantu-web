import test from "node:test";
import assert from "node:assert/strict";
import {
  publicEvidenceId,
  repairResearchEvidence,
  reusableResearchSources,
} from "../../server/explanation/research-repair.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
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
  parent.documentLinks = [
    { url: "https://example.edu.cn/new.pdf", title: "硕士专业目录" },
  ];
  const result = await repairResearchEvidence({
    ...base(),
    sources: [parent],
    maxRequests: 0,
    readPage: async () => ({ text: "", contentType: "application/pdf" }),
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.attempts[0].reason, "WEB_EMPTY");
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
