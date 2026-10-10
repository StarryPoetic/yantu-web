import { readFileSync } from "node:fs";
import { CITY_OPTIONS, normalizeCityName } from "../../shared/cities.ts";
import { registrableDomain } from "../explanation/web.ts";

export const PROVINCES = [
  "北京",
  "天津",
  "河北",
  "山西",
  "内蒙古",
  "辽宁",
  "吉林",
  "黑龙江",
  "上海",
  "江苏",
  "浙江",
  "安徽",
  "福建",
  "江西",
  "山东",
  "河南",
  "湖北",
  "湖南",
  "广东",
  "广西",
  "海南",
  "重庆",
  "四川",
  "贵州",
  "云南",
  "西藏",
  "陕西",
  "甘肃",
  "青海",
  "宁夏",
  "新疆",
] as const;
export interface SchoolRegistryEntry {
  name: string;
  aliases: readonly string[];
  province: string;
  city: string;
  registrableDomain: string;
  homepage: string;
  graduateAdmissionsUrl: string | null;
  campusHints: readonly {
    name: string;
    city: string;
    provenanceUrl?: string;
  }[];
  tags: readonly string[];
  discoveryUrls?: readonly string[];
  locationDiscoveryUrls?: readonly string[];
  provenanceUrl?: string;
  verification: {
    checkedAt: string;
    homepageOk: boolean | null;
    graduateAdmissionsOk: boolean | null;
    failureCode?: string;
    /** URL-specific results keep one failed page from disabling unrelated seeds. */
    urls?: Readonly<Record<string, boolean>>;
  };
}
export type SchoolLead = Readonly<SchoolRegistryEntry> & {
  discoveryOnly: true;
};

export function validateSchoolRegistry(value: unknown): SchoolRegistryEntry[] {
  const fail = (detail: string): never => {
    throw new Error(`院校种子库无效：${detail}`);
  };
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { schools?: unknown }).schools)
  )
    fail("缺少 schools 数组");
  const names = new Set<string>(),
    domains = new Set<string>(),
    identities = new Set<string>();
  return (value as { schools: SchoolRegistryEntry[] }).schools.map(
    (s, index) => {
      if (!s || typeof s !== "object") fail(`第${index + 1}条不是对象`);
      const string = (v: unknown): v is string =>
        typeof v === "string" && !!v.trim() && v === v.trim();
      const strings = (v: unknown): v is string[] =>
        Array.isArray(v) && v.every(string);
      if (!string(s.name) || names.has(s.name))
        fail(`名称缺失或重复：${s.name}`);
      names.add(s.name);
      if (!strings(s.aliases) || !strings(s.tags))
        fail(`${s.name} aliases/tags 必须是字符串数组`);
      for (const name of [s.name, ...s.aliases]) {
        if (identities.has(name)) fail(`名称/别名重复：${name}`);
        identities.add(name);
      }
      if (!(PROVINCES as readonly string[]).includes(s.province))
        fail(`${s.name} 省份不属于31个省级行政区`);
      const city = normalizeCityName(typeof s.city === "string" ? s.city : "");
      const option = CITY_OPTIONS.find((c) => c.name === city);
      if (!option || !option.province.startsWith(s.province))
        fail(`${s.name} 城市不可识别或省市不一致：${s.city}`);
      if (
        !string(s.registrableDomain) ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(s.registrableDomain) ||
        registrableDomain(s.registrableDomain) !== s.registrableDomain ||
        ["edu.cn", "ac.cn", "com.cn"].includes(s.registrableDomain) ||
        domains.has(s.registrableDomain)
      )
        fail(`${s.name} 注册域名无效或重复：${s.registrableDomain}`);
      domains.add(s.registrableDomain);
      const url = (v: unknown) => {
        if (!string(v)) fail(`${s.name} URL 缺失`);
        try {
          const u = new URL(v as string);
          if (
            !["https:", "http:"].includes(u.protocol) ||
            u.username ||
            u.password ||
            u.port ||
            registrableDomain(u.hostname) !== s.registrableDomain ||
            (u.protocol === "http:" && !u.hostname.endsWith(".edu.cn"))
          )
            fail(`${s.name} URL 不属于学校或传输不合规：${v}`);
        } catch {
          fail(`${s.name} URL 无效：${v}`);
        }
      };
      url(s.homepage);
      if (s.graduateAdmissionsUrl !== null) url(s.graduateAdmissionsUrl);
      for (const field of [s.discoveryUrls, s.locationDiscoveryUrls]) {
        if (field !== undefined && !strings(field))
          fail(`${s.name} 发现网址必须是数组`);
        field?.forEach(url);
      }
      if (s.provenanceUrl !== undefined) url(s.provenanceUrl);
      if (!Array.isArray(s.campusHints))
        fail(`${s.name} campusHints 必须是数组`);
      const campusHints = s.campusHints.map((hint) => {
        if (
          !hint ||
          !string(hint.name) ||
          !string(hint.city) ||
          !CITY_OPTIONS.some((c) => c.name === normalizeCityName(hint.city))
        )
          fail(`${s.name} 校区城市不可识别`);
        if (hint.provenanceUrl) url(hint.provenanceUrl);
        return { ...hint, city: normalizeCityName(hint.city) };
      });
      const v = s.verification;
      if (
        !v ||
        !string(v.checkedAt) ||
        !Number.isFinite(Date.parse(v.checkedAt)) ||
        ![true, false, null].includes(v.homepageOk) ||
        ![true, false, null].includes(v.graduateAdmissionsOk) ||
        (v.failureCode !== undefined && !string(v.failureCode))
      )
        fail(`${s.name} 核验摘要无效`);
      if (v.urls !== undefined) {
        if (!v.urls || typeof v.urls !== "object" || Array.isArray(v.urls))
          fail(`${s.name} 网址核验摘要无效`);
        for (const [key, result] of Object.entries(v.urls)) {
          url(key);
          if (typeof result !== "boolean")
            fail(`${s.name} 网址核验结果不是布尔值`);
        }
      }
      return { ...s, city, campusHints };
    },
  );
}

export function createSchoolRegistry(value: unknown) {
  const schools: SchoolLead[] = validateSchoolRegistry(value).map((s) => {
    const lead = { ...s, discoveryOnly: true as const };
    // A caller cannot mutate the cached hints and alter later city decisions.
    const freeze = (v: object) => {
      Object.values(v).forEach((x) => {
        if (x && typeof x === "object") freeze(x);
      });
      Object.freeze(v);
    };
    freeze(lead);
    return lead;
  });
  const names = new Map(
    schools.flatMap((s) =>
      [s.name, ...s.aliases].map((name) => [name, s] as const),
    ),
  );
  const domains = new Map(schools.map((s) => [s.registrableDomain, s]));
  return {
    schools: Object.freeze(schools),
    byName: (name: string) => names.get(name.trim()),
    byHost: (host: string) =>
      domains.get(registrableDomain(host.toLowerCase().replace(/\.$/, ""))),
    byCity: (city: string) =>
      schools.flatMap<{
        school: SchoolLead;
        city: string;
        cityMatch: "main" | "campus_hint";
      }>((s) => {
        const normalized = normalizeCityName(city);
        return s.city === normalized
          ? [{ school: s, city: normalized, cityMatch: "main" as const }]
          : s.campusHints.some((h) => h.city === normalized)
            ? [
                {
                  school: s,
                  city: normalized,
                  cityMatch: "campus_hint" as const,
                },
              ]
            : [];
      }),
    discoveryUrls: (s: SchoolRegistryEntry) =>
      [
        ...new Set([
          ...(s.discoveryUrls ?? []),
          ...(s.graduateAdmissionsUrl ? [s.graduateAdmissionsUrl] : []),
          s.homepage,
        ]),
      ].filter((url) => {
        const ok =
          s.verification.urls?.[url] ??
          (url === s.homepage
            ? s.verification.homepageOk
            : url === s.graduateAdmissionsUrl
              ? s.verification.graduateAdmissionsOk
              : null);
        return ok !== false;
      }),
  };
}

// Imported during server startup; a broken registry fails before serving requests.
export const schoolRegistry = createSchoolRegistry(
  JSON.parse(
    readFileSync(
      new URL("../../knowledge/schools/registry.json", import.meta.url),
      "utf8",
    ),
  ),
);
export function normalizeCollegeName(
  institutionName: string,
  collegeName?: string,
) {
  const school = schoolRegistry.byName(institutionName);
  return collegeName &&
    (collegeName === institutionName ||
      (school && schoolRegistry.byName(collegeName)?.name === school.name))
    ? undefined
    : collegeName;
}
