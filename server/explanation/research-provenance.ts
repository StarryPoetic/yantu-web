import type { WebSource } from "./web.ts";
import { webPageText } from "./web.ts";
import { explicitAdmissionsYears } from "../../shared/research-years.ts";
import {
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
} from "./research-school.ts";

function schoolDomain(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^[a-z0-9.-]+\.edu\.cn$/i.test(url.hostname)
      ? url.hostname.split(".").slice(-3).join(".")
      : undefined;
  } catch {
    return undefined;
  }
}

function namesIn(text: string) {
  const names = [
    ...withoutSchoolLinks(text).matchAll(
      /(?:^|[\s:：©Ⓒ|｜。；])([\p{Script=Han}]{1,30}?(?:大学|科学院|研究院|研究所|学院))(?=$|\s|\d|年|硕士|博士|研究生|招生|专业|学科|版权所有|学院|研究院|研究所|中心)/gu,
    ),
  ].map((match) => match[1]);
  return [...new Set(names)].filter(
    (name) =>
      !names.some(
        (other) =>
          other !== name && name.startsWith(other) && /大学$/.test(other),
      ),
  );
}

function contradictsOwner(source: WebSource, institutionName: string) {
  return namesIn(source.excerpt).some((name) => {
    if (name === institutionName || name.startsWith(institutionName))
      return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const explicit = new RegExp(
      `(?:学校名称|主办单位|版权所有|Copyright)[^。；\\n]{0,30}${escaped}|${escaped}\\s*版权所有`,
      "i",
    ).test(source.excerpt);
    // A bare department heading such as 机械工程学院 is not another institution.
    return (
      (explicit || /大学$/.test(name)) && sourceHasSchoolIdentity(source, name)
    );
  });
}

/** Rechecks context structure and its actual owner passage; source titles alone never bind identity. */
export function validatedSourceProvenance(source: WebSource) {
  const context = source.provenance;
  if (
    !context ||
    source.kind !== "official_page" ||
    !source.parentSourceId ||
    context.parentSourceId !== source.parentSourceId ||
    context.parentSourceId === source.id ||
    !context.identityExcerpt ||
    context.identityExcerpt.length > 8000 ||
    !schoolDomain(source.url) ||
    schoolDomain(source.url) !== schoolDomain(context.parentUrl)
  )
    return undefined;
  const bodyOwner = {
    ...source,
    excerpt: context.identityExcerpt,
    provenance: undefined,
    parentSourceId: undefined,
  };
  if (!sourceHasSchoolIdentity(bodyOwner, context.institutionName))
    return undefined;
  const unbound = { ...source, provenance: undefined };
  if (contradictsOwner(unbound, context.institutionName)) return undefined;
  return context;
}

/** Bind an actual same-school linked document; never prepend parent words to its quoted body. */
export function normalizeAttachedEvidence(
  source: WebSource,
  parent: WebSource | undefined,
  body: string,
): WebSource {
  const unbound = { ...source, provenance: undefined };
  if (
    !parent ||
    !body.trim() ||
    source.kind !== "official_page" ||
    parent.kind !== "official_page" ||
    source.parentSourceId !== parent.id ||
    source.id === parent.id ||
    !schoolDomain(source.url) ||
    schoolDomain(source.url) !== schoolDomain(parent.url)
  )
    return unbound;
  const linked = parent.documentLinks?.find((link) => {
    try {
      return new URL(link.url).href === new URL(source.url).href;
    } catch {
      return false;
    }
  });
  if (!linked) return unbound;
  if (
    /(?:兄弟院校|兄弟高校|外校|友校|合作(?:院校|单位)|独立院校|转载|转发)[^。；\n]{0,80}(?:大学|学院|研究院|研究所)/.test(
      linked.title,
    )
  )
    return unbound;
  const inherited = validatedSourceProvenance(parent);
  const owners = namesIn(parent.excerpt).filter((name) =>
    sourceHasSchoolIdentity(parent, name),
  );
  const universities = owners.filter((name) => /大学$/.test(name));
  const institutionName =
    inherited?.institutionName ??
    (universities.length === 1
      ? universities[0]
      : universities.length
        ? undefined
        : owners.length === 1
          ? owners[0]
          : undefined);
  if (!institutionName) return unbound;
  const actualBody = /<[a-z][^>]*>/i.test(body) ? webPageText(body) : body;
  const actualChild = { ...unbound, excerpt: actualBody };
  if (contradictsOwner(actualChild, institutionName)) return unbound;
  // A partner's document title on a school-owned page cannot acquire its owner's identity.
  const foreignTitle =
    /([\p{Script=Han}]{1,30}?(?:大学|学院|研究院|研究所))\s*(?:20\d{2}[年级]?)?[^。；\n]{0,16}(?:硕士|博士|研究生)[^。；\n]{0,20}(?:招生|培养|专业)/gu;
  if (
    [
      ...`${linked.title}\n${actualBody.slice(0, 500)}`.matchAll(foreignTitle),
    ].some((match) => {
      const name = match[1];
      if (name === institutionName || name.startsWith(institutionName))
        return false;
      if (/大学$/.test(name)) return true;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const school = institutionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Named colleges/institutes need an explicit internal relationship. An
      // independently named institution cannot acquire the page owner's school.
      return !new RegExp(
        `${school}\\s*${escaped}|(?:本校|我校|下属|直属|所属|招生院系[:：])\\s*${escaped}`,
      ).test(`${linked.title}\n${parent.excerpt}`);
    })
  )
    return unbound;
  const childYears = explicitAdmissionsYears(actualBody).map(String);
  const linkedYear = linked.title.match(/\b(20\d{2})\b/)?.[1];
  const admissionYear =
    childYears.length === 1
      ? childYears[0]
      : childYears.length
        ? undefined
        : (linkedYear ?? inherited?.admissionYear);
  const mastersScope =
    !/博士|本科|学士/.test(linked.title) &&
    (/硕士(?:研究生|专业学位)?[^。；]{0,35}(?:招生|专业目录|培养)/.test(
      linked.title,
    ) ||
      inherited?.mastersScope === true) &&
    !/^(?:工作表[^\n]*\n)?[^\n]{0,80}(?:博士|本科|学士)[^\n]{0,25}(?:招生|培养|专业目录)/.test(
      actualBody,
    );
  const identityExcerpt =
    inherited?.identityExcerpt ?? parent.excerpt.slice(0, 8000);
  return {
    ...source,
    provenance: {
      institutionName,
      parentSourceId: parent.id,
      parentUrl: parent.url,
      linkedTitle: linked.title,
      identityExcerpt,
      ...(admissionYear ? { admissionYear } : {}),
      mastersScope,
    },
  };
}
