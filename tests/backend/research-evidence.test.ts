import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import {
  admissionEvidence,
  knownAdmissionConflict,
  supportsProgram,
  sourcePriority,
  compactEvidence,
  scopedAdmissionEvidence,
  scopedKnownAdmissionConflict,
  scopedProgramPassages,
} from "../../server/explanation/research-evidence.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import { normalizeAttachedEvidence } from "../../server/explanation/research-provenance.ts";

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

test("scoped admission evidence isolates faculty and study-mode restrictions without rejecting the entire directory", () => {
  const page = source(
    "甲大学2027年硕士研究生招生专业目录。\n001机械学院 | 085500 机械 全日制 正常招生\n001机械学院 | 085500 机械 非全日制 本专业停招\n002工程学院 | 085500 机械 全日制 仅限法学本科毕业生报考",
  );
  const scope = {
    institutionName: "甲大学",
    programName: "机械",
    majorCode: "085500",
    collegeName: "机械学院",
    studyMode: "full_time" as const,
  };
  assert.equal(admissionEvidence(page, "2027").excluded, undefined);
  const active = scopedAdmissionEvidence(page, "2027", scope);
  assert.equal(active.scopeMatched, true);
  assert.equal(active.admissionStatus, "current_evidence");
  assert.equal(active.excluded, undefined);
  assert.equal(
    scopedAdmissionEvidence(page, "2027", { ...scope, studyMode: "part_time" })
      .exclusionKind,
    "closure",
  );
  assert.equal(
    scopedKnownAdmissionConflict(
      page,
      scope,
      discipline("0855"),
      { major: "机械工程" },
      "2027",
    ),
    false,
  );
  assert.equal(
    scopedKnownAdmissionConflict(
      page,
      { ...scope, collegeName: "工程学院" },
      discipline("0855"),
      { major: "机械工程" },
      "2027",
    ),
    true,
  );
  const unknown = scopedAdmissionEvidence(page, "2027", {
    ...scope,
    collegeName: "未知学院",
  });
  assert.equal(unknown.scopeMatched, false);
  assert.equal(unknown.excluded, undefined);
  assert.ok(
    scopedProgramPassages(page, scope).every(
      (quote) => !/非全日制|法学/.test(quote),
    ),
  );
});

test("programme-wide notices remain applicable while title-only years cannot establish current restrictions", () => {
  const notice = source("甲大学2027年硕士研究生招生通知。机械硕士专业停招。");
  const scope = {
    institutionName: "甲大学",
    programName: "机械",
    majorCode: "085500",
    collegeName: "机械学院",
    studyMode: "full_time" as const,
  };
  assert.equal(
    scopedAdmissionEvidence(notice, "2027", scope).exclusionKind,
    "closure",
  );
  const historical = source(
    "甲大学2026年硕士研究生招生目录。\n001机械学院 | 085500 机械 全日制 仅限法学本科毕业生报考",
    { title: "甲大学2027年招生目录" },
  );
  assert.equal(
    scopedKnownAdmissionConflict(
      historical,
      scope,
      discipline("0855"),
      { major: "机械工程" },
      "2027",
    ),
    false,
  );
});

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

test("Southeast University programme evidence cannot be assigned to Tongji University through its peer-school footer", () => {
  const text =
    "东南大学硕士研究生培养方案（081420 土木工程建造与管理） 首页 学院概况 招生与就业。" +
    "东南大学硕士研究生培养方案：（一级学科代码：0814 一级学科名称：土木工程）" +
    "（二级学科代码：081420 二级学科名称：土木工程建造与管理）。" +
    "本学科培养具有土木工程建造技术、合同与造价管理知识的人才。" +
    "联系我们 地址：江苏省南京市江宁区东南大学路2号土木教学科研楼。" +
    "快速导航 学校主页 兄弟院校 同济大学土木工程学院 Ｗe are 土木，Ｗe are family! " +
    "版权所有 © 东南大学土木工程学院";
  const page = source(text, {
    title: "东南大学硕士研究生培养方案(081420 土木工程建造与管理)",
    url: "https://civil.seu.edu.cn/2009/1022/c20027a93071/page.htm",
  });
  for (const excerpt of [
    text,
    compactEvidence(text, [discipline("0814")], 600),
  ]) {
    assert.equal(
      supportsProgram(
        { ...page, excerpt },
        "东南大学",
        "土木工程建造与管理",
        discipline("0814"),
      ),
      true,
    );
    assert.equal(
      supportsProgram(
        { ...page, excerpt },
        "同济大学",
        "土木工程建造与管理",
        discipline("0814"),
      ),
      false,
    );
    assert.equal(
      supportsProgram(
        { ...page, excerpt },
        "同济大学",
        "工业工程与管理",
        discipline("1256"),
      ),
      false,
    );
  }
});

test("a referenced university or search title cannot supply a fetched programme's school subject", () => {
  for (const excerpt of [
    "硕士研究生招生专业目录：030101法学理论。",
    "乙大学硕士研究生招生专业目录：030101法学理论，拥有甲大学博士生导师。",
    "乙大学硕士研究生招生专业目录：030101法学理论。兄弟院校：甲大学。",
  ]) {
    assert.equal(
      supportsProgram(
        source(excerpt),
        "甲大学",
        "法学理论",
        discipline("0301"),
      ),
      false,
      excerpt,
    );
  }
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

test("current and historical programme policies keep their own year when entry restrictions mention student cohort or graduation years", () => {
  for (const qualification of [
    "仅限2025级本科生报考",
    "2025年毕业的考生可报考",
    "2025年取得本科毕业证的考生可报考",
  ]) {
    const current = source(
      `甲大学2027年硕士招生专业目录：030101法学理论。${qualification}。`,
    );
    assert.equal(
      admissionEvidence(current, "2027").admissionStatus,
      "current_evidence",
      qualification,
    );
    assert.equal(
      admissionEvidence(
        { ...current, excerpt: current.excerpt.replace("2027年", "2026年") },
        "2027",
      ).admissionStatus,
      "needs_verification",
      qualification,
    );
  }
  const current = source(
    "甲大学2027年硕士招生专业目录：0503新闻传播学，仅限新闻传播学本科毕业生报考。2025年毕业的考生可报考。",
  );
  assert.equal(
    knownAdmissionConflict(
      current,
      "新闻传播学",
      discipline("0503"),
      { major: "机械工程" },
      "2027",
    ),
    true,
  );
  assert.equal(
    knownAdmissionConflict(
      { ...current, excerpt: current.excerpt.replace("2027年", "2026年") },
      "新闻传播学",
      discipline("0503"),
      { major: "机械工程" },
      "2027",
    ),
    false,
  );
});

test("admission years reject title-only years, publication metadata, copyright and genuinely mixed policies", () => {
  for (const excerpt of [
    "甲大学硕士招生专业目录：030101法学理论。",
    "甲大学硕士招生专业目录：030101法学理论。发布时间：2027年硕士招生通知。",
    "甲大学硕士招生专业目录：030101法学理论。版权所有©2027年研究生招生办公室。",
    "甲大学2027年硕士招生目录。2026年硕士招生目录。030101法学理论。",
  ])
    assert.equal(
      admissionEvidence(
        source(excerpt, { title: "甲大学2027年硕士招生专业目录" }),
        "2027",
      ).admissionStatus,
      "needs_verification",
      excerpt,
    );
  assert.ok(
    admissionEvidence(
      source(
        "甲大学2027年硕士招生目录：030101法学理论，本专业暂停招生。仅限2025级本科生报考。",
      ),
      "2027",
      "法学理论",
    ).excluded,
  );
});

test("a linked undated attachment inherits its verified year while explicit mixed attachment years cannot inherit the parent", () => {
  const parent = source("甲大学2027年硕士研究生招生专业目录。下载附件。", {
    id: "admission-parent",
    documentLinks: [
      {
        title: "2027年硕士研究生招生专业目录.xls",
        url: "https://yz.example.edu.cn/catalog.xls",
      },
    ],
  });
  const child = (excerpt: string): WebSource =>
    source(excerpt, {
      id: "admission-child",
      url: parent.documentLinks![0].url,
      parentSourceId: parent.id,
      title: parent.documentLinks![0].title,
    });
  const plain = "080200 机械工程 201英语一301数学一";
  const linked = normalizeAttachedEvidence(child(plain), parent, plain);
  assert.equal(
    admissionEvidence(linked, "2027").admissionStatus,
    "current_evidence",
  );
  for (const [body, status] of [
    [
      "2026年硕士招生目录。080200机械工程。仅限2025级本科生报考。",
      "needs_verification",
    ],
    [
      "2027年硕士招生目录。080200机械工程。2025年毕业的本科生可报考。",
      "current_evidence",
    ],
    [
      "2027年硕士招生目录。2026年硕士招生目录。080200机械工程。",
      "needs_verification",
    ],
  ] as const) {
    const attached = normalizeAttachedEvidence(child(body), parent, body);
    assert.equal(
      admissionEvidence(
        {
          ...attached,
          provenance: attached.provenance
            ? { ...attached.provenance, admissionYear: "2027" }
            : undefined,
        },
        "2027",
      ).admissionStatus,
      status,
      body,
    );
  }
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

test("doctoral student, postdoc, supervisor administration and admission notices cannot outrank master's programme documents", () => {
  const mechanical = discipline("0802");
  const programme = source("甲大学0802机械工程硕士培养", {
    title: "甲大学机械工程硕士研究生培养方案",
    url: "https://mech.example.edu.cn/info/1001/2001.htm",
  });
  for (const title of [
    "机械工程学院2024年交叉科学研究院专项博士生招生通知",
    "机械工程博士研究生招生目录",
    "机械工程博士后研究人员招收公告",
    "机械工程学院研究生导师招生资格审核通知",
    "关于开展硕士生导师遴选的通知",
    "机械工程学院2026年硕士录取通知书领取通知",
  ]) {
    const other = { ...programme, title };
    assert.ok(sourcePriority(other, mechanical) < 0, title);
    assert.ok(
      sourcePriority(programme, mechanical) > sourcePriority(other, mechanical),
      title,
    );
  }
  const combined = {
    ...programme,
    title: "机械工程硕士与博士研究生招生专业目录",
  };
  assert.ok(sourcePriority(combined, mechanical) >= 100);
  const mastersWithMentors = {
    ...programme,
    title: "机械工程硕士专业介绍及导师研究方向",
  };
  assert.ok(sourcePriority(mastersWithMentors, mechanical) >= 100);
});

test("college home pages with graduate navigation stay below actual master's programme pages", () => {
  const mechanical = discipline("0802");
  const programme = source("甲大学0802机械工程硕士培养", {
    title: "机械工程硕士招生通知",
    url: "https://mech.example.edu.cn/info/1001/2001.htm",
  });
  for (const homepage of [
    {
      ...programme,
      title: "甲大学机械工程学院",
      url: "https://mech.example.edu.cn/",
    },
    {
      ...programme,
      title: "甲大学机械工程学院",
      url: "https://mech.example.edu.cn/index.html",
    },
    {
      ...programme,
      title: "机械工程学院首页",
      url: "https://mech.example.edu.cn/channel/intro",
    },
  ]) {
    assert.ok(sourcePriority(homepage, mechanical) < 0);
    assert.ok(
      sourcePriority(programme, mechanical) >
        sourcePriority(homepage, mechanical),
    );
  }
  assert.ok(
    sourcePriority(
      {
        ...programme,
        title: "机械工程硕士培养方案",
        url: "https://masters.example.edu.cn/",
      },
      mechanical,
    ) >= 100,
  );
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

test("a real master's catalogue heading beyond the first 200 characters survives repeated compaction and still scopes distant rows", () => {
  const text =
    "甲大学" +
    "导航".repeat(105) +
    "硕士研究生招生专业目录。" +
    "招生说明。".repeat(1500) +
    "050301新闻学 研究方向与课程安排。";
  const major = discipline("0503");
  const large = compactEvidence(text, [major], 6000);
  const small = compactEvidence(large, [major], 600);
  for (const excerpt of [text, large, small]) {
    assert.ok(excerpt.includes("硕士研究生招生专业目录"));
    assert.ok(excerpt.includes("050301新闻学"));
    assert.equal(
      supportsProgram(source(excerpt), "甲大学", "新闻学", major),
      true,
    );
    assert.ok(excerpt.split(" … ").every((part) => text.includes(part)));
  }
});

test("actual master's authorization or degree-conferral scope proves project existence without implying current admissions", () => {
  for (const heading of ["硕士学位授权点名单", "硕士专业学位授予类别目录"]) {
    const professional = heading.includes("专业学位");
    const major = discipline(professional ? "0855" : "0802");
    const name = professional ? "机械" : "机械工程";
    const row = professional ? "085500机械" : "080200机械工程";
    const text = `甲大学学位建设成果。${"导览".repeat(200)}${heading}。${"建设说明。".repeat(1200)}${row}。`;
    const large = compactEvidence(text, [major], 6000);
    for (const excerpt of [text, large, compactEvidence(large, [major], 600)]) {
      assert.equal(
        supportsProgram(source(excerpt), "甲大学", name, major),
        true,
        heading,
      );
      assert.equal(
        admissionEvidence(source(excerpt), "2027").admissionStatus,
        "needs_verification",
      );
    }
  }
});

test("compaction preserves intervening degree boundaries and a fee list never invents a master's level", () => {
  const major = discipline("0802");
  for (const heading of [
    "本科专业目录",
    "博士生招生专业目录",
    "硕士与博士研究生招生专业目录",
  ]) {
    const text =
      "甲大学硕士研究生招生专业目录。" +
      "前文。".repeat(300) +
      heading +
      "。" +
      "该层级说明。".repeat(1000) +
      "080200机械工程。";
    const large = compactEvidence(text, [major], 6000);
    for (const excerpt of [text, large, compactEvidence(large, [major], 600)]) {
      assert.ok(excerpt.includes(heading));
      assert.equal(
        supportsProgram(source(excerpt), "甲大学", "机械工程", major),
        false,
        heading,
      );
    }
  }
  for (const excerpt of [
    "甲大学收费标准：080200机械工程学费8000元/年。",
    "甲大学专业学位授予目录：080200机械工程。",
    "甲大学本科专业目录：080200机械工程。导航：研究生教育。",
  ])
    assert.equal(
      supportsProgram(source(excerpt), "甲大学", "机械工程", major),
      false,
    );
});

test("job detail pages and recruitment-domain vacancies cannot consume master's source priority or prove a program", () => {
  const major = discipline("0802");
  for (const url of [
    "https://job.cjlu.edu.cn/job/view/id/123",
    "https://jy.example.edu.cn/info/1001/123.htm",
    "https://career.example.edu.cn/vacancies/123",
  ]) {
    const page = source(
      "甲大学机械工程硕士培养背景优先，应聘机械工程师岗位。",
      { url, title: "机械工程师" },
    );
    assert.ok(sourcePriority(page, major) < 0);
    assert.equal(supportsProgram(page, "甲大学", "机械工程", major), false);
  }
  assert.ok(
    sourcePriority(
      source("甲大学机械工程硕士培养", {
        title: "机械工程硕士专业介绍与就业方向",
        url: "https://mech.example.edu.cn/info/1001/123.htm",
      }),
      major,
    ) >= 100,
  );
});

test("courses on a genuine master's page cannot become newly discovered degree programs", () => {
  const math = discipline("0701");
  for (const label of [
    "课程设置：",
    "必修课程包括",
    "核心课程：",
    "参考书目：",
  ]) {
    const excerpt = `甲大学机械工程硕士培养方案。${label}高等数学、机械制造基础。`;
    assert.equal(
      supportsProgram(source(excerpt), "甲大学", "高等数学", math),
      false,
    );
  }
  const page = source(
    "甲大学硕士培养方案。课程设置：应用数学。另设硕士招生专业目录：070104 应用数学，培养数学研究人才。",
  );
  assert.equal(supportsProgram(page, "甲大学", "应用数学", math), true);
});

test("long-page compaction reserves an ordinary address passage without removing programme or tuition evidence", () => {
  const major = discipline("0301");
  const text =
    "甲大学硕士研究生招生专业目录。" +
    "招生说明。".repeat(1200) +
    "030101 法学理论。" +
    "培养介绍。".repeat(900) +
    "法学理论2027年全日制硕士研究生学费8000元/年。" +
    "其他信息。".repeat(800) +
    "联系方式：甲大学地址：杭州市大学路一号。";
  const large = compactEvidence(text, [major], 6000);
  const small = compactEvidence(large, [major], 600);
  for (const [excerpt, budget] of [
    [large, 6000],
    [small, 600],
  ] as const) {
    assert.ok(excerpt.length <= budget);
    assert.ok(excerpt.includes("030101 法学理论"));
    assert.ok(excerpt.includes("学费8000元/年"));
    assert.ok(excerpt.includes("地址：杭州市大学路一号"));
    assert.ok(excerpt.split(" … ").every((part) => text.includes(part)));
    assert.equal(
      supportsProgram(source(excerpt), "甲大学", "法学理论", major),
      true,
    );
  }
});

test("a late contact address is retained ahead of addresses inside a friendship-links clause", () => {
  const major = discipline("0301");
  const text =
    "甲大学硕士研究生招生专业目录。" +
    "招生说明。".repeat(900) +
    "030101 法学理论。" +
    "培养介绍。".repeat(700) +
    "友情链接：乙大学地址：北京市其他学校路。" +
    "链接介绍。".repeat(20) +
    "版权所有：甲大学。联系地址：杭州市大学路一号。";
  const excerpt = compactEvidence(text, [major], 600);
  assert.ok(excerpt.includes("联系地址：杭州市大学路一号"));
  assert.ok(!excerpt.includes("北京市其他学校路"));
  assert.ok(excerpt.length <= 600);
  assert.ok(excerpt.split(" … ").every((part) => text.includes(part)));
});
