import type { Page } from "@playwright/test";
import {
  createAttempt,
  loadQuestionBank,
  publicAttempt,
  saveDraft,
  submitAttempt,
} from "../../server/assessment/index";
import type {
  AssessmentAttempt,
  QuestionBank,
} from "../../server/assessment/types";

/** Fixed UI fixture: question rendering tests must not depend on random pool selection.
 * Scoring/draft transitions use the real assessment module; API ownership is tested separately. */
export async function installAssessmentFixture(
  page: Page,
  bank?: QuestionBank,
) {
  const pool = bank ?? (await loadQuestionBank());
  let attempt: AssessmentAttempt | undefined;
  await page.route("**/api/v1/assessment-attempts**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const input = req.method() === "GET" ? {} : req.postDataJSON();
    let body: unknown;
    if (path.endsWith("/tutor")) {
      const question = attempt!.questions.find(
        (q) => q.id === input.questionId,
      )!;
      const submitted = attempt!.status === "submitted";
      body = {
        kind: submitted ? "explanation" : "hint",
        status: "fallback",
        answer: submitted
          ? question.explanation
          : `复习 ${question.point} 的定义和方法。`,
        notices: [
          submitted
            ? "模型暂不可用，已保留本题固定解析。"
            : "作答中仅提供知识点与方法提示，不显示答案或本题代入结果。",
        ],
        ...(submitted && input.message
          ? {
              messages: [
                { id: "question", role: "user", content: input.message },
                {
                  id: "answer",
                  role: "assistant",
                  content: question.explanation,
                },
              ],
            }
          : {}),
      };
    } else if (
      path.endsWith("/assessment-attempts") &&
      req.method() === "GET"
    ) {
      body = {
        items: attempt ? [publicAttempt(attempt)] : [],
        nextCursor: null,
      };
    } else {
      if (path.endsWith("/assessment-attempts") && req.method() === "POST") {
        attempt = createAttempt(pool, {
          ...input,
          subjectId: "ui-fixture",
          seed: "ui-domains",
          allowExampleBank: true,
        });
      } else if (req.method() === "PATCH") {
        attempt = saveDraft(attempt!, {
          ...input,
          expectedAttemptVersion: attempt!.attemptVersion,
        });
      } else if (path.endsWith("/submit")) {
        attempt = submitAttempt(attempt!, {
          ...input,
          expectedAttemptVersion: attempt!.attemptVersion,
        });
      }
      body = publicAttempt(attempt!);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { etag: `"fixture-${attempt?.attemptVersion ?? 0}"` },
      body: JSON.stringify(body),
    });
  });
  return () => attempt;
}
