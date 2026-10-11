import { researchDocumentPriority } from "./research-document-priority.ts";
import { createResearchReader } from "./research-reader.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import {
  researchSchoolPriorities,
  type ResearchSchoolPreferences,
} from "./research-school-priority.ts";
import { createHash } from "node:crypto";
import type {
  ResearchEvidenceGap,
  ResearchReadAttempt,
} from "../../shared/research-coverage.ts";
import {
  historicalReferenceYears,
  researchYearPriority,
  explicitAdmissionsYears,
} from "../../shared/research-years.ts";
import {
  academicDomain,
  researchAttachments,
  researchLocationLinks,
} from "./research-pages.ts";
import { sourceHasSchoolIdentity } from "./research-school.ts";
import { normalizeAttachedEvidence } from "./research-provenance.ts";
import { isSchoolPage } from "./research-evidence.ts";
import {
  webPageText,
  readSourceMetadata,
  type WebSource,
  type WebReadResult,
  type createWebAnswerModule,
} from "./web.ts";

export const publicEvidenceId = (url: string) =>
  `evidence-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;

/** Rebase reused citations as a graph; account-private recommendations are never imported. */
export function reusableResearchSources(
  sources: readonly WebSource[],
  now = Date.now(),
): WebSource[] {
  const ids = new Map(
    sources.map((source) => [
      source.id,
      source.library ? source.id : publicEvidenceId(source.url),
    ]),
  );
  const byUrl = new Map<string, WebSource>();
  for (const value of sources) {
    if (value.kind !== "official_page" || !value.excerpt.trim()) continue;
    const source = structuredClone(value);
    source.id = source.library ? source.id : publicEvidenceId(source.url);
    if (!source.library) {
      const retrieved = Date.parse(source.retrievedAt);
      source.library = {
        status:
          Number.isFinite(retrieved) && now - retrieved < 86400000
            ? "fresh"
            : "stale",
        storedAt: source.retrievedAt,
        expiresAt: new Date(
          Number.isFinite(retrieved) ? retrieved + 86400000 : 0,
        ).toISOString(),
        version: 1,
      };
    }
    if (source.parentSourceId)
      source.parentSourceId =
        ids.get(source.parentSourceId) ??
        (source.provenance
          ? publicEvidenceId(source.provenance.parentUrl)
          : source.parentSourceId);
    if (source.provenance)
      source.provenance.parentSourceId = source.parentSourceId!;
    const old = byUrl.get(source.url);
    if (!old || source.retrievedAt > old.retrievedAt)
      byUrl.set(source.url, source);
  }
  return [...byUrl.values()];
}

const terms = {
  program: "硕士 招生专业目录",
  exams: "硕士 初试科目 招生专业目录",
  location: "研究生 培养地点 校区",
  tuition: "研究生 学费 收费标准",
  eligibility: "硕士 招生章程 报考条件",
  curriculum: "硕士 培养方案 研究方向",
};
const titles = {
  program: /硕士|招生|专业目录/,
  exams: /初试|考试科目|专业目录/,
  location: /校区|地址|培养地点|学校概况/,
  tuition: /学费|收费/,
  eligibility: /章程|报考|招生简章/,
  curriculum: /培养方案|研究方向|专业介绍/,
};
const priority = { high: 0, normal: 1, low: 2 };
const cancelled = (error: unknown) =>
  error instanceof Error &&
  (error.name === "AbortError" ||
    /DATA_DELETED|CANCELLED|ABORTED/i.test(
      String((error as Error & { code?: string }).code ?? ""),
    ));

/** A bounded continuation works on saved gaps and actual links, without a new model school lottery. */
export async function repairResearchEvidence(input: {
  subjectId: string;
  signal?: AbortSignal;
  gaps: readonly ResearchEvidenceGap[];
  sources: readonly WebSource[];
  targetYear: string;
  preferences?: ResearchSchoolPreferences;
  web: ReturnType<typeof createWebAnswerModule>;
  maxRequests: number;
  maxReads: number;
  lookupKeys?: readonly string[];
  attempts?: readonly ResearchReadAttempt[];
  readPage: (url: string) => Promise<WebReadResult & { retrievedAt?: string }>;
  onSource?: (source: WebSource) => void | Promise<void>;
  onAttempt?: (attempt: ResearchReadAttempt) => void;
  onProgress: (detail: string) => Promise<void>;
  now?: () => number;
  /** Two-stage runs never follow search results outside the selected school. */
  allowedDomains?: readonly string[];
  priorityDocuments?: boolean;
  discoveryReadLimit?: number;
  queryForGap?: (gap: ResearchEvidenceGap) => string[];
  stop?: (sources: readonly WebSource[]) => boolean;
  needsEvidence?: (
    gap: ResearchEvidenceGap,
    sources: readonly WebSource[],
  ) => boolean;
}) {
  const matchesTitle = (field: ResearchEvidenceGap["field"], title: string) =>
    input.priorityDocuments
      ? researchDocumentPriority(title) > 0
      : titles[field].test(title);
  const documentOrder = (
    a: { title: string; url: string },
    b: { title: string; url: string },
    program?: string,
  ) =>
    researchDocumentPriority(b.title, program) -
      researchDocumentPriority(a.title, program) ||
    researchYearPriority(
      explicitAdmissionsYears(b.title)[0],
      input.targetYear,
    ) -
      researchYearPriority(
        explicitAdmissionsYears(a.title)[0],
        input.targetYear,
      ) ||
    a.url.localeCompare(b.url);
  const scheduler = createResearchReader(
    (url) => input.readPage(url),
    input.signal,
  );
  try {
    const sources = structuredClone([...input.sources]);
    const attempts: ResearchReadAttempt[] = [];
    const keys = new Set(input.lookupKeys ?? []);
    const touched = new Set<string>();
    const schoolPriority = researchSchoolPriorities(input.preferences);
    const schools = new Map<string, ResearchEvidenceGap[]>();
    for (const gap of [...input.gaps].sort(
      (a, b) =>
        schoolPriority.priority(a.institutionName) -
          schoolPriority.priority(b.institutionName) ||
        priority[a.priority] - priority[b.priority] ||
        a.institutionName.localeCompare(b.institutionName, "zh-CN") ||
        a.id.localeCompare(b.id),
    )) {
      const list = schools.get(gap.institutionName) ?? [];
      list.push(gap);
      schools.set(gap.institutionName, list);
    }
    const gaps: ResearchEvidenceGap[] = [];
    for (const level of schoolPriority.active ? [0, 1, 2, 3] : [3]) {
      const lists = [...schools]
        .filter(([name]) => schoolPriority.priority(name) === level)
        .map(([, list]) => list);
      while (lists.some((list) => list.length))
        for (const list of lists) if (list.length) gaps.push(list.shift()!);
    }
    const maxRequests = Math.min(
      B.searches,
      Math.max(0, Math.floor(input.maxRequests)),
    );
    const maxReads = Math.min(B.reads, Math.max(0, Math.floor(input.maxReads)));
    const limitations: string[] = [];
    let requestCount = 0,
      readCount = 0,
      searched = false;
    const readsPerGap = Math.min(
      B.schoolReads,
      Math.max(1, Math.floor(maxReads / Math.max(1, schools.size))),
    );
    let gapReadLimit = maxReads;
    const discoveryReads = new Map<string, number>();
    const discoveryLimit = Math.min(
      B.schoolDiscoveryReads,
      Math.max(0, input.discoveryReadLimit ?? B.schoolDiscoveryReads),
    );
    const at = () => new Date(input.now?.() ?? Date.now()).toISOString();
    const mayRead = (url: string) => {
      if (touched.has(url)) return false;
      const prior = [...(input.attempts ?? [])]
        .reverse()
        .find((item) => item.url === url);
      return (
        !prior ||
        prior.status !== "failed" ||
        (input.now?.() ?? Date.now()) - Date.parse(prior.attemptedAt) >=
          5 * 60_000
      );
    };
    const unread = (url: string) =>
      mayRead(url) &&
      !sources.some(
        (source) =>
          source.url === url &&
          isSchoolPage(source) &&
          source.library?.status !== "stale",
      );
    const prefetched = new Map<
      string,
      PromiseSettledResult<Awaited<ReturnType<typeof input.readPage>>>
    >();
    async function wave(
      candidates: { url: string; title: string; parent?: WebSource }[],
      gap: ResearchEvidenceGap,
    ) {
      let discoverySlots = Math.max(
        0,
        discoveryLimit - (discoveryReads.get(gap.institutionName) ?? 0),
      );
      const values = candidates
        .filter(
          (c) =>
            !input.priorityDocuments ||
            researchDocumentPriority(c.title, gap.programName) >= -10,
        )
        .sort((a, b) =>
          input.priorityDocuments ? documentOrder(a, b, gap.programName) : 0,
        )
        .filter(
          (c) =>
            !input.allowedDomains ||
            input.allowedDomains.includes(academicDomain(c.url)),
        )
        .filter((c) => unread(c.url))
        .filter(
          (c) =>
            !input.priorityDocuments ||
            researchDocumentPriority(c.title, gap.programName) > 0 ||
            discoverySlots-- > 0,
        )
        .filter((c, i, all) => all.findIndex((a) => a.url === c.url) === i)
        .slice(0, Math.min(B.concurrency, gapReadLimit - readCount));
      if (input.stop) {
        for (const candidate of values) {
          if (input.stop(sources)) break;
          await read(candidate, gap);
        }
        return;
      }
      const results = await Promise.allSettled(
        values.map((c) => scheduler.read(c.url)),
      );
      for (let i = 0; i < values.length; i++) {
        prefetched.set(values[i].url, results[i]);
        await read(values[i], gap);
      }
    }
    async function read(
      candidate: { url: string; title: string; parent?: WebSource },
      gap: ResearchEvidenceGap,
    ) {
      if (
        readCount >= gapReadLimit ||
        !mayRead(candidate.url) ||
        input.stop?.(sources) ||
        (input.allowedDomains &&
          !input.allowedDomains.includes(academicDomain(candidate.url)))
      )
        return;
      const existing = sources.find(
        (source) => source.url === candidate.url && isSchoolPage(source),
      );
      if (
        existing &&
        !(
          existing as WebSource & { library?: { status: string } }
        ).library?.status?.includes("stale")
      )
        return;
      if (input.priorityDocuments) {
        const priority = researchDocumentPriority(
          candidate.title,
          gap.programName,
        );
        if (priority < -10) return;
        if (priority <= 0) {
          const count = discoveryReads.get(gap.institutionName) ?? 0;
          if (count >= discoveryLimit) return;
          discoveryReads.set(gap.institutionName, count + 1);
        }
      }
      touched.add(candidate.url);
      readCount++;
      await input.onProgress(
        `正在补查${gap.institutionName}${gap.programName ?? ""}：${gap.nextAction}`,
      );
      try {
        const outcome = prefetched.get(candidate.url);
        prefetched.delete(candidate.url);
        if (outcome?.status === "rejected") throw outcome.reason;
        const result =
          outcome?.status === "fulfilled"
            ? outcome.value
            : await scheduler.read(candidate.url);
        const body = /^(?:application\/pdf|application\/vnd\.)/i.test(
          result.contentType,
        )
          ? result.text.trim()
          : webPageText(result.text);
        if (!body || body.length > 200000)
          throw Object.assign(new Error("Empty or oversized evidence"), {
            code: body ? "WEB_TEXT_TOO_LARGE" : "WEB_EMPTY",
          });
        let source: WebSource = {
          id: existing?.id ?? publicEvidenceId(candidate.url),
          url: candidate.url,
          ...readSourceMetadata(result, candidate.url),
          title: candidate.title,
          kind: "official_page",
          verified: false,
          excerpt: body,
          retrievedAt: result.retrievedAt ?? at(),
          ...(candidate.parent ? { parentSourceId: candidate.parent.id } : {}),
        };
        if (candidate.parent)
          source = normalizeAttachedEvidence(source, candidate.parent, body);
        if (/html/i.test(result.contentType))
          source.documentLinks = [
            ...researchAttachments(source, result.text, {
              targetYear: input.targetYear,
              maxLinks: B.attachmentLinks,
            }),
            ...researchLocationLinks(source, result.text),
          ]
            .slice(0, B.attachments)
            .map(({ url, title }) => ({ url, title }));
        if (existing) sources.splice(sources.indexOf(existing), 1, source);
        else sources.push(source);
        await input.onSource?.(source);
        const attempt: ResearchReadAttempt = {
          url: candidate.url,
          status: "success",
          attemptedAt: at(),
        };
        attempts.push(attempt);
        input.onAttempt?.(attempt);
      } catch (error) {
        if (cancelled(error)) throw error;
        const attempt: ResearchReadAttempt = {
          url: candidate.url,
          status: "failed",
          reason: String(
            (error as { code?: string })?.code ?? "WEB_UNAVAILABLE",
          ),
          tlsCode: (error as { tlsCode?: string })?.tlsCode,
          attemptedAt: at(),
        };
        attempts.push(attempt);
        input.onAttempt?.(attempt);
        limitations.push(
          `${gap.institutionName}的${gap.programName ?? "专业目录"}补查未完成，已保存读取失败与原有证据。`,
        );
      }
    }
    // Start one known gap link per school together. Each result is persisted through
    // the usual read path, so concurrency does not bypass budgets or attempt logs.
    const opening = [...schools.keys()]
      .flatMap((school) => {
        const gap = gaps.find(
          (value) =>
            value.institutionName === school &&
            (!input.needsEvidence || input.needsEvidence(value, sources)),
        );
        if (!gap) return [];
        const parent = sources.find(
          (source) =>
            isSchoolPage(source) &&
            sourceHasSchoolIdentity(source, school) &&
            source.documentLinks?.some(
              (link) =>
                matchesTitle(gap.field, link.title) &&
                unread(link.url) &&
                academicDomain(link.url) === academicDomain(source.url),
            ),
        );
        const link = parent?.documentLinks
          ?.slice()
          .sort((a, b) =>
            input.priorityDocuments ? documentOrder(a, b, gap.programName) : 0,
          )
          .find(
            (link) =>
              matchesTitle(gap.field, link.title) &&
              unread(link.url) &&
              academicDomain(link.url) === academicDomain(parent.url),
          );
        return parent && link ? [{ candidate: { ...link, parent }, gap }] : [];
      })
      .filter(
        ({ gap }) =>
          !schoolPriority.active ||
          schoolPriority.priority(gap.institutionName) ===
            schoolPriority.priority(gaps[0]?.institutionName),
      )
      .slice(0, Math.min(B.concurrency, maxReads));
    if (opening.length > 1) {
      const results = await Promise.allSettled(
        opening.map(({ candidate }) => scheduler.read(candidate.url)),
      );
      for (const [index, { candidate, gap }] of opening.entries()) {
        prefetched.set(candidate.url, results[index]);
        await read(candidate, gap);
      }
    }
    const openingAllowance = new Set(
      opening.length > 1 ? opening.map(({ gap }) => gap.id) : [],
    );
    for (const gap of gaps) {
      if (input.stop?.(sources)) break;
      if (readCount >= maxReads) break;
      if (input.needsEvidence && !input.needsEvidence(gap, sources)) continue;
      gapReadLimit = Math.min(
        maxReads,
        readCount + readsPerGap - Number(openingAllowance.delete(gap.id)),
      );
      const owned = sources.filter((source) =>
        sourceHasSchoolIdentity(source, gap.institutionName),
      );
      const domains = input.allowedDomains
        ? [...input.allowedDomains]
        : [...new Set(owned.map((source) => academicDomain(source.url)))].slice(
            0,
            2,
          );
      const links = owned
        .filter(isSchoolPage)
        .flatMap((parent) =>
          (parent.documentLinks ?? []).map((link) => ({ ...link, parent })),
        )
        .filter(
          (link) =>
            matchesTitle(gap.field, link.title) &&
            domains.includes(academicDomain(link.url)) &&
            unread(link.url),
        )
        .sort(
          (a, b) =>
            (input.priorityDocuments
              ? researchDocumentPriority(b.title, gap.programName) -
                researchDocumentPriority(a.title, gap.programName)
              : 0) ||
            researchYearPriority(
              explicitAdmissionsYears(b.title)[0],
              input.targetYear,
            ) -
              researchYearPriority(
                explicitAdmissionsYears(a.title)[0],
                input.targetYear,
              ) ||
            a.url.localeCompare(b.url),
        );
      await wave(links, gap);
      if (
        readCount >= gapReadLimit ||
        requestCount >= maxRequests ||
        (input.needsEvidence && !input.needsEvidence(gap, sources))
      )
        continue;
      const years =
        gap.purpose === "target_year_check"
          ? [Number(input.targetYear)]
          : [
              ...historicalReferenceYears(input.targetYear),
              Number(input.targetYear),
            ];
      const queries =
        input.queryForGap?.(gap) ??
        years
          .filter(Number.isInteger)
          .map((year) =>
            [
              gap.institutionName,
              gap.collegeName,
              gap.majorCode,
              gap.programName,
              `${year}年`,
              gap.studyMode === "full_time"
                ? "全日制"
                : gap.studyMode === "part_time"
                  ? "非全日制"
                  : "",
              terms[gap.field],
            ]
              .filter(Boolean)
              .join(" "),
          );
      const query = queries.find(
        (question) =>
          !keys.has(
            createHash("sha256")
              .update(JSON.stringify([question, domains]))
              .digest("hex"),
          ),
      );
      if (!query) continue;
      keys.add(
        createHash("sha256")
          .update(JSON.stringify([query, domains]))
          .digest("hex"),
      );
      requestCount++;
      await input.onProgress(
        `按已记录缺项检索${gap.institutionName}${gap.programName ?? "硕士专业目录"}`,
      );
      const found = await input.web.answer(
        { subjectId: input.subjectId, question: query, search: true },
        {
          sourcesOnly: true,
          upgradeAcademicHttp: true,
          search: {
            count: 10,
            ...(domains.length ? { includeDomains: domains } : {}),
          },
        },
      );
      searched ||= found.searched;
      if (found.reason)
        limitations.push(`${gap.institutionName}定向检索：${found.reason}`);
      const candidates = found.sources
        .filter(
          (source) =>
            !input.priorityDocuments ||
            researchDocumentPriority(source.title, gap.programName) >= -10,
        )
        .sort((a, b) =>
          input.priorityDocuments ? documentOrder(a, b, gap.programName) : 0,
        )
        .filter((source) =>
          sourceHasSchoolIdentity(source, gap.institutionName),
        )
        .slice(0, B.concurrency);
      await wave(candidates, gap);
      for (const value of candidates) {
        if (
          readCount >= gapReadLimit ||
          (input.needsEvidence && !input.needsEvidence(gap, sources))
        )
          break;
        if (!sources.some((source) => source.url === value.url))
          sources.push({ ...value, id: publicEvidenceId(value.url) });
        await read({ url: value.url, title: value.title }, gap);
        const parent = sources.find(
          (source) => source.url === value.url && isSchoolPage(source),
        );
        if (parent)
          for (const child of parent.documentLinks
            ?.filter(
              (link) => matchesTitle(gap.field, link.title) && unread(link.url),
            )
            .sort((a, b) =>
              input.priorityDocuments
                ? documentOrder(a, b, gap.programName)
                : 0,
            )
            .slice(0, B.concurrency) ?? [])
            await read({ ...child, parent }, gap);
      }
    }
    return {
      sources,
      attempts,
      lookupKeys: [...keys].slice(-1000),
      limitations,
      requestCount,
      readCount,
      searched,
    };
  } finally {
    scheduler.dispose();
  }
}
