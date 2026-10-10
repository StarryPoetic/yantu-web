import { schoolRegistry } from "../schools/index.ts";
import { registrableDomain } from "./web.ts";
import type { WebSource } from "./web.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";

/** School navigation links identify peers, not the owner of this page. */
export function withoutSchoolLinks(text: string) {
  return text.replace(
    /(?:友情链接|相关链接|院校链接|兄弟院校|兄弟高校|兄弟学校)[\s\S]*?(?=学院地址|学校地址|联系地址|联系方式|联系我们|Copyright|版权所有|$)/gi,
    "",
  );
}

/** Identify the page's school subject; fetched pages require actual body evidence. */
const identityCache = new WeakMap<
  WebSource,
  {
    title: string;
    excerpt: string;
    kind: string;
    provenance: WebSource["provenance"];
    values: Map<string, boolean>;
  }
>();
function directSchoolIdentity(source: WebSource, school: string) {
  let cache = identityCache.get(source);
  if (
    !cache ||
    cache.title !== source.title ||
    cache.excerpt !== source.excerpt ||
    cache.kind !== source.kind ||
    cache.provenance !== source.provenance
  ) {
    cache = {
      title: source.title,
      excerpt: source.excerpt,
      kind: source.kind,
      provenance: source.provenance,
      values: new Map(),
    };
    identityCache.set(source, cache);
  }
  if (cache.values.has(school)) return cache.values.get(school)!;
  const entry = schoolRegistry.byName(school);
  const sameDomain =
    schoolRegistrableDomain(source.url) === entry?.registrableDomain;
  const found =
    uncachedSchoolIdentity(source, school) ||
    (!!entry &&
      sameDomain &&
      [entry.name, ...entry.aliases]
        .filter((name) => name !== school)
        .some((name) => uncachedSchoolIdentity(source, name)));
  cache.values.set(school, found);
  return found;
}
function uncachedSchoolIdentity(source: WebSource, school: string) {
  if (school.length < 2) return false;
  const escaped = school.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const department =
    "[\\p{Script=Han}A-Za-z]{0,24}(?:学院|研究生院|研究院|研究所|中心|处)";
  const suffix = `(?!(?:\\s*(?:博士生导师|硕士生导师|博士导师|硕士导师|教授|教师|校友|等|城市学院)))(?=$|[\\s\\d年级:：,，.。;；()（）\\[\\]【】|｜—-]|硕士|博士|研究生|本科|招生|培养|专业|学科|学位|教育|简介|概况|官网|官方网站|网站|导航|学校|于|现有|拥有|开设|设|附属|目录|地址|校区|收费|学费|联系|电话|邮政|${department})`;
  if (
    source.kind !== "official_page" &&
    new RegExp(
      `(?:^|20\\d{2}[年级]?|[\\s:：|｜—-])${escaped}${suffix}`,
      "u",
    ).test(withoutSchoolLinks(source.title))
  )
    return true;
  const body = withoutSchoolLinks(source.excerpt);
  const ownerPrefix =
    "(?:学校名称|主办单位|版权所有|Copyright)\\s*[\\s:：©Ⓒ()cC\\d.,，—–-]*";
  const ownedSchool = new RegExp(
    `${ownerPrefix}${escaped}(?!城市学院)(?=$|[\\s,，.。;；:：]|${department})|${escaped}(?!城市学院)(?:\\s*${department})?\\s*版权所有`,
    "iu",
  );
  if (ownedSchool.test(body)) return true;
  // A body's explicit different copyright/organizer school outranks a quoted
  // partner title. Department names are kept; no school/domain map is inferred.
  if (
    new RegExp(
      `${ownerPrefix}[\\p{Script=Han}A-Za-z]{1,35}(?:大学|学院|科学院|研究院|研究所)|[\\p{Script=Han}A-Za-z]{1,35}(?:大学|学院|科学院|研究院|研究所)\\s*版权所有`,
      "iu",
    ).test(body)
  )
    return false;
  if (new RegExp(`^\\s*${escaped}${suffix}`, "u").test(body)) return true;
  // A masthead or actual document title may follow a short page/navigation label.
  // It remains in the fetched text itself; a search title cannot fill this gap.
  if (
    new RegExp(`(?:^|[\\s:：|｜—-])${escaped}${suffix}`, "u").test(
      body.slice(0, 300),
    )
  )
    return true;
  // Actual body headings can follow navigation or introductory text. Unlike a
  // bare name anywhere in a page, these explicitly name the school as the
  // subject of an academic document or institutional statement.
  const subjects = new RegExp(
    `${escaped}(?!\\s*(?:城市学院|博士生导师|硕士生导师|博士导师|硕士导师|教授|教师|校友))\\s*(?:20\\d{2}[年级]?\\s*)?[\\p{Script=Han}\\d（）()\\s]{0,28}?(?:硕士(?:研究生|专业学位)?(?:招生|培养|专业|学位)|研究生(?:招生|培养|专业)|招生(?:专业)?目录|专业(?:介绍|目录|招生目录|接受|报考|报名|招收|仅限|只招收|不招收)|培养方案|收费标准|学位授权|学校简介|现有|拥有|开设)`,
    "gu",
  );
  const direct = [...body.matchAll(subjects)].some((match) => {
    const preceding = body.slice(Math.max(0, match.index! - 24), match.index!);
    return !/(?:来自|毕业于|就读于|任职于|合作(?:单位|院校)?|伙伴(?:院校)?|转载|转发|参照|参考|访问|赴|与|和)\s*$/.test(
      preceding,
    );
  });
  return (
    direct || validatedSourceProvenance(source)?.institutionName === school
  );
}

/** Registry names take priority; callers still require actual read identity. */
export type InstitutionResolver = (
  registrableDomain: string,
  sources: readonly WebSource[],
) => string | undefined;

export function schoolRegistrableDomain(value: string) {
  try {
    const host = new URL(value).hostname;
    return registrableDomain(host);
  } catch {
    return undefined;
  }
}

/** Only actual read owner/subject text counts; partners and friendly links cannot name the owner. */
const ownerCache = new WeakMap<
  readonly WebSource[],
  {
    states: {
      source: WebSource;
      title: string;
      excerpt: string;
      kind: string;
      url: string;
    }[];
    owners: Map<string, string | undefined>;
  }
>();
export const resolveInstitutionFromPages: InstitutionResolver = (
  domain,
  sources,
) => {
  const seed = schoolRegistry.byHost(domain);
  if (seed) return seed.name;
  let cache = ownerCache.get(sources);
  if (
    !cache ||
    cache.states.length !== sources.length ||
    cache.states.some(
      (state, i) =>
        state.source !== sources[i] ||
        state.excerpt !== sources[i].excerpt ||
        state.kind !== sources[i].kind ||
        state.title !== sources[i].title ||
        state.url !== sources[i].url,
    )
  ) {
    cache = {
      states: sources.map((source) => ({
        source,
        excerpt: source.excerpt,
        kind: source.kind,
        title: source.title,
        url: source.url,
      })),
      owners: new Map(),
    };
    ownerCache.set(sources, cache);
  }
  if (cache.owners.has(domain)) return cache.owners.get(domain);
  const owner = resolveUncachedInstitution(domain, sources);
  cache.owners.set(domain, owner);
  return owner;
};

const resolveUncachedInstitution: InstitutionResolver = (domain, sources) => {
  const names = new Set<string>();
  for (const source of sources) {
    if (
      source.kind !== "official_page" ||
      schoolRegistrableDomain(source.url) !== domain
    )
      continue;
    const body = withoutSchoolLinks(source.excerpt);
    for (const match of `${source.title}\n${body}`.matchAll(
      /(?:^|[\s:：©。；|｜—-])([\p{Script=Han}A-Za-z]{1,30}?(?:大学|科学院|研究院|研究所|学院))(?=$|[\s:：。；|｜]|20\d{2}|硕士|研究生|招生|版权所有|学院|地址|[\p{Script=Han}]{1,24}学院)/gu,
    )) {
      const name = match[1];
      if (directSchoolIdentity(source, name)) names.add(name);
    }
  }
  const universities = [...names].filter((name) => /大学$/.test(name));
  if (universities.length)
    return universities.length === 1 ? universities[0] : undefined;
  // Standalone colleges/institutes need explicit organizer/copyright ownership.
  const independent = [...names].filter((name) =>
    sources.some(
      (s) =>
        s.kind === "official_page" &&
        schoolRegistrableDomain(s.url) === domain &&
        new RegExp(
          `(?:学校名称|主办单位|版权所有|Copyright)[^。；\\n]{0,35}${name}|${name}(?:[\\p{Script=Han}]{1,24}学院)?\\s*版权所有`,
          "iu",
        ).test(withoutSchoolLinks(s.excerpt)) &&
        (!/学院$/.test(name) ||
          new RegExp(
            `(?:学校名称|招生单位)\\s*[:：]\\s*${name}|${name}[\\p{Script=Han}]{1,24}学院`,
            "u",
          ).test(withoutSchoolLinks(s.excerpt))),
    ),
  );
  return independent.length === 1 ? independent[0] : undefined;
};

export function normalizeInstitutionName(
  name: string,
  cited: readonly WebSource[],
  sources: readonly WebSource[],
  resolver: InstitutionResolver = resolveInstitutionFromPages,
): { institutionName: string; collegeName?: string } | undefined {
  const domains = [
    ...new Set(
      cited
        .filter((s) => {
          if (directSchoolIdentity(s, name)) return true;
          const domain = schoolRegistrableDomain(s.url);
          const owner = domain && resolver(domain, sources);
          return (
            s.kind === "official_page" &&
            /学院$/.test(name) &&
            !!owner &&
            withoutSchoolLinks(s.excerpt).includes(`${owner}${name}`)
          );
        })
        .map((s) => schoolRegistrableDomain(s.url))
        .filter((d): d is string => !!d),
    ),
  ];
  const owners = [
    ...new Set(
      domains.map((d) => resolver(d, sources)).filter((n): n is string => !!n),
    ),
  ];
  if (owners.length > 1) return undefined;
  if (owners.length === 1)
    return {
      institutionName: owners[0],
      ...(owners[0] !== name &&
      schoolRegistry.byName(name)?.name !== owners[0] &&
      !cited.some((s) =>
        new RegExp(`${name}[\\p{Script=Han}]{1,24}学院`, "u").test(
          withoutSchoolLinks(s.excerpt),
        ),
      )
        ? { collegeName: name }
        : {}),
    };
  if (/(?:大学|科学院|研究所|研究院|党校|学校|医院|中心)$/.test(name))
    return { institutionName: name };
  return undefined;
}

export function sourceHasSchoolIdentity(
  source: WebSource,
  school: string,
  sources: readonly WebSource[] = [],
) {
  if (directSchoolIdentity(source, school)) return true;
  // Attachments can inherit only their validated linked-page provenance.
  if (source.parentSourceId || source.provenance) return false;
  if (source.kind !== "official_page" || !sources.length) return false;
  const domain = schoolRegistrableDomain(source.url);
  if (!domain || resolveInstitutionFromPages(domain, sources) !== school)
    return false;
  // A department-owned body can inherit its university, never a conflicting university owner.
  const body = withoutSchoolLinks(source.excerpt);
  const pageOwner = resolveUncachedInstitution(domain, [source]);
  if (
    pageOwner &&
    pageOwner !== school &&
    schoolRegistry.byName(pageOwner)?.name !== school
  )
    return false;
  const departments = [
    ...body.matchAll(
      /(?:^|[\s:：©。；|｜])([\p{Script=Han}]{2,24}学院)(?=$|\s|20\d{2}|硕士|研究生|招生|版权所有)/gu,
    ),
  ].map((m) => m[1]);
  return departments.some((name) => directSchoolIdentity(source, name));
}

export function isConcreteProgramName(name: string) {
  return !/^(?:学科简介|学院简介|学校简介|专业简介|专业介绍|招生简章|招生章程|招生目录|招生专业目录|培养方案|学科介绍|研究生教育|学科|专业|硕士|研究生|研究方向|硕士研究生|招收|招生|培养|初试|考试科目|专业代码|专业名称|招生单位|报考条件|学习方式|适用专项计划|适用培养层次|适用学位类型|适用年级|学制)$/.test(
    name,
  );
}
