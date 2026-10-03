import test from "node:test";
import assert from "node:assert/strict";
import { safeSourceYear } from "../../server/explanation/research-years.ts";
import { normalizeAttachedEvidence } from "../../server/explanation/research-provenance.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const parent: WebSource = {
  id: "year-parent",
  title: "青山大学2027年硕士研究生招生专业目录",
  url: "https://grad.qingshan.edu.cn/catalog.htm",
  excerpt: "青山大学2027年硕士研究生招生专业目录。下载对应附件。",
  kind: "official_page",
  verified: false,
  retrievedAt: "2026-10-04T00:00:00Z",
  documentLinks: [
    {
      title: "2027年硕士研究生招生专业目录.xls",
      url: "https://grad.qingshan.edu.cn/catalog.xls",
    },
  ],
};
const child = (excerpt: string): WebSource => ({
  id: "year-child",
  title: "2027年硕士研究生招生专业目录.xls",
  url: parent.documentLinks![0].url,
  excerpt,
  kind: "official_page",
  verified: false,
  retrievedAt: parent.retrievedAt,
  parentSourceId: parent.id,
});

test("validated undated anonymous attachments may inherit an explicit linked admissions year", () => {
  const body = "机械工程学院\n080200 机械工程 201英语一301数学一";
  const attached = normalizeAttachedEvidence(child(body), parent, body);
  assert.equal(safeSourceYear(attached), 2027);
  assert.equal(safeSourceYear(child(body)), undefined);
});

test("actual attachment years override parent years and mixed body years cannot fall back to a parent", () => {
  const historical =
    "2026年硕士研究生招生专业目录\n080200 机械工程 201英语一301数学一";
  assert.equal(
    safeSourceYear(
      normalizeAttachedEvidence(child(historical), parent, historical),
    ),
    2026,
  );
  const mixed =
    "2026年硕士研究生招生专业目录、2025年硕士研究生招生专业目录\n080200 机械工程 201英语一301数学一";
  const attached = normalizeAttachedEvidence(child(mixed), parent, mixed);
  assert.equal(
    safeSourceYear({
      ...attached,
      provenance: attached.provenance
        ? { ...attached.provenance, admissionYear: "2027" }
        : undefined,
    }),
    undefined,
  );
});

test("public year classification rejects title-only years, timestamps, copyright and snippets", () => {
  const undated = {
    ...parent,
    excerpt:
      "青山大学硕士研究生招生专业目录。发布时间：2026年9月1日。版权所有2027。",
  };
  assert.equal(safeSourceYear(undated), undefined);
  assert.equal(
    safeSourceYear({ ...parent, kind: "search_snippet" }),
    undefined,
  );
});

test("actual policy headings remain dated when eligibility separately states student cohort or graduation years", () => {
  for (const eligibility of [
    "仅限2025级本科生报考",
    "2025年毕业的本科生可报考",
    "2025年获得学士学位的考生可报考",
  ]) {
    const body = `2026年硕士研究生招生专业目录。${eligibility}。\n080200 机械工程 201英语一301数学一`;
    const linked = normalizeAttachedEvidence(child(body), parent, body);
    assert.equal(safeSourceYear(linked), 2026, eligibility);
    assert.equal(
      safeSourceYear({
        ...parent,
        excerpt: `2027年硕士招生目录。${eligibility}。`,
      }),
      2027,
      eligibility,
    );
  }
  assert.equal(
    safeSourceYear({
      ...parent,
      excerpt: "2026级硕士研究生培养方案。仅限2025级本科生报考。",
    }),
    2026,
  );
  assert.equal(
    safeSourceYear({
      ...parent,
      excerpt: "2026年硕士招生目录。仅限2025级本科生报考。2027年硕士招生目录。",
    }),
    undefined,
  );
});
