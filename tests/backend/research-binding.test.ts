import test from "node:test";
import assert from "node:assert/strict";
import {
  generateGuidance,
  getDisciplineCatalog,
} from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import { bindRecommendationEvidence } from "../../server/explanation/research-binding.ts";
import type { ResearchReport } from "../../server/explanation/research.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import { normalizeAttachedEvidence } from "../../server/explanation/research-provenance.ts";

const discipline = getDisciplineCatalog().items.find((d) => d.code === "0802")!;
const run = generateGuidance({
  subjectId: "student",
  guidanceRunId: "binding",
  generatedAt: "2026-10-11T00:00:00Z",
  profile: {
    ...blankProfile(),
    major: "机械工程",
    targetMajor: "机械工程",
    year: "2027",
    cities: ["杭州"],
    budget: "1 万元以内",
    studyGoal: "学术研究",
    hours: "每天2至4小时",
  },
  profileVersion: 1,
  selectionVersion: 1,
  confirmedMajorId: "0802",
  excludedMajorIds: [],
  assessments: [],
});
function source(
  id: string,
  excerpt: string,
  url = `https://grad.a.edu.cn/${id}`,
): WebSource {
  return {
    id,
    title: "甲大学硕士招生资料",
    url,
    excerpt,
    retrievedAt: "2026-10-11T00:00:00Z",
    kind: "official_page",
    verified: false,
  };
}
const admission = source(
  "admission",
  "甲大学2027年硕士研究生招生专业目录。机械工程学院\n080200 机械工程 全日制硕士招生。",
);
function card(
  changes: Partial<ResearchReport["recommendations"][number]> = {},
): ResearchReport["recommendations"][number] {
  return {
    institutionName: "甲大学",
    programName: "机械工程",
    majorCode: "080200",
    collegeName: "机械工程学院",
    studyMode: "full_time",
    disciplineCode: "0802",
    degreeType: "academic",
    citations: ["admission"],
    rationale: "按本人兴趣比较培养内容。",
    preparation: [],
    uncertainties: [],
    ...changes,
  };
}
const bind = (sources: WebSource[], changes = {}) =>
  bindRecommendationEvidence(
    card(changes),
    run,
    discipline,
    [admission, ...sources],
    "2027",
  );

test("all same-domain read pages bind uncited tuition, campus and exams with source citations", () => {
  const fees = source(
    "fees",
    "甲大学2027年硕士研究生收费标准。机械工程学院 080200 机械工程 全日制学费8000元/年。",
  );
  const campus = source(
    "campus",
    "甲大学2027年硕士研究生培养安排。机械工程学院 080200 机械工程 全日制培养地址：浙江省杭州市西湖区学院路1号。",
  );
  const exams = source(
    "exams",
    "甲大学2027年硕士研究生招生专业目录。机械工程学院\n080200 机械工程 全日制 初试①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合",
  );
  const result = bind([fees, campus, exams]);
  assert.equal(result.tuition?.amount, 8000);
  assert.equal(result.location?.city, "杭州");
  assert.equal(result.exams?.status, "verified_current");
  assert.deepEqual(
    result.exams?.subjects.map((s) => s.code),
    ["101", "201", "301", "812"],
  );
  for (const id of ["fees", "campus", "exams"])
    assert.ok(result.citations.includes(id));
  assert.ok(result.constraintChecks?.every((c) => c.status === "match"));
  assert.equal(result.pendingEvidence?.length, 0);
});

test("historical exams and fees retain year and label the budget comparison as historical reference", () => {
  const result = bind([
    source(
      "history",
      "甲大学2026年硕士研究生招生专业目录及收费标准。机械工程学院\n080200 机械工程 全日制 初试①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合\n机械工程学院 080200 机械工程 全日制学费8000元/年。",
    ),
  ]);
  assert.equal(result.exams?.status, "historical");
  assert.equal(result.exams?.year, 2026);
  assert.equal(result.tuition?.year, 2026);
  assert.equal(
    result.constraintChecks?.find((c) => c.field === "budget")?.status,
    "match",
  );
  assert.match(
    result.constraintChecks!.find((c) => c.field === "budget")!.reason,
    /2026年历史.*2027年.*待核对/,
  );
});

test("conflicting amounts and campuses stay pending literal quotes, independent of source order", () => {
  const sources = [8000, 12000].map((amount, i) =>
    source(
      `fee${i}`,
      `甲大学2027年硕士研究生收费标准。机械工程学院 080200 机械工程 全日制学费${amount}元/年。`,
    ),
  );
  sources.push(
    ...["杭州", "宁波"].map((city, i) =>
      source(
        `campus${i}`,
        `甲大学2027年硕士研究生培养安排。机械工程学院 080200 机械工程 全日制培养地址：浙江省${city}市学院路1号。`,
      ),
    ),
  );
  for (const pool of [sources, [...sources].reverse()]) {
    const result = bind(pool);
    assert.equal(result.tuition, undefined);
    assert.equal(result.location, undefined);
    assert.ok(result.constraintChecks?.every((c) => c.status === "unknown"));
    assert.deepEqual(
      new Set(result.pendingEvidence?.map((e) => e.field)),
      new Set(["tuition", "location"]),
    );
    for (const evidence of result.pendingEvidence ?? []) {
      assert.ok(evidence.quote.length <= 300);
      assert.ok(
        pool
          .find((s) => s.id === evidence.sourceId)
          ?.excerpt.includes(evidence.quote),
      );
      assert.ok(evidence.reason);
    }
  }
});

test("other college, mode, special population and foreign-domain same-name text cannot supply this project's fields", () => {
  for (const text of [
    "其他学院 080200 机械工程 全日制学费8000元/年，培养地址：浙江省杭州市学院路1号。",
    "机械工程学院 080200 机械工程 非全日制学费8000元/年，培养地址：浙江省杭州市学院路1号。",
    "机械工程学院 080200 机械工程 全日制 来华留学生学费8000元/年，培养地址：浙江省杭州市学院路1号。",
  ]) {
    const result = bind([
      source("other", `甲大学2027年硕士研究生招生。${text}`),
    ]);
    assert.equal(result.tuition, undefined, text);
    assert.equal(result.location, undefined, text);
    assert.ok(result.pendingEvidence?.some((e) => e.field === "tuition"));
  }
  const outside = source(
    "foreign",
    "甲大学2027年硕士研究生收费标准。机械工程学院 080200 机械工程 全日制学费8000元/年。",
    "https://grad.b.edu.cn/fee",
  );
  const result = bind([outside]);
  assert.equal(result.tuition, undefined);
  assert.equal(result.pendingEvidence?.length, 0);
});

test("programme, semester and credit prices are not annualized or used for annual budget matching", () => {
  for (const [unit, period] of [
    ["全程", "program"],
    ["学期", "semester"],
    ["学分", "credit"],
  ] as const) {
    const result = bind([
      source(
        "fee",
        `甲大学2027年硕士研究生收费标准。机械工程学院 080200 机械工程 全日制学费8000元/${unit}。`,
      ),
    ]);
    assert.equal(result.tuition?.period, period);
    assert.equal(result.tuition?.amount, 8000);
    assert.equal(
      result.constraintChecks?.find((c) => c.field === "budget")?.status,
      "unknown",
    );
  }
});

test("same programme in multiple colleges or modes cannot bind without an explicit identity", () => {
  const sourceText =
    "甲大学2027年硕士研究生招生目录。\n机械工程学院\n080200 机械工程 全日制 初试①101思想政治理论②201英语（一）③301数学（一）\n智能制造学院\n080200 机械工程 非全日制 初试①101思想政治理论②201英语（一）③301数学（一）";
  const result = bind([source("ambiguous", sourceText)], {
    collegeName: undefined,
    studyMode: undefined,
  });
  assert.equal(result.exams?.status, "ambiguous");
  assert.equal(result.exams?.subjects.length, 0);
  assert.ok(result.pendingEvidence?.some((e) => e.field === "exams"));
});

test("the same programme name under different codes stays pending when no code was selected", () => {
  const result = bind(
    [
      source(
        "codes",
        "甲大学2027年硕士研究生招生目录。机械工程学院\n080201 机械工程 全日制 初试①101思想政治理论②201英语（一）③301数学（一）",
      ),
    ],
    { majorCode: undefined },
  );
  assert.equal(result.exams?.status, "ambiguous");
  assert.equal(result.exams?.subjects.length, 0);
  assert.ok(result.pendingEvidence?.some((e) => e.field === "exams"));
});

test("a read linked attachment needs validated school provenance before its fields can bind", () => {
  const parent = {
    ...admission,
    documentLinks: [
      {
        url: "https://grad.a.edu.cn/fees.pdf",
        title: "2027年硕士研究生收费标准.pdf",
      },
    ],
  };
  const child = {
    ...source(
      "attachment",
      "2027年硕士研究生收费标准\n机械工程学院 080200 机械工程 全日制学费8000元/年。",
      parent.documentLinks[0].url,
    ),
    parentSourceId: parent.id,
  };
  assert.equal(
    bindRecommendationEvidence(card(), run, discipline, [parent, child], "2027")
      .tuition,
    undefined,
  );
  const linked = normalizeAttachedEvidence(child, parent, child.excerpt);
  const result = bindRecommendationEvidence(
    card(),
    run,
    discipline,
    [parent, linked],
    "2027",
  );
  assert.equal(result.tuition?.amount, 8000);
  assert.ok(result.citations.includes("attachment"));
  assert.equal(result.tuition?.quote.includes("甲大学"), false);
});

test("a conflicting target-year notice invalidates an older price rather than restoring it", () => {
  const sources = [
    source(
      "old",
      "甲大学2026年硕士研究生收费标准。机械工程学院 080200 机械工程 全日制学费8000元/年。",
    ),
    source(
      "new1",
      "甲大学2027年硕士研究生收费标准。机械工程学院 080200 机械工程 全日制学费9000元/年。",
    ),
    source(
      "new2",
      "甲大学2027年硕士研究生收费标准。机械工程学院 080200 机械工程 全日制学费12000元/年。",
    ),
  ];
  const result = bind(sources, {
    tuition: {
      amount: 8000,
      currency: "CNY",
      period: "academic_year",
      year: 2026,
      studyMode: "full_time",
      quote: sources[0].excerpt.split("。")[1],
      sourceId: "old",
    },
  });
  assert.equal(result.tuition, undefined);
  assert.equal(
    result.constraintChecks?.find((c) => c.field === "budget")?.status,
    "unknown",
  );
});
