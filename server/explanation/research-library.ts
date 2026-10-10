import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Store } from "../store.ts";
import { getDisciplineCatalog } from "../disciplines/index.ts";
import {
  explicitAdmissionsYears,
  historicalReferenceYears,
  isTargetYearChange,
  researchYearPriority,
} from "../../shared/research-years.ts";
import { validatedSourceProvenance } from "./research-provenance.ts";
import {
  sourceHasSchoolIdentity,
  withoutSchoolLinks,
} from "./research-school.ts";
import { safeSourceYear } from "./research-years.ts";
import type { WebSource } from "./web.ts";
import { registrableDomain, HTTP_RETRIEVAL_NOTE } from "./web.ts";

export interface ResearchReadAttempt {
  url: string;
  status: "success" | "failed";
  reason?: string;
  tlsCode?: string;
  attemptedAt: string;
}

export interface ResearchEvidenceLibrary {
  load(input: {
    disciplineCodes: string[];
    targetYear: string;
    schoolNames?: string[];
    maxSources?: number;
  }): WebSource[];
  save(source: WebSource): void;
  recordAttempt(attempt: ResearchReadAttempt): void;
  attempts(urls?: string[]): ResearchReadAttempt[];
}

export interface ResearchLibraryOptions {
  now?: () => number;
  /** Exact additional public official hosts; *.edu.cn is accepted by default. */
  allowedHosts?: string[];
  targetTtlMs?: number;
  historicalTtlMs?: number;
  undatedTtlMs?: number;
}

const day = 24 * 60 * 60 * 1000;
const catalog = getDisciplineCatalog().items;
const disciplineCodes = new Set(catalog.map((item) => item.code));
const forbiddenQuery =
  /^(?:q|query|search(?:[_-]?(?:text|word|keyword))?|keyword|searchword|wd|question|profile|user(?:name|id)?|subject(?:id)?|account(?:id)?|password|email|phone|token|j?session(?:id)?|sid|uid|openid|ticket|auth|secret|api[_-]?key|key|csrf|sign(?:ature)?|access[_-]?token|refresh[_-]?token)$/i;
const diagnosticCodes = new Set([
  "WEB_REDIRECT_CROSS_SITE",
  "WEB_REDIRECT_LIMIT",
  "WEB_DECODE_FAILED",
  "WEB_TLS_CERT",
  "WEB_CONNECTION_RESET",
  "WEB_CONNECTION_REFUSED",
  "WEB_DNS_INVALID_RESPONSE",
  "WEB_DNS_TIMEOUT",
  "WEB_DNS_UNAVAILABLE",
  "HTTP_410",
  "HTTP_4XX",
  "HTTP_5XX",

  "TIMEOUT",
  "DNS_FAILED",
  "READ_FAILED",
  "EMPTY_BODY",
  "INVALID_URL",
  "UNSUPPORTED_FORMAT",
  "PARSE_FAILED",
  "NETWORK_ERROR",
  "BUDGET_EXHAUSTED",
  "WEB_EMPTY",
  "WEB_TEXT_TOO_LARGE",
  "WEB_TOO_LARGE",
  "WEB_TIMEOUT",
  "WEB_ADDRESS_BLOCKED",
  "WEB_HOST_BLOCKED",
  "WEB_HOST_NOT_ALLOWED",
  "WEB_URL_INVALID",
  "WEB_REDIRECT_BLOCKED",
  "WEB_FORMAT_UNSUPPORTED",
  "WEB_BUDGET_EXHAUSTED",
  "WEB_UNAVAILABLE",
  "WEB_PDF_TIMEOUT",
  "WEB_PDF_PARSE_FAILED",
  "WEB_SPREADSHEET_PARSE_FAILED",
  "HTTP_403",
  "HTTP_404",
  "HTTP_408",
  "HTTP_429",
  "HTTP_500",
  "HTTP_502",
  "HTTP_503",
  "HTTP_504",
]);

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceId(url: string) {
  return `library-${hash(url).slice(0, 24)}`;
}

function ttl(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function bodyCodes(body: string): string[] {
  const codes = new Set<string>();
  for (const match of body.matchAll(/(?:^|[^0-9])(\d{4})(?:\d{2})?(?!\d)/g)) {
    if (disciplineCodes.has(match[1])) codes.add(match[1]);
  }
  for (const item of catalog) {
    if (
      [item.name, ...item.aliases].some(
        (name) => name.length >= 2 && body.includes(name),
      )
    )
      codes.add(item.code);
  }
  return [...codes];
}

function bodySchools(source: WebSource): string[] {
  const body = withoutSchoolLinks(source.excerpt);
  const names = [
    ...body.matchAll(
      /(?:^|[\s:：©Ⓒ|｜。；])([\p{Script=Han}]{1,30}?(?:大学|科学院|研究院|研究所|学院))(?=$|\s|\d|年|硕士|博士|研究生|招生|培养|专业|学科|版权所有|学院|研究院|研究所|中心)/gu,
    ),
  ].map((match) => match[1]);
  const inherited = validatedSourceProvenance(source)?.institutionName;
  if (inherited) names.push(inherited);
  return [...new Set(names)].filter((name) =>
    sourceHasSchoolIdentity(source, name),
  );
}

interface SourceRow {
  url: string;
  payload: string;
  content_hash: string;
  retrieved_at: string;
  stored_at: string;
  version: number;
  evidence_year: number | null;
}

/** Stores only public transport evidence. Policy verification remains the downstream evidence gate. */
export function createResearchEvidenceLibrary(
  store: Store,
  options: ResearchLibraryOptions = {},
): ResearchEvidenceLibrary {
  const now = options.now ?? Date.now;
  const allowed = new Set(
    (options.allowedHosts ?? []).map((host) => host.trim().toLowerCase()),
  );
  const targetTtl = ttl(options.targetTtlMs, day);
  const historicalTtl = ttl(options.historicalTtlMs, 30 * day);
  const undatedTtl = ttl(options.undatedTtlMs, 7 * day);
  const db = store.db;

  function publicUrl(value: string): string | undefined {
    try {
      if (typeof value !== "string" || value.length > 4000) return undefined;
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && host.endsWith(".edu.cn"))) ||
        url.username ||
        url.password ||
        url.port ||
        isIP(host) ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(
          host,
        ) ||
        !(host.endsWith(".edu.cn") || allowed.has(host)) ||
        /;jsessionid=/i.test(url.pathname) ||
        [...url.searchParams.keys()].some((key) => forbiddenQuery.test(key))
      )
        return undefined;
      url.hash = "";
      return url.href;
    } catch {
      return undefined;
    }
  }

  function timestamp(value: string): string | undefined {
    const time = Date.parse(value);
    return Number.isFinite(time) && time <= now() + 5 * 60 * 1000
      ? new Date(time).toISOString()
      : undefined;
  }

  function publicSource(source: WebSource): WebSource | undefined {
    const url = publicUrl(source.url);
    const retrievedAt = timestamp(source.retrievedAt);
    if (
      source.kind !== "official_page" ||
      source.verified !== false ||
      !url ||
      !retrievedAt ||
      typeof source.excerpt !== "string" ||
      !source.excerpt.trim() ||
      source.excerpt.length > 1000000 ||
      /^(?:\s*<(?:!doctype|html|head|body)[^>]*>\s*)*(?:\s*<[^>]*>\s*)*(?:40[34]\s*(?:Forbidden|Not Found)|Access Denied|Error\s*50[0234]|验证码|访问被拒绝|访问过于频繁|请完成验证)/i.test(
        source.excerpt,
      )
    )
      return undefined;
    const result: WebSource = {
      id: sourceId(url),
      title:
        typeof source.title === "string"
          ? source.title.slice(0, 500)
          : "官网公开资料",
      url,
      retrievedAt,
      excerpt: source.excerpt,
      kind: "official_page",
      verified: false,
    };
    const finalUrl = source.finalUrl && publicUrl(source.finalUrl);
    if (
      finalUrl &&
      registrableDomain(new URL(finalUrl).hostname) ===
        registrableDomain(new URL(url).hostname)
    )
      result.finalUrl = finalUrl;
    result.transport =
      source.transport === "http" ||
      url.startsWith("http:") ||
      finalUrl?.startsWith("http:")
        ? "http"
        : "https";
    if (result.transport === "http") result.retrievalNote = HTTP_RETRIEVAL_NOTE;
    const links = (source.documentLinks ?? []).slice(0, 60).flatMap((link) => {
      const linkUrl = publicUrl(link.url);
      return linkUrl
        ? [
            {
              url: linkUrl,
              title:
                typeof link.title === "string"
                  ? link.title.slice(0, 500)
                  : "附件",
            },
          ]
        : [];
    });
    if (links.length) result.documentLinks = links;
    const context = validatedSourceProvenance(source);
    const parentUrl = context && publicUrl(context.parentUrl);
    if (context && parentUrl && parentUrl !== url) {
      const parentSourceId = sourceId(parentUrl);
      result.parentSourceId = parentSourceId;
      result.provenance = {
        institutionName: context.institutionName,
        parentSourceId,
        parentUrl,
        linkedTitle: context.linkedTitle.slice(0, 500),
        identityExcerpt: context.identityExcerpt,
        mastersScope: context.mastersScope === true,
        ...(/^20\d{2}$/.test(context.admissionYear ?? "")
          ? { admissionYear: context.admissionYear }
          : {}),
      };
    }
    return result;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS research_public_sources (
      url TEXT PRIMARY KEY, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
      retrieved_at TEXT NOT NULL, stored_at TEXT NOT NULL, version INTEGER NOT NULL,
      evidence_year INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS research_public_disciplines (
      url TEXT NOT NULL REFERENCES research_public_sources(url) ON DELETE CASCADE,
      code TEXT NOT NULL, PRIMARY KEY(url, code)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS research_public_code_idx ON research_public_disciplines(code, url);
    CREATE TABLE IF NOT EXISTS research_public_schools (
      url TEXT NOT NULL REFERENCES research_public_sources(url) ON DELETE CASCADE,
      name TEXT NOT NULL, PRIMARY KEY(url, name)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS research_public_school_idx ON research_public_schools(name, url);
    CREATE TABLE IF NOT EXISTS research_public_read_attempts (
      id INTEGER PRIMARY KEY, url TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('success','failed')),
      reason TEXT, attempted_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS research_public_attempt_idx ON research_public_read_attempts(url, attempted_at);
  `);

  if (
    !(
      db.prepare("PRAGMA table_info(research_public_read_attempts)").all() as {
        name: string;
      }[]
    ).some((column) => column.name === "tls_code")
  )
    db.exec(
      "ALTER TABLE research_public_read_attempts ADD COLUMN tls_code TEXT",
    );

  return {
    save(source) {
      const normalized = publicSource(source);
      if (!normalized) return;
      const body = withoutSchoolLinks(normalized.excerpt);
      const codes = bodyCodes(body);
      const schools = bodySchools(normalized);
      const year = safeSourceYear(normalized) ?? null;
      const contentHash = hash(
        JSON.stringify({
          excerpt: normalized.excerpt,
          title: normalized.title,
          documentLinks: normalized.documentLinks,
          finalUrl: normalized.finalUrl,
          transport: normalized.transport,
          provenance: normalized.provenance,
        }),
      );
      store.transaction(() => {
        const previous = db
          .prepare("SELECT * FROM research_public_sources WHERE url = ?")
          .get(normalized.url) as unknown as SourceRow | undefined;
        if (
          previous &&
          (normalized.retrievedAt < previous.retrieved_at ||
            (normalized.retrievedAt === previous.retrieved_at &&
              contentHash === previous.content_hash))
        )
          return;
        const version = previous
          ? previous.version + Number(previous.content_hash !== contentHash)
          : 1;
        db.prepare(
          `INSERT INTO research_public_sources(url, payload, content_hash, retrieved_at, stored_at, version, evidence_year)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET
          payload=excluded.payload, content_hash=excluded.content_hash, retrieved_at=excluded.retrieved_at,
          stored_at=excluded.stored_at, version=excluded.version, evidence_year=excluded.evidence_year`,
        ).run(
          normalized.url,
          JSON.stringify(normalized),
          contentHash,
          normalized.retrievedAt,
          new Date(now()).toISOString(),
          version,
          year,
        );
        db.prepare("DELETE FROM research_public_disciplines WHERE url = ?").run(
          normalized.url,
        );
        db.prepare("DELETE FROM research_public_schools WHERE url = ?").run(
          normalized.url,
        );
        const insertCode = db.prepare(
          "INSERT INTO research_public_disciplines(url, code) VALUES (?, ?)",
        );
        const insertSchool = db.prepare(
          "INSERT INTO research_public_schools(url, name) VALUES (?, ?)",
        );
        for (const code of codes) insertCode.run(normalized.url, code);
        for (const school of schools) insertSchool.run(normalized.url, school);
      });
    },
    load(input) {
      const codes = [...new Set(input.disciplineCodes)]
        .filter((code) => disciplineCodes.has(code))
        .slice(0, 30);
      const schools = [...new Set(input.schoolNames ?? [])]
        .filter((name) => name.length >= 2 && name.length <= 50)
        .slice(0, 30);
      const years = historicalReferenceYears(input.targetYear);
      if (!years.length || (!codes.length && !schools.length)) return [];
      const limit =
        input.maxSources === undefined || !Number.isFinite(input.maxSources)
          ? 24
          : Math.max(0, Math.min(40, Math.floor(input.maxSources)));
      if (!limit) return [];
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (codes.length) {
        clauses.push(
          `EXISTS (SELECT 1 FROM research_public_disciplines d WHERE d.url = s.url AND d.code IN (${codes.map(() => "?").join(",")}))`,
        );
        params.push(...codes);
      }
      if (schools.length) {
        // School-wide policies remain useful, while another indexed subject is not recalled merely by school.
        clauses.push(
          `(EXISTS (SELECT 1 FROM research_public_schools n WHERE n.url = s.url AND n.name IN (${schools.map(() => "?").join(",")}))${codes.length ? " AND NOT EXISTS (SELECT 1 FROM research_public_disciplines d WHERE d.url = s.url)" : ""})`,
        );
        params.push(...schools);
      }
      const acceptableYears = [Number(input.targetYear), ...years];
      const predicate = `(${clauses.join(" OR ")}) AND (s.evidence_year IS NULL OR s.evidence_year IN (?, ?, ?, ?))`;
      const baseline = db
        .prepare(
          `SELECT s.* FROM research_public_sources s WHERE ${predicate}
          ORDER BY CASE s.evidence_year WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 ELSE 3 END,
          s.retrieved_at DESC, s.url LIMIT 200`,
        )
        .all(...params, ...acceptableYears, ...years) as unknown as SourceRow[];
      // A separate bounded window prevents a large historical inventory from hiding current changes.
      const changes = [
        "停招",
        "暂停",
        "停止招",
        "不再招",
        "撤销",
        "变更",
        "调整",
        "更正",
      ]
        .map(
          (word) =>
            `instr(json_extract(s.payload, '$.excerpt'), '${word}') > 0`,
        )
        .join(" OR ");
      const current = db
        .prepare(
          `SELECT s.* FROM research_public_sources s
        WHERE (${clauses.join(" OR ")}) AND s.evidence_year = ?
        ORDER BY CASE WHEN (${changes}) THEN 0 ELSE 1 END, s.retrieved_at DESC, s.url LIMIT 40`,
        )
        .all(...params, Number(input.targetYear)) as unknown as SourceRow[];
      const rows = [
        ...new Map(
          [...baseline, ...current].map((row) => [row.url, row]),
        ).values(),
      ];
      const sources = rows.flatMap((row) => {
        let source: WebSource;
        try {
          source = JSON.parse(row.payload) as WebSource;
        } catch {
          return [];
        }
        const normalized = publicSource(source);
        if (!normalized) return [];
        const body = withoutSchoolLinks(normalized.excerpt);
        const bodyYears = explicitAdmissionsYears(body);
        if (
          bodyYears.length &&
          !bodyYears.some((year) => acceptableYears.includes(year))
        )
          return [];
        const year = safeSourceYear(normalized);
        const expiresAt = new Date(
          Date.parse(normalized.retrievedAt) +
            (year === Number(input.targetYear)
              ? targetTtl
              : year === undefined
                ? undatedTtl
                : historicalTtl),
        ).toISOString();
        const status = Date.parse(expiresAt) <= now() ? "stale" : "fresh";
        normalized.library = {
          status,
          storedAt: row.stored_at,
          expiresAt,
          version: row.version,
        };
        normalized.retrievalNote =
          (normalized.transport === "http" ? HTTP_RETRIEVAL_NOTE : "") +
          `复用公开官网证据；原始抓取时间为${normalized.retrievedAt}。${status === "stale" ? "已超过复核期限，需重新读取官网确认；本次复用不代表新抓取。" : "仍在复核期限内；本次复用不代表新抓取。"}`;
        return [
          {
            source: normalized,
            year,
            change: isTargetYearChange(body, input.targetYear),
          },
        ];
      });
      sources.sort(
        (a, b) =>
          Number(b.change) - Number(a.change) ||
          researchYearPriority(b.year, input.targetYear) -
            researchYearPriority(a.year, input.targetYear) ||
          b.source.retrievedAt.localeCompare(a.source.retrievedAt) ||
          a.source.url.localeCompare(b.source.url),
      );
      const selected = sources.slice(0, limit);
      // Keep known current requirements visible beside the historical comparison baseline.
      const currentEvidence = sources.find(
        (item) => item.year === Number(input.targetYear),
      );
      if (limit > 1 && currentEvidence && !selected.includes(currentEvidence))
        selected[selected.length - 1] = currentEvidence;
      return selected.map((item) => item.source);
    },
    recordAttempt(attempt) {
      const url = publicUrl(attempt.url);
      const attemptedAt = timestamp(attempt.attemptedAt);
      if (
        !url ||
        !attemptedAt ||
        !["success", "failed"].includes(attempt.status)
      )
        return;
      const reason =
        attempt.status === "failed"
          ? diagnosticCodes.has(attempt.reason ?? "")
            ? attempt.reason!
            : "READ_FAILED"
          : null;
      store.transaction(() => {
        db.prepare(
          "INSERT INTO research_public_read_attempts(url, status, reason, attempted_at, tls_code) VALUES (?, ?, ?, ?, ?)",
        ).run(
          url,
          attempt.status,
          reason,
          attemptedAt,
          reason === "WEB_TLS_CERT" &&
            /^[A-Z0-9_]{1,80}$/.test(attempt.tlsCode ?? "")
            ? attempt.tlsCode!
            : null,
        );
        db.prepare(
          "DELETE FROM research_public_read_attempts WHERE url = ? AND id NOT IN (SELECT id FROM research_public_read_attempts WHERE url = ? ORDER BY attempted_at DESC, id DESC LIMIT 20)",
        ).run(url, url);
        db.exec(
          "DELETE FROM research_public_read_attempts WHERE id NOT IN (SELECT id FROM research_public_read_attempts ORDER BY attempted_at DESC, id DESC LIMIT 10000)",
        );
      });
    },
    attempts(urls) {
      const selected =
        urls === undefined
          ? undefined
          : [
              ...new Set(
                urls.flatMap((url) => {
                  const safe = publicUrl(url);
                  return safe ? [safe] : [];
                }),
              ),
            ].slice(0, 100);
      if (selected && !selected.length) return [];
      const rows = db
        .prepare(
          `SELECT url, status, reason, attempted_at, tls_code FROM research_public_read_attempts${selected ? ` WHERE url IN (${selected.map(() => "?").join(",")})` : ""} ORDER BY attempted_at DESC, id DESC LIMIT 200`,
        )
        .all(...(selected ?? [])) as unknown as {
        url: string;
        status: "success" | "failed";
        reason: string | null;
        tls_code: string | null;
        attempted_at: string;
      }[];
      return rows
        .filter((row) => publicUrl(row.url))
        .map((row) => ({
          url: row.url,
          status: row.status,
          ...(row.reason ? { reason: row.reason } : {}),
          attemptedAt: row.attempted_at,
          ...(row.tls_code ? { tlsCode: row.tls_code } : {}),
        }));
    },
  };
}
