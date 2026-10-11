/** Recognise a published admissions-summary layout, not arbitrary numeric prose.
 * Required score columns are read from the right; optional recommendation/transfer
 * cells are never filled with zero. All quotes remain literal source substrings. */
export function pdfAdmissionRows(text: string) {
  const headerEnd = text.indexOf("国家线");
  if (headerEnd < 0) return [];
  const header = text.slice(0, headerEnd + 3);
  if (
    !/硕士研究生报考上线录取情况/.test(text) ||
    !/学院专业学位类型学习方式一志愿报考人数一志愿上线人数一志愿上复试线人数录取人数其中推免录取人数其中一志愿录取人数其中调剂录取人数录取最高分录取最低分录取平均分国家线/.test(
      header.replace(/\s/g, ""),
    )
  )
    return [];
  const mixed = /统计包含[^。]{0,30}士兵计划/.test(text);
  const rows: {
    quote: string;
    header: string;
    code: string;
    college?: string;
    collegeQuote?: string;
    minimum: number;
    admitted?: number;
    applicants?: number;
    recommended?: number;
    population: string;
  }[] = [];
  let college: string | undefined, collegeQuote: string | undefined;
  for (const line of text.slice(headerEnd + 3).split("\n")) {
    const heading = line.match(
      /^\s*\d{3}([^\d\n]+?(?:学院|中心|研究院))(?=\s|$)/,
    );
    if (heading) {
      college = heading[1].trim();
      collegeQuote = heading[0].trim();
    }
    const match = line.match(
      /(?:^|\s)(\d{6})[^\n]*?(?:学术学位|专业学位)\s+(?:非)?全日制\s+([\d.\s]+)$/,
    );
    if (!match) continue;
    const values = match[2].trim().split(/\s+/).map(Number);
    if (
      values.length < 8 ||
      values.length > 11 ||
      values.some((n) => !Number.isFinite(n) || n < 0)
    )
      continue;
    const [maximum, minimum, average, national] = values.slice(-4);
    if (
      maximum > 500 ||
      minimum < 100 ||
      minimum > average ||
      average > maximum ||
      national < 100 ||
      national > 500
    )
      continue;
    const counts = values.slice(0, -4);
    // Prefix must contain a coherent, explicitly populated application/eligibility
    // block. Missing eligibility cells (seen in other departments) are ambiguous.
    const coherent =
      counts.length >= 5 &&
      counts[0] >= counts[1] &&
      counts[1] >= counts[2] &&
      counts.slice(4).every((n) => n <= counts[3]) &&
      counts.slice(4).reduce((a, b) => a + b, 0) === counts[3];
    rows.push({
      quote: line,
      header,
      code: match[1],
      college,
      collegeQuote,
      minimum,
      ...(coherent ? { admitted: counts[3], applicants: counts[0] } : {}),
      ...(coherent && counts.length === 7 ? { recommended: counts[4] } : {}),
      population: mixed
        ? "官方汇总含士兵计划；不等于普通统考门槛，不计算目标分差"
        : "官方公布录取汇总；非复试门槛",
    });
  }
  return rows;
}
