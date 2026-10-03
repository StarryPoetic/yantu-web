import test from "node:test";
import assert from "node:assert/strict";
import { deriveRecommendationConstraints } from "../../server/explanation/research-constraints.ts";
import type { RecommendationConstraintInput } from "../../server/explanation/research-constraints.ts";
import type { WebSource } from "../../server/explanation/web.ts";

function source(excerpt: string, changes: Partial<WebSource> = {}): WebSource {
  return {
    id: "address",
    kind: "official_page",
    title: "甲大学硕士研究生资料",
    url: "https://grad.example.edu.cn/address",
    excerpt,
    retrievedAt: "2026-10-04T00:00:00Z",
    verified: false,
    ...changes,
  };
}
function input(
  excerpt: string,
  changes: Partial<RecommendationConstraintInput> = {},
): RecommendationConstraintInput {
  return {
    profile: { budget: "", cities: ["杭州"] },
    targetYear: 2027,
    institutionName: "甲大学",
    programName: "教育学",
    citations: ["admission"],
    sources: [source(excerpt)],
    ...changes,
  };
}
const cityCheck = (value: ReturnType<typeof deriveRecommendationConstraints>) =>
  value.constraintChecks.find((item) => item.field === "cities")!;

test("omitted project location is recovered from a continuous read school address and gets its own source ID", () => {
  const text = "甲大学教育学硕士培养地点：浙江省杭州市西湖区示例路1号。";
  const result = deriveRecommendationConstraints(input(text));
  assert.equal(result.location?.city, "杭州");
  assert.ok(text.includes(result.location!.quote));
  assert.equal(result.location?.sourceId, "address");
  assert.equal(cityCheck(result).status, "match");
  assert.deepEqual(cityCheck(result).sourceIds, ["address"]);
});

test("one explicit school address is recoverable without inferring a city from the university's name", () => {
  assert.equal(
    deriveRecommendationConstraints(
      input("甲大学地址：江苏省南京市玄武区示例路1号。"),
    ).location?.city,
    "南京",
  );
  assert.equal(
    cityCheck(
      deriveRecommendationConstraints(
        input("甲大学地址：江苏省南京市玄武区示例路1号。"),
      ),
    ).status,
    "mismatch",
  );
  assert.equal(
    deriveRecommendationConstraints(
      input("杭州甲大学教育学硕士专业介绍。", {
        institutionName: "杭州甲大学",
      }),
    ).location,
    undefined,
  );
});

test("an explicit project address is preferred to a generic institutional address in another source", () => {
  const result = deriveRecommendationConstraints(
    input("甲大学地址：上海市徐汇区示例路1号。", {
      sources: [
        source("甲大学地址：上海市徐汇区示例路1号。"),
        source("甲大学教育学培养地址：浙江省杭州市西湖区示例路2号。", {
          id: "project",
          url: "https://grad.example.edu.cn/project",
        }),
      ],
    }),
  );
  assert.equal(result.location?.city, "杭州");
  assert.equal(result.location?.sourceId, "project");
});

test("known multiple campuses, conflicting addresses and a school's footer cannot be silently assigned to a project", () => {
  for (const text of [
    "甲大学教育学硕士设北京校区和杭州校区。甲大学地址：浙江省杭州市西湖区示例路1号。",
    "甲大学地址：上海市徐汇区示例路1号。甲大学地址：浙江省杭州市西湖区示例路2号。",
    "甲大学教育学培养地址：上海市徐汇区或杭州市西湖区。",
    `甲大学教育学硕士介绍${"专业教学研究内容".repeat(50)}。学校设杭州校区和北京校区。甲大学地址：浙江省杭州市西湖区。`,
  ])
    assert.equal(
      deriveRecommendationConstraints(input(text)).location,
      undefined,
      text,
    );
  assert.equal(
    deriveRecommendationConstraints(
      input("甲大学教育学培养地址：上海市。甲大学教育学培养地址：杭州市。"),
    ).location,
    undefined,
  );
});

test("a unique explicit project address may identify its campus even if the university has other campuses", () => {
  const text =
    "甲大学设北京校区与杭州校区。教育学全日制硕士培养地点：杭州市西湖区。";
  assert.equal(
    deriveRecommendationConstraints(input(text)).location?.city,
    "杭州",
  );
});

test("another programme's address, another institution's address, friend links and promotional destinations do not migrate", () => {
  for (const text of [
    "甲大学教育学硕士招生。乙大学地址：杭州市西湖区。",
    "甲大学教育学硕士招生，乙大学地址：杭州市西湖区。",
    "甲大学教育学硕士招生，金融硕士地址：杭州市西湖区。",
    "甲大学教育学硕士与乙大学交流，乙大学教育学培养地址：杭州市西湖区。",
    "甲大学教育学硕士招生，金融硕士培养地点：杭州市西湖区。",
    "甲大学教育学硕士招生。金融硕士培养地点：杭州市西湖区。",
    "甲大学教育学硕士欢迎杭州考生报考。",
    "甲大学教育学就业辐射杭州市。",
    "乙大学地址：杭州市西湖区。友情链接：甲大学。",
  ])
    assert.equal(
      deriveRecommendationConstraints(input(text)).location,
      undefined,
      text,
    );
});

test("search snippets and non-HTTPS addresses cannot be promoted by omitted-location recovery", () => {
  const text = "甲大学教育学硕士培养地点：杭州市西湖区。";
  for (const changes of [
    { kind: "search_snippet" as const },
    { url: "http://grad.example.edu.cn/address" },
  ])
    assert.equal(
      deriveRecommendationConstraints(
        input(text, { sources: [source(text, changes)] }),
      ).location,
      undefined,
    );
});

test("a same-school page title cannot give another university's identically named programme its location", () => {
  for (const text of [
    "甲大学教育学硕士招生。乙大学：教育学培养地点：杭州市西湖区。",
    "甲大学教育学硕士招生。乙大学 教育学培养地点：杭州市西湖区。",
    "甲大学教育学硕士招生。合作学校乙大学的全日制教育学硕士培养地点：杭州市西湖区。",
  ]) {
    const result = deriveRecommendationConstraints(input(text));
    assert.equal(result.location, undefined, text);
    assert.equal(cityCheck(result).status, "unknown", text);
  }
  assert.equal(
    deriveRecommendationConstraints(
      input("甲大学附属教育学院 全日制教育学硕士培养地点：杭州市西湖区。"),
    ).location?.city,
    "杭州",
  );
});

test("independent colleges and partner institutes cannot lend their programme address to the page's school", () => {
  for (const local of [
    "乙学院：教育学培养地点：杭州市西湖区。",
    "合作单位乙研究院的全日制教育学硕士培养地点：杭州市西湖区。",
    "乙研究所：教育学培养地点：杭州市西湖区。",
    "合作单位乙科学院 全日制教育学硕士培养地点：杭州市西湖区。",
    "甲大学的合作单位乙研究所 全日制教育学硕士培养地点：杭州市西湖区。",
    "甲大学与乙学院 全日制教育学硕士培养地点：杭州市西湖区。",
    "甲大学教育学院与乙学院 全日制教育学硕士培养地点：杭州市西湖区。",
  ]) {
    const text = `甲大学教育学硕士招生。${local}`;
    const result = deriveRecommendationConstraints(input(text));
    assert.equal(result.location, undefined, text);
    assert.equal(cityCheck(result).status, "unknown", text);
    assert.equal(
      deriveRecommendationConstraints(
        input(text, {
          citations: ["address"],
          location: { city: "杭州", quote: local, sourceId: "address" },
        }),
      ).location,
      undefined,
      text,
    );
  }
  for (const local of [
    "甲大学附属教育学院 全日制教育学硕士培养地点：杭州市西湖区。",
    "甲大学教育学院：教育学培养地点：杭州市西湖区。",
    "甲大学心理与教育学院 全日制教育学硕士培养地点：杭州市西湖区。",
    "甲大学直属教育研究所 全日制教育学硕士培养地点：杭州市西湖区。",
    "本校教育研究院 全日制教育学硕士培养地点：杭州市西湖区。",
    "招生院系：教育学院 全日制教育学硕士培养地点：杭州市西湖区。",
  ])
    assert.equal(
      deriveRecommendationConstraints(input(`甲大学硕士招生。${local}`))
        .location?.city,
      "杭州",
      local,
    );
});

test("an explicit wrong model address remains rejected rather than being repaired from another value", () => {
  const text = "甲大学教育学培养地点：杭州市西湖区。";
  const result = deriveRecommendationConstraints(
    input(text, {
      citations: ["address"],
      location: { city: "上海", quote: text, sourceId: "address" },
    }),
  );
  assert.equal(result.location, undefined);
  assert.equal(cityCheck(result).status, "unknown");
});

test("peer-school navigation cannot borrow another school's address or copyright owner", () => {
  const quote =
    "联系我们 地址：江苏省南京市江宁区乙大学路2号土木教学科研楼 快速导航 学校主页 兄弟院校 甲大学土木工程学院 版权所有 © 乙大学土木工程学院";
  const text = `乙大学硕士研究生培养方案(081420 土木工程建造与管理)。${quote}`;
  const sources = [source(text, { title: "乙大学硕士研究生培养方案" })];
  for (const changes of [
    {},
    {
      citations: ["address"],
      location: { city: "南京", quote, sourceId: "address" },
    },
  ]) {
    const result = deriveRecommendationConstraints(
      input(text, { sources, ...changes }),
    );
    assert.equal(result.location, undefined);
    assert.equal(cityCheck(result).status, "unknown");
  }
  // Even a page with a real mention of our school cannot turn a peer's footer
  // into our own address when the location evidence is only that footer.
  const mixed = `甲大学教育学硕士招生，以下是合作单位的联系信息。${quote}`;
  assert.equal(
    deriveRecommendationConstraints(input(mixed)).location,
    undefined,
  );
  const footer =
    "联系我们 地址：江苏省南京市示例路2号 快速导航 甲大学教育学院 版权所有 © 乙大学教育学院";
  for (const changes of [
    {},
    {
      citations: ["address"],
      location: { city: "南京", quote: footer, sourceId: "address" },
    },
  ])
    assert.equal(
      deriveRecommendationConstraints(
        input(`甲大学教育学硕士招生。${footer}`, changes),
      ).location,
      undefined,
    );
  const ownerless =
    "联系我们 地址：江苏省南京市示例路2号 快速导航 学校主页 甲大学教育学院 版权所有";
  assert.equal(
    deriveRecommendationConstraints(input(`甲大学教育学硕士招生。${ownerless}`))
      .location,
    undefined,
  );
});

test("an address may use an explicit same-school copyright owner instead of a navigation mention", () => {
  for (const quote of [
    "联系我们 地址：浙江省杭州市西湖区示例路1号 版权所有 © 甲大学教育学院",
    "联系我们 地址：浙江省杭州市西湖区示例路1号 Copyright © 2026 甲大学研究生院",
    "联系我们 地址：浙江省杭州市西湖区示例路1号 甲大学教育学院 版权所有",
  ]) {
    const text = `甲大学教育学硕士招生。${quote}`;
    assert.equal(
      deriveRecommendationConstraints(input(text)).location?.city,
      "杭州",
      quote,
    );
    assert.equal(
      deriveRecommendationConstraints(
        input(text, {
          citations: ["address"],
          location: { city: "杭州", quote, sourceId: "address" },
        }),
      ).location?.city,
      "杭州",
      quote,
    );
  }
});

test("an explicit whole-page quote cannot call a distant footer project-local to bypass multiple-campus guards", () => {
  const text = `甲大学教育学硕士介绍${"教学资料说明".repeat(50)}设杭州校区和北京校区，甲大学地址：杭州市西湖区。`;
  const result = deriveRecommendationConstraints(
    input(text, {
      citations: ["address"],
      location: { city: "杭州", quote: text, sourceId: "address" },
    }),
  );
  assert.equal(result.location, undefined);
});
