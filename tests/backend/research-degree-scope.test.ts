import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import { supportsProgram } from "../../server/explanation/research-evidence.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const management = getDisciplineCatalog().items.find((d) => d.code === "1201")!;
const law = getDisciplineCatalog().items.find((d) => d.code === "0301")!;
const source = (excerpt: string): WebSource => ({
  id: "catalog",
  title: "甲大学2014年硕士研究生招生专业目录",
  url: "https://grad.a.edu.cn/catalog.htm",
  excerpt,
  retrievedAt: "2026-10-04T00:00:00Z",
  kind: "official_page",
  verified: false,
});

test("doctoral authorization symbols in a masters catalogue do not turn subsequent rows into doctoral programmes", () => {
  for (const legend of [
    "注：带▲表示为博士学位授权点，★带表示按硕士一级学科招生。",
    "说明：专业标记★表示博士学位授权点。",
    "标有▲的专业为博士学位授权点，硕士按一级学科招生。",
  ]) {
    const page = source(
      `甲大学2014年硕士研究生招生专业目录。${legend}经济管理学院 120100 管理科学与工程 ★。`,
    );
    assert.equal(
      supportsProgram(page, "甲大学", "管理科学与工程", management),
      true,
      legend,
    );
  }
});

test("real doctoral and undergraduate sections after a symbol legend still close the masters scope", () => {
  for (const section of [
    "博士学位授权点",
    "博士研究生招生专业目录",
    "本科专业介绍",
  ]) {
    const page = source(
      `甲大学硕士研究生招生专业目录。注：带▲表示为博士学位授权点。120100 管理科学与工程。${section}：030101 法学理论。`,
    );
    assert.equal(
      supportsProgram(page, "甲大学", "管理科学与工程", management),
      true,
    );
    assert.equal(
      supportsProgram(page, "甲大学", "法学理论", law),
      false,
      section,
    );
  }
});

test("a genuine new masters section can independently support a programme after the doctoral section", () => {
  const page = source(
    "甲大学硕士研究生招生专业目录。注：带▲表示为博士学位授权点。120100 管理科学与工程。博士研究生招生专业目录：030101 法学理论。硕士研究生招生专业目录：030101 法学理论。",
  );
  assert.equal(supportsProgram(page, "甲大学", "法学理论", law), true);
});
