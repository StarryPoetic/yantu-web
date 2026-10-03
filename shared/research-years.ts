/** Comparable admission policies come from the three years before the target intake. */
export function historicalReferenceYears(
  targetYear: string | number,
): number[] {
  const year = Number(targetYear);
  return /^20\d{2}$/.test(String(targetYear)) &&
    Number.isInteger(year) &&
    year >= 2003
    ? [year - 1, year - 2, year - 3]
    : [];
}

/** Explicit admission/teaching-policy years, never publication timestamps or copyright dates. */
export function explicitAdmissionsYears(text: string): number[] {
  const body = text.replace(
    /(?:发布时间|发布于|更新于|更新时间|Copyright|版权所有|©)[^\n。；;]*/gi,
    "",
  );
  return [
    ...new Set(
      [
        ...body.matchAll(
          /(?:^|[^0-9])(20\d{2})(?:\s*(?:年(?:度)?|级)\s*[^0-9。；;！？\n]{0,48}?|\s*(?=硕士|研究生|招生|招收|报考|初试|复试|专业目录|考试|培养|学费|收费))(?:(?:硕士|研究生)[^0-9。；;！？\n]{0,28}?)?(?:招生|招收|报考|专业(?:招生)?目录|初试(?:科目(?:表|目录)?|考试(?:安排|大纲|说明)?)|复试(?:科目(?:表|目录)?|考试(?:安排|大纲|说明)?)|入学考试|考试(?:科目(?:表|目录)?|安排|大纲|说明)|培养(?:方案|政策|地点|校区)|学费|收费)/g,
        ),
      ]
        .filter((match) => {
          const afterYear = match[0].slice(
            match[0].indexOf(match[1]) + match[1].length,
          );
          const policyAt = afterYear.search(
            /招生|招收|报考|专业(?:招生)?目录|初试|复试|入学考试|考试|培养|学费|收费/,
          );
          const context =
            policyAt < 0 ? afterYear : afterYear.slice(0, policyAt);
          // A student's entry/graduation year is an eligibility fact, not the policy's intake year.
          return !/毕业|(?:取得|获得)[^。；;\n]{0,12}(?:学历|学位|毕业证)|^\s*级\s*[^。；;\n]{0,12}(?:本科|专科|大专|高职)/.test(
            context,
          );
        })
        .map((match) => Number(match[1])),
    ),
  ];
}

/** Body-only classification; ambiguous mixed years and undated sources stay unknown. */
export function officialSourceYear(source: {
  kind: string;
  excerpt: string;
}): number | undefined {
  if (source.kind !== "official_page") return undefined;
  const years = explicitAdmissionsYears(source.excerpt);
  return years.length === 1 ? years[0] : undefined;
}

/** Discovery sorting only; a title year never becomes factual evidence. */
export function researchYearPriority(
  year: number | undefined,
  targetYear: string | number,
): number {
  const references = historicalReferenceYears(targetYear);
  if (!references.length) return 0;
  const index = year === undefined ? -1 : references.indexOf(year);
  return index >= 0
    ? 100 - index * 10
    : year === Number(targetYear)
      ? 50
      : year === undefined
        ? 30
        : year < Number(targetYear)
          ? 10
          : 0;
}

/** Explicit target-year changes must remain visible even while history is compared first. */
export function isTargetYearChange(
  text: string,
  targetYear: string | number,
): boolean {
  return (
    explicitAdmissionsYears(text).includes(Number(targetYear)) &&
    /停招|暂停(?:招收|招生)|停止(?:招收|招生)|不再(?:招收|招生)|撤销|变更|调整|更正/.test(
      text,
    )
  );
}
