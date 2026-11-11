import { RESEARCH_BUDGET as B } from "../explanation/research-budget.ts";
import {
  createExplanationModule,
  createModelRuntime,
} from "../explanation/index.ts";
import {
  createHttpsReader,
  createWebAnswerModule,
} from "../explanation/web.ts";
import { dnsModeFromEnvironment } from "../explanation/dns.ts";
import {
  createSearchBudget,
  searchConfigFromEnvironment,
} from "../explanation/search.ts";
import { createGeneralChatModule } from "../explanation/chat.ts";
import type { Conversation, ChatMessage } from "../explanation/chat.ts";
import type { Context } from "../context.ts";
import { required } from "../context.ts";
import type { AssessmentAttempt } from "../assessment/types.ts";
import { fields, HttpError, text, id, now, matchEtag } from "../http.ts";
import type { Reply } from "../http.ts";
import { createGuidanceExplainer } from "../explanation/guidance.ts";
import { guidanceFreshness } from "./guidance.ts";
import type { GuidanceRun } from "../disciplines/types.ts";
import { createResearchReportModule } from "../explanation/research.ts";
import type { ResearchEvidenceLibrary } from "../explanation/research-library.ts";
import type { UsageLedger } from "../explanation/usage-ledger.ts";

export function createAssistantRoutes(
  dependencies: {
    library?: ResearchEvidenceLibrary;
    usageLedger?: UsageLedger;
  } = {},
) {
  const config = {
    usageLedger: dependencies.usageLedger,
    enabled: process.env.YANTU_MODEL_ENABLED === "true",
    apiKey: process.env.DEEPSEEK_API_KEY,
    dnsMode: dnsModeFromEnvironment(process.env),
    userDailyTokens: Number(
      process.env.YANTU_MODEL_USER_DAILY_TOKENS ?? B.userDailyTokens,
    ),
    globalDailyTokens: Number(
      process.env.YANTU_MODEL_DAILY_TOKENS ?? B.globalDailyTokens,
    ),
  };
  const runtime = createModelRuntime(config);
  const explanations = createExplanationModule({ ...config, runtime });
  const searchConfig = searchConfigFromEnvironment(process.env);
  const webConfig = {
    ...config,
    runtime,
    ...searchConfig,
    searchBudget: createSearchBudget({
      ...searchConfig,
      usageLedger: dependencies.usageLedger,
    }),
    reader: createHttpsReader({ dnsMode: config.dnsMode }),
    ...(process.env.YANTU_OFFICIAL_HOSTS
      ? {
          allowedHosts: process.env.YANTU_OFFICIAL_HOSTS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  };
  const web = createWebAnswerModule(webConfig);
  const research = createResearchReportModule(
    {
      ...webConfig,
      researchModel: (process.env.YANTU_RESEARCH_MODEL ?? "deepseek-v4-pro") as
        | "deepseek-flash"
        | "deepseek-v4-pro",
      researchEffort: (process.env.YANTU_RESEARCH_EFFORT ?? "high") as
        | "low"
        | "high"
        | "max",
      researchTimeoutMs: Number(
        process.env.YANTU_RESEARCH_TIMEOUT_MS ?? B.thinkingTimeoutMs,
      ),
      researchMaxOutputTokens: Number(
        process.env.YANTU_RESEARCH_MAX_OUTPUT_TOKENS ?? 16384,
      ),
    },
    { runtime, web, library: dependencies.library },
  );
  const chat = createGeneralChatModule(webConfig);
  const guidanceExplainer = createGuidanceExplainer(runtime);
  function currentGuidance(c: Context) {
    const run = required(
      c.store.get<GuidanceRun>(
        c.session.subjectId,
        "guidance",
        c.path.split("/")[2],
      ),
    ).value;
    if (run.subjectId !== c.session.subjectId)
      throw new HttpError(404, "not_found", "未找到本次专业结论。");
    const freshness = guidanceFreshness(c, run);
    if (freshness.needsRefresh)
      throw new HttpError(
        409,
        "guidance_changed",
        "专业结论的依据已变化，请重新生成后再查看辅助解释。",
        freshness,
      );
    return run;
  }
  const conversation = (
    c: Context,
    kind = "assistant-conversation",
    key = "current",
  ) =>
    c.store.get<Conversation>(c.session.subjectId, kind, key) ??
    c.store.put<Conversation>(c.session.subjectId, kind, key, {
      conversationId: id(),
      version: 0,
      messages: [],
    });
  function assertLive(c: Context) {
    if (c.sessionHash && !c.store.session(c.sessionHash))
      throw new HttpError(
        409,
        "session_changed",
        "登录状态已变化，旧对话请求已取消。",
      );
    if (c.store.generation(c.session.subjectId) !== c.session.generation)
      throw new HttpError(
        409,
        "data_deleted",
        "相关个人记录已删除，请重新打开对话。",
      );
  }
  function validateReplay(c: Context, saved: Record<string, unknown>) {
    if (/^\/guidance\/[^/]+\/explanation$/.test(c.path)) currentGuidance(c);
    if (c.path === "/assistant/conversation") {
      const current = c.store.get<Conversation>(
        c.session.subjectId,
        "assistant-conversation",
      );
      if (!current || current.value.conversationId !== saved.conversationId)
        throw new HttpError(
          409,
          "conversation_cleared",
          "此对话已清空，旧回答不再可用。",
        );
    }
    if (/^\/assessment-attempts\/[^/]+\/tutor$/.test(c.path)) {
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
          "本次题库已撤回，旧辅助讲解不再可用。",
        );
    }
  }
  return {
    research,
    validateReplay,
    matches: (c: Context) =>
      (c.path === "/assistant/conversation" &&
        ["GET", "POST", "DELETE"].includes(c.method)) ||
      (c.method === "POST" &&
        (c.path === "/assistant/questions" ||
          /^\/guidance\/[^/]+\/explanation$/.test(c.path) ||
          /^\/assessment-attempts\/[^/]+\/(explanations|tutor)$/.test(c.path))),
    clearSubject: (owner: string) => {
      explanations.clearSubject(owner);
      web.clearSubject(owner);
      chat.clearSubject(owner);
    },
    async handle(c: Context): Promise<Reply> {
      if (/^\/guidance\/[^/]+\/explanation$/.test(c.path)) {
        fields(c.body, []);
        const run = currentGuidance(c);
        const result = await guidanceExplainer.explain(
          c.session.subjectId,
          run,
        );
        assertLive(c);
        currentGuidance(c);
        return { body: result };
      }
      if (c.path === "/assistant/conversation") {
        const current = conversation(c);
        if (c.method === "GET")
          return { body: current.value, etag: current.etag };
        matchEtag(c.request.headers["if-match"], current.etag);
        if (c.method === "DELETE") {
          fields(c.body, []);
          chat.clearSubject(c.session.subjectId);
          const cleared = c.store.put<Conversation>(
            c.session.subjectId,
            "assistant-conversation",
            "current",
            { conversationId: id(), version: 0, messages: [] },
          );
          c.store.db
            .prepare(
              "DELETE FROM idempotency WHERE owner=? AND operation IN ('POST /assistant/conversation','DELETE /assistant/conversation')",
            )
            .run(c.session.subjectId);
          return { body: cleared.value, etag: cleared.etag };
        }
        fields(c.body, ["message", "allowSearch", "urls"]);
        const message = text(c.body.message, "消息", 3000, true);
        if (
          c.body.allowSearch !== undefined &&
          typeof c.body.allowSearch !== "boolean"
        )
          throw new HttpError(
            422,
            "invalid_search_flag",
            "请明确是否允许按需搜索。",
          );
        if (
          c.body.urls !== undefined &&
          (!Array.isArray(c.body.urls) ||
            c.body.urls.length > 2 ||
            c.body.urls.some(
              (value) => typeof value !== "string" || value.length > 2048,
            ))
        )
          throw new HttpError(
            422,
            "invalid_urls",
            "每次最多提供两个官方资料链接。",
          );
        const result = await chat.answer({
          subjectId: c.session.subjectId,
          message,
          history: current.value.messages,
          allowSearch: c.body.allowSearch === true,
          urls: c.body.urls as string[] | undefined,
        });
        assertLive(c);
        matchEtag(
          current.etag,
          required(
            c.store.get<Conversation>(
              c.session.subjectId,
              "assistant-conversation",
            ),
          ).etag,
        );
        const messages: ChatMessage[] = [
          ...current.value.messages,
          { id: id(), role: "user", content: message, createdAt: now() },
          {
            id: id(),
            role: "assistant",
            content: result.answer,
            createdAt: now(),
            sources: result.sources,
            notices: result.notices,
            reason: result.reason,
            status: result.status,
          },
        ];
        // Storage is bounded by content size, not by a fixed number of questions.
        while (JSON.stringify(messages).length > 250000 && messages.length > 2)
          messages.splice(0, 2);
        const saved = c.store.put<Conversation>(
          c.session.subjectId,
          "assistant-conversation",
          "current",
          {
            conversationId: current.value.conversationId,
            version: current.value.version + 1,
            messages,
          },
        );
        return { body: saved.value, etag: saved.etag };
      }
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
      const tutor = c.path.endsWith("/tutor");
      fields(
        c.body,
        tutor
          ? ["questionId", "includeReasoning", "message"]
          : ["questionId", "includeReasoning"],
      );
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
      if (tutor) {
        const questionId = text(c.body.questionId, "题号", 200, true);
        const question = attempt.questions.find(
          (item) => item.id === questionId,
        );
        if (!question)
          throw new HttpError(
            404,
            "question_not_found",
            "本次测评中没有这道题。",
          );
        if (attempt.status === "in_progress")
          return {
            body: {
              kind: "hint",
              questionId,
              answer:
                question.studyHint ||
                `这道题涉及“${question.point}”。先回顾相关定义，整理已知条件，再独立列式或判断。提交后可以查看完整解析与逐题追问。`,
              status: "reference",
              notices: [
                "作答中仅提供知识点与方法提示，不显示答案或本题代入结果。",
              ],
            },
          };
        if (attempt.status !== "submitted" || !attempt.diagnosis)
          throw new HttpError(
            409,
            "submission_required",
            "本次测评不可讲解，请先完成有效提交。",
          );
        const key = `${attempt.assessmentAttemptId}:${question.id}`;
        const current = conversation(c, "question-chat", key);
        const message =
          c.body.message === undefined
            ? "请完整讲解这道题的解题步骤，并说明容易混淆的地方。"
            : text(c.body.message, "追问", 3000, true);
        const result = await chat.answer({
          subjectId: c.session.subjectId,
          message,
          history: current.value.messages,
          teachingContext: {
            question: question.text,
            point: question.point,
            correctAnswer: question.options[question.correct],
            referenceExplanation: question.explanation,
            ...(c.body.includeReasoning === true
              ? {
                  studentReasoning: attempt.answers.find(
                    (answer) => answer.questionId === question.id,
                  )?.reasoning,
                }
              : {}),
          },
        });
        assertLive(c);
        if (
          c.store.get("public", "withdrawn-banks", attempt.questionBankVersion)
        )
          throw new HttpError(
            409,
            "bank_withdrawn",
            "题库已撤回，讲解已取消。",
          );
        matchEtag(
          current.etag,
          required(
            c.store.get<Conversation>(
              c.session.subjectId,
              "question-chat",
              key,
            ),
          ).etag,
        );
        const answer =
          result.status === "model" ? result.answer : question.explanation;
        const messages: ChatMessage[] = [
          ...current.value.messages,
          { id: id(), role: "user", content: message, createdAt: now() },
          {
            id: id(),
            role: "assistant",
            content: answer,
            createdAt: now(),
            reason: result.reason,
            status: result.status,
          },
        ];
        while (JSON.stringify(messages).length > 100000 && messages.length > 2)
          messages.splice(0, 2);
        c.store.put(c.session.subjectId, "question-chat", key, {
          conversationId: current.value.conversationId,
          version: current.value.version + 1,
          messages,
        });
        return {
          body: {
            kind: "explanation",
            questionId,
            answer,
            status: result.status === "model" ? "model" : "reference",
            reason: result.reason,
            messages,
            presentation: question.solutionPresentation,
            referenceExplanation: question.explanation,
            notices:
              result.status === "model"
                ? ["辅助讲解用于理解，评分仍依据本题固定答案。"]
                : ["模型暂不可用，已保留本题固定解析。"],
          },
        };
      }
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
