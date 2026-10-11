import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAttachedEvidence,
  validatedSourceProvenance,
} from "../../server/explanation/research-provenance.ts";
import { sourceHasSchoolIdentity } from "../../server/explanation/research-school.ts";
import {
  admissionEvidence,
  supportsProgram,
} from "../../server/explanation/research-evidence.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import {
  buildEvidenceCandidates,
  extractProgramExams,
} from "../../server/explanation/research-matching.ts";
import { blankProfile } from "../../server/profile.ts";
import { safeSourceYear } from "../../server/explanation/research-years.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const mechanical = getDisciplineCatalog().items.find(
  (item) => item.code === "0802",
)!;
const school = "杭州电子科技大学";
const plainRows =
  "机械工程学院\n080200 机械工程 ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合";
function fixture() {
  const parent: WebSource = {
    id: "parent",
    title: `${school}2027年硕士招生专业目录`,
    url: "https://grs.hdu.edu.cn/catalog.htm",
    excerpt: `${school}2027年硕士研究生招生专业目录。下载附件。Copyright © ${school}研究生院`,
    kind: "official_page",
    verified: false,
    retrievedAt: "2026-10-04T00:00:00Z",
    documentLinks: [
      {
        url: "https://grs.hdu.edu.cn/files/catalog.xls",
        title: "2027年硕士研究生招生专业目录.xls",
      },
    ],
  };
  const child: WebSource = {
    id: "child",
    title: "2027年硕士研究生招生专业目录.xls",
    url: parent.documentLinks![0].url,
    excerpt: plainRows,
    kind: "official_page",
    verified: false,
    retrievedAt: parent.retrievedAt,
    parentSourceId: parent.id,
  };
  return { parent, child };
}

test("cached provenance and body-year parsing revalidate nested metadata, body and transport identity changes", () => {
  const { parent, child } = fixture();
  const linked = normalizeAttachedEvidence(child, parent, plainRows);
  assert.ok(validatedSourceProvenance(linked));
  assert.equal(safeSourceYear(linked), 2027);
  linked.provenance!.parentUrl = "https://other.edu.cn/catalog";
  assert.equal(validatedSourceProvenance(linked), undefined);
  assert.equal(safeSourceYear(linked), undefined);
  linked.provenance!.parentUrl = parent.url;
  assert.ok(validatedSourceProvenance(linked));
  linked.excerpt = "其他大学版权所有。2026年硕士研究生招生专业目录。";
  assert.equal(validatedSourceProvenance(linked), undefined);
  assert.equal(safeSourceYear(linked), 2026);
  linked.kind = "search_snippet";
  assert.equal(safeSourceYear(linked), undefined);
});

test("linked school XLS binds actual owner and master's scope while preserving exact child words", () => {
  const { parent, child } = fixture();
  assert.equal(sourceHasSchoolIdentity(child, school), false);
  const linked = normalizeAttachedEvidence(child, parent, plainRows);
  assert.equal(linked.excerpt, plainRows);
  assert.equal(linked.provenance?.institutionName, school);
  assert.equal(sourceHasSchoolIdentity(linked, school), true);
  assert.equal(supportsProgram(linked, school, "机械工程", mechanical), true);
  assert.equal(
    admissionEvidence(linked, "2027").admissionStatus,
    "current_evidence",
  );
  const exam = extractProgramExams({
    institutionName: school,
    programName: "机械工程",
    discipline: mechanical,
    sources: [linked],
    targetYear: "2027",
  });
  assert.equal(exam.status, "verified_current");
  assert.deepEqual(
    exam.subjects.map((subject) => subject.code),
    ["101", "201", "301", "812"],
  );
  assert.ok(exam.quote && plainRows.includes(exam.quote));
  assert.ok(!exam.quote?.includes(school));
});

test("student eligibility dates in anonymous attachments do not replace the linked admission year", () => {
  const { parent, child } = fixture();
  for (const qualification of [
    "仅限2025级本科生报考",
    "2025年毕业的本科生可报考",
    "2025年获得学士学位的考生可报考",
  ]) {
    const body = `${plainRows}\n${qualification}。`;
    const attached = normalizeAttachedEvidence(
      { ...child, excerpt: body },
      parent,
      body,
    );
    assert.equal(attached.provenance?.admissionYear, "2027", qualification);
    assert.equal(safeSourceYear(attached), 2027, qualification);
    assert.equal(
      admissionEvidence(attached, "2027").admissionStatus,
      "current_evidence",
      qualification,
    );
  }
  const historical = `2026年硕士研究生招生专业目录\n${plainRows}\n仅限2025级本科生报考。`;
  const old = normalizeAttachedEvidence(
    { ...child, excerpt: historical },
    parent,
    historical,
  );
  assert.equal(old.provenance?.admissionYear, "2026");
  assert.equal(safeSourceYear(old), 2026);
  const mixed = `2026年硕士招生专业目录。2025年硕士招生专业目录。\n${plainRows}\n仅限2024级本科生报考。`;
  const ambiguous = normalizeAttachedEvidence(
    { ...child, excerpt: mixed },
    parent,
    mixed,
  );
  assert.equal(ambiguous.provenance?.admissionYear, undefined);
  assert.equal(safeSourceYear(ambiguous), undefined);
  assert.equal(
    admissionEvidence(ambiguous, "2027").admissionStatus,
    "needs_verification",
  );
});

test("nested directory details pass validated origin to their actual file links", () => {
  const { parent, child } = fixture();
  const detailUrl = "https://grs.hdu.edu.cn/2027/detail.htm";
  parent.documentLinks = [
    { url: detailUrl, title: "2027年硕士研究生招生专业目录" },
  ];
  const detail = normalizeAttachedEvidence(
    {
      ...child,
      id: "detail",
      url: detailUrl,
      excerpt: "2027年硕士研究生招生专业目录，附件下载。",
      documentLinks: [{ url: child.url, title: child.title }],
    },
    parent,
    "2027年硕士研究生招生专业目录，附件下载。",
  );
  assert.ok(validatedSourceProvenance(detail));
  const linked = normalizeAttachedEvidence(
    { ...child, parentSourceId: detail.id },
    detail,
    plainRows,
  );
  assert.equal(linked.provenance?.parentSourceId, detail.id);
  assert.equal(sourceHasSchoolIdentity(linked, school), true);
  assert.equal(supportsProgram(linked, school, "机械工程", mechanical), true);
});

test("search-only parents, missing actual links, foreign domains and unrelated parent IDs cannot bind evidence", () => {
  for (const change of [
    ({ parent, child }: ReturnType<typeof fixture>) => {
      parent.kind = "search_snippet";
    },
    ({ parent }: ReturnType<typeof fixture>) => {
      parent.excerpt = "硕士招生目录，附件下载。";
    },
    ({ parent }: ReturnType<typeof fixture>) => {
      parent.documentLinks = [];
    },
    ({ child }: ReturnType<typeof fixture>) => {
      child.parentSourceId = "another";
    },
    ({ child }: ReturnType<typeof fixture>) => {
      child.url = "https://hdu.edu.cn.evil.edu.cn/catalog.xls";
    },
    ({ child }: ReturnType<typeof fixture>) => {
      child.kind = "search_snippet";
    },
  ]) {
    const pair = fixture();
    change(pair);
    assert.equal(
      normalizeAttachedEvidence(pair.child, pair.parent, plainRows).provenance,
      undefined,
    );
  }
});

test("foreign school documents, doctoral scope and historical years override linked-page context", () => {
  const { parent, child } = fixture();
  const foreign =
    "乙大学2027年硕士招生专业目录。080200 机械工程。版权所有 © 乙大学";
  assert.equal(
    normalizeAttachedEvidence({ ...child, excerpt: foreign }, parent, foreign)
      .provenance,
    undefined,
  );
  const historical =
    "2026年硕士研究生招生专业目录\n080200 机械工程 201英语（一）301数学（一）";
  const old = normalizeAttachedEvidence(
    { ...child, excerpt: historical },
    parent,
    historical,
  );
  assert.equal(
    admissionEvidence(old, "2027").admissionStatus,
    "needs_verification",
  );
  const doctoral = "博士研究生招生专业目录\n080200 机械工程";
  const phd = normalizeAttachedEvidence(
    { ...child, excerpt: doctoral },
    parent,
    doctoral,
  );
  assert.equal(supportsProgram(phd, school, "机械工程", mechanical), false);
});

test("altered provenance URLs or owner passages lose identity, and parent identity never becomes a quote", () => {
  const { parent, child } = fixture();
  const linked = normalizeAttachedEvidence(child, parent, plainRows);
  assert.ok(linked.provenance);
  for (const provenance of [
    { ...linked.provenance, parentUrl: "https://evil.edu.cn/fake.htm" },
    { ...linked.provenance, identityExcerpt: "硕士招生目录，学校名称未知。" },
  ]) {
    assert.equal(
      validatedSourceProvenance({ ...linked, provenance }),
      undefined,
    );
    assert.equal(
      sourceHasSchoolIdentity({ ...linked, provenance }, school),
      false,
    );
  }
  assert.equal(linked.excerpt, child.excerpt);
  assert.ok(!linked.excerpt.includes(parent.excerpt));
});

test("a child exam-subject table or exam arrangement keeps its actual historical year despite the current linked title", () => {
  const { parent, child } = fixture();
  for (const heading of [
    "2026年硕士研究生初试科目表",
    "2026年初试科目表",
    "2026年硕士研究生考试安排",
    "2026年硕士研究生考试大纲",
    "2026年硕士研究生培养政策",
  ]) {
    const rows = `${heading}\n${plainRows}`;
    const linked = normalizeAttachedEvidence(
      { ...child, excerpt: rows },
      parent,
      rows,
    );
    assert.equal(linked.provenance?.admissionYear, "2026", heading);
    assert.equal(
      admissionEvidence(linked, "2027").admissionStatus,
      "needs_verification",
      heading,
    );
    assert.notEqual(
      extractProgramExams({
        institutionName: school,
        programName: "机械工程",
        discipline: mechanical,
        sources: [linked],
        targetYear: "2027",
      }).status,
      "verified_current",
      heading,
    );
  }
});

test("a partner college/institute attachment cannot inherit a school, while an explicitly internal college can", () => {
  for (const title of [
    "兄弟院校乙学院2027年硕士研究生招生专业目录.xlsx",
    "乙学院2027年硕士研究生招生专业目录.xlsx",
    "乙研究院2027年硕士研究生招生专业目录.xlsx",
    "乙研究所2027年硕士研究生招生专业目录.xlsx",
  ]) {
    const { parent, child } = fixture();
    parent.documentLinks![0].title = title;
    assert.equal(
      normalizeAttachedEvidence({ ...child, title }, parent, plainRows)
        .provenance,
      undefined,
      title,
    );
  }
  const { parent, child } = fixture();
  parent.documentLinks![0].title =
    "机械工程学院2027年硕士研究生招生专业目录.xlsx";
  parent.excerpt += `\n${school}机械工程学院提供本学院招生目录。`;
  assert.equal(
    normalizeAttachedEvidence(child, parent, plainRows).provenance
      ?.institutionName,
    school,
  );
});

test("bare linked XLS rows discover both mechanical routes independently of model output and preserve each actual exam combination", () => {
  // The row shape mirrors the official HDU XLS read on 2026-10-04. This fixture
  // tests extraction and provenance, not automatic annual catalogue updates.
  const { parent, child } = fixture();
  const rows =
    "工作表：rep_print_kskm3\n第1行：2027年硕士研究生招生专业目录\n第3行：院系所 | 专业 | 学位类型 | 考试科目\n第4行：010机械工程学院 | 080200机械工程 | 学术学位 | ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合\n第5行：010机械工程学院 | 085500机械 | 专业学位 | ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合";
  const linked = normalizeAttachedEvidence(
    { ...child, excerpt: rows },
    parent,
    rows,
  );
  const run = generateGuidance({
    subjectId: "linked-evidence-test",
    guidanceRunId: "linked-evidence-guidance",
    generatedAt: child.retrievedAt,
    profile: {
      ...blankProfile(),
      major: "机械设计制造及其自动化",
      cities: ["杭州"],
      crossMajor: "接受跨专业",
      hours: "每天4小时",
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [],
  });
  const result = buildEvidenceCandidates({
    run,
    disciplines: [
      mechanical,
      getDisciplineCatalog().items.find((item) => item.code === "0855")!,
    ],
    sources: [parent, linked],
    targetYear: "2027",
    schoolNames: [school],
  });
  assert.deepEqual(
    result.recommendations.map((item) => item.disciplineCode),
    ["0802", "0855"],
  );
  assert.ok(
    result.recommendations.every(
      (item) => item.exams?.status === "verified_current",
    ),
  );
  assert.ok(
    result.recommendations.every(
      (item) =>
        item.exams?.subjects.some((subject) => subject.code === "201") &&
        item.exams?.subjects.some((subject) => subject.code === "301"),
    ),
  );
  assert.equal(result.audit[0].status, "recommended");
});
