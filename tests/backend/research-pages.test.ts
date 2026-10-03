import test from "node:test";
import assert from "node:assert/strict";
import { getDisciplineCatalog } from "../../server/disciplines/index.ts";
import {
  researchAttachments,
  researchReadingOrder,
} from "../../server/explanation/research-pages.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const law = getDisciplineCatalog().items.find((d) => d.code === "0301")!;
function source(
  id: string,
  domain: string,
  title = "甲大学2027年法学硕士招生专业目录",
): WebSource {
  return {
    id,
    title,
    url: `https://${domain}/master/${id}.htm`,
    excerpt: "甲大学030101法学理论硕士研究生招生",
    kind: "search_snippet",
    verified: false,
    retrievedAt: "2026-10-04T00:00:00Z",
  };
}

test("each school gets a first read before repeats, with fee notices before further programme pages", () => {
  const sources = [
    source("a", "law.a.edu.cn"),
    source("a2", "yz.a.edu.cn"),
    source("afee", "yz.a.edu.cn", "甲大学2027研究生学费收费标准"),
    source("b", "yz.b.edu.cn"),
    source("c", "yz.c.edu.cn"),
    source("undergrad", "yz.d.edu.cn", "甲大学法学本科专业招生介绍"),
  ];
  const result = researchReadingOrder(
    sources,
    new Map(sources.map((s) => [s.id, "0301"])),
    [law],
  );
  assert.equal(result.firstRoundCount, 3);
  assert.deepEqual(
    result.pages.map((s) => s.id),
    ["a", "b", "c", "afee", "a2"],
  );
});

test("PDF attachments must be linked on the same school and relevant; scripts and untrusted URLs cannot expand reads", () => {
  const parent = source("parent", "yz.a.edu.cn");
  const html = `<script><a href="/hidden.pdf">硕士招生目录</a></script>
    <a href="/files/catalog.pdf#page=1">2027年硕士招生专业目录</a>
    <a href="https://cw.a.edu.cn/fees.pdf?x=1&amp;y=2">研究生学费收费标准</a>
    <a href="https://other.edu.cn/fake.pdf">硕士目录</a>
    <a href="http://yz.a.edu.cn/plain.pdf">硕士目录</a>
    <a href="https://yz.a.edu.cn:4433/port.pdf">硕士目录</a>
    <a href="https://name:password@yz.a.edu.cn/auth.pdf">硕士目录</a>
    <a href="javascript:alert(1)">硕士目录</a>
    <a href="/undergraduate.pdf">本科招生目录</a>
    <a href="/doctoral.pdf">博士招生目录</a>
    <a href="/files/catalog.pdf">2027年硕士招生专业目录</a>`;
  assert.deepEqual(
    researchAttachments(parent, html).map((s) => s.url),
    [
      "https://yz.a.edu.cn/files/catalog.pdf",
      "https://cw.a.edu.cn/fees.pdf?x=1&y=2",
    ],
  );
});

test("attachment selection is bounded and only PDFs are followed", () => {
  const parent = source("parent", "yz.a.edu.cn");
  const html =
    Array.from(
      { length: 30 },
      (_, i) => `<a href="/${i}.pdf">附件${i}硕士招生目录</a>`,
    ).join("") +
    `<a href="/other.htm">硕士招生目录</a><a href="/other.docx">硕士招生目录</a>`;
  assert.equal(researchAttachments(parent, html).length, 2);
});

test("preferred city or owned school hints prioritize observed domains without skipping any school's first turn", () => {
  const sources = [
    source("outside", "law.outside.edu.cn", "甲大学2027年法学硕士招生专业目录"),
    {
      ...source("city", "yz.city.edu.cn", "乙大学2027年法学硕士招生专业目录"),
      excerpt: "乙大学2027年030101法学理论硕士招生，学校地址：杭州市。",
    },
    source("hint", "yz.hint.edu.cn", "丙大学2027年法学硕士招生专业目录"),
    source("hint2", "law.hint.edu.cn", "丙大学2026年法学硕士招生专业目录"),
  ];
  const result = researchReadingOrder(
    sources,
    new Map(sources.map((s) => [s.id, "0301"])),
    [law],
    { cities: ["杭州"], schoolHints: ["丙大学"] },
  );
  assert.deepEqual(result.priorityDomains, ["city.edu.cn", "hint.edu.cn"]);
  assert.equal(result.firstRoundCount, 3);
  assert.deepEqual(
    result.pages.map((s) => s.id),
    ["city", "hint", "outside", "hint2"],
  );
});

test("a university mentioned as another school's faculty is not an owned school preference", () => {
  const page = {
    ...source(
      "partners",
      "yz.hzcu.edu.cn",
      "电子信息 - 浙大城市学院研究生招生网",
    ),
    excerpt: "030101 法学理论硕士研究生培养，拥有浙江大学博士生导师。",
  };
  const result = researchReadingOrder(
    [page],
    new Map([[page.id, "0301"]]),
    [law],
    { schoolHints: ["浙江大学"] },
  );
  assert.deepEqual(result.priorityDomains, []);
  assert.equal(result.pages.length, 1);
});

test("specific master's programme details and admission catalogues precede generic list pages on the same school", () => {
  const pages = [
    {
      ...source("list", "yz.a.edu.cn", "培养方案"),
      url: "https://yz.a.edu.cn/1728/list.htm",
    },
    {
      ...source("detail", "yz.a.edu.cn", "法学 - 甲大学研究生招生网"),
      url: "https://yz.a.edu.cn/a/programme/584.html",
    },
    {
      ...source("catalog", "yz.b.edu.cn", "乙大学2027年硕士招生专业目录"),
      excerpt: "乙大学硕士招生专业目录附件下载。",
    },
    {
      ...source("otherList", "yz.b.edu.cn", "法学硕士培养方案"),
      url: "https://yz.b.edu.cn/123/list.htm",
    },
  ];
  const result = researchReadingOrder(
    pages,
    new Map(pages.map((s) => [s.id, "0301"])),
    [law],
  );
  assert.deepEqual(
    result.pages.slice(0, 2).map((s) => s.id),
    ["detail", "catalog"],
  );
  assert.equal(result.firstRoundCount, 2);
});
