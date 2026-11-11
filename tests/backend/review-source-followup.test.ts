import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  checkSavedReviewChain,
  currentPath,
  predecessorPath,
  verifyReviewChain,
} from "../../scripts/verify-hdu-review-chain.ts";
import { buildEvidenceAudit } from "../../scripts/research-evidence-audit.ts";
import { spreadsheetText } from "../../server/explanation/spreadsheet-text.ts";
import { webPageText } from "../../server/explanation/web.ts";
import type { CatalogImport } from "../../server/catalog/types.ts";

const file = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url));
const json = (path: string) => JSON.parse(file(path).toString("utf8"));
const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const directory = "tests/fixtures/source-review-20261111/";
const capture = json(`${directory}capture.json`);

test("bounded public captures retain actual bytes, acquisition time and no human approval", () => {
  assert.equal(capture.paidCalls, 0);
  assert.equal(capture.humanReviewed, false);
  assert.equal(capture.records.length, 3);
  for (const record of capture.records) {
    assert.equal(record.status, 200);
    assert.equal(record.error, null);
    assert.match(record.attemptedAt, /^2026-11-11T/);
    assert.ok(record.file.startsWith(directory));
    assert.equal(file(record.file).length, record.bytes);
    assert.equal(hash(file(record.file)), record.sha256);
    assert.ok(
      ["grs.hdu.edu.cn", "yz.chsi.com.cn"].includes(
        new URL(record.url).hostname,
      ),
    );
  }
});

test("the real XLS reproduces the archived text behind all 26 claims without silently changing them", async () => {
  const bytes = file(`${directory}hdu-catalogue.xls`);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "d0cf11e0a1b11ae1");
  const text = await spreadsheetText(bytes);
  assert.equal(
    text,
    file(`${directory}hdu-catalogue.txt`).toString("utf8").trimEnd(),
  );
  assert.equal(
    hash(text),
    "9bdebebdca78d73290e31962f62580b6a67c136bed862b4b1cdfc92273a92e8d",
  );
  const current = json(currentPath) as CatalogImport;
  assert.equal(current.programs.flatMap((p) => p.claims).length, 26);
  for (const program of current.programs)
    for (const claim of program.claims) {
      const match = claim.locator.match(
        /; UTF16-offset=(\d+); quote=([\s\S]*)$/,
      )!;
      assert.ok(match);
      assert.equal(
        text.slice(Number(match[1]), Number(match[1]) + match[2].length),
        match[2],
      );
      assert.equal(claim.availability, "unverified");
      assert.equal(claim.reviewedBy, null);
    }
  const parent = file(`${directory}hdu-parent.html`).toString("utf8");
  const xls = capture.records.find((record: { file: string }) =>
    record.file.endsWith(".xls"),
  );
  assert.ok(parent.includes(new URL(xls.url).pathname));
  assert.match(webPageText(parent), /2027年硕士研究生招生专业目录/);
});

test("captured 2025 national numbers complete only the national segment, never school applicability", () => {
  const national = json(
    "tests/fixtures/research-a-national-lines.json",
  ).pages.find(
    (page: { source: { id: string } }) => page.source.id === "a-national-2025",
  );
  const bytes = file(`${directory}national-line-2025.html`);
  assert.equal(national.rawHtml, bytes.toString("utf8"));
  assert.equal(national.rawHtmlSha256, hash(bytes));
  assert.equal(national.source.excerpt, webPageText(national.rawHtml));
  assert.equal(national.source.verified, false);
  const audit = buildEvidenceAudit();
  assert.equal(audit.supplementalCorpus.bodies, 7);
  assert.equal(audit.reviewProgress.currentConfirmable, 12);
  assert.equal(audit.reviewProgress.currentPending, 63);
  assert.equal(audit.reviewProgress.humanReviewed, 0);
  for (const chain of audit.nationalLineChains.filter(
    (item) => item.year === 2025,
  )) {
    assert.equal(chain.status, "incomplete_chain");
    assert.equal(chain.derivedFactId, null);
    if (chain.schoolName !== "杭州电子科技大学")
      assert.ok(
        chain.missing.some((reason) => reason.includes("执行A区国家线")),
      );
    else
      assert.ok(
        chain.missing.some((reason) => reason.includes("专业代码身份")),
      );
    assert.ok(!chain.missing.some((reason) => reason.includes("数值原文")));
    const row = chain.evidence.find((item) => item.role === "nationalRow")!;
    assert.match(
      row.source.quote,
      /工学\[08\] \| 其他学科专业 \| 260 \| 34 \| 51 \| 250/,
    );
    assert.ok(
      chain.evidence.some(
        (item) => item.role === "region" && item.source.quote.includes("浙江"),
      ),
    );
    assert.ok(chain.evidence.some((item) => item.role === "exceptions"));
  }
});

test("the exact Git predecessor followed by the draft works only as an unpublished memory sequence", () => {
  assert.deepEqual(checkSavedReviewChain(), {
    revisions: 4,
    releases: 0,
    activeCatalogVersion: null,
    persisted: false,
    humanReviewed: false,
  });
  const predecessor = json(predecessorPath) as CatalogImport;
  const current = json(currentPath) as CatalogImport;
  const original = structuredClone([predecessor, current]);
  verifyReviewChain(predecessor, current);
  assert.deepEqual([predecessor, current], original);
  assert.throws(() => verifyReviewChain(current, predecessor), /predecessor/);
  const unlinked = structuredClone(current);
  unlinked.programs[0].supersedesRevisionId = null;
  assert.throws(() => verifyReviewChain(predecessor, unlinked), /predecessor/);
  const promoted = structuredClone(current);
  promoted.programs[0].claims[0].reviewedBy = "automated-check";
  assert.throws(
    () => verifyReviewChain(predecessor, promoted),
    /cannot approve/,
  );
});
