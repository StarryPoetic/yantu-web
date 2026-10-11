import test from "node:test";
import assert from "node:assert/strict";
import {
  getDisciplineCatalog,
  generateGuidance,
} from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import {
  programEntries,
  hasConcreteExamSubjects,
  buildEvidenceCandidates,
} from "../../server/explanation/research-matching.ts";
import { bindRecommendationEvidence } from "../../server/explanation/research-binding.ts";
import { webPageText, type WebSource } from "../../server/explanation/web.ts";
import { deriveRecommendationConstraints } from "../../server/explanation/research-constraints.ts";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import { deriveCampusLocation } from "../../server/explanation/research-campus.ts";
const disciplines = getDisciplineCatalog().items;
const school = "杭州电子科技大学";
const page = (excerpt: string, id = "page"): WebSource => ({
  id,
  excerpt,
  title: "硕士招生资料",
  url: `https://grs.hdu.edu.cn/${id}`,
  kind: "official_page",
  retrievedAt: "2026-10-11T00:00:00.000Z",
  verified: false,
});
const tariff = `${school}2027年硕士研究生招生章程\n（ 1 ）全日制学术学位硕士：\n研究生每生每年学费 8000 元。\n（ 2 ）专业学位硕士研究生学费：\n全日制专业学位硕士研究生每生每年学费 10000 元；\n非全日制专业学位硕士收费请见下表\n2027级研究生学费标准（元/年）\n085410 人工智能 非全日制 学费30000元/年。`;
const run = generateGuidance({
  subjectId: "quality",
  guidanceRunId: "quality",
  generatedAt: "2026-10-11T00:00:00Z",
  profile: { ...blankProfile(), year: "2027" },
  profileVersion: 1,
  selectionVersion: 0,
  confirmedMajorId: null,
  excludedMajorIds: [],
  assessments: [],
});

test("only real catalogue rows create identities and their quotes stay local and short", () => {
  for (const body of [
    `${school}2027年硕士招生章程：125604 ）等专业学位硕士思想政治理论科目考试在复试中进行`,
    `${school}2027年硕士研究生招生专业目录\n085410 待定（以省发改委批复为准）`,
    `${school}招生简章\n报考080200 机械工程的考生请注意`,
    `${school}招生简章\n080200 机械工程`,
  ]) {
    assert.deepEqual(programEntries(page(body), disciplines), []);
    assert.deepEqual(
      buildEvidenceCandidates({
        run,
        disciplines,
        sources: [page(body)],
        targetYear: "2027",
      }).recommendations,
      [],
    );
  }
  const body = `${school}2027年硕士研究生招生专业目录\n机械工程学院\n080200 机械工程 全日制\n${"无关正文。".repeat(100)}`;
  assert.equal(
    programEntries(
      page(
        `${school}2027年硕士招生目录\n080200 机械工程。${"无关正文。".repeat(100)}`,
      ),
      disciplines,
    )[0].catalogQuote,
    "080200 机械工程",
  );
  const business = disciplines.find((d) => d.code === "0453")!;
  assert.equal(
    programEntries(
      page(`${school}2027年硕士研究生招生目录\n045300 汉语国际教育`),
      disciplines,
    )[0].programName,
    business.name,
  );
  assert.equal(
    programEntries(page(body), disciplines)[0].catalogQuote,
    "080200 机械工程 全日制",
  );
  assert.equal(
    programEntries(page(`${school}\n080200 机械工程\n085500 机械`), disciplines)
      .length,
    2,
  );
  const store = new Store();
  try {
    const library = createResearchEvidenceLibrary(store, {
      now: () => Date.parse("2026-10-11T00:00:00Z"),
    });
    library.save(page(body));
    library.save(
      page(`${school}2027年章程\n085410 待定\n125604 ）等专业学位硕士`, "bad"),
    );
    assert.equal(
      library
        .queryFacts({ targetYear: "2027" })
        .filter((f) => f.field === "catalog").length,
      1,
    );
    assert.ok(
      library
        .queryFacts({ targetYear: "2027" })
        .every(
          (f) =>
            f.programName === "机械工程" &&
            (f.field !== "catalog" || f.quote.length <= 300),
        ),
    );
    library.save(
      page(
        `${school}2027年硕士研究生招生目录\n045300 汉语国际教育 全日制`,
        "alias",
      ),
    );
    assert.ok(
      library
        .queryFacts({ targetYear: "2027" })
        .some(
          (f) =>
            f.field === "catalog" &&
            f.programName === "国际中文教育" &&
            f.quote.includes("汉语国际教育"),
        ),
    );
  } finally {
    store.close();
  }
});

test("pending exams require concrete subjects, reject referrals and deduplicate one identity", () => {
  for (const text of [
    "具体招生专业、考试科目以及复试范围详见目录",
    "详细考试时间、考试科目及有关要求等请见准考证",
    "学校坚持立德树人",
    "推荐免试是指免去初试",
  ])
    assert.equal(hasConcreteExamSubjects(text), false);
  for (const text of [
    "101 思想政治理论",
    "201 英语一",
    "数学二",
    "经济类综合能力",
    "812机械工程综合",
  ])
    assert.equal(hasConcreteExamSubjects(text), true);
  const catalogue = page(
    `${school}2027年硕士研究生招生专业目录\n080200 机械工程 全日制`,
    "catalogue",
  );
  const evidence = page(
    `${school}硕士招生说明\n机械工程初试考试科目详见目录\n机械工程初试科目：101思想政治理论、201英语一`,
    "exams",
  );
  const bound = bindRecommendationEvidence(
    {
      institutionName: school,
      programName: "机械工程",
      majorCode: "080200",
      disciplineCode: "0802",
      degreeType: "academic",
      citations: [catalogue.id],
      rationale: "",
      preparation: [],
      uncertainties: [],
    },
    run,
    disciplines.find((d) => d.code === "0802")!,
    [
      catalogue,
      evidence,
      { ...evidence, id: "duplicate", url: "https://grs.hdu.edu.cn/duplicate" },
    ],
    "2027",
  );
  assert.equal(
    bound.pendingEvidence?.filter((e) => e.field === "exams").length,
    1,
  );
  assert.ok(
    bound.pendingEvidence
      ?.filter((e) => e.field === "exams")
      .every(
        (e) => hasConcreteExamSubjects(e.quote) && !e.quote.includes("详见"),
      ),
  );
});

test("school degree tariffs bind exact degree and mode, never another programme's part-time price", () => {
  const check = (
    degreeType: "academic" | "professional",
    studyMode?: "full_time" | "part_time",
    programName = "机械工程",
    majorCode = "080200",
  ) =>
    deriveRecommendationConstraints({
      institutionName: school,
      programName,
      majorCode,
      degreeType,
      studyMode,
      profile: { budget: "1万元以内", cities: [] },
      targetYear: "2027",
      sources: [page(tariff)],
      citations: ["page"],
    });
  assert.equal(check("academic", "full_time").tuition?.amount, 8000);
  assert.equal(
    check("academic", "full_time").tuition?.scope,
    "school_degree_type",
  );
  assert.equal(
    check("professional", "full_time", "机械", "085500").tuition?.amount,
    10000,
  );
  assert.equal(
    check("professional", "part_time", "人工智能", "085410").tuition?.amount,
    30000,
  );
  assert.equal(
    check("professional", "part_time", "机械", "085500").tuition,
    undefined,
  );
  assert.equal(check("academic").tuition, undefined);
  for (const restricted of [
    { ...page(tariff), title: `${school}电子信息学院收费标准` },
    page(
      `${school}2027年硕士收费标准\n电子信息学院学费标准\n全日制专业学位硕士研究生学费20000元/年`,
    ),
  ])
    assert.equal(
      deriveRecommendationConstraints({
        institutionName: school,
        programName: "机械",
        majorCode: "085500",
        degreeType: "professional",
        studyMode: "full_time",
        profile: { budget: "", cities: [] },
        targetYear: "2027",
        sources: [restricted],
        citations: [restricted.id],
      }).tuition,
      undefined,
    );
  const catalogue = page(
    `${school}2027年硕士研究生招生专业目录\n080200 机械工程 全日制`,
    "catalogue",
  );
  const bind = (sources: WebSource[]) =>
    bindRecommendationEvidence(
      {
        institutionName: school,
        programName: "机械工程",
        majorCode: "080200",
        disciplineCode: "0802",
        degreeType: "academic",
        citations: [sources[0].id],
        rationale: "",
        preparation: [],
        uncertainties: [],
      },
      run,
      disciplines.find((d) => d.code === "0802")!,
      sources,
      "2027",
    );
  assert.equal(bind([catalogue, page(tariff)]).tuition?.amount, 8000);
  const unknown = bind([page(tariff)]);
  assert.equal(unknown.tuition, undefined);
  assert.equal(
    unknown.constraintChecks?.find((c) => c.field === "budget")?.status,
    "unknown",
  );
  assert.ok(
    unknown.pendingEvidence?.some(
      (e) => e.field === "tuition" && e.quote.includes("8000"),
    ),
  );
  const scoped = page(
    `${school}2027年硕士招生章程\n电子信息学院专业学位硕士全日制学费20000元/年\n机械专业学位硕士全日制学费30000元/年`,
  );
  assert.equal(
    deriveRecommendationConstraints({
      institutionName: school,
      programName: "金融",
      majorCode: "025100",
      degreeType: "professional",
      studyMode: "full_time",
      profile: { budget: "", cities: [] },
      targetYear: "2027",
      sources: [scoped],
      citations: [scoped.id],
    }).tuition,
    undefined,
  );
});

test("table text keeps code, name and amount on the same row", () => {
  assert.equal(
    webPageText(
      "<table><tr><td><p>085410</p></td><td><p>待定</p></td></tr><tr><td>080200</td><td>机械工程</td></tr></table>",
    ),
    "085410 | 待定 |\n080200 | 机械工程 |",
  );
});

test("college campus rules use documented city mappings and keep cross-city or unknown colleges pending", () => {
  const policy = page(
    `${school}2027年硕士研究生招生章程\n录取在电子信息学院、集成电路科学与工程学院的新生所在校区：根据导师团队在杭州电子科技大学下沙校区或绍兴校区。其他学院的新生所在校区为杭州电子科技大学下沙校区或文一校区。`,
    "policy",
  );
  const catalogue = page(
    `${school}2027年硕士研究生招生专业目录\n010机械工程学院 | 080200机械工程 全日制\n020电子信息学院 | 080900电子科学与技术 全日制`,
    "catalogue",
  );
  const base = {
    institutionName: school,
    programName: "机械工程",
    collegeName: "机械工程学院",
    majorCode: "080200",
    targetYear: "2027",
    sources: [catalogue, policy],
  };
  const location = deriveCampusLocation(base);
  assert.equal(location?.city, "杭州");
  assert.match(location!.quote, /下沙校区或文一校区/);
  assert.equal(
    deriveCampusLocation({
      ...base,
      programName: "电子科学与技术",
      collegeName: "电子信息学院",
      majorCode: "080900",
    }),
    undefined,
  );
  assert.equal(
    deriveCampusLocation({ ...base, collegeName: undefined }),
    undefined,
  );
  const recommendation = bindRecommendationEvidence(
    {
      institutionName: school,
      programName: "电子科学与技术",
      collegeName: "电子信息学院",
      majorCode: "080900",
      disciplineCode: "0809",
      degreeType: "academic",
      studyMode: "full_time",
      citations: [catalogue.id],
      rationale: "",
      preparation: [],
      uncertainties: [],
    },
    run,
    disciplines.find((d) => d.code === "0809")!,
    [catalogue, policy],
    "2027",
  );
  assert.equal(recommendation.location, undefined);
  assert.ok(
    recommendation.pendingEvidence?.some(
      (e) => e.field === "location" && e.quote.includes("绍兴校区"),
    ),
  );
  assert.ok(
    recommendation.pendingEvidence
      ?.filter((e) => e.field === "location")
      .every((e) => !e.quote.startsWith("其他学院")),
  );
});

test("rule upgrade re-extracts old public facts without refreshing original timestamps", () => {
  const store = new Store();
  try {
    const library = createResearchEvidenceLibrary(store, {
      now: () => Date.parse("2026-10-11T00:00:00Z"),
    });
    const original = page(
      `${school}2027年硕士研究生招生专业目录\n080200 机械工程 全日制\n①101思想政治理论\n②201英语一\n③301数学一\n④820机械原理\n0812Z2 智能交通技术\n①101思想政治理论\n②201英语一\n③301数学一\n④888运筹学`,
    );
    library.save(original);
    const row = store.db
      .prepare(
        "SELECT identity,field,source_key,payload FROM research_program_facts LIMIT 1",
      )
      .get()!;
    const old = JSON.parse(String(row.payload));
    store.db.prepare("UPDATE research_program_facts SET payload=?").run(
      JSON.stringify({
        ...old,
        programName: "等",
        extractor: "phase2-program-binding@2",
      }),
    );
    const upgraded = createResearchEvidenceLibrary(store, {
      now: () => Date.parse("2026-10-11T00:00:00Z"),
    }).queryFacts({
      targetYear: "2027",
    });
    assert.ok(upgraded.length > 0);
    assert.ok(
      upgraded.every(
        (f) =>
          f.programName === "机械工程" &&
          f.extractor === "phase2-program-binding@3" &&
          f.retrievedAt === original.retrievedAt,
      ),
    );
    assert.deepEqual(
      (
        upgraded.find((f) => f.field === "exams" && f.status === "bound")
          ?.value as { subjects: { code: string }[] } | undefined
      )?.subjects.map((s) => s.code),
      ["101", "201", "301", "820"],
    );
  } finally {
    store.close();
  }
});

test("a newly read cross-city campus vetoes same-city address fallback even without registry hint", () => {
  const source = {
    ...page(
      "宁波工程学院2027年硕士招生专业目录\n080200 机械工程\n校区地址：宁波市江北区风华路201号\n版权所有：宁波工程学院",
    ),
    url: "https://nbut.edu.cn/catalogue",
  };
  const input = {
    institutionName: "宁波工程学院",
    programName: "机械工程",
    degreeType: "academic" as const,
    profile: { budget: "", cities: ["宁波"] },
    targetYear: "2027",
    sources: [source],
    citations: [source.id],
  };
  assert.equal(deriveRecommendationConstraints(input).location?.city, "宁波");
  for (const name of ["绍兴校区", "海宁国际校区"])
    assert.equal(
      deriveRecommendationConstraints({
        ...input,
        sources: [{ ...source, excerpt: source.excerpt + `\n${name}正在招生` }],
      }).location,
      undefined,
    );
});
