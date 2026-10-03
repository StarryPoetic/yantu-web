import type { Discipline } from "../disciplines/types.ts";
import type {
  ResearchStudyMode,
  TuitionEvidence,
} from "../../shared/research-recommendation.ts";
import { researchReason } from "../../shared/research-status.ts";
import { deriveRecommendationConstraints } from "./research-constraints.ts";
import { compactEvidence } from "./research-evidence.ts";
import { academicDomain, researchAttachments } from "./research-pages.ts";
import { webPageText } from "./web.ts";
import type { createWebAnswerModule, WebReadResult, WebSource } from "./web.ts";

export interface ResearchFeeRecommendation {
  institutionName: string;
  programName: string;
  disciplineCode: string;
  citations?: readonly string[];
  degreeType?: "academic" | "professional";
  studyMode?: ResearchStudyMode;
  tuition?: TuitionEvidence;
}
type SearchResult = Awaited<
  ReturnType<ReturnType<typeof createWebAnswerModule>["answer"]>
>;
const caches = new WeakMap<
  object,
  Map<string, { expires: number; value: SearchResult }>
>();
const clamp = (value: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
const cancelled = (error: unknown) =>
  error instanceof Error &&
  (error.name === "AbortError" ||
    /^(?:DATA_DELETED|.*CANCELLED|.*ABORTED)$/.test(
      String((error as Error & { code?: string }).code ?? ""),
    ));
const failureReason = (error: unknown) =>
  researchReason(
    String((error as { code?: string } | undefined)?.code ?? "WEB_UNAVAILABLE"),
  );

/** Investigate actual verified recommendations after generation under the caller's shared read budget. */
export async function enrichResearchFees(input: {
  subjectId: string;
  recommendations: readonly ResearchFeeRecommendation[];
  sources: readonly WebSource[];
  disciplines: readonly Discipline[];
  targetYear: string | number;
  web: ReturnType<typeof createWebAnswerModule>;
  remainingReads: number;
  maxRequests?: number;
  readPage: (url: string) => Promise<WebReadResult & { retrievedAt?: string }>;
  onProgress: (detail: string) => Promise<void>;
  now?: () => number;
}) {
  const maxReads = clamp(input.remainingReads, 8);
  const maxRequests = clamp(input.maxRequests ?? 6, 6);
  const sources: WebSource[] = [];
  const limitations: string[] = [];
  let requestCount = 0;
  let readCount = 0;
  let searched = false;
  if (!maxReads || !maxRequests)
    return { sources, limitations, requestCount, readCount, searched };
  const now = input.now ?? Date.now;
  let cache = caches.get(input.web);
  if (!cache) {
    cache = new Map();
    caches.set(input.web, cache);
  }
  const usedIds = new Set(input.sources.map((source) => source.id));
  const attempted = new Set(
    input.sources
      .filter((source) => source.kind === "official_page")
      .map((source) => source.url),
  );
  let feeId = 0;
  function evidence(recommendation: ResearchFeeRecommendation) {
    return deriveRecommendationConstraints({
      profile: { budget: "", cities: [] },
      targetYear: input.targetYear,
      institutionName: recommendation.institutionName,
      programName: recommendation.programName,
      degreeType:
        recommendation.degreeType ??
        input.disciplines.find(
          (item) => item.code === recommendation.disciplineCode,
        )?.degreeType,
      studyMode: recommendation.studyMode,
      citations: [...(recommendation.citations ?? [])],
      sources: [...input.sources, ...sources],
      tuition: recommendation.tuition,
    }).tuition;
  }
  function schoolDomains(recommendation: ResearchFeeRecommendation) {
    return [
      ...new Set(
        input.sources
          .filter((source) => {
            try {
              return (
                source.kind === "official_page" &&
                (!recommendation.citations?.length ||
                  recommendation.citations.includes(source.id)) &&
                /^[a-z0-9.-]+\.edu\.cn$/.test(new URL(source.url).hostname) &&
                source.excerpt
                  .replace(
                    /(?:友情链接|相关链接|院校链接)[\s\S]*?(?=学院地址|学校地址|联系地址|Copyright|版权所有|$)/gi,
                    "",
                  )
                  .includes(recommendation.institutionName)
              );
            } catch {
              return false;
            }
          })
          .map((source) => academicDomain(source.url)),
      ),
    ];
  }
  function permitted(url: string, domains: string[]) {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        parsed.href.length <= 2048 &&
        domains.includes(academicDomain(parsed.href))
      );
    } catch {
      return false;
    }
  }
  const recommendations = input.recommendations
    .filter(
      (item, index, all) =>
        all.findIndex(
          (other) =>
            other.institutionName === item.institutionName &&
            other.programName === item.programName,
        ) === index,
    )
    .filter((item) => !evidence(item))
    .slice(0, 6);
  const jobs: {
    recommendation: ResearchFeeRecommendation;
    domains: string[];
    queue: { url: string; title: string }[];
  }[] = [];
  for (const recommendation of recommendations) {
    if (requestCount >= maxRequests) break;
    const domains = schoolDomains(recommendation);
    if (!domains.length) {
      limitations.push(
        `${recommendation.institutionName}${recommendation.programName}尚无可确认归属的学校官网域名，本次未据名称构造费用网址。`,
      );
      continue;
    }
    const question = `${recommendation.institutionName} ${recommendation.programName} 硕士 研究生 学费 收费标准`;
    const key = JSON.stringify([question, [...domains].sort()]);
    requestCount++;
    await input.onProgress(
      `正在补查已推荐学校学费：第 ${requestCount}/${Math.min(recommendations.length, maxRequests)} 项`,
    );
    let result: SearchResult;
    try {
      const saved = cache.get(key);
      const reused = saved && saved.expires > now();
      result = reused
        ? structuredClone(saved.value)
        : await input.web.answer(
            { subjectId: input.subjectId, question, search: true },
            {
              sourcesOnly: true,
              upgradeAcademicHttp: true,
              search: { count: 10, includeDomains: domains },
            },
          );
      if (
        !reused &&
        result.searched &&
        result.sources.length &&
        !result.reason
      ) {
        if (cache.size >= 120) cache.delete(cache.keys().next().value!);
        cache.set(key, {
          expires: now() + 15 * 60_000,
          value: structuredClone(result),
        });
      }
    } catch (error) {
      if (cancelled(error)) throw error;
      limitations.push(
        `${recommendation.institutionName}费用检索未完成：${failureReason(error)}`,
      );
      continue;
    }
    searched ||= result.searched;
    if (result.reason)
      limitations.push(
        `${recommendation.institutionName}费用检索未完成：${researchReason(result.reason)}`,
      );
    const queue = result.sources
      .filter(
        (source) =>
          permitted(source.url, domains) &&
          /学费|收费|费用/.test(`${source.title} ${source.excerpt}`) &&
          (!/本科(?:生|专业|招生)?|博士|同等学力|留学生/.test(source.title) ||
            /硕士|研究生/.test(source.title)),
      )
      .sort(
        (a, b) =>
          Number(b.title.includes(recommendation.programName)) -
          Number(a.title.includes(recommendation.programName)),
      )
      .map(({ url, title }) => ({ url, title }));
    jobs.push({ recommendation, domains, queue });
    await input.onProgress(
      `已检索${recommendation.institutionName}${recommendation.programName}，正在核对官网费用原文`,
    );
    if (
      [
        "SEARCH_BUDGET_EXHAUSTED",
        "SEARCH_DISABLED",
        "SEARCH_NOT_CONFIGURED",
        "SEARCH_PROVIDER_ERROR",
      ].includes(result.reason ?? "")
    )
      break;
  }
  // Rotate schools before expanding an individual page's linked fee PDF.
  while (
    readCount < maxReads &&
    jobs.some((job) => job.queue.length && !evidence(job.recommendation))
  ) {
    for (const job of jobs) {
      if (readCount >= maxReads) break;
      if (evidence(job.recommendation)) {
        job.queue = [];
        continue;
      }
      let next = job.queue.shift();
      while (next && attempted.has(next.url)) next = job.queue.shift();
      if (!next) continue;
      attempted.add(next.url);
      readCount++;
      await input.onProgress(
        `正在读取已推荐学校费用原文：第 ${readCount}/${maxReads} 项`,
      );
      try {
        const result = await input.readPage(next.url);
        const discipline = input.disciplines.find(
          (item) => item.code === job.recommendation.disciplineCode,
        );
        const excerpt = compactEvidence(
          /^application\/pdf(?:;|$)/i.test(result.contentType)
            ? result.text.trim()
            : webPageText(result.text),
          discipline ? [discipline] : [],
          12000,
        );
        if (!excerpt) {
          limitations.push(
            `${job.recommendation.institutionName}费用网页未返回可用正文。`,
          );
          continue;
        }
        while (usedIds.has(`fee-${++feeId}`)) {
          /* source IDs cannot shadow existing evidence. */
        }
        const source: WebSource = {
          id: `fee-${feeId}`,
          title: next.title,
          url: next.url,
          retrievedAt: result.retrievedAt ?? new Date(now()).toISOString(),
          kind: "official_page",
          verified: false,
          excerpt,
        };
        usedIds.add(source.id);
        sources.push(source);
        if (/html/i.test(result.contentType)) {
          const attachments = researchAttachments(source, result.text).filter(
            (link) =>
              permitted(link.url, job.domains) && !attempted.has(link.url),
          );
          job.queue.unshift(...attachments);
        }
      } catch (error) {
        if (cancelled(error)) throw error;
        limitations.push(
          `${job.recommendation.institutionName}费用官网读取未完成：${failureReason(error)}`,
        );
      }
      await input.onProgress(
        `已核对${job.recommendation.institutionName}${job.recommendation.programName}费用原文，${evidence(job.recommendation) ? "取得可保留的项目费用证据" : "金额或适用项目仍待核验"}`,
      );
    }
  }
  return { sources, limitations, requestCount, readCount, searched };
}
