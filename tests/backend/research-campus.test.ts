import test from "node:test";
import assert from "node:assert/strict";
import { deriveCampusLocation } from "../../server/explanation/research-campus.ts";
import { deriveRecommendationConstraints } from "../../server/explanation/research-constraints.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const school = "杭州电子科技大学";
const row =
  "第4行：010机械工程学院 | 080200机械工程 | 学术学位 | 201英语（一）301数学（一）";
const policy =
  "录取在电子信息学院、集成电路科学与工程学院的新生所在校区：根据研究生导师团队和学科方向在杭州电子科技大学下沙校区或绍兴校区。\n其他学院的新生所在校区为杭州电子科技大学下沙校区或文一校区。";
function source(
  id: string,
  excerpt: string,
  changes: Partial<WebSource> = {},
): WebSource {
  return {
    id,
    excerpt,
    kind: "official_page",
    title: `${school}硕士资料`,
    url: `https://grs.hdu.edu.cn/${id}.htm`,
    retrievedAt: "2026-10-04T00:00:00Z",
    verified: false,
    ...changes,
  };
}
function fixture() {
  return {
    institutionName: school,
    programName: "机械工程",
    collegeName: "机械工程学院",
    majorCode: "080200",
    programSourceId: "directory",
    targetYear: "2027",
    sources: [
      source("directory", `${school}2027年硕士研究生招生专业目录\n${row}`),
      source(
        "charter",
        `${school}2027年硕士研究生招生章程\n十四、培养所在校区\n${policy}\n联系方式\n研究生招生办公室（下沙校区行政楼207）\n地址：杭州市钱塘区2号大街1158号`,
      ),
      source(
        "geography",
        `${school}浙江省信息化发展研究院\n友情链接\n乙大学\n联系我们\n地址：杭州市西湖区文一路115号 杭州电子科技大学（文一校区）实验楼\n版权所有©杭州电子科技大学`,
        { url: "https://xxhzk.hdu.edu.cn/main.htm" },
      ),
    ],
  };
}

test("bound program faculty, exhaustive other-faculty policy and both campus addresses prove Hangzhou with exact supporting passages", () => {
  const input = fixture();
  const location = deriveCampusLocation(input);
  assert.equal(location?.city, "杭州");
  assert.deepEqual(
    location?.supportingEvidence?.map((item) => item.role),
    ["program_college", "campus_policy", "campus_city", "campus_city"],
  );
  assert.ok(
    location?.supportingEvidence?.every((item) =>
      input.sources
        .find((source) => source.id === item.sourceId)
        ?.excerpt.includes(item.quote),
    ),
  );
  assert.equal(location?.supportingEvidence?.[0].quote, row);
  const constraints = deriveRecommendationConstraints({
    ...input,
    profile: { cities: ["杭州"], budget: "不确定" },
    citations: ["directory"],
  });
  const city = constraints.constraintChecks.find(
    (check) => check.field === "cities",
  );
  assert.equal(city?.status, "match");
  assert.deepEqual(
    new Set(city?.sourceIds),
    new Set(["directory", "charter", "geography"]),
  );
});

test("missing geography, unknown faculty, wrong program code and a cross-year campus policy do not fill a city gap", () => {
  const cases = [
    {
      ...fixture(),
      sources: fixture().sources.filter((source) => source.id !== "geography"),
    },
    { ...fixture(), collegeName: "不存在学院" },
    { ...fixture(), majorCode: "080201" },
    { ...fixture(), programName: "机械" },
    {
      ...fixture(),
      sources: fixture().sources.map((source) =>
        source.id === "directory"
          ? {
              ...source,
              excerpt: source.excerpt.replace(
                "010机械工程学院",
                "010数字机械工程学院",
              ),
            }
          : source,
      ),
    },
    {
      ...fixture(),
      sources: fixture().sources.map((source) =>
        source.id === "charter"
          ? { ...source, excerpt: source.excerpt.replaceAll("2027", "2026") }
          : source,
      ),
    },
  ];
  for (const input of cases)
    assert.equal(deriveCampusLocation(input), undefined);
});

test("a coherent 2026, 2025 or 2024 programme-policy chain is a labelled historical city reference for 2027", () => {
  for (const year of [2026, 2025, 2024]) {
    const input = fixture();
    input.sources = input.sources.map((source) => ({
      ...source,
      excerpt: source.excerpt.replaceAll("2027", String(year)),
    }));
    const location = deriveCampusLocation(input);
    assert.equal(location?.city, "杭州");
    assert.equal(location?.year, year);
    const result = deriveRecommendationConstraints({
      ...input,
      profile: { cities: ["杭州"], budget: "" },
      citations: ["directory"],
    });
    const check = result.constraintChecks.find(
      (check) => check.field === "cities",
    )!;
    assert.equal(check.status, "match");
    assert.match(check.reason, new RegExp(`${year}年历史培养安排参考`));
    assert.match(check.reason, /2027年实际培养安排仍待核对/);
    assert.equal(check.reason.includes("符合已选城市偏好"), false);
    assert.equal(
      deriveRecommendationConstraints({
        ...input,
        profile: { cities: ["杭州"], budget: "" },
        citations: input.sources.map((source) => source.id),
        location: { ...location, year: 2027 },
      }).location,
      undefined,
    );
  }
});

test("different historical cohorts cannot be joined and a current conflicting campus policy blocks an old city match", () => {
  const crossed = fixture();
  crossed.sources[0].excerpt = crossed.sources[0].excerpt.replaceAll(
    "2027",
    "2026",
  );
  crossed.sources[1].excerpt = crossed.sources[1].excerpt.replaceAll(
    "2027",
    "2025",
  );
  assert.equal(deriveCampusLocation(crossed), undefined);
  const conflict = fixture();
  conflict.sources = conflict.sources.map((source) => ({
    ...source,
    excerpt: source.excerpt.replaceAll("2027", "2026"),
  }));
  conflict.sources.push(
    source(
      "current-policy",
      `${school}2027年硕士研究生招生章程\n机械工程学院硕士研究生就读校区为绍兴校区。`,
    ),
  );
  conflict.sources.push(
    source(
      "shaoxing",
      `${school}绍兴校区\n地址：绍兴市示例路1号\n版权所有©${school}`,
    ),
  );
  assert.equal(deriveCampusLocation(conflict), undefined);
  const checked = deriveRecommendationConstraints({
    ...conflict,
    profile: { cities: ["杭州"], budget: "" },
    citations: ["directory"],
  });
  assert.equal(
    checked.location,
    undefined,
    "fallback footer cannot bypass a current conflicting policy",
  );
  assert.equal(
    checked.constraintChecks.find((check) => check.field === "cities")?.status,
    "unknown",
  );
});

test("a complete current programme and policy override an older arrangement without crossing their years", () => {
  const input = fixture();
  input.sources = input.sources.map((source) => ({
    ...source,
    excerpt: source.excerpt.replaceAll("2027", "2026"),
  }));
  input.sources.push(
    source(
      "current-directory",
      `${school}2027年硕士研究生招生专业目录\n${row}`,
    ),
  );
  input.sources.push(
    source(
      "current-policy",
      `${school}2027年硕士研究生招生章程\n机械工程学院硕士研究生就读校区为绍兴校区。`,
    ),
  );
  input.sources.push(
    source(
      "shaoxing",
      `${school}绍兴校区\n地址：绍兴市示例路1号\n版权所有©${school}`,
    ),
  );
  const result = deriveCampusLocation({ ...input, programSourceId: undefined });
  assert.equal(result?.city, "绍兴");
  assert.equal(result?.year, 2027);
  assert.ok(
    result?.supportingEvidence?.some(
      (passage) => passage.sourceId === "current-directory",
    ),
  );
  assert.equal(
    result?.supportingEvidence?.some(
      (passage) => passage.sourceId === "charter",
    ),
    false,
  );
});

test("a current programme's changed owning faculty prevents reuse of the historical faculty policy", () => {
  const input = fixture();
  input.sources = input.sources.map((source) => ({
    ...source,
    excerpt: source.excerpt.replaceAll("2027", "2026"),
  }));
  input.sources.push(
    source(
      "current-directory",
      `${school}2027年硕士研究生招生专业目录\n第4行：020新机械工程学院 | 080200机械工程 | 学术学位`,
    ),
  );
  assert.equal(deriveCampusLocation(input), undefined);
});

test("historical population restrictions still apply and an ambiguous geography year cannot supply a campus chain", () => {
  for (const population of [
    "港澳台",
    "国际学生",
    "非全日制硕士研究生",
    "中外合作硕士研究生",
  ]) {
    const input = fixture();
    input.sources = input.sources.map((source) => ({
      ...source,
      excerpt: source.excerpt.replaceAll("2027", "2026"),
    }));
    input.sources[1].title = `${school}2026年${population}招生章程`;
    input.sources[1].excerpt = input.sources[1].excerpt.replace(
      "2026年硕士研究生招生章程",
      `2026年${population}招生章程`,
    );
    assert.equal(deriveCampusLocation(input), undefined, population);
  }
  const mixed = fixture();
  mixed.sources[2].excerpt = `${school}2026年硕士研究生培养方案\n${school}2027年硕士研究生培养方案\n${mixed.sources[2].excerpt}`;
  assert.equal(deriveCampusLocation(mixed), undefined);
});

test("a dated current campus address in another city cannot be bypassed using an older same-campus map", () => {
  const input = fixture();
  input.sources = input.sources.map((source) => ({
    ...source,
    excerpt: source.excerpt.replaceAll("2027", "2026"),
  }));
  input.sources.push(
    source(
      "current-geography",
      `${school}2027年硕士研究生培养校区说明\n文一校区\n地址：绍兴市示例路1号\n版权所有©${school}`,
    ),
  );
  assert.equal(deriveCampusLocation(input), undefined);
});

test("an excluded faculty cannot borrow the other-faculty Hangzhou policy and a cross-city policy remains unresolved", () => {
  const input = fixture();
  input.collegeName = "电子信息学院";
  input.programName = "电子科学与技术";
  input.majorCode = "080900";
  input.sources[0].excerpt = `${school}2027年硕士研究生招生专业目录\n第4行：020电子信息学院 | 080900电子科学与技术 | 学术学位`;
  assert.equal(deriveCampusLocation(input), undefined);
  input.sources.push(
    source("shaoxing", `${school}绍兴校区\n地址：绍兴市示例路1号`),
  );
  assert.equal(
    deriveCampusLocation(input),
    undefined,
    "possible campuses in two cities are not one verified preferred city",
  );
});

test("other-faculty policy requires explicit exclusions and cannot be lifted from a foreign school or a peer link block", () => {
  const missingExclusions = fixture();
  missingExclusions.sources[1].excerpt = `${school}2027年硕士研究生招生章程\n其他学院的新生所在校区为杭州电子科技大学下沙校区或文一校区。\n下沙校区\n地址：杭州市钱塘区示例路`;
  assert.equal(deriveCampusLocation(missingExclusions), undefined);
  const foreign = fixture();
  foreign.sources[2].url = "https://peer.edu.cn/main.htm";
  assert.equal(deriveCampusLocation(foreign), undefined);
  const peer = fixture();
  peer.sources[2].excerpt = `${school}官网\n友情链接\n乙大学文一校区\n地址：杭州市示例路1号\n联系我们\n版权所有©杭州电子科技大学`;
  assert.equal(deriveCampusLocation(peer), undefined);
});

test("contradictory campus mapping and several campus names in one address window remain unresolved", () => {
  const conflicting = fixture();
  conflicting.sources.push(
    source(
      "conflict",
      `${school}文一校区\n地址：绍兴市示例路1号\n版权所有©${school}`,
    ),
  );
  assert.equal(deriveCampusLocation(conflicting), undefined);
  const ambiguous = fixture();
  ambiguous.sources[2].excerpt = `${school}下沙校区、文一校区\n地址：杭州市示例路1号\n版权所有©杭州电子科技大学`;
  assert.equal(deriveCampusLocation(ambiguous), undefined);
});

test("campus proof survives revalidation only when the complete deterministic chain is reproduced", () => {
  const input = fixture();
  const location = deriveCampusLocation(input)!;
  const base = {
    ...input,
    profile: { cities: ["杭州"], budget: "不确定" },
    citations: input.sources.map((source) => source.id),
    location,
  };
  assert.equal(
    deriveRecommendationConstraints(base).constraintChecks.find(
      (check) => check.field === "cities",
    )?.status,
    "match",
  );
  for (const changed of [
    { ...location, city: "绍兴" },
    { ...location, quote: location.quote + "伪造" },
    { ...location, supportingEvidence: location.supportingEvidence!.slice(1) },
    {
      ...location,
      supportingEvidence: location.supportingEvidence!.map((item) => ({
        ...item,
        quote: item.quote + "伪造",
      })),
    },
  ])
    assert.equal(
      deriveRecommendationConstraints({ ...base, location: changed }).location,
      undefined,
    );
  assert.equal(
    deriveRecommendationConstraints({
      ...base,
      sources: input.sources.filter((source) => source.id !== "geography"),
    }).location,
    undefined,
  );
});

test("a plain directory footer and an admissions office address cannot override a cross-city faculty policy", () => {
  const input = fixture();
  input.collegeName = "电子信息学院";
  input.programName = "电子科学与技术";
  input.majorCode = "080900";
  input.sources[0].excerpt = `${school}2027年硕士研究生招生专业目录\n第4行：020电子信息学院 | 080900电子科学与技术 | 学术学位\n${school}地址：杭州市示例路1号`;
  input.sources.push(
    source(
      "contact",
      `${school}电子科学与技术硕士咨询招生办联系地址：杭州市示例路1号`,
    ),
  );
  const constraints = deriveRecommendationConstraints({
    ...input,
    profile: { cities: ["杭州"], budget: "不确定" },
    citations: input.sources.map((source) => source.id),
  });
  assert.equal(constraints.location, undefined);
  assert.equal(
    constraints.constraintChecks.find((check) => check.field === "cities")
      ?.status,
    "unknown",
  );
});

test("same-year special-population charters and locally scoped campus policies cannot assign ordinary candidates a city", () => {
  for (const population of [
    "港澳台",
    "来华留学硕士研究生",
    "国际学生",
    "非全日制硕士研究生",
    "中外合作硕士研究生",
  ]) {
    const input = fixture();
    input.sources[1].title = `${school}2027年${population}招生章程`;
    input.sources[1].excerpt = input.sources[1].excerpt.replace(
      "2027年硕士研究生招生章程",
      `2027年${population}招生章程`,
    );
    assert.equal(deriveCampusLocation(input), undefined, population);
  }
  const local = fixture();
  local.sources[1].excerpt = local.sources[1].excerpt.replace(
    "十四、培养所在校区",
    "十四、港澳台硕士研究生培养所在校区",
  );
  assert.equal(deriveCampusLocation(local), undefined);
  const inline = fixture();
  inline.sources[1].excerpt = inline.sources[1].excerpt.replace(
    "录取在电子信息学院",
    "港澳台硕士研究生培养所在校区：录取在电子信息学院",
  );
  assert.equal(deriveCampusLocation(inline), undefined);
  const navigation = fixture();
  navigation.sources[1].excerpt = `导航\n港澳台招生\n来华留学\n${navigation.sources[1].excerpt}`;
  assert.equal(
    deriveCampusLocation(navigation)?.city,
    "杭州",
    "navigation is not a dedicated population policy",
  );
});

test("another school's faculty and coded-program campus expressions support the same proof chain across cities", () => {
  for (const expression of [
    "机械工程学院硕士研究生就读校区为主校区或北校区",
    "080200机械工程硕士培养地点为主校区或北校区",
  ]) {
    const input = {
      institutionName: "甲大学",
      programName: "机械工程",
      collegeName: "机械工程学院",
      majorCode: "080200",
      targetYear: "2027",
      sources: [
        source("catalog", `甲大学2027年硕士研究生招生专业目录\n${row}`, {
          url: "https://yz.jia.edu.cn/catalog.htm",
        }),
        source("campus", `甲大学2027年硕士研究生招生章程\n${expression}。`, {
          url: "https://yz.jia.edu.cn/campus.htm",
        }),
        source(
          "main",
          "甲大学主校区\n地址：南京市示例路1号\n版权所有©甲大学",
          { url: "https://www.jia.edu.cn/main.htm" },
        ),
        source(
          "north",
          "甲大学北校区\n地址：南京市示例路2号\n版权所有©甲大学",
          { url: "https://www.jia.edu.cn/north.htm" },
        ),
      ],
    };
    assert.equal(deriveCampusLocation(input)?.city, "南京", expression);
    input.sources[3].excerpt = input.sources[3].excerpt.replace(
      "南京市",
      "扬州市",
    );
    assert.equal(
      deriveCampusLocation(input),
      undefined,
      "multiple possible campuses in different cities remain unresolved",
    );
  }
});
