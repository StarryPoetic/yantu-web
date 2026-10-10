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

test("registered same-city campuses verify city from detailed school footer addresses; cross-city hints and unknown schools retain uncertainty", () => {
  const schoolSource = (name: string, domain: string, address: string) => ({
    ...source(
      "registered",
      `${name}2026年硕士研究生招生，080200 机械工程。\n${address}\n版权所有：${name}`,
      `https://${domain}/graduate`,
    ),
    title: `${name}硕士招生资料`,
  });
  const sameCity = schoolSource(
    "宁波工程学院",
    "nbut.edu.cn",
    "校区地址：宁波杭州湾新区滨海二路769号 电话0574-12345678 邮编315000。\n校区地址：宁波市江北区风华路201号",
  );
  const verify = (s: WebSource, name: string) =>
    bindRecommendationEvidence(
      card({
        institutionName: name,
        collegeName: undefined,
        citations: [s.id],
      }),
      run,
      discipline,
      [s],
      "2027",
    );
  const result = verify(sameCity, "宁波工程学院");
  assert.equal(result.location?.city, "宁波");
  assert.equal(
    result.constraintChecks?.find((c) => c.field === "cities")?.status,
    "mismatch",
  );
  assert.equal(result.location?.supportingEvidence?.length, 2);
  assert.ok(
    result.location?.supportingEvidence?.every((e) =>
      sameCity.excerpt.includes(e.quote),
    ),
  );
  const cross = verify(
    schoolSource(
      "浙江大学",
      "zju.edu.cn",
      "校区地址：杭州市学院路1号 电话12345 邮编310000",
    ),
    "浙江大学",
  );
  assert.equal(cross.location, undefined);
  assert.ok(
    cross.pendingEvidence?.some(
      (e) => e.field === "location" && e.quote.includes("学院路1号"),
    ),
  );
  const unknown = verify(
    schoolSource(
      "未知大学",
      "unknown.edu.cn",
      "校区地址：杭州市学院路1号。\n校区地址：杭州市学院路2号",
    ),
    "未知大学",
  );
  assert.equal(unknown.location, undefined);
  const conflicting = verify(
    { ...sameCity, excerpt: sameCity.excerpt + "\n校区地址：杭州市学院路1号" },
    "宁波工程学院",
  );
  assert.equal(conflicting.location, undefined);
  const coarseConflict = verify(
    { ...sameCity, excerpt: sameCity.excerpt + "\n校区地址：杭州市钱塘区" },
    "宁波工程学院",
  );
  assert.equal(coarseConflict.location, undefined);
  const preferredRun = structuredClone(run);
  preferredRun.inputSnapshot.profile.cities = ["宁波"];
  const preferred = bindRecommendationEvidence(
    card({
      institutionName: "宁波工程学院",
      collegeName: undefined,
      citations: [sameCity.id],
    }),
    preferredRun,
    discipline,
    [sameCity],
    "2027",
  );
  assert.equal(
    preferred.constraintChecks?.find((c) => c.field === "cities")?.status,
    "match",
  );
});

test("detailed office/footer addresses survive as pending evidence, pure contact details do not; old school aliases cannot reappear as colleges", () => {
  const result = bind([
    source(
      "addresses",
      "甲大学硕士研究生招生。\n地址：宁波杭州湾新区滨海二路769号 电话0574-12345678 邮编315000。\n联系地址：电话0574-12345678 邮编315000 邮箱a@example.edu.cn",
    ),
  ]);
  assert.equal(result.location, undefined);
  const locations =
    result.pendingEvidence?.filter((e) => e.field === "location") ?? [];
  assert.equal(locations.length, 1);
  assert.match(locations[0].quote, /滨海二路769号.*电话.*邮编/);
  const oldName = source(
    "yulin",
    "榆林学院2026年硕士研究生招生专业目录。榆林学院\n080200 机械工程 全日制硕士招生。",
    "https://yjsc.yulinu.edu.cn/catalog",
  );
  const normalized = bindRecommendationEvidence(
    card({
      institutionName: "榆林大学",
      collegeName: "榆林学院",
      citations: [oldName.id],
    }),
    run,
    discipline,
    [oldName],
    "2027",
  );
  assert.equal(normalized.collegeName, undefined);
});

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

test("explicit school-wide uniform tariffs bind every programme without inventing a study mode", () => {
  for (const wording of [
    "我校研究生学费标准均为",
    "我校研究生学 费标准均为",
    "所有研究生学费统一为",
    "全校硕士研究生学费为",
    "我校研究生学费标准为",
  ]) {
    const fee = source(
      "uniform",
      `甲大学2024年硕士研究生收费标准。${wording}7000元/年。`,
    );
    const result = bind([fee], { studyMode: "part_time" });
    assert.equal(result.tuition?.amount, 7000, wording);
    assert.equal(result.tuition?.year, 2024);
    assert.equal(result.tuition?.scope, "school_wide");
    assert.equal(result.tuition?.studyMode, "unspecified");
    assert.ok(result.citations.includes(fee.id));
    assert.match(
      result.constraintChecks!.find((c) => c.field === "budget")!.reason,
      /2024年历史.*2027年.*待核对.*全校统一/,
    );
    assert.equal(
      result.pendingEvidence?.filter((e) => e.field === "tuition").length,
      0,
    );
  }
});

test("a uniform school tariff remains applicable when the programme faculty or mode is unresolved", () => {
  const result = bind(
    [
      source(
        "uniform",
        "甲大学2024年硕士研究生收费标准。我校研究生学费统一为7000元/年。\n机械工程学院\n080200 机械工程 全日制硕士。\n智能制造学院\n080200 机械工程 非全日制硕士。",
      ),
    ],
    { collegeName: undefined, studyMode: undefined },
  );
  assert.equal(result.tuition?.amount, 7000);
  assert.equal(result.tuition?.scope, "school_wide");
  assert.equal(result.location, undefined);
  assert.equal(result.exams?.status, "ambiguous");
});

const schoolBands =
  "我校全日制硕士研究生缴纳学费标准为10000元/人·年，非全日制硕士研究生（工程管理）缴纳学费标准75000元/生·全程。";
test("school mode tariffs remain two literal pending clauses when programme mode is unknown", () => {
  const plainAdmission = source(
    "admission",
    "甲大学2027年硕士招生目录。机械工程专业招收硕士。",
  );
  const fee = source("bands", `甲大学2024年硕士研究生收费标准。${schoolBands}`);
  const result = bindRecommendationEvidence(
    card({ studyMode: undefined }),
    run,
    discipline,
    [plainAdmission, fee],
    "2027",
  );
  assert.equal(result.studyMode, undefined);
  assert.equal(result.tuition, undefined);
  assert.equal(
    result.constraintChecks!.find((c) => c.field === "budget")!.status,
    "unknown",
  );
  const pending = result.pendingEvidence!.filter((e) => e.field === "tuition");
  assert.equal(pending.length, 2);
  assert.ok(pending.some((e) => e.quote.includes("10000元/人·年")));
  assert.ok(pending.some((e) => e.quote.includes("75000元/生·全程")));
  for (const item of pending) {
    assert.ok(fee.excerpt.includes(item.quote));
    assert.match(item.reason, /区分全日制与非全日制.*未写明学习方式/);
    assert.match(item.reason, /多个金额不同的档次/);
    assert.match(item.reason, /2024早于目标年度2027/);
  }
});

test("an explicitly full-time programme binds only that school tariff, and undated tuition never matches budget", () => {
  const dated = bind([
    source("bands", `甲大学2024年硕士研究生收费标准。${schoolBands}`),
  ]);
  assert.equal(dated.tuition?.amount, 10000);
  assert.equal(dated.tuition?.scope, "school_wide_mode");
  assert.equal(dated.tuition?.studyMode, "full_time");
  const undated = bind([
    source("bands", `甲大学硕士研究生收费标准。${schoolBands}`),
  ]);
  assert.equal(undated.tuition?.amount, 10000);
  assert.equal(undated.tuition?.year, undefined);
  assert.equal(
    undated.constraintChecks!.find((c) => c.field === "budget")!.status,
    "unknown",
  );
  assert.match(
    undated.constraintChecks!.find((c) => c.field === "budget")!.reason,
    /未明确适用年度/,
  );
});

test("current mode-specific school tariffs invalidate an older uniform tariff when programme mode is unknown", () => {
  const plainAdmission = source(
    "admission",
    "甲大学2027年硕士招生目录。机械工程专业招收硕士。",
  );
  const result = bindRecommendationEvidence(
    card({ studyMode: undefined }),
    run,
    discipline,
    [
      plainAdmission,
      source(
        "old",
        "甲大学2024年硕士研究生收费标准。我校研究生学费统一为7000元/年。",
      ),
      source("current", `甲大学2027年硕士研究生收费标准。${schoolBands}`),
    ],
    "2027",
  );
  assert.equal(result.tuition, undefined);
  assert.equal(
    result.constraintChecks!.find((c) => c.field === "budget")!.status,
    "unknown",
  );
});

test("conflicting school-wide tariffs in the target year do not restore an older price", () => {
  const result = bind([
    source(
      "old",
      "甲大学2024年硕士研究生收费标准。我校研究生学费统一为7000元/年。",
    ),
    ...[8000, 9000].map((amount, index) =>
      source(
        `current${index}`,
        `甲大学2027年硕士研究生收费标准。我校研究生学费统一为${amount}元/年。`,
      ),
    ),
  ]);
  assert.equal(result.tuition, undefined);
  assert.match(
    result.pendingEvidence!.find((e) => e.sourceId === "old")!.reason,
    /早于目标年度/,
  );
});

test("school tariffs do not borrow faculty, programme or special-population prices or annualize units", () => {
  for (const clause of [
    "其他学院我校研究生学费统一为7000元/年",
    "我校研究生（电气工程）学费统一为7000元/年",
    "我校研究生中的电气工程学费统一为7000元/年",
    "我校研究生学费标准：电气工程7000元/年",
    "我校来华留学生研究生学费统一为7000元/年",
    "我校研究生学费7000元/年或9000元/年",
  ])
    assert.equal(
      bind([source("invalid", `甲大学2024年硕士收费标准。${clause}。`)])
        .tuition,
      undefined,
      clause,
    );
  for (const unit of ["全程", "学期", "学分"]) {
    const result = bind([
      source(
        "uniform",
        `甲大学2024年硕士研究生收费标准。我校研究生学费统一为7000元/${unit}。`,
      ),
    ]);
    assert.ok(result.tuition);
    assert.notEqual(result.tuition.period, "academic_year");
    assert.equal(
      result.constraintChecks!.find((c) => c.field === "budget")!.status,
      "unknown",
    );
  }
});

test("pending tuition excludes auxiliary fees, bare amounts and headings; pure contacts are not campus evidence", () => {
  const result = bind([
    source(
      "noise",
      "甲大学2024年硕士研究生收费标准。\n（一）学费\n学费（元/学年）\n住宿费1000元/年。教材费500元。体检费93元。杂费200元。7000元/年。\n培养地址：浙江省杭州市学院路1号，电话0571-12345678，邮编310000。\n联系地址：浙江省杭州市办公室1号，电话0571-12345678。",
    ),
  ]);
  assert.equal(
    result.pendingEvidence?.filter((e) => e.field === "tuition").length,
    0,
  );
  const pending =
    result.pendingEvidence?.filter((e) => e.field === "location") ?? [];
  assert.equal(pending.length, 1);
  assert.match(pending[0].quote, /培养地址.*电话.*邮编/);
  assert.ok(!pending[0].quote.includes("办公室"));
  const multiple = bind([
    source(
      "campuses",
      "甲大学2024年硕士研究生培养安排。培养地址：浙江省杭州市下沙校区；教学地址：浙江省宁波市梅山校区。",
    ),
  ]);
  assert.equal(multiple.location, undefined);
  const campusPending = multiple.pendingEvidence!.filter(
    (e) => e.field === "location",
  );
  assert.equal(campusPending.length, 2);
  assert.ok(campusPending.every((e) => /页面列出多个校区地址/.test(e.reason)));
});

test("pending quotes deduplicate normalized whitespace and punctuation per field and source, with concrete scope reasons", () => {
  const result = bind([
    source(
      "duplicate",
      "甲大学2024年硕士研究生收费标准。其他学院 080200 机械工程 全日制学费8000元/年。\n其他学院　080200　机械工程　全日制学费8000元/年。",
    ),
  ]);
  const tuition = result.pendingEvidence!.filter((e) => e.field === "tuition");
  assert.equal(tuition.length, 1);
  assert.match(tuition[0].reason, /无法确认适用学院或专业/);
  assert.match(tuition[0].reason, /2024早于目标年度2027/);
});
