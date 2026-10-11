import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
  normalizeInstitutionName,
  resolveInstitutionFromPages,
  schoolRegistrableDomain,
} from "../../server/explanation/research-school.ts";
import { sourceHasSchoolIdentity as compatibleIdentity } from "../../server/explanation/research-search.ts";
import type { WebSource } from "../../server/explanation/web.ts";

function source(
  excerpt: string,
  overrides: Partial<WebSource> = {},
): WebSource {
  return {
    id: "school-1",
    title: "甲大学2027年硕士招生专业目录",
    url: "https://yz.example.edu.cn/catalog.htm",
    kind: "official_page",
    excerpt,
    verified: false,
    retrievedAt: "2026-10-04T00:00:00Z",
    ...overrides,
  };
}

test("department names normalize through same-domain read university ownership and retain the department", () => {
  const page = source("经济学院2027年硕士招生目录。030101法学理论。", {
    id: "department",
    title: "经济学院硕士招生",
    url: "https://college.example.edu.cn/law",
  });
  const owner = source("学校概况。版权所有：甲大学", {
    id: "owner",
    url: "https://www.example.edu.cn/about",
  });
  const sources = [page, owner];
  assert.equal(schoolRegistrableDomain(page.url), "example.edu.cn");
  assert.equal(
    resolveInstitutionFromPages("example.edu.cn", sources),
    "甲大学",
  );
  assert.deepEqual(normalizeInstitutionName("经济学院", [page], sources), {
    institutionName: "甲大学",
    collegeName: "经济学院",
  });
  assert.equal(sourceHasSchoolIdentity(page, "甲大学", sources), true);
  assert.equal(sourceHasSchoolIdentity(page, "甲大学", [page]), false);
});

test("unresolved colleges and friendly university links do not establish a recruiting institution", () => {
  const page = source(
    "经济学院硕士招生目录。版权所有：经济学院。友情链接 甲大学",
    { title: "经济学院" },
  );
  assert.equal(normalizeInstitutionName("经济学院", [page], [page]), undefined);
  const foreign = source("版权所有：甲大学", {
    url: "https://www.other.edu.cn/about",
  });
  assert.equal(
    normalizeInstitutionName("经济学院", [page], [page, foreign]),
    undefined,
  );
});

test("a same-domain department attachment cannot inherit university identity without validated provenance", () => {
  const owner = source("版权所有：甲大学", { id: "owner" });
  const attachment = source("经济学院2027年硕士招生目录。030101法学理论。", {
    id: "attachment",
    title: "经济学院硕士招生目录.pdf",
    url: "https://college.example.edu.cn/catalog.pdf",
    parentSourceId: owner.id,
  });
  assert.equal(
    sourceHasSchoolIdentity(attachment, "甲大学", [owner, attachment]),
    false,
  );
});

test("standalone college prefixes are preserved while their subordinate college is normalized", () => {
  const page = source(
    "宁波工程学院杭州湾汽车学院硕士招生目录。© 2020 宁波工程学院杭州湾汽车学院 版权所有",
    {
      title: "宁波工程学院杭州湾汽车学院",
      url: "https://auto.nbut.edu.cn/admission",
    },
  );
  assert.equal(
    resolveInstitutionFromPages("nbut.edu.cn", [page]),
    "宁波工程学院",
  );
  assert.deepEqual(
    normalizeInstitutionName("宁波工程学院杭州湾汽车学院", [page], [page]),
    {
      institutionName: "宁波工程学院",
      collegeName: "宁波工程学院杭州湾汽车学院",
    },
  );
});

test("the domain resolver is replaceable and cached page ownership changes invalidate old results", () => {
  const page = source("经济学院硕士招生目录。");
  const calls: string[] = [];
  assert.deepEqual(
    normalizeInstitutionName("经济学院", [page], [page], (domain) => {
      calls.push(domain);
      return "甲大学";
    }),
    { institutionName: "甲大学", collegeName: "经济学院" },
  );
  assert.deepEqual(calls, ["example.edu.cn"]);
  const owner = source("版权所有：甲大学");
  const pages = [owner];
  assert.equal(resolveInstitutionFromPages("example.edu.cn", pages), "甲大学");
  owner.excerpt = "版权所有：乙大学";
  owner.title = "乙大学官网";
  assert.equal(resolveInstitutionFromPages("example.edu.cn", pages), "乙大学");
  assert.equal(sourceHasSchoolIdentity(owner, "甲大学"), false);
});

test("actual school body titles, mastheads and explicit copyright owners survive navigation and department suffixes", () => {
  for (const text of [
    "首页 学校概况 招生信息 甲大学2027年硕士招生专业目录：030101法学理论。",
    "2027年硕士招生目录。甲大学法学专业招生目录列出法学理论研究方向。",
    "2022年硕士招生目录。甲大学法学理论专业接受跨专业考生报名。",
    "导航 学校概况 甲大学机械工程一级学科硕士研究生培养方案。",
    "甲大学网站导航：首页。甲大学2027年法学硕士全日制学费8000元/年。",
    "甲大学本科与研究生综合收费标准。",
    "甲大学地址：杭州市大学路一号。",
    "甲大学设北京校区。",
    "甲大学附属教育学院法学硕士培养方案。",
    "资料正文：硕士招生专业目录。主办单位：甲大学研究生院",
    "资料正文：硕士招生专业目录。版权所有 © 甲大学教育学院",
    "资料正文：硕士招生专业目录。Copyright © 2018-2026 甲大学研究生院",
    "资料正文：硕士招生专业目录。© 2018-2026 甲大学研究生院 版权所有",
    "资料正文：硕士招生专业目录。甲大学 版权所有",
  ]) {
    assert.equal(sourceHasSchoolIdentity(source(text), "甲大学"), true, text);
  }
});

test("peer school links and other-school tutors cannot identify a page's school", () => {
  for (const label of [
    "友情链接",
    "相关链接",
    "院校链接",
    "兄弟院校",
    "兄弟高校",
    "兄弟学校",
  ]) {
    const page = source(
      `甲大学硕士招生专业目录。${label}：乙大学。版权所有 © 甲大学教育学院`,
    );
    assert.equal(sourceHasSchoolIdentity(page, "甲大学"), true, label);
    assert.equal(sourceHasSchoolIdentity(page, "乙大学"), false, label);
    assert.ok(!withoutSchoolLinks(page.excerpt).includes("乙大学"));
  }
  for (const text of [
    "甲大学硕士培养，拥有乙大学博士生导师。",
    "乙大学 博士生导师来我院讲座。",
    "首页 乙大学 教授来我院讲座。",
  ])
    assert.equal(sourceHasSchoolIdentity(source(text), "乙大学"), false, text);
});

test("a different explicit copyright school wins over a quoted school heading", () => {
  const page = source(
    "学院通知：乙大学硕士招生专业目录。版权所有 © 甲大学教育学院",
  );
  assert.equal(sourceHasSchoolIdentity(page, "甲大学"), true);
  assert.equal(sourceHasSchoolIdentity(page, "乙大学"), false);
});

test("admissions office copyright identifies its school without accepting partners or independent college prefixes", () => {
  for (const [name, owner] of [
    ["浙江科技大学", "版权所有 © 浙江科技大学研究生招生办公室"],
    ["浙江传媒学院", "版权所有：浙江传媒学院招生工作办公室"],
  ]) {
    const page = source(
      `${"网站导航 ".repeat(80)}专业目录：085400电子信息。${owner}`,
      {
        title: "硕士招生专业目录",
      },
    );
    assert.equal(sourceHasSchoolIdentity(page, name), true, owner);
    assert.equal(sourceHasSchoolIdentity(page, "甲大学"), false, owner);
    assert.equal(
      sourceHasSchoolIdentity(
        { ...page, excerpt: `${name}硕士招生目录。版权所有：乙大学招生办公室` },
        name,
      ),
      false,
    );
  }
  assert.equal(
    sourceHasSchoolIdentity(
      source("版权所有：浙江大学城市学院招生办公室"),
      "浙江大学",
    ),
    false,
  );
  assert.equal(
    sourceHasSchoolIdentity(
      source("招生办公室。专业目录：085400电子信息。"),
      "甲大学",
    ),
    false,
  );
});

test("school-name boundaries reject independent college prefixes while retaining the actual department", () => {
  const cityCollege = source("浙江大学城市学院硕士培养方案。", {
    title: "浙江大学城市学院硕士培养方案",
    kind: "search_snippet",
  });
  assert.equal(sourceHasSchoolIdentity(cityCollege, "浙江大学"), false);
  assert.equal(sourceHasSchoolIdentity(cityCollege, "浙江大学城市学院"), true);
  assert.equal(
    sourceHasSchoolIdentity(
      source("浙江大学工程师学院2026年工程管理硕士招生简章"),
      "浙江大学",
    ),
    true,
  );
});

test("search titles guide discovery but cannot supply missing fetched school body identity", () => {
  const page = source("硕士招生专业目录：030101法学理论。");
  assert.equal(sourceHasSchoolIdentity(page, "甲大学"), false);
  assert.equal(
    sourceHasSchoolIdentity({ ...page, kind: "search_snippet" }, "甲大学"),
    true,
  );
  assert.equal(compatibleIdentity, sourceHasSchoolIdentity);
});
