import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import {
  createResearchReportModule,
  type ResearchConfig,
} from "../../server/explanation/research.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";
import type { ResearchCheckpoint } from "../../server/explanation/research-resume.ts";
import type {
  ResearchEvidenceLibrary,
  ProgramFact,
} from "../../server/explanation/research-library.ts";
import { schoolRegistry } from "../../server/schools/index.ts";

/** All admissions claims below are synthetic test evidence, never saved to a real library. */
export function prefilterFixture(
  options: {
    available?: number;
    failModel?: boolean;
    completeFields?: boolean;
    duplicatePages?: boolean;
    cities?: string[];
    schoolNames?: string[];
  } = {},
) {
  const schools = schoolRegistry.schools
    .filter((s) =>
      options.schoolNames
        ? options.schoolNames.includes(s.name)
        : ["杭州", "南京", "西安"].includes(s.city),
    )
    .slice(0, 12);
  let saved: ResearchCheckpoint | undefined;
  let failModel = options.failModel;
  let factsCalls = 0;
  const counts = { searches: 0, reads: 0, models: 0, inputChars: 0 };
  const readDomains: string[] = [];
  const questions: string[] = [];
  const facts: ProgramFact[] = schools.map((s) => ({
    schoolName: s.name,
    registrableDomain: s.registrableDomain,
    majorCode: "080200",
    programName: "机械工程",
    disciplineCode: "0802",
    degreeType: "academic",
    studyMode: "full_time",
    year: 2026,
    field: "catalog",
    value: { exists: true },
    quote: `${s.name}080200机械工程`,
    sourceUrl: `https://${s.registrableDomain}/catalog`,
    sourceId: `local-${s.registrableDomain}`,
    retrievedAt: "2026-10-11T00:00:00Z",
    extractedAt: "2026-10-11T00:00:00Z",
    extractor: "test",
    status: "bound",
    verified: false,
  }));
  const library: ResearchEvidenceLibrary = {
    load: () => [],
    queryFacts: () => {
      factsCalls++;
      return facts;
    },
    coverageStats: () => ({
      librarySchoolCount: schools.length,
      libraryProgramCount: schools.length,
    }),
    isFresh: () => false,
    save: () => {},
    recordAttempt: () => {},
    attempts: () => [],
  };
  const run = generateGuidance({
    subjectId: "two-stage-test",
    guidanceRunId: "two-stage-run",
    generatedAt: "2026-10-11T00:00:00Z",
    profile: {
      ...blankProfile(),
      major: "机械工程",
      targetMajor: "机械工程",
      cities: options.cities ?? [],
      studyGoal: "专业实践与行业就业",
      budget: "1万元以内",
      crossMajor: "接受跨专业",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "0802",
    excludedMajorIds: [],
    assessments: [],
  });
  const config: ResearchConfig = {
    enabled: true,
    apiKey: "offline-test",
    searchEnabled: true,
    searchKey: "offline-test",
    now: () => Date.parse("2026-10-11T00:00:00Z"),
    userDailyTokens: 1000000,
    globalDailyTokens: 2000000,
    searchDailyRequestsPerUser: 100,
    searchDailyRequestsGlobal: 500,
    reader: async (url) => {
      if (new URL(url).hostname === "api.search.brave.com") {
        counts.searches++;
        const question = new URL(url).searchParams.get("q") ?? "";
        questions.push(question);
        // Include unrelated results deliberately; narrowing must reject them before reads.
        return {
          contentType: "application/json",
          text: JSON.stringify({
            web: {
              results: schools
                .slice(0, options.available ?? schools.length)
                .sort(
                  (a, b) =>
                    Number(question.includes(b.name)) -
                    Number(question.includes(a.name)),
                )
                .flatMap((s) =>
                  Array.from(
                    { length: options.duplicatePages ? 3 : 1 },
                    (_, index) => ({
                      url: `https://${s.registrableDomain}/catalog${index}`,
                      title: `${s.name}2026年硕士招生目录`,
                      description: `${s.name}080200机械工程全日制硕士招生目录`,
                    }),
                  ),
                ),
            },
          }),
        };
      }
      counts.reads++;
      readDomains.push(new URL(url).hostname);
      const s = schools.find(
        (s) => s.registrableDomain === new URL(url).hostname,
      );
      if (!s) throw new ModelError("HTTP_404");
      return {
        contentType: "text/html",
        text: `<h1>${s.name}2026年硕士研究生招生专业目录</h1><p>001机械工程学院 | 080200机械工程 学术学位 全日制 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理</p>${options.completeFields ? `<p>${s.name}2026年硕士学费标准：我校所有全日制硕士研究生学费统一为8000元/生·学年。</p><p>机械工程专业培养地点：${s.city}市大学路1号。</p>` : ""}`,
      };
    },
    adapter: {
      async complete(messages, requestOptions) {
        counts.models++;
        counts.inputChars += JSON.stringify(messages).length;
        const collection =
          /research-(?:query-plan|page-extract|school-summary)-v1/.test(
            messages[0].content,
          );
        if (collection)
          return {
            content: JSON.stringify({
              focus: [0, 0, 0, 0, 0],
              facts: [],
              factIds: [],
            }),
            inputTokens: 100,
            outputTokens: 20,
            model: requestOptions?.model ?? "deepseek-flash",
          };
        if (failModel) {
          failModel = false;
          throw new ModelError("MODEL_TIMEOUT");
        }
        return {
          content: JSON.stringify({
            summary: "依据已有目录比较，未知字段继续核验。",
            facts: [],
            recommendations: [],
            limitations: ["离线模拟，不代表真实招生事实。"],
          }),
          inputTokens: 100,
          outputTokens: 100,
          model: "deepseek-v4-pro",
        };
      },
    },
  };
  return {
    schools,
    run,
    config,
    library,
    counts,
    readDomains,
    questions,
    factsCalls: () => factsCalls,
    create: () => createResearchReportModule(config, { library }),
    save: (cp: ResearchCheckpoint) => {
      saved = structuredClone(cp);
    },
    checkpoint: () => saved!,
  };
}
