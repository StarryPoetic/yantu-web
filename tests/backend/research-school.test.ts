import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
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
