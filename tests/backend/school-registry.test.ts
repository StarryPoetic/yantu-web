import test from "node:test";
import assert from "node:assert/strict";
import {
  schoolRegistry,
  createSchoolRegistry,
  validateSchoolRegistry,
  PROVINCES,
  normalizeCollegeName,
  type SchoolRegistryEntry,
} from "../../server/schools/index.ts";
import {
  normalizeInstitutionName,
  sourceHasSchoolIdentity,
} from "../../server/explanation/research-school.ts";
import type { WebSource } from "../../server/explanation/web.ts";

const sample = () => ({
  schools: [
    structuredClone(schoolRegistry.byName("浙江大学")!) as SchoolRegistryEntry,
  ],
});
test("national registry has unique school/domain identities, 31 provinces and all 147 double-first-class leads", () => {
  assert.ok(schoolRegistry.schools.length >= 300);
  assert.equal(
    new Set(schoolRegistry.schools.map((s) => s.name)).size,
    schoolRegistry.schools.length,
  );
  assert.equal(
    new Set(schoolRegistry.schools.map((s) => s.registrableDomain)).size,
    schoolRegistry.schools.length,
  );
  assert.deepEqual(
    new Set(schoolRegistry.schools.map((s) => s.province)),
    new Set(PROVINCES),
  );
  assert.equal(
    schoolRegistry.schools.filter((s) => s.tags.includes("双一流")).length,
    147,
  );
  for (const name of [
    "浙江大学",
    "杭州电子科技大学",
    "浙江工业大学",
    "浙江理工大学",
    "杭州师范大学",
    "浙江工商大学",
    "浙江财经大学",
    "中国计量大学",
    "浙江中医药大学",
    "浙江科技大学",
    "浙大城市学院",
    "浙江传媒学院",
    "中国美术学院",
    "浙江农林大学",
    "浙江外国语学院",
    "杭州医学院",
  ])
    assert.ok(
      schoolRegistry.byCity("杭州市").some((lead) => lead.school.name === name),
    );
});
test("original five navigation/provenance and geography URLs survive national import even if later reads fail", () => {
  const urls: Record<string, string[]> = {
    杭州电子科技大学: [
      "https://grs.hdu.edu.cn/13497/list.htm",
      "https://grs.hdu.edu.cn/2026/0928/c13497a300811/page.htm",
      "https://xxhzk.hdu.edu.cn/main.htm",
    ],
    浙江工业大学: ["https://zs.zjut.edu.cn/jsp/"],
    浙江理工大学: ["https://gradadmission.zstu.edu.cn/index.htm"],
    浙江大学: [
      "https://www.grs.zju.edu.cn/yjszs/main.htm",
      "https://www.zju.edu.cn/xxgk/17953/list.htm",
    ],
    杭州师范大学: ["https://yjs.hznu.edu.cn/yjszs/"],
  };
  for (const [name, expected] of Object.entries(urls)) {
    const school = schoolRegistry.byName(name)!;
    for (const url of expected)
      assert.ok(
        [
          ...(school.discoveryUrls ?? []),
          ...(school.locationDiscoveryUrls ?? []),
          school.provenanceUrl,
        ].includes(url),
        `${name}: ${url}`,
      );
  }
});
test("registry resolves aliases/subdomains, annotates cross-city hints and returns no unknown hosts", () => {
  assert.equal(schoolRegistry.byName("浙大")?.name, "浙江大学");
  assert.equal(schoolRegistry.byHost("GRS.ZJU.EDU.CN.")?.name, "浙江大学");
  assert.equal(schoolRegistry.byHost("zju.edu.cn.attacker.example"), undefined);
  assert.equal(schoolRegistry.byHost("edu.cn"), undefined);
  for (const city of ["嘉兴", "舟山"])
    assert.equal(
      schoolRegistry
        .byCity(city)
        .find((lead) => lead.school.name === "浙江大学")?.cityMatch,
      "campus_hint",
    );
  assert.equal(
    schoolRegistry
      .byCity("杭州")
      .find((lead) => lead.school.name === "浙江大学")?.cityMatch,
    "main",
  );
  assert.ok(
    schoolRegistry
      .byName("浙江科技大学")
      ?.campusHints.some((h) => h.city === "湖州"),
  );
  assert.throws(() => {
    (schoolRegistry.byName("浙大")!.aliases as string[]).push("造假");
  });
});
test("registry validation fails clearly for malformed structure, duplicate names/domains, invalid cities/provinces and external URLs", () => {
  assert.throws(() => validateSchoolRegistry({}), /schools/);
  for (const change of [
    (r: ReturnType<typeof sample>) =>
      r.schools.push(structuredClone(r.schools[0])),
    (r: ReturnType<typeof sample>) =>
      r.schools.push({
        ...structuredClone(r.schools[0]),
        name: "另一校",
        aliases: [],
      }),
    (r: ReturnType<typeof sample>) => {
      r.schools[0].province = "不存在";
    },
    (r: ReturnType<typeof sample>) => {
      r.schools[0].city = "不存在";
    },
    (r: ReturnType<typeof sample>) => {
      r.schools[0].city = "北京";
    },
    (r: ReturnType<typeof sample>) => {
      r.schools[0].homepage = "https://attacker.example/";
    },
    (r: ReturnType<typeof sample>) => {
      r.schools[0].registrableDomain = "edu.cn";
    },
    (r: ReturnType<typeof sample>) => {
      r.schools[0].verification.checkedAt = "bad-date";
    },
  ]) {
    const r = sample();
    change(r);
    assert.throws(() => createSchoolRegistry(r), /院校种子库无效/);
  }
});
test("discovery URLs are ordered, deduplicated and exclude only the specifically failed URLs", () => {
  const r = sample(),
    s = r.schools[0];
  s.discoveryUrls = ["https://www.zju.edu.cn/a", "https://www.zju.edu.cn/b"];
  s.graduateAdmissionsUrl = "https://grs.zju.edu.cn/";
  s.verification = {
    checkedAt: "2026-10-11",
    homepageOk: false,
    graduateAdmissionsOk: true,
    urls: { "https://www.zju.edu.cn/a": false },
  };
  const registry = createSchoolRegistry(r);
  assert.deepEqual(registry.discoveryUrls(registry.schools[0]), [
    "https://www.zju.edu.cn/b",
    "https://grs.zju.edu.cn/",
  ]);
  assert.equal(registry.schools[0].discoveryOnly, true);
});
test("a read department normalizes to registry school; aliases are never colleges and registry alone proves no identity", () => {
  const s: WebSource = {
    id: "school",
    url: "https://me.zju.edu.cn/program",
    title: "机械工程学院",
    excerpt: "浙江大学机械工程学院2026年硕士研究生招生。",
    kind: "official_page",
    verified: false,
    retrievedAt: "2026-10-11",
  };
  assert.deepEqual(normalizeInstitutionName("机械工程学院", [s], [s]), {
    institutionName: "浙江大学",
    collegeName: "机械工程学院",
  });
  const renamed = {
    ...s,
    url: "https://yjsc.yulinu.edu.cn/",
    title: "榆林学院",
    excerpt: "榆林学院2026年硕士研究生招生，电子信息。",
  };
  assert.equal(schoolRegistry.byName("榆林学院")?.name, "榆林大学");
  assert.deepEqual(normalizeInstitutionName("榆林学院", [renamed], [renamed]), {
    institutionName: "榆林大学",
  });
  assert.equal(normalizeCollegeName("榆林大学", "榆林学院"), undefined);
  assert.equal(
    normalizeCollegeName("未知大学", "机械工程学院"),
    "机械工程学院",
  );
  assert.equal(
    sourceHasSchoolIdentity(
      { ...s, excerpt: "某合作单位浙江大学教授，其他资料。" },
      "浙江大学",
      [s],
    ),
    false,
  );
});
