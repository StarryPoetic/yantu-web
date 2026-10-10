import type { LocationEvidence } from "../../shared/research-recommendation.ts";
import type { WebSource } from "./web.ts";
import { admissionEvidence } from "./research-evidence.ts";
import {
  historicalReferenceYears,
  explicitAdmissionsYears,
} from "../../shared/research-years.ts";
import { safeSourceYear } from "./research-years.ts";
import {
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
} from "./research-school.ts";

type Passage = {
  sourceId: string;
  quote: string;
  role: "program_college" | "campus_policy" | "campus_city";
};
function domain(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".edu.cn")
      ? url.hostname.split(".").slice(-3).join(".")
      : undefined;
  } catch {
    return undefined;
  }
}
function campuses(text: string, institutionName: string) {
  return [
    ...new Set(
      text
        .replaceAll(institutionName, "")
        .split(/[、，,或；;\n]/)
        .flatMap((part) => [...part.matchAll(/[\p{Script=Han}]{1,24}校区/gu)])
        .map((match) => match[0].replace(/^.*(?:所在|位于|在|为|于)/, ""))
        .filter((name) => name !== "校区" && name.length <= 12),
    ),
  ];
}
function schoolPages(
  sources: WebSource[],
  institutionName: string,
  sameDomain: string,
) {
  return sources.filter(
    (source) =>
      source.kind === "official_page" &&
      domain(source.url) === sameDomain &&
      sourceHasSchoolIdentity(source, institutionName, sources),
  );
}

/** Ordinary candidates cannot borrow a campus policy restricted to another population. */
function restrictedPolicy(source: WebSource, body: string, position: number) {
  const restricted =
    "(?:港澳台(?:地区)?(?:学生|考生|研究生|硕士(?:研究生)?)?|来华留学(?:生|研究生|硕士研究生)?|留学生|国际(?:学生|研究生|硕士(?:研究生)?)|外国(?:籍|学生|留学生)|外籍|中外合作|专项计划|非全日制|定向(?:就业)?)";
  const ordinary =
    "(?:(?:普通统考|全国统考|境内|内地|大陆)(?:学生|考生|研究生|硕士(?:研究生)?)?)";
  const title = new RegExp(
    `${restricted}[^。；;\\n]{0,35}(?:硕士|研究生|招生|招收|培养)|(?:硕士|研究生|招生|招收|培养)[^。；;\\n]{0,35}${restricted}`,
  );
  const restrictedTitle = title.test(source.title);
  if (restrictedTitle && !new RegExp(ordinary).test(source.title)) return true;
  const scopes: { position: number; restricted: boolean }[] = [];
  const documentStart =
    [
      ...body.matchAll(
        /(?:^|\n)[^\n。]{0,60}20\d{2}年[^\n。]{0,60}(?:硕士|研究生)[^\n。]{0,24}招生(?:章程|简章)/g,
      ),
    ]
      .filter((match) => match.index! <= position)
      .at(-1)?.index ?? 0;
  for (const [population, isRestricted] of [
    [restricted, true],
    [ordinary, false],
  ] as const) {
    const headings = new RegExp(
      `${population}[^。；;\\n]{0,32}?(?:培养(?:所在)?校区|培养地点|新生所在校区|教学地点|招生(?:章程|简章|办法))|(?:培养(?:所在)?校区|培养地点|新生所在校区|教学地点|招生(?:章程|简章|办法))[^。；;\\n]{0,24}?${population}|(?:^|\\n)\\s*(?:[一二三四五六七八九十]+[、.]|\\d+[、.])?\\s*${population}\\s*(?=\\n|$)`,
      "g",
    );
    for (const match of body.matchAll(headings))
      if (match.index! >= documentStart && match.index! <= position)
        scopes.push({ position: match.index!, restricted: isRestricted });
  }
  return (
    scopes.sort((a, b) => a.position - b.position).at(-1)?.restricted ??
    restrictedTitle
  );
}

/** Reuse the same population scope for direct programme addresses and campus chains. */
export function isRestrictedCampusQuote(source: WebSource, quote: string) {
  const body = withoutSchoolLinks(source.excerpt);
  const position = body.indexOf(quote);
  if (position < 0 || body.indexOf(quote, position + quote.length) >= 0)
    return true;
  return restrictedPolicy(source, body, position + quote.length);
}

type CampusLocationInput = {
  institutionName: string;
  programName: string;
  collegeName?: string;
  majorCode?: string;
  programSourceId?: string;
  sources: WebSource[];
  targetYear: string | number;
};

/** Each programme-policy chain is bound to one explicit cohort, never a mixture of years. */
function deriveCampusLocationForYear(
  input: CampusLocationInput,
  evidenceYear: number,
): LocationEvidence | undefined {
  const { collegeName, majorCode } = input;
  if (
    !collegeName ||
    !/学院$/.test(collegeName) ||
    !/^(?:0[1-9]|1[0-4])\d{4}$/.test(majorCode ?? "")
  )
    return undefined;
  const escapedCollege = collegeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedProgramme = input.programName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const boundRow = (row: string) => {
    const codeAt = row.indexOf(majorCode!);
    return (
      codeAt >= 0 &&
      new RegExp(
        `(?:^|[:：|｜])\\s*(?:\\d{3})?${escapedCollege}\\s*(?:[|｜]\\s*)?$`,
      ).test(row.slice(0, codeAt)) &&
      new RegExp(`^[\\s|:：-]*${escapedProgramme}(?=$|[\\s|｜])`).test(
        row.slice(codeAt + majorCode!.length),
      )
    );
  };
  const programme = input.sources.find(
    (source) =>
      (!input.programSourceId || source.id === input.programSourceId) &&
      source.kind === "official_page" &&
      sourceHasSchoolIdentity(source, input.institutionName, input.sources) &&
      safeSourceYear(source) === evidenceYear &&
      !admissionEvidence(source, String(evidenceYear), input.programName)
        .excluded &&
      withoutSchoolLinks(source.excerpt)
        .split(/[。；;\n]/)
        .some((row) => {
          return boundRow(row);
        }),
  );
  if (!programme) return undefined;
  const sameDomain = domain(programme.url);
  if (!sameDomain) return undefined;
  const row = withoutSchoolLinks(programme.excerpt)
    .split(/[。；;\n]/)
    .find(boundRow)!;
  const pages = schoolPages(input.sources, input.institutionName, sameDomain);
  const policiesForYear = (year: number) => {
    const policies: { source: WebSource; quote: string; campuses: string[] }[] =
      [];
    for (const source of pages) {
      if (
        safeSourceYear(source) !== year ||
        admissionEvidence(source, String(year)).excluded
      )
        continue;
      const body = withoutSchoolLinks(source.excerpt);
      const pieces = [...body.matchAll(/[^。；;\n]+/g)];
      // Check the local policy marker before scanning the full document's population scope.
      // Ordinary directory rows must not cause one whole-body scan per paragraph and programme.
      const generic = pieces.flatMap((piece) => {
        const marker =
          /(?:培养|教学|就读|学习|所在|办学)(?:所在)?(?:地点|校区|地址)/.exec(
            piece[0],
          );
        if (!marker) return [];
        if (restrictedPolicy(source, body, piece.index! + piece[0].length))
          return [];
        const before = piece[0]
          .slice(0, marker.index)
          .replaceAll(input.institutionName, "");
        if (/(?:大学|科学院|研究院|研究所)/.test(before)) return [];
        const faculty = new RegExp(
          `(?:^|[、，,：:\\s])${escapedCollege}(?=$|[\\s，,、]|硕士|研究生|的|所在|培养|就读|教学|学习|办学)`,
        ).test(before);
        const codedProgramme =
          before.includes(majorCode!) &&
          new RegExp(
            `${majorCode}\\s*${escapedProgramme}(?=$|[\\s，,、]|硕士|研究生|专业|的)`,
          ).test(before);
        if (!faculty && !codedProgramme) return [];
        const names = campuses(
          piece[0].slice(marker.index + marker[0].length),
          input.institutionName,
        );
        if (!names.length) return [];
        return [{ source, quote: piece[0].trim(), campuses: names }];
      });
      if (generic.length) {
        policies.push(...generic);
        continue;
      }
      const named = pieces.flatMap((piece) => {
        const group = /录取在([^。；\n:：]{2,150})的新生所在校区/.exec(
          piece[0],
        )?.[1];
        if (!group) return [];
        if (restrictedPolicy(source, body, piece.index! + piece[0].length))
          return [];
        const colleges = group
          .replaceAll(input.institutionName, "")
          .split(/[、，,]/)
          .map((value) => value.trim());
        if (
          !colleges.length ||
          colleges.some((value) => !/^[\p{Script=Han}]{2,30}学院$/u.test(value))
        )
          return [];
        return [{ piece, colleges }];
      });
      const exact = named.filter((item) => item.colleges.includes(collegeName));
      if (exact.length) {
        for (const item of exact)
          policies.push({
            source,
            quote: item.piece[0].trim(),
            campuses: campuses(item.piece[0], input.institutionName),
          });
        continue;
      }
      for (const piece of pieces) {
        if (!/其他学院的新生所在校区(?:为|是)/.test(piece[0])) continue;
        if (restrictedPolicy(source, body, piece.index! + piece[0].length))
          continue;
        const preceding = named.filter(
          (item) =>
            item.piece.index! < piece.index! &&
            piece.index! - item.piece.index! < 800,
        );
        if (
          !preceding.length ||
          preceding.some((item) => item.colleges.includes(collegeName))
        )
          continue;
        const first = preceding[0].piece.index!;
        const quote = body.slice(first, piece.index! + piece[0].length).trim();
        if (quote.length > 1800) continue;
        policies.push({
          source,
          quote,
          campuses: campuses(piece[0], input.institutionName),
        });
      }
    }
    return policies;
  };
  const policies = policiesForYear(evidenceYear);
  if (!policies.length || policies.some((policy) => !policy.campuses.length))
    return undefined;
  const expectedCampuses = [
    ...new Set(policies.flatMap((policy) => policy.campuses)),
  ];
  if (evidenceYear !== Number(input.targetYear)) {
    const current = policiesForYear(Number(input.targetYear));
    const currentCampuses = [
      ...new Set(current.flatMap((policy) => policy.campuses)),
    ];
    if (
      current.length &&
      (current.some((policy) => !policy.campuses.length) ||
        JSON.stringify(currentCampuses.sort()) !==
          JSON.stringify([...expectedCampuses].sort()))
    )
      return undefined;
    // A current coded row that changes the owning faculty invalidates the old
    // faculty-policy binding. It cannot be silently treated as the same route.
    if (
      pages.some(
        (source) =>
          safeSourceYear(source) === Number(input.targetYear) &&
          withoutSchoolLinks(source.excerpt)
            .split(/[。；;\n]/)
            .some(
              (piece) =>
                new RegExp(
                  `${majorCode}\\s*${escapedProgramme}(?=$|[\\s|｜])`,
                ).test(piece) && !boundRow(piece),
            ),
      )
    )
      return undefined;
  }
  const geography = new Map<string, { city: string; passage: Passage }[]>();
  const currentGeography = new Map<
    string,
    { city: string; passage: Passage }[]
  >();
  for (const source of pages) {
    const geographyYear = safeSourceYear(source);
    if (
      geographyYear === undefined &&
      explicitAdmissionsYears(withoutSchoolLinks(source.excerpt)).length
    )
      continue;
    const currentOnly =
      evidenceYear !== Number(input.targetYear) &&
      geographyYear === Number(input.targetYear);
    if (
      geographyYear !== undefined &&
      geographyYear !== evidenceYear &&
      !currentOnly
    )
      continue;
    const destination = currentOnly ? currentGeography : geography;
    // Geography quotes remain contiguous in the fetched body. Navigation removal
    // can join separate blocks and must never produce an invented quotation.
    const body = source.excerpt;
    for (const match of body.matchAll(
      /(?:地址|校址|地理位置|位于)\s*[:：]?\s*(?:[\p{Script=Han}]{2,10}省)?([\p{Script=Han}]{2,10})市/gu,
    )) {
      // Keep an address on its actual line; if its campus label is on the
      // immediately preceding nonempty line, include that line. A fixed window
      // could swallow an unrelated multi-campus policy just above a short footer.
      let start = body.lastIndexOf("\n", match.index!) + 1;
      const nextLine = body.indexOf("\n", match.index!);
      const end = nextLine < 0 ? body.length : nextLine;
      if (!campuses(body.slice(start, end), input.institutionName).length) {
        const preceding = /[^\n]+\n\s*$/.exec(body.slice(0, start));
        if (
          preceding &&
          start - preceding.index <= 180 &&
          campuses(preceding[0], input.institutionName).length
        )
          start = preceding.index;
      }
      const quote = body.slice(start, end).trim();
      if (quote.length > 600) continue;
      if (!withoutSchoolLinks(body).includes(quote)) continue;
      const present = campuses(quote, input.institutionName);
      const relevant = expectedCampuses.filter((campus) =>
        quote.includes(campus),
      );
      // Only one campus and one city are allowed in a geography passage.
      const cities = [
        ...new Set(
          [...quote.matchAll(/([\p{Script=Han}]{2,10})市/gu)].map((value) =>
            value[1].replace(/^.*省/, ""),
          ),
        ),
      ];
      if (
        present.length !== 1 ||
        relevant.length !== 1 ||
        cities.length !== 1 ||
        cities[0] !== match[1]
      )
        continue;
      const values = destination.get(relevant[0]) ?? [];
      values.push({
        city: match[1],
        passage: { sourceId: source.id, quote, role: "campus_city" },
      });
      destination.set(relevant[0], values);
    }
  }
  const mappings = expectedCampuses.map((campus) => geography.get(campus));
  if (
    mappings.some(
      (values) =>
        !values?.length ||
        new Set(values.map((value) => value.city)).size !== 1,
    )
  )
    return undefined;
  const cities = new Set(
    mappings.flatMap((values) => values!.map((value) => value.city)),
  );
  if (cities.size !== 1) return undefined;
  if (
    [...currentGeography.values()].some((values) =>
      values.some((value) => !cities.has(value.city)),
    )
  )
    return undefined;
  const supportingEvidence: Passage[] = [
    { sourceId: programme.id, quote: row.trim(), role: "program_college" },
    ...policies.map((policy) => ({
      sourceId: policy.source.id,
      quote: policy.quote,
      role: "campus_policy" as const,
    })),
    ...mappings.map((values) => values![0].passage),
  ];
  if (
    supportingEvidence.some(
      (passage) =>
        !input.sources
          .find((source) => source.id === passage.sourceId)
          ?.excerpt.includes(passage.quote),
    )
  )
    return undefined;
  return {
    city: [...cities][0],
    year: evidenceYear,
    quote: policies[0].quote,
    sourceId: policies[0].source.id,
    supportingEvidence,
  };
}

/** Current arrangements override conflicting history; coherent earlier cohorts remain labelled references. */
export function deriveCampusLocation(
  input: CampusLocationInput,
): LocationEvidence | undefined {
  const targetYear = Number(input.targetYear);
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2099)
    return undefined;
  for (const year of [targetYear, ...historicalReferenceYears(targetYear)]) {
    const location = deriveCampusLocationForYear(input, year);
    if (location) return location;
  }
  return undefined;
}
