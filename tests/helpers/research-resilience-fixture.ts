import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import {
  createResearchReportModule,
  type ResearchConfig,
} from "../../server/explanation/research.ts";
import {
  ModelError,
  type ModelMessage,
} from "../../server/explanation/deepseek.ts";
import type { ResearchCheckpoint } from "../../server/explanation/research-resume.ts";
import type { WebReader } from "../../server/explanation/web.ts";

export const schools = [
  ["杭州电子科技大学", "grs.hdu.edu.cn"],
  ["浙江科技大学", "yzw.zust.edu.cn"],
  ["浙江师范大学", "yzw.zjnu.edu.cn"],
  ["西北大学", "yjs.nwu.edu.cn"],
  ["浙江工业大学", "www.yz.zjut.edu.cn"],
  ["浙江理工大学", "gradadmission.zstu.edu.cn"],
];
export const resilienceRun = () =>
  generateGuidance({
    subjectId: "resilience-student",
    guidanceRunId: "resilience-run",
    generatedAt: "2026-10-11T05:00:00Z",
    profile: {
      ...blankProfile(),
      year: "2027",
      major: "机械工程",
      targetMajor: "机械工程",
      cities: [],
      studyGoal: "专业实践与行业就业",
      crossMajor: "接受跨专业",
      budget: "1万元以内",
    },
    profileVersion: 1,
    selectionVersion: 1,
    confirmedMajorId: "0802",
    excludedMajorIds: [],
    assessments: [],
  });
const fitReasons = [
  {
    profileField: "major",
    reason: "结合已学机械课程，可先复习机械基础，这属于准备推断。",
  },
  {
    profileField: "studyGoal",
    reason: "结合实践就业目标，建议核对课程中的实践要求，这是准备推断。",
  },
];
export function resilienceFixture(
  settings: {
    pageError?: string;
    malformedSchool?: boolean;
    modelFailures?: number;
    modelError?: string;
    hang?: "search" | "model";
    timeoutMs?: number;
  } = {},
) {
  const counts = { searches: 0, pages: 0, planning: 0, final: 0 };
  let checkpoint: ResearchCheckpoint | undefined;
  const reader: WebReader = async (url) => {
    const host = new URL(url).hostname;
    if (host === "api.search.brave.com") {
      counts.searches++;
      if (settings.hang === "search") return new Promise(() => {});
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: schools.map(([name, domain]) => ({
              url: `https://${domain}/directory`,
              title: `${name}2026年硕士招生目录`,
              description: "080200机械工程硕士招生目录",
            })),
          },
        }),
      };
    }
    counts.pages++;
    const school = schools.find(([, domain]) => domain === host);
    if (!school) throw new ModelError("HTTP_404");
    if (host === schools[0][1] && settings.pageError)
      throw new ModelError(settings.pageError);
    if (host === schools[0][1] && settings.malformedSchool)
      return { contentType: "text/html", text: null as unknown as string };
    return {
      contentType: "text/html",
      text: `<p>${school[0]}2026年硕士研究生招生专业目录</p><p>001机械工程学院 | 080200机械工程 学术学位 全日制 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理</p>`,
    };
  };
  const config: ResearchConfig = {
    enabled: true,
    apiKey: "offline-placeholder",
    searchEnabled: true,
    searchKey: "offline-placeholder",
    allowedHosts: schools.map(([, host]) => host),
    allowAcademicHosts: false,
    now: () => Date.parse("2026-10-11T05:00:00Z"),
    userDailyTokens: 1000000,
    globalDailyTokens: 2000000,
    searchDailyRequestsPerUser: 200,
    searchDailyRequestsGlobal: 500,
    reader,
    ...(settings.timeoutMs
      ? { researchTotalTimeoutMs: settings.timeoutMs }
      : {}),
    adapter: {
      async complete(messages: ModelMessage[]) {
        const planning = messages[0].content.includes(
          "research-direction-plan-v6",
        );
        if (planning) counts.planning++;
        else counts.final++;
        if (!planning && settings.hang === "model")
          return new Promise(() => {});
        if (!planning && counts.final <= (settings.modelFailures ?? 0))
          throw new ModelError(
            settings.modelError ?? "PROVIDER_TEMPORARY_UNAVAILABLE",
          );
        const sources = planning ? [] : JSON.parse(messages[1].content).sources;
        const content = planning
          ? {
              directions: [
                {
                  disciplineCode: "0802",
                  rationale: "结合机械课程与实践目标比较。",
                  fitReasons,
                },
              ],
              followUpQuestions: [],
            }
          : {
              summary: "根据公开目录比较学校，年度资格分别核验。",
              facts: [],
              recommendations: schools.flatMap(([name]) => {
                const source = sources.find((source: { excerpt: string }) =>
                  source.excerpt.includes(name),
                );
                return source
                  ? [
                      {
                        institutionName: name,
                        programName: "机械工程",
                        disciplineCode: "0802",
                        rationale: "结合已学课程进行准备，这是推断。",
                        fitReasons,
                        tradeoffs: ["需核对培养方案并补足专业基础。"],
                        preparation: ["核对初试范围。"],
                        uncertainties: ["目标年度资格待核验。"],
                        citations: [source.id],
                      },
                    ]
                  : [];
              }),
              limitations: ["模拟数据仅用于故障演练。"],
            };
        return {
          content: JSON.stringify(content),
          inputTokens: 100,
          outputTokens: 100,
          model: "deepseek-v4-pro",
        };
      },
    },
  };
  return {
    counts,
    config,
    create: () => createResearchReportModule(config),
    run: resilienceRun(),
    save: (value: ResearchCheckpoint) => {
      checkpoint = structuredClone(value);
    },
    checkpoint: () => checkpoint!,
  };
}
