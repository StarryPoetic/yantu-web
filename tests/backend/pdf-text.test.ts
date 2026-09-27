import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { pdfText, pdfTextLimits } from "../../server/explanation/pdf-text.ts";
import { createHttpsReader } from "../../server/explanation/web.ts";

function document(
  text = "Research University master programme 040101",
  pages = 1,
  script = false,
  padding = 0,
) {
  const ids = Array.from({ length: pages }, (_, index) => 4 + index * 2);
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${script ? '/OpenAction << /S /JavaScript /JS (while\\(true\\){}; app.launchURL\\(\\"https://127.0.0.1/private\\"\\)) >>' : ""} >>`,
    `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const chinese = /[^\x00-\x7f]/.test(text);
  if (chinese)
    objects[2] = `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${4 + pages * 2} 0 R] >>`;
  const literal = chinese
    ? `<${[...text].map((char) => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>`
    : `(${text.replace(/[()\\]/g, "\\$&")})`;
  const stream = `BT /F1 12 Tf 50 700 Td ${literal} Tj ET`;
  for (const id of ids)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  if (chinese)
    objects.push(
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor ${5 + pages * 2} 0 R /DW 1000 >>`,
      "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>",
    );
  if (padding)
    objects.push(
      `<< /Length ${padding} >>\nstream\n${" ".repeat(padding)}\nendstream`,
    );
  let body = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test("server PDF text uses local parser assets and does not execute PDF JavaScript or open document links", async () => {
  assert.equal(
    await pdfText(document(undefined, 1, true)),
    "Research University master programme 040101",
  );
});

test("Chinese CID fonts resolve bundled CMaps locally and preserve actual programme names and codes", async () => {
  const text = "示范大学 硕士研究生 教育学原理 040101";
  assert.equal(await pdfText(document(text)), text);
});

test("PDF parsing rejects invalid, empty, oversized, too many pages and excessive extracted text", async () => {
  for (const [bytes, options, code] of [
    [Buffer.from("not a PDF"), {}, "WEB_PDF_INVALID"],
    [Buffer.from("%PDF-1.7\ninvalid"), {}, "WEB_PDF_INVALID"],
    [Buffer.alloc(pdfTextLimits.maxBytes + 1), {}, "WEB_TOO_LARGE"],
    [document(""), {}, "WEB_PDF_EMPTY"],
    [
      document("master programme", 2),
      { maxPages: 1 },
      "WEB_PDF_TOO_MANY_PAGES",
    ],
    [document("long content"), { maxChars: 5 }, "WEB_PDF_TEXT_TOO_LARGE"],
  ] as const)
    await assert.rejects(pdfText(bytes, options), { code });
  for (const value of [NaN, -1, 0, Infinity, 100000])
    await assert.rejects(pdfText(document(), { timeoutMs: value }), {
      code: "WEB_PDF_LIMIT_INVALID",
    });
});

test("PDF worker deadline terminates parsing and a later valid request can still succeed", async () => {
  await assert.rejects(pdfText(document(), { timeoutMs: 1 }), {
    code: "WEB_PDF_TIMEOUT",
  });
  assert.match(await pdfText(document()), /master programme/);
});

test("PDF child ignores inherited Node preload options and service process configuration", async () => {
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--require=/must-not-be-loaded-by-pdf-parser.cjs";
  try {
    assert.match(await pdfText(document()), /master programme/);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});

test("PDF HTTPS opt-in preserves MIME, DNS pinning, redirects and byte limits; default and spoofed types are rejected", async () => {
  let bytes = document(),
    contentType = "application/pdf",
    statusCode = 200;
  let declaredLength = "",
    calls = 0;
  let captured: Record<string, unknown> = {};
  const request = ((
    _url: unknown,
    options: Record<string, unknown>,
    callback: (response: unknown) => void,
  ) => {
    calls++;
    captured = options;
    const response = Object.assign(new EventEmitter(), {
      statusCode,
      headers: {
        "content-type": contentType,
        ...(declaredLength ? { "content-length": declaredLength } : {}),
      },
      destroy() {},
    });
    queueMicrotask(() => {
      callback(response);
      response.emit("data", bytes);
      response.emit("end");
    });
    return Object.assign(new EventEmitter(), { destroy() {}, end() {} });
  }) as never;
  const reader = createHttpsReader({
    request,
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
  });
  const url = "https://yz.example.edu.cn/programme.pdf",
    options = { allowedHosts: ["yz.example.edu.cn"] };
  await assert.rejects(reader(url, options), {
    code: "WEB_FORMAT_UNSUPPORTED",
  });
  assert.match(
    (await reader(url, { ...options, allowPdf: true })).text,
    /040101/,
  );
  assert.equal(captured.servername, "yz.example.edu.cn");
  assert.equal(captured.agent, false);
  const pinned = captured.lookup as (
    host: string,
    options: { all: boolean },
    done: (err: unknown, addresses: unknown) => void,
  ) => void;
  pinned("yz.example.edu.cn", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
  });
  statusCode = 302;
  await assert.rejects(reader(url, { ...options, allowPdf: true }), {
    code: "WEB_REDIRECT_BLOCKED",
  });
  statusCode = 200;
  declaredLength = "1000001";
  await assert.rejects(reader(url, { ...options, allowPdf: true }), {
    code: "WEB_TOO_LARGE",
  });
  declaredLength = "";
  await assert.rejects(
    reader(url, { ...options, allowPdf: true, maxBytes: 50 }),
    { code: "WEB_TOO_LARGE" },
  );
  contentType = "text/html";
  await assert.rejects(reader(url, options), {
    code: "WEB_FORMAT_UNSUPPORTED",
  });
  contentType = "application/pdf";
  bytes = Buffer.from("html is not PDF");
  await assert.rejects(reader(url, { ...options, allowPdf: true }), {
    code: "WEB_PDF_INVALID",
  });
  const before = calls;
  const privateReader = createHttpsReader({
    request,
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
  });
  await assert.rejects(privateReader(url, { ...options, allowPdf: true }), {
    code: "WEB_ADDRESS_BLOCKED",
  });
  assert.equal(calls, before);
});

test("research PDF budget accepts a multi-megabyte programme without increasing HTML limits and stops oversized streams", async () => {
  let bytes = document("Chinese graduate programme 040101", 1, false, 2000000);
  let contentType = "application/pdf",
    declaredLength = "",
    sent = 0,
    destroyed = false;
  const reader = createHttpsReader({
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    request: ((
      _url: unknown,
      _options: unknown,
      callback: (value: unknown) => void,
    ) => {
      sent = 0;
      destroyed = false;
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: {
          "content-type": contentType,
          ...(declaredLength ? { "content-length": declaredLength } : {}),
        },
        destroy() {
          destroyed = true;
        },
      });
      queueMicrotask(() => {
        callback(response);
        for (
          let start = 0;
          start < bytes.length && !destroyed;
          start += 32768
        ) {
          const chunk = bytes.subarray(start, start + 32768);
          sent += chunk.length;
          response.emit("data", chunk);
        }
        if (!destroyed) response.emit("end");
      });
      return Object.assign(new EventEmitter(), {
        end() {},
        destroy() {
          destroyed = true;
        },
      });
    }) as never,
  });
  const url = "https://yz.example.edu.cn/programme.pdf",
    options = {
      allowedHosts: ["yz.example.edu.cn"],
      allowPdf: true,
      maxPdfBytes: 5000000,
    };
  assert.ok(bytes.length > 1000000);
  assert.match((await reader(url, options)).text, /graduate programme 040101/);
  contentType = "text/html";
  await assert.rejects(reader(url, options), { code: "WEB_TOO_LARGE" });
  assert.equal(destroyed, true);
  assert.ok(sent > 512000 && sent <= 512000 + 32768);
  contentType = "application/pdf";
  declaredLength = "5000001";
  await assert.rejects(reader(url, options), { code: "WEB_TOO_LARGE" });
  assert.equal(sent, 0);
  declaredLength = "";
  bytes = Buffer.alloc(5100000, 32);
  await assert.rejects(reader(url, options), { code: "WEB_TOO_LARGE" });
  assert.equal(destroyed, true);
  assert.ok(sent > 5000000 && sent <= 5000000 + 32768);
  for (const maxPdfBytes of [NaN, -1, 0, 5000001])
    await assert.rejects(reader(url, { ...options, maxPdfBytes }), {
      code: "WEB_PDF_LIMIT_INVALID",
    });
});
