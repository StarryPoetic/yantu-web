import {
  createExplanationModule,
  createModelRuntime,
} from "../explanation/index.ts";
import { createWebAnswerModule } from "../explanation/web.ts";
import type { Context } from "../context.ts";
import { required } from "../context.ts";
import type { AssessmentAttempt } from "../assessment/types.ts";
import { fields, HttpError, text } from "../http.ts";
import type { Reply } from "../http.ts";

export function createAssistantRoutes() {
  const config = {
    enabled: process.env.YANTU_MODEL_ENABLED === "true",
    apiKey: process.env.DEEPSEEK_API_KEY,
    userDailyTokens: Number(process.env.YANTU_MODEL_USER_DAILY_TOKENS ?? 20000),
    globalDailyTokens: Number(process.env.YANTU_MODEL_DAILY_TOKENS ?? 100000),
  };
  const runtime = createModelRuntime(config);
  const explanations = createExplanationModule({ ...config, runtime });
  const web = createWebAnswerModule({
    ...config,
    runtime,
    searchEnabled: process.env.YANTU_SEARCH_ENABLED === "true",
    searchKey: process.env.BRAVE_SEARCH_API_KEY,
    ...(process.env.YANTU_OFFICIAL_HOSTS
      ? {
          allowedHosts: process.env.YANTU_OFFICIAL_HOSTS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  });
  return {
    matches: (c: Context) =>
      c.method === "POST" &&
      (c.path === "/assistant/questions" ||
        /^\/assessment-attempts\/[^/]+\/explanations$/.test(c.path)),
    clearSubject: (owner: string) => {
      explanations.clearSubject(owner);
      web.clearSubject(owner);
    },
    async handle(c: Context): Promise<Reply> {
      if (c.path === "/assistant/questions") {
        fields(c.body, ["question", "allowSearch", "urls"]);
        if (
          c.body.allowSearch !== undefined &&
          typeof c.body.allowSearch !== "boolean"
        )
          throw new HttpError(422, "invalid_search_flag", "联网选项必须明确。");
        if (
          c.body.urls !== undefined &&
          (!Array.isArray(c.body.urls) ||
            c.body.urls.some((v) => typeof v !== "string"))
        )
          throw new HttpError(422, "invalid_urls", "网页链接格式错误。");
        const result = await web.answer({
          subjectId: c.session.subjectId,
          question: text(c.body.question, "问题", 600, true),
          search: c.body.allowSearch === true,
          urls: c.body.urls as string[] | undefined,
        });
        return {
          body: {
            ...result,
            explanationStatus:
              result.status === "answered" ? "model" : "template",
          },
        };
      }
      fields(c.body, ["questionId", "includeReasoning"]);
      if (
        c.body.includeReasoning !== undefined &&
        typeof c.body.includeReasoning !== "boolean"
      )
        throw new HttpError(422, "invalid_consent", "请明确是否包含解题过程。");
      const attempt = required(
        c.store.get<AssessmentAttempt>(
          c.session.subjectId,
          "attempt",
          c.path.split("/")[2],
        ),
      ).value;
      if (c.store.get("public", "withdrawn-banks", attempt.questionBankVersion))
        throw new HttpError(
          409,
          "bank_withdrawn",
          "题库已撤回，暂不能生成辅助解释。",
        );
      const result = await explanations.explainAssessment(
        attempt,
        c.session.subjectId,
        {
          questionId:
            c.body.questionId === undefined
              ? undefined
              : text(c.body.questionId, "题号", 200, true),
          includeReasoning: c.body.includeReasoning === true,
        },
      );
      return {
        body: {
          ...result,
          explanationStatus:
            result.status === "generated" ? "model" : "template",
        },
      };
    },
  };
}
