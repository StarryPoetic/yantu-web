import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { utils, write } from "xlsx";
import {
  spreadsheetText,
  spreadsheetTextLimits,
} from "../../server/explanation/spreadsheet-text.ts";
import { createHttpsReader } from "../../server/explanation/web.ts";

function document(
  bookType: "xls" | "xlsx" = "xlsx",
  rows: unknown[][] = [
    ["2027年硕士招生专业目录"],
    ["专业代码", "专业名称", "英语", "数学"],
    ["080200", "机械工程", "201英语（一）", "301数学（一）"],
    ["085500", "机械", "204英语（二）", "302数学（二）"],
  ],
) {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet(rows);
  sheet["E3"] = { t: "n", v: 7, f: 'WEBSERVICE("https://127.0.0.1/private")' };
  sheet["!ref"] = "A1:E4";
  sheet["A3"].l = { Target: "https://127.0.0.1/private" };
  utils.book_append_sheet(workbook, sheet, "机械工程学院");
  return Buffer.from(
    write(workbook, { type: "buffer", bookType, compression: true }),
  );
}

test("official XLS and XLSX preserve programme rows and subject codes without executing formulas or hyperlinks", async () => {
  for (const format of ["xls", "xlsx"] as const) {
    const text = await spreadsheetText(document(format));
    assert.match(text, /工作表：机械工程学院/);
    assert.match(
      text,
      /第3行：080200 \| 机械工程 \| 201英语（一） \| 301数学（一） \| 7/,
    );
    assert.match(text, /085500 \| 机械 \| 204英语（二） \| 302数学（二）/);
    assert.doesNotMatch(text, /WEBSERVICE|127\.0\.0\.1/);
  }
});

function mergedDocument(
  bookType: "xls" | "xlsx",
  options: {
    noMerges?: boolean;
    conflict?: boolean;
    oversizedMerge?: boolean;
  } = {},
) {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["2027年硕士研究生招生专业目录"],
    ["学院", "专业", "学位类型"],
    ["010机械工程学院", "080200机械工程", "学术学位"],
    [
      options.conflict ? "020电气工程学院" : undefined,
      "085500机械",
      "专业学位",
    ],
    [undefined, "085800能源动力", "专业学位"],
    [undefined, "081000信息与通信工程", "学术学位"],
    [undefined, "085400电子信息", "专业学位"],
    ["030电气工程学院", undefined, "080800电气工程"],
    [undefined, undefined, "085801电气工程"],
  ]);
  if (!options.noMerges)
    sheet["!merges"] = [
      {
        s: { r: 2, c: 0 },
        e: {
          r: options.oversizedMerge ? spreadsheetTextLimits.maxRows : 3,
          c: 0,
        },
      },
      { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
      { s: { r: 7, c: 0 }, e: { r: 8, c: 1 } },
    ];
  utils.book_append_sheet(workbook, sheet, "目录");
  return Buffer.from(
    write(workbook, { type: "buffer", bookType, compression: true }),
  );
}

test("only declared single-column vertical faculty merges preserve the real anchor in covered programme rows", async () => {
  for (const format of ["xls", "xlsx"] as const) {
    const text = await spreadsheetText(mergedDocument(format));
    assert.match(
      text,
      /纵向合并学院单元格：A3:A4（原值：010机械工程学院；仅该范围共用）/,
    );
    assert.match(text, /第4行：010机械工程学院 \| 085500机械 \| 专业学位/);
    assert.match(
      text,
      /第5行： \| 085800能源动力/,
      "blank outside the merge is not carried forward",
    );
    assert.match(
      text,
      /第7行： \| 085400电子信息/,
      "a merge without an actual anchor does not guess a faculty",
    );
    assert.match(
      text,
      /第9行： \|  \| 085801电气工程/,
      "a multi-column merge does not assign faculty columns",
    );
    const unmerged = await spreadsheetText(
      mergedDocument(format, { noMerges: true }),
    );
    assert.match(unmerged, /第4行： \| 085500机械/);
    assert.doesNotMatch(unmerged, /纵向合并学院单元格/);
  }
});

test("faculty merge ranges, conflicts and expanded output obey the original extraction budgets", async () => {
  await assert.rejects(
    spreadsheetText(mergedDocument("xlsx", { oversizedMerge: true })),
    { code: "WEB_SPREADSHEET_TOO_LARGE" },
  );
  await assert.rejects(
    spreadsheetText(mergedDocument("xlsx", { conflict: true })),
    { code: "WEB_SPREADSHEET_INVALID" },
  );
  const unmerged = await spreadsheetText(
    mergedDocument("xlsx", { noMerges: true }),
  );
  await assert.rejects(
    spreadsheetText(mergedDocument("xlsx"), { maxChars: unmerged.length + 1 }),
    { code: "WEB_SPREADSHEET_TOO_LARGE" },
  );
});

test("spreadsheet byte, sheet, row, column, cell and text budgets fail closed rather than silently truncating", async () => {
  await assert.rejects(
    spreadsheetText(Buffer.alloc(spreadsheetTextLimits.maxBytes + 1)),
    { code: "WEB_TOO_LARGE" },
  );
  await assert.rejects(spreadsheetText(Buffer.from("not a workbook")), {
    code: "WEB_SPREADSHEET_INVALID",
  });
  await assert.rejects(spreadsheetText(document(), { maxRows: 2 }), {
    code: "WEB_SPREADSHEET_TOO_LARGE",
  });
  await assert.rejects(spreadsheetText(document(), { maxColumns: 2 }), {
    code: "WEB_SPREADSHEET_TOO_LARGE",
  });
  await assert.rejects(spreadsheetText(document(), { maxChars: 10 }), {
    code: "WEB_SPREADSHEET_TOO_LARGE",
  });
  await assert.rejects(spreadsheetText(document(), { maxCellChars: 3 }), {
    code: "WEB_SPREADSHEET_TOO_LARGE",
  });
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["机械"]]), "甲");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["机械"]]), "乙");
  await assert.rejects(
    spreadsheetText(write(workbook, { type: "buffer", bookType: "xlsx" }), {
      maxSheets: 1,
    }),
    { code: "WEB_SPREADSHEET_TOO_LARGE" },
  );
  for (const value of [NaN, -1, 0, Infinity, 5001])
    await assert.rejects(spreadsheetText(document(), { timeoutMs: value }), {
      code: "WEB_SPREADSHEET_LIMIT_INVALID",
    });
});

test("spreadsheet ZIP preflight rejects declared expansion bombs and malformed containers", async () => {
  const bytes = document();
  const central = bytes.indexOf(Buffer.from("504b0102", "hex"));
  assert.ok(central > 0);
  bytes.writeUInt32LE(spreadsheetTextLimits.maxEntryBytes + 1, central + 24);
  await assert.rejects(spreadsheetText(bytes), {
    code: "WEB_SPREADSHEET_TOO_LARGE",
  });
  await assert.rejects(
    spreadsheetText(Buffer.from("504b030400000000", "hex")),
    { code: "WEB_SPREADSHEET_INVALID" },
  );
});

test("spreadsheet child ignores Node preloads and timeout isolates a failed parser from a later request", async () => {
  await assert.rejects(spreadsheetText(document(), { timeoutMs: 1 }), {
    code: "WEB_SPREADSHEET_TIMEOUT",
  });
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS =
    "--require=/must-not-be-loaded-by-spreadsheet-parser.cjs";
  try {
    assert.match(await spreadsheetText(document()), /机械工程/);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});

test("spreadsheet HTTPS opt-in keeps default MIME, byte, redirect and spoof checks and accepts school XLS octet-stream", async () => {
  let bytes = document("xls"),
    contentType = "application/vnd.ms-excel",
    statusCode = 200;
  const reader = createHttpsReader({
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    request: ((
      _url: unknown,
      _options: unknown,
      callback: (response: unknown) => void,
    ) => {
      const response = Object.assign(new EventEmitter(), {
        statusCode,
        headers: { "content-type": contentType },
        destroy() {},
      });
      queueMicrotask(() => {
        callback(response);
        response.emit("data", bytes);
        response.emit("end");
      });
      return Object.assign(new EventEmitter(), { destroy() {}, end() {} });
    }) as never,
  });
  const url = "https://grs.example.edu.cn/catalog.xls",
    options = { allowedHosts: ["grs.example.edu.cn"] };
  await assert.rejects(reader(url, options), {
    code: "WEB_FORMAT_UNSUPPORTED",
  });
  assert.match(
    (await reader(url, { ...options, allowSpreadsheet: true })).text,
    /080200/,
  );
  contentType = "application/octet-stream";
  assert.match(
    (await reader(url, { ...options, allowSpreadsheet: true })).text,
    /085500/,
  );
  await assert.rejects(
    reader("https://grs.example.edu.cn/unrelated.bin", {
      ...options,
      allowSpreadsheet: true,
    }),
    { code: "WEB_FORMAT_UNSUPPORTED" },
  );
  await assert.rejects(
    reader(url, {
      ...options,
      allowSpreadsheet: true,
      maxSpreadsheetBytes: 10,
    }),
    { code: "WEB_TOO_LARGE" },
  );
  statusCode = 302;
  await assert.rejects(reader(url, { ...options, allowSpreadsheet: true }), {
    code: "WEB_REDIRECT_BLOCKED",
  });
  statusCode = 200;
  contentType = "text/html";
  await assert.rejects(reader(url, { ...options, allowSpreadsheet: true }), {
    code: "WEB_FORMAT_UNSUPPORTED",
  });
  contentType = "application/vnd.ms-excel";
  bytes = Buffer.from("this is not an XLS file");
  await assert.rejects(reader(url, { ...options, allowSpreadsheet: true }), {
    code: "WEB_SPREADSHEET_INVALID",
  });
});
