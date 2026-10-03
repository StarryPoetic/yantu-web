import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import {
  admissionEvidence,
  knownAdmissionConflict,
  supportsProgram,
  sourcePriority,
  compactEvidence,
} from "../../server/explanation/research-evidence.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const discipline = (code: string) =>
  getDisciplineCatalog().items.find((item) => item.code === code)!;
function source(
  excerpt: string,
  overrides: Partial<WebSource> = {},
): WebSource {
  return {
    id: "research-1",
    url: "https://yz.example.edu.cn/catalog",
    title: "甲大学专业资料",
    retrievedAt: "2026-09-27T00:00:00Z",
    excerpt,
    kind: "official_page",
    verified: false,
    ...overrides,
  };
}

test("an unrelated university in a friendship link is not the owner of a master's program", () => {
  const page = source(
    "甲大学硕士研究生招生专业目录：0503 新闻传播学。友情链接：乙大学。",
  );
  assert.equal(
    supportsProgram(page, "甲大学", "新闻传播学", discipline("0503")),
    true,
  );
  assert.equal(
    supportsProgram(page, "乙大学", "新闻传播学", discipline("0503")),
    false,
  );
});

test("doctoral content and doctoral URL paths cannot establish a master's program or convert an exam code to an admissions year", () => {
  const content =
    "甲大学博士研究生招生专业目录：0503 新闻传播学，博士研究生培养方案。2027新闻传播学专业基础。";
  for (const page of [
    source(content),
    source("甲大学研究生培养方案：0503新闻传播学。", {
      url: "https://yz.example.edu.cn/ZSJZ/BS/2022/catalog",
    }),
    source("甲大学研究生培养方案：0503新闻传播学。", {
      title: "甲大学博士研究生招生目录",
    }),
    source("甲大学研究生培养方案：0503新闻传播学。", {
      url: "https://yz.example.edu.cn/xx_bs_catalog.html",
    }),
  ]) {
    assert.equal(
      supportsProgram(page, "甲大学", "新闻传播学", discipline("0503")),
      false,
    );
    assert.equal(
      admissionEvidence(page, "2027").admissionStatus,
      "needs_verification",
    );
  }
});

test("the program's own six-digit code takes precedence over broad aliases without rejecting another valid row", () => {
  const page = source(
    "甲大学硕士招生专业目录：【045115】小学教育；【040107】成人教育学；【050301】新闻学。",
  );
  assert.equal(
    supportsProgram(page, "甲大学", "小学教育", discipline("0401")),
    false,
  );
  assert.equal(
    supportsProgram(page, "甲大学", "小学教育", discipline("0451")),
    true,
  );
  assert.equal(
    supportsProgram(page, "甲大学", "成人教育学", discipline("0401")),
    true,
  );
  assert.equal(
    supportsProgram(page, "甲大学", "新闻学", discipline("0503")),
    true,
  );
});

test("only clear current restrictions establish a known conflict, not historical conditions or conditional non-admission", () => {
  const content =
    "甲大学2027年硕士招生专业目录：0503新闻传播学，仅限新闻传播学本科毕业生报考，不接受跨专业考生。";
  assert.equal(
    knownAdmissionConflict(
      source(content),
      "新闻传播学",
      discipline("0503"),
      { major: "机械工程" },
      "2027",
    ),
    true,
  );
  assert.equal(
    knownAdmissionConflict(
      source(content),
      "新闻传播学",
      discipline("0503"),
      { major: "新闻传播学" },
      "2027",
    ),
    false,
  );
  assert.equal(
    knownAdmissionConflict(
      source(content.replace("2027", "2024")),
      "新闻传播学",
      discipline("0503"),
      { major: "机械工程" },
      "2027",
    ),
    false,
  );
  assert.equal(
    admissionEvidence(
      source(
        "甲大学2027年硕士招生专业目录：0503新闻传播学，不招收同等学力考生。",
      ),
      "2027",
    ).excluded,
    undefined,
  );
});

test("official programme documents are read before admission rosters, recruitment and alumni lists", () => {
  const programme = source("甲大学教育学硕士", {
    title: "甲大学硕士招生专业目录与培养方案",
    url: "https://yz.example.edu.cn/programme.pdf",
  });
  for (const title of [
    "硕士拟录取名单公示",
    "教育学招聘岗位",
    "教育学院校友名册",
    "教育学硕士录取公示",
  ]) {
    const other = source("甲大学教育学硕士", {
      title,
      url: "https://yz.example.edu.cn/roster.pdf",
    });
    assert.ok(
      sourcePriority(programme, discipline("0401")) >
        sourcePriority(other, discipline("0401")),
    );
  }
});

test("closure and entry requirements bind to their own programme rather than an adjacent catalogue row", () => {
  const page = source(
    "甲大学2027年硕士招生专业目录：040101教育学原理正常招生；040102课程与教学论停止招生，仅限教育学本科毕业生报考，不接受跨专业。",
    { title: "甲大学目录" },
  );
  assert.equal(admissionEvidence(page, "2027").excluded, undefined);
  assert.equal(
    admissionEvidence(page, "2027", "教育学原理").excluded,
    undefined,
  );
  assert.ok(admissionEvidence(page, "2027", "课程与教学论").excluded);
  assert.equal(
    knownAdmissionConflict(
      page,
      "教育学原理",
      discipline("0401"),
      { major: "机械工程" },
      "2027",
    ),
    false,
  );
  const openPage = {
    ...page,
    excerpt: page.excerpt.replace("停止招生", "正常招生"),
  };
  assert.equal(
    knownAdmissionConflict(
      openPage,
      "课程与教学论",
      discipline("0401"),
      { major: "机械工程" },
      "2027",
    ),
    true,
  );
  assert.equal(
    knownAdmissionConflict(
      openPage,
      "课程与教学论",
      discipline("0401"),
      { major: "教育学" },
      "2027",
    ),
    false,
  );
  const separateSentence = source(
    "甲大学2027年硕士招生专业目录：040101教育学原理。040102课程与教学论，仅限教育学本科毕业生报考。",
  );
  assert.equal(
    knownAdmissionConflict(
      separateSentence,
      "教育学原理",
      discipline("0401"),
      { major: "机械工程" },
      "2027",
    ),
    false,
  );
});

test("explicit programme and school-wide closure remain excluded while historical restrictions remain unknown", () => {
  for (const suffix of ["本专业暂停招生", "本专业不招生"]) {
    const page = source(`甲大学硕士招生专业目录：040101教育学原理。${suffix}`);
    assert.ok(admissionEvidence(page, "2027", "教育学原理").excluded);
  }
  assert.ok(
    admissionEvidence(source("甲大学全校硕士暂停招生。"), "2027").excluded,
  );
  const page = source(
    "甲大学2024年硕士招生目录：040101教育学原理，仅限教育学本科毕业生报考。",
  );
  assert.equal(
    knownAdmissionConflict(
      page,
      "教育学原理",
      discipline("0401"),
      { major: "机械工程" },
      "2027",
    ),
    false,
  );
});

test("a programme restriction survives intervening condition clauses but stops at the next programme", () => {
  for (const restriction of ["本专业暂停招生", "本专业不招生"]) {
    const page = source(
      `甲大学2027年硕士招生目录列出教育学原理研究方向，具体条件以招生简章为准。${restriction}。`,
    );
    assert.ok(admissionEvidence(page, "2027", "教育学原理").excluded);
    assert.equal(admissionEvidence(page, "2027").excluded, undefined);
  }
  for (const next of ["040102课程与教学论", "课程与教学论", "另设专业"]) {
    const page = source(
      `甲大学2027年硕士招生目录：040101教育学原理，具体条件以招生简章为准。${next}，本专业暂停招生，仅限教育学本科毕业生报考。`,
    );
    assert.equal(
      admissionEvidence(page, "2027", "教育学原理").excluded,
      undefined,
    );
    assert.equal(
      knownAdmissionConflict(
        page,
        "教育学原理",
        discipline("0401"),
        { major: "机械工程" },
        "2027",
      ),
      false,
    );
  }
  const current = source(
    "甲大学2027年硕士招生目录：040101教育学原理，具体条件以招生简章为准，报考要求详见本页说明。仅限教育学本科毕业生报考。",
  );
  assert.equal(
    knownAdmissionConflict(
      current,
      "教育学原理",
      discipline("0401"),
      { major: "机械工程" },
      "2027",
    ),
    true,
  );
});

test("long-page evidence retains actual school identity and distant programme rows through repeated compaction", () => {
  const excerpt =
    "导航".repeat(110) +
    "甲大学硕士研究生招生专业目录。" +
    "公告".repeat(100) +
    "教育学招生介绍" +
    "其他公告".repeat(3000) +
    "040101 教育学原理 硕士研究生培养方案。" +
    "其他专业".repeat(4000);
  const large = compactEvidence(excerpt, [discipline("0401")], 6000);
  const small = compactEvidence(large, [discipline("0401")], 600);
  for (const result of [large, small]) {
    assert.ok(result.includes("甲大学"));
    assert.ok(result.includes("040101 教育学原理"));
    assert.ok(result.split(" … ").every((part) => excerpt.includes(part)));
    assert.equal(
      supportsProgram(
        source(result),
        "甲大学",
        "教育学原理",
        discipline("0401"),
      ),
      true,
    );
  }
  assert.ok(large.length <= 6000 && small.length <= 600);
});
