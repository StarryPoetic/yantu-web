import { createHash } from "node:crypto";
import { extractPriorityFacts } from "./research-priority-facts.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";
import type {
  ResearchPriorityFact,
  ResearchPriorityField,
} from "../../shared/research-priority-facts.ts";
import type { Discipline } from "../disciplines/types.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
import { repairResearchEvidence } from "./research-repair.ts";
import { academicDomain } from "./research-pages.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import type { ResearchPrefilter } from "../../shared/research-prefilter.ts";
import { programEntries } from "./research-matching.ts";
import { isSchoolPage } from "./research-evidence.ts";
import type { WebSource } from "./web.ts";

/** Short, category-specific queries. Score years remain independent evidence slots. */
export function missingPriorityQueries(
  school: string,
  discipline: Discipline,
  year: string,
  facts: readonly ResearchPriorityFact[],
  scope?: { majorCode?: string; collegeName?: string },
) {
  const own = facts.filter(
    (f) =>
      f.schoolName === school &&
      (!f.disciplineCode || f.disciplineCode === discipline.code) &&
      (!f.majorCode || !scope?.majorCode || f.majorCode === scope.majorCode) &&
      (!f.collegeName ||
        !scope?.collegeName ||
        f.collegeName === scope.collegeName),
  );
  const has = (field: ResearchPriorityField, y?: number) =>
    own.some((f) => f.field === field && (y === undefined || f.year === y));
  const years = historicalReferenceYears(year);
  const tasks: {
    fields: ResearchPriorityField[];
    year?: number;
    terms: string;
  }[] = [
    {
      fields: ["cutoff"],
      year: years[0],
      terms: "硕士研究生 复试基本分数线 总分 单科",
    },
    {
      fields: [
        "admittedCount",
        "recommendationShare",
        "applicationAdmissionRatio",
      ],
      terms: "硕士研究生 拟录取名单 统考 推免 报录比 报录统计",
    },
    {
      fields: ["undergraduateAdmission", "crossMajorAdmission"],
      terms: "硕士研究生 生源质量 双非 跨专业 录取情况",
    },
    {
      fields: ["disciplineAssessment", "programRanking"],
      terms: "第四轮学科评估 等级 专业排名",
    },
    {
      fields: ["employment", "cityDevelopment"],
      terms: "毕业生就业质量报告 就业率 主要去向 城市产业发展",
    },
    ...years.flatMap((y) => [
      {
        fields: ["cutoff"] as ResearchPriorityField[],
        year: y,
        terms: "硕士研究生 复试基本分数线 总分 单科",
      },
      {
        fields: ["admissionScore"] as ResearchPriorityField[],
        year: y,
        terms: "硕士研究生 拟录取名单 初试成绩 统考 推免",
      },
    ]),
  ];
  return [
    ...new Set(
      tasks
        .filter((t) => t.fields.some((f) => !has(f, t.year)))
        .map((t) =>
          `${school} ${t.fields.includes("disciplineAssessment") ? "" : `${t.year ?? years[0]}年`} ${scope?.collegeName ?? ""} ${scope?.majorCode ?? ""} ${discipline.name} ${t.terms}`.replace(
            /\s+/g,
            " ",
          ),
        ),
    ),
  ];
}

export async function collectMissingPriorityEvidence(
  input: Omit<Parameters<typeof repairResearchEvidence>[0], "gaps"> & {
    selected: ResearchPrefilter["selected"];
    disciplines: Discipline[];
    usedReads?: Map<string, number>;
    priorityPrograms?: {
      institutionName: string;
      disciplineCode: string;
      majorCode?: string;
      collegeName?: string;
    }[];
  },
) {
  let sources = [...input.sources],
    requestCount = 0,
    readCount = 0;
  let lookupKeys = [...(input.lookupKeys ?? [])];
  const limitations: string[] = [];
  const reads = new Map(input.usedReads ?? []);
  const attempted = new Set<string>();
  const schoolSearches = new Map<string, number>();
  // Sources in this collection snapshot are immutable; new reads replace objects.
  const extracted = new WeakMap<WebSource, ResearchPriorityFact[]>();
  const factsFor = (source: WebSource) => {
    let facts = extracted.get(source);
    if (!facts) {
      facts = extractPriorityFacts(source, input.disciplines, input.targetYear);
      extracted.set(source, facts);
    }
    return facts;
  };
  const known = new Set(
    input.priorityPrograms
      ? input.selected
          .filter((s) =>
            input.priorityPrograms!.some(
              (r) => r.institutionName === s.institutionName,
            ),
          )
          .map((s) => s.domain)
      : sources
          .filter(
            (s) =>
              isSchoolPage(s) &&
              programEntries(s, input.disciplines).length > 0,
          )
          .map((s) => academicDomain(s.url)),
  );
  // A search/read can reveal another target programme after the first inventory.
  // These are investigation leads only; final recommendations still use binding.
  const inspected = new WeakSet<WebSource>();
  const discover = () => {
    for (const source of sources) {
      if (inspected.has(source)) continue;
      inspected.add(source);
      if (
        isSchoolPage(source) &&
        programEntries(source, input.disciplines).length
      )
        known.add(academicDomain(source.url));
    }
  };
  discover();
  let candidatesFinished = known.size === 0;
  let exhausted = false;
  // One school gets one query per turn; unused shares return to the next round.
  // Empty/failed results advance to another missing category, never end all work.
  while (
    requestCount < input.maxRequests &&
    readCount < input.maxReads &&
    !exhausted
  ) {
    input.signal?.throwIfAborted();
    discover();
    let advanced = false;
    for (const school of input.selected.filter(
      (s) => candidatesFinished || known.has(s.domain),
    )) {
      input.signal?.throwIfAborted();
      if ((schoolSearches.get(school.domain) ?? 0) >= B.prioritySchoolSearches)
        continue;
      if (
        requestCount >= input.maxRequests ||
        readCount >= input.maxReads ||
        exhausted
      )
        break;
      const remaining = Math.min(
        B.schoolReads - (reads.get(school.domain) ?? 0),
        input.maxReads - readCount,
      );
      if (remaining <= 0) continue;
      const own = sources.filter(
        (s) => academicDomain(s.url) === school.domain,
      );
      const facts = own.flatMap(factsFor);
      const allPrograms =
        input.priorityPrograms?.filter(
          (p) => p.institutionName === school.institutionName,
        ) ?? [];
      // An unscoped duplicate must not repeat the same major's scoped queries.
      const programs = allPrograms.filter(
        (p) =>
          p.collegeName ||
          !allPrograms.some(
            (other) =>
              other.majorCode === p.majorCode &&
              other.disciplineCode === p.disciplineCode &&
              other.collegeName,
          ),
      );
      const queries = programs.length
        ? programs.flatMap((p) => {
            const d = input.disciplines.find(
              (d) => d.code === p.disciplineCode,
            );
            return d
              ? missingPriorityQueries(
                  school.institutionName,
                  d,
                  input.targetYear,
                  facts,
                  p,
                )
              : [];
          })
        : input.disciplines.flatMap((d) =>
            missingPriorityQueries(
              school.institutionName,
              d,
              input.targetYear,
              facts,
            ),
          );
      const query = [...queries, ...queries.map((q) => q + " 官网 附件")].find(
        (q) =>
          !attempted.has(q) &&
          !lookupKeys.includes(
            createHash("sha256")
              .update(JSON.stringify([q, [school.domain]]))
              .digest("hex"),
          ),
      );
      if (!query) continue;
      attempted.add(query);
      schoolSearches.set(
        school.domain,
        (schoolSearches.get(school.domain) ?? 0) + 1,
      );
      advanced = true;
      const gap: ResearchEvidenceGap = {
        id: `priority:${school.key}:${query}`,
        institutionName: school.institutionName,
        programName: input.disciplines[0]?.name,
        disciplineCode: input.disciplines[0]?.code,
        field: "program",
        targetYear: input.targetYear,
        referenceYears: historicalReferenceYears(input.targetYear),
        purpose: "missing_evidence",
        reason: "五类依据仍有缺项",
        nextAction: query,
        sourceIds: [],
        references: [],
        priority: "high",
        attempts: [],
      };
      const result = await repairResearchEvidence({
        ...input,
        sources: own,
        gaps: [gap],
        lookupKeys,
        maxRequests: 1,
        maxReads: Math.min(remaining, B.priorityReadsPerTurn),
        allowedDomains: [school.domain],
        priorityDocuments: true,
        searchFirst: true,
        discoveryReadLimit: 0,
        queryForGap: () => [query],
        needsEvidence: undefined,
        stop: undefined,
      });
      requestCount += result.requestCount;
      readCount += result.readCount;
      reads.set(
        school.domain,
        (reads.get(school.domain) ?? 0) + result.readCount,
      );
      lookupKeys = [...new Set([...lookupKeys, ...result.lookupKeys])];
      limitations.push(...result.limitations);
      sources = [
        ...sources.filter((s) => academicDomain(s.url) !== school.domain),
        ...result.sources,
      ];
      exhausted = result.stoppedReason === "SEARCH_BUDGET_EXHAUSTED";
    }
    if (!advanced) {
      if (!candidatesFinished) {
        candidatesFinished = true;
        continue;
      }
      break;
    }
  }
  if (exhausted)
    limitations.push(
      "有效账号/全站搜索额度已耗尽，不能将配置的72次上限当作剩余可用额度；已保存证据和缺项供续跑。",
    );
  // A spent search allowance does not discard already discovered useful links.
  for (const school of input.selected) {
    input.signal?.throwIfAborted();
    const remaining = Math.min(
      input.maxReads - readCount,
      B.schoolReads - (reads.get(school.domain) ?? 0),
    );
    if (remaining <= 0) continue;
    const own = sources.filter((s) => academicDomain(s.url) === school.domain);
    const facts = own.flatMap(factsFor);
    if (
      !input.disciplines.some(
        (d) =>
          missingPriorityQueries(
            school.institutionName,
            d,
            input.targetYear,
            facts,
          ).length,
      )
    )
      continue;
    if (
      !own.some((s) =>
        s.documentLinks?.some((l) =>
          /复试|拟录取|报录|学科评估|就业|生源|排名|推免|城市发展|产业/.test(
            l.title,
          ),
        ),
      )
    )
      continue;
    const gap: ResearchEvidenceGap = {
      id: `priority-links:${school.key}`,
      institutionName: school.institutionName,
      programName: input.disciplines[0]?.name,
      field: "program",
      targetYear: input.targetYear,
      referenceYears: historicalReferenceYears(input.targetYear),
      purpose: "missing_evidence",
      reason: "已有五类依据链接尚未读取",
      nextAction: "读取已发现的五类材料",
      sourceIds: [],
      references: [],
      priority: "high",
      attempts: [],
    };
    const result = await repairResearchEvidence({
      ...input,
      sources: own.map((s) => ({
        ...s,
        documentLinks: s.documentLinks?.filter((l) =>
          /复试|拟录取|报录|学科评估|就业|生源|排名|推免|城市发展|产业/.test(
            l.title,
          ),
        ),
      })),
      gaps: [gap, { ...gap, id: gap.id + ":remaining" }],
      maxRequests: 0,
      maxReads: remaining,
      priorityDocuments: true,
      discoveryReadLimit: 0,
      allowedDomains: [school.domain],
      needsEvidence: undefined,
      stop: undefined,
    });
    readCount += result.readCount;
    limitations.push(...result.limitations);
    sources = [
      ...sources.filter((s) => academicDomain(s.url) !== school.domain),
      ...result.sources.map((s) => ({
        ...s,
        documentLinks: [
          ...new Map(
            [
              ...(own.find((old) => old.url === s.url)?.documentLinks ?? []),
              ...(s.documentLinks ?? []),
            ].map((l) => [l.url, l]),
          ).values(),
        ],
      })),
    ];
  }
  return { sources, lookupKeys, requestCount, readCount, limitations };
}
