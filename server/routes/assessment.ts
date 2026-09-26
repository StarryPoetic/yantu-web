import {
  createAttempt,
  saveDraft,
  submitAttempt,
  publicAttempt,
  publicDiagnosis,
  closeAttempt,
} from "../assessment/index.ts";
import type {
  AssessmentAttempt,
  CreateAttemptInput,
  SaveDraftInput,
  QuestionBank,
} from "../assessment/types.ts";
import { fields, HttpError, matchEtag } from "../http.ts";
import type { Reply } from "../http.ts";
import type { Context } from "../context.ts";
import { required } from "../context.ts";
import { selectionsResource } from "./profile.ts";

export function assessmentRoutes(c: Context): Reply | undefined {
  const owner = c.session.subjectId;
  if (c.path === "/assessment-attempts") {
    if (c.method === "GET")
      return {
        body: {
          items: c.store
            .list<AssessmentAttempt>(owner, "attempt")
            .map((row) => ({ ...publicAttempt(row.value), etag: row.etag })),
          nextCursor: null,
        },
      };
    if (c.method === "POST") {
      fields(c.body, [
        "stage",
        "modules",
        "scope",
        "mathFoundation",
        "derivedFrom",
      ]);
      const input = c.body as Partial<CreateAttemptInput>;
      if (input.derivedFrom)
        required(c.store.get(owner, "attempt", input.derivedFrom));
      const bank = c.store.get<QuestionBank>("public", "question-bank")?.value;
      if (!bank)
        throw new HttpError(
          503,
          "question_bank_unavailable",
          "题库尚未发布，可以先探索院校。",
        );
      const attempt = createAttempt(bank, {
        ...input,
        subjectId: owner,
        confirmedMajorId:
          selectionsResource(c).value.confirmedMajorId ?? undefined,
        allowExampleBank: c.config.sampleData,
      });
      const saved = c.store.put(
        owner,
        "attempt",
        attempt.assessmentAttemptId,
        attempt,
      );
      return { status: 201, body: publicAttempt(attempt), etag: saved.etag };
    }
  }
  const match =
    /^\/assessment-attempts\/([^/]+)(?:\/(submit|result|abandon))?$/.exec(
      c.path,
    );
  if (!match) return;
  const current = required(
    c.store.get<AssessmentAttempt>(owner, "attempt", match[1]),
  );
  if (
    c.method !== "GET" &&
    c.store.get("public", "withdrawn-banks", current.value.questionBankVersion)
  )
    throw new HttpError(
      409,
      "bank_withdrawn",
      "题库版本已撤回，本次草稿暂停提交。",
    );
  if (c.method === "GET") {
    if (match[2] === "result") return { body: publicDiagnosis(current.value) };
    if (!match[2])
      return { body: publicAttempt(current.value), etag: current.etag };
  }
  if (c.method === "PATCH" && !match[2]) {
    fields(c.body, ["answers", "currentIndex"]);
    matchEtag(c.request.headers["if-match"], current.etag);
    const updated = saveDraft(current.value, {
      ...(c.body as unknown as SaveDraftInput),
      expectedAttemptVersion: current.value.attemptVersion,
    });
    const saved = c.store.put(owner, "attempt", match[1], updated);
    return { body: publicAttempt(updated), etag: saved.etag };
  }
  if (c.method === "POST" && match[2] === "submit") {
    fields(c.body, ["confirmUnanswered"]);
    if (current.value.status === "submitted")
      return { body: publicAttempt(current.value), etag: current.etag };
    matchEtag(c.request.headers["if-match"], current.etag);
    if (
      c.body.confirmUnanswered !== undefined &&
      typeof c.body.confirmUnanswered !== "boolean"
    )
      throw new HttpError(422, "invalid_confirmation", "请明确确认未答题。");
    const updated = submitAttempt(current.value, {
      expectedAttemptVersion: current.value.attemptVersion,
      confirmUnanswered: c.body.confirmUnanswered as boolean | undefined,
    });
    const saved = c.store.put(owner, "attempt", match[1], updated);
    return { body: publicAttempt(updated), etag: saved.etag };
  }
  if (c.method === "POST" && match[2] === "abandon") {
    matchEtag(c.request.headers["if-match"], current.etag);
    const updated = closeAttempt(
      current.value,
      "abandoned",
      "用户主动放弃本次测评",
    );
    const saved = c.store.put(owner, "attempt", match[1], updated);
    return { body: publicAttempt(updated), etag: saved.etag };
  }
}
