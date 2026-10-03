import { inflateRawSync } from "node:zlib";
import { read, utils } from "xlsx";

type Limits = {
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxEntries: number;
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
  maxCellChars: number;
  maxChars: number;
};

// Check actual expansion, not just ZIP-declared sizes, before the parser sees XLSX.
// There is no extraction to disk and no resolution of workbook external links.
function checkZip(data: Buffer, limits: Limits) {
  let end = -1;
  for (
    let index = data.length - 22;
    index >= Math.max(0, data.length - 65557);
    index--
  ) {
    if (data.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6))
    throw new Error("WEB_SPREADSHEET_INVALID");
  const entries = data.readUInt16LE(end + 10);
  const offset = data.readUInt32LE(end + 16);
  if (!entries || entries > limits.maxEntries || offset > end)
    throw new Error("WEB_SPREADSHEET_TOO_LARGE");
  let cursor = offset;
  let total = 0;
  let hasWorkbook = false;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("WEB_SPREADSHEET_INVALID");
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const compressed = data.readUInt32LE(cursor + 20);
    const expanded = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const local = data.readUInt32LE(cursor + 42);
    const name = data
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      local + 30 > offset ||
      data.readUInt32LE(local) !== 0x04034b50
    )
      throw new Error("WEB_SPREADSHEET_INVALID");
    if (
      expanded > limits.maxEntryBytes ||
      total + expanded > limits.maxExpandedBytes
    )
      throw new Error("WEB_SPREADSHEET_TOO_LARGE");
    const start =
      local +
      30 +
      data.readUInt16LE(local + 26) +
      data.readUInt16LE(local + 28);
    if (start + compressed > offset) throw new Error("WEB_SPREADSHEET_INVALID");
    const bytes = data.subarray(start, start + compressed);
    const content =
      method === 0
        ? bytes
        : inflateRawSync(bytes, { maxOutputLength: limits.maxEntryBytes });
    if (content.length !== expanded) throw new Error("WEB_SPREADSHEET_INVALID");
    total += content.length;
    if (total > limits.maxExpandedBytes)
      throw new Error("WEB_SPREADSHEET_TOO_LARGE");
    hasWorkbook ||= name === "xl/workbook.xml";
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!hasWorkbook) throw new Error("WEB_SPREADSHEET_INVALID");
}

process.once("message", (message: { bytes: Uint8Array; limits: Limits }) => {
  try {
    const bytes = Buffer.from(message.bytes);
    const limits = message.limits;
    if (bytes.subarray(0, 4).toString("hex") === "504b0304")
      checkZip(bytes, limits);
    const names = read(bytes, {
      type: "buffer",
      bookSheets: true,
      bookVBA: false,
    }).SheetNames;
    if (names.length > limits.maxSheets)
      throw new Error("WEB_SPREADSHEET_TOO_LARGE");
    const workbook = read(bytes, {
      type: "buffer",
      dense: true,
      sheetRows: limits.maxRows + 1,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellNF: false,
      cellText: false,
      bookVBA: false,
      bookDeps: false,
    });
    const lines: string[] = [];
    let length = 0;
    const append = (line: string) => {
      length += line.length + 1;
      if (length > limits.maxChars)
        throw new Error("WEB_SPREADSHEET_TOO_LARGE");
      lines.push(line);
    };
    for (const name of names) {
      const sheet = workbook.Sheets[name];
      if (!sheet?.["!ref"]) continue;
      const full = utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
      if (full.e.r >= limits.maxRows || full.e.c >= limits.maxColumns)
        throw new Error("WEB_SPREADSHEET_TOO_LARGE");
      append(`工作表：${name}`);
      const rows = sheet["!data"] as
        | ({ v?: unknown } | undefined)[][]
        | undefined;
      const cellAt = (row: number, column: number) =>
        rows?.[row]?.[column] ??
        sheet[utils.encode_cell({ r: row, c: column })];
      const mergedColleges = new Map<string, string>();
      const merges = sheet["!merges"] ?? [];
      if (merges.length > limits.maxRows * limits.maxColumns)
        throw new Error("WEB_SPREADSHEET_TOO_LARGE");
      for (const merge of merges) {
        if (
          ![merge.s.r, merge.s.c, merge.e.r, merge.e.c].every(
            (value) => Number.isInteger(value) && value >= 0,
          ) ||
          merge.s.r > merge.e.r ||
          merge.s.c > merge.e.c
        )
          throw new Error("WEB_SPREADSHEET_INVALID");
        if (merge.e.r >= limits.maxRows || merge.e.c >= limits.maxColumns)
          throw new Error("WEB_SPREADSHEET_TOO_LARGE");
        if (merge.s.c !== merge.e.c || merge.s.r === merge.e.r) continue;
        const value = cellAt(merge.s.r, merge.s.c)?.v;
        if (typeof value !== "string") continue;
        const college = value.trim();
        if (!/^(?:\d{3})?[\p{Script=Han}A-Za-z]{2,40}学院$/u.test(college))
          continue;
        if (college.length > limits.maxCellChars)
          throw new Error("WEB_SPREADSHEET_TOO_LARGE");
        for (let row = merge.s.r; row <= merge.e.r; row++) {
          const key = `${row}:${merge.s.c}`;
          if (mergedColleges.has(key))
            throw new Error("WEB_SPREADSHEET_INVALID");
          const covered = cellAt(row, merge.s.c)?.v;
          if (
            covered !== undefined &&
            covered !== null &&
            String(covered).trim() &&
            String(covered).trim() !== college
          )
            throw new Error("WEB_SPREADSHEET_INVALID");
          mergedColleges.set(key, college);
        }
        append(
          `纵向合并学院单元格：${utils.encode_range(merge)}（原值：${college}；仅该范围共用）`,
        );
      }
      for (let row = full.s.r; row <= full.e.r; row++) {
        const cells: string[] = [];
        for (let column = full.s.c; column <= full.e.c; column++) {
          const cell = cellAt(row, column);
          const value = mergedColleges.get(`${row}:${column}`) ?? cell?.v;
          const text =
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
              ? String(value)
                  .replace(/[\r\n\t|]+/g, " ")
                  .trim()
              : "";
          if (text.length > limits.maxCellChars)
            throw new Error("WEB_SPREADSHEET_TOO_LARGE");
          cells.push(text);
        }
        if (cells.some(Boolean)) append(`第${row + 1}行：${cells.join(" | ")}`);
      }
    }
    const text = lines.join("\n");
    if (!text.trim()) throw new Error("WEB_SPREADSHEET_EMPTY");
    process.send?.({ text });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "WEB_SPREADSHEET_INVALID";
    process.send?.({
      error: ["WEB_SPREADSHEET_TOO_LARGE", "WEB_SPREADSHEET_EMPTY"].includes(
        reason,
      )
        ? reason
        : "WEB_SPREADSHEET_INVALID",
    });
  }
});
