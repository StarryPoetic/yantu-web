import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalReferenceYears,
  explicitAdmissionsYears,
  officialSourceYear,
  researchYearPriority,
  isTargetYearChange,
} from "../../shared/research-years.ts";

test("historical reference years are stable target-relative years and invalid targets do not fabricate dates", () => {
  assert.deepEqual(historicalReferenceYears("2027"), [2026, 2025, 2024]);
  assert.deepEqual(historicalReferenceYears(2028), [2027, 2026, 2025]);
  for (const value of ["", "2027年", "未知", 2027.1, 2001, Infinity])
    assert.deepEqual(historicalReferenceYears(value), []);
  assert.ok(
    researchYearPriority(2026, "2027") > researchYearPriority(2025, "2027"),
  );
  assert.ok(
    researchYearPriority(2024, "2027") > researchYearPriority(2027, "2027"),
  );
});

test("official source years require a single actual admission policy year and ignore snippet titles, dates and copyright", () => {
  for (const text of [
    "2026年硕士研究生招生专业目录",
    "2025年硕士研究生初试科目表",
    "2024年硕士研究生考试安排",
    "2026年研究生收费标准",
    "2025年硕士培养政策",
  ]) {
    assert.equal(
      officialSourceYear({ kind: "official_page", excerpt: text }),
      Number(text.slice(0, 4)),
    );
  }
  assert.deepEqual(
    explicitAdmissionsYears(
      "发布时间：2026-10-04\n080200机械工程\n版权所有©2026",
    ),
    [],
  );
  assert.equal(
    officialSourceYear({
      kind: "official_page",
      excerpt:
        "2026年目录发布于2025年9月29日\n2026年硕士研究生招生专业目录\nCopyright2027",
    }),
    2026,
  );
  assert.equal(
    officialSourceYear({
      kind: "search_snippet",
      excerpt: "2026年硕士研究生招生专业目录",
    }),
    undefined,
  );
  assert.equal(
    officialSourceYear({
      kind: "official_page",
      excerpt: "2026年硕士招生目录\n2025年硕士招生目录",
    }),
    undefined,
  );
  assert.equal(
    officialSourceYear({
      kind: "official_page",
      excerpt: "080200机械工程，无年度正文",
    }),
    undefined,
  );
});

test("a known target-year cancellation remains an explicit change, while history and publication years do not change the target", () => {
  assert.equal(
    isTargetYearChange(
      "2027年硕士研究生招生专业目录调整：机械专业暂停招生",
      "2027",
    ),
    true,
  );
  assert.equal(
    isTargetYearChange(
      "2026年硕士研究生招生专业目录调整：机械专业暂停招生",
      "2027",
    ),
    false,
  );
  assert.equal(
    isTargetYearChange("发布时间：2027-01-01\n机械专业暂停招生", "2027"),
    false,
  );
});

test("student cohort and graduation dates do not become admissions-policy years", () => {
  for (const qualification of [
    "仅限2025级本科生报考",
    "2025级法学本科毕业生可报考",
    "2025年毕业的本科生可报考",
    "2025年及以前毕业的考生可报考",
    "2025年取得本科毕业证的考生可报考",
    "2025年获得学士学位的考生可报考",
  ]) {
    const body = `2027年硕士研究生招生专业目录。${qualification}。`;
    assert.deepEqual(explicitAdmissionsYears(body), [2027], qualification);
    assert.equal(
      officialSourceYear({ kind: "official_page", excerpt: body }),
      2027,
      qualification,
    );
    assert.deepEqual(explicitAdmissionsYears(qualification), [], qualification);
  }
  for (const heading of [
    "2026级硕士研究生招生简章",
    "2026级硕士研究生培养方案",
    "2026年本科招生目录",
  ]) {
    assert.equal(
      officialSourceYear({ kind: "official_page", excerpt: heading }),
      2026,
      heading,
    );
  }
  assert.deepEqual(
    explicitAdmissionsYears(
      "2027年硕士招生目录。仅限2025级本科生报考。2026级硕士研究生招生简章。",
    ),
    [2027, 2026],
  );
  assert.equal(
    officialSourceYear({
      kind: "official_page",
      excerpt:
        "2027年硕士招生目录。仅限2025级本科生报考。2026级硕士研究生招生简章。",
    }),
    undefined,
  );
});
