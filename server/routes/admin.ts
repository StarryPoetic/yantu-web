import {
  fields,
  HttpError,
  id,
  matchEtag,
  now,
  object,
  text,
} from "../http.ts";
import type { Reply } from "../http.ts";
import { catalogState, required } from "../context.ts";
import type { Context } from "../context.ts";
import {
  importCatalog,
  reviewRevision,
  publishCatalog,
  validateCatalogImport,
  withdrawRevision,
} from "../catalog/index.ts";
import type {
  CatalogImport,
  CatalogState,
  SourceRecord,
} from "../catalog/types.ts";
import {
  closeAttempt,
  publishQuestionBank,
  QUESTION_REVIEW_CHECKS,
  validateQuestionBank,
} from "../assessment/index.ts";
import type { AssessmentAttempt, QuestionBank } from "../assessment/types.ts";
import { validateRule } from "../recommendation/index.ts";
import type { RecommendationRule } from "../recommendation/index.ts";

type Kind = "program" | "question" | "rule" | "risk" | "claim";
interface Draft {
  draftId: string;
  kind: Kind;
  content: unknown;
  authorId: string;
  reviewStatus: "draft" | "pending_review" | "approved" | "rejected";
  reviewId: string | null;
  reviews: {
    actorId: string;
    decision: string;
    reason: string;
    at: string;
    checks?: string[];
  }[];
  published: boolean;
}
const adminOwner = "administration";
function role(
  c: Context,
  name: "editor" | "reviewer" | "publisher" | "auditor",
) {
  if (!c.admin?.roles.includes(name))
    throw new HttpError(403, "role_required", "当前身份没有此操作权限。");
}
function kind(value: string): Kind {
  if (!["program", "question", "rule", "risk", "claim"].includes(value))
    throw new HttpError(404, "draft_kind_not_found", "不支持此资料类型。");
  return value as Kind;
}
function validateContent(type: Kind, content: unknown) {
  object(content);
  let errors: string[] = [];
  if (["program", "risk", "claim"].includes(type)) {
    const result = validateCatalogImport(content);
    errors = result.errors;
    const bundle = content as CatalogImport;
    if (
      result.valid &&
      bundle.programs.some(
        (p) =>
          p.reviewStatus !== "draft" || p.publicationStatus !== "unpublished",
      )
    )
      errors.push("导入内容必须是未发布草稿");
    if (result.valid && !bundle.programs.length)
      errors.push("资料批次至少包含一个项目");
    if (
      result.valid &&
      type === "risk" &&
      !bundle.programs.some((p) => p.risks.length)
    )
      errors.push("风险草稿必须包含项目风险依据");
    if (
      result.valid &&
      type === "claim" &&
      !bundle.programs.some((p) => p.claims.length)
    )
      errors.push("事实草稿必须包含字段断言");
  } else if (type === "question") {
    errors = validateQuestionBank(content as QuestionBank);
    if (
      !errors.length &&
      (content as QuestionBank).questions.some(
        (q) =>
          q.reviewStatus !== "draft" || q.publicationStatus !== "unpublished",
      )
    )
      errors.push("题库导入只能包含未发布草稿");
  } else {
    const rule = content as RecommendationRule;
    errors = validateRule(content).errors;
    if (
      rule.reviewStatus !== "draft" ||
      !Array.isArray(rule.reviewedBy) ||
      rule.reviewedBy.length ||
      !Array.isArray(rule.compatibleSchemaVersions) ||
      !rule.compatibleSchemaVersions.includes(1)
    )
      errors.push("导入规则必须是结构版本 1 兼容的未审核草稿");
  }
  if (errors.length)
    throw new HttpError(422, "invalid_draft", "资料结构校验未通过。", {
      errors,
    });
}
function view(row: { value: Draft; etag: string }) {
  return { ...row.value, etag: row.etag };
}
function requiredReviewers(draft: Draft): number {
  if (["rule", "risk"].includes(draft.kind)) return 2;
  if (
    ["program", "claim"].includes(draft.kind) &&
    (draft.content as CatalogImport).programs.some((p) =>
      p.risks.some((r) => r.reviewStatus === "approved"),
    )
  )
    return 2;
  return 1;
}

export function adminRoutes(c: Context): Reply | undefined {
  const actor = c.admin!.actorId;
  if (c.path === "/admin/me" && c.method === "GET")
    return { body: { actorId: actor, roles: c.admin!.roles } };
  if (c.path === "/admin/audit-events" && c.method === "GET") {
    role(c, "auditor");
    return { body: { items: c.store.auditEvents() } };
  }
  if (c.path === "/admin/sources" && c.method === "POST") {
    role(c, "editor");
    const source = c.body as unknown as SourceRecord;
    const validation = validateCatalogImport({
      schemaVersion: 1,
      coverage: { years: [], description: "来源登记", limitations: [] },
      sources: [source],
      programs: [],
    });
    if (!validation.valid)
      throw new HttpError(
        422,
        "invalid_source",
        "来源校验未通过。",
        validation.errors,
      );
    if (c.store.get(adminOwner, "source", source.sourceId))
      throw new HttpError(409, "source_exists", "来源 ID 已登记。");
    c.store.put(adminOwner, "source", source.sourceId, source);
    c.store.audit(actor, "source.register", source.sourceId);
    return { status: 201, body: source };
  }
  const draftMatch =
    /^\/admin\/drafts\/([^/]+)(?:\/([^/]+))?(?:\/(submit-review|withdraw-review))?$/.exec(
      c.path,
    );
  if (draftMatch) {
    const type = kind(draftMatch[1]);
    const key = draftMatch[2];
    const action = draftMatch[3];
    if (
      c.method === "GET" &&
      !c.admin!.roles.some((r) =>
        ["editor", "reviewer", "publisher"].includes(r),
      )
    )
      throw new HttpError(
        403,
        "role_required",
        "审计身份不能读取未发布资料全文。",
      );
    if (c.method === "GET" && !key)
      return {
        body: {
          items: c.store
            .list<Draft>(adminOwner, "draft")
            .filter((row) => row.value.kind === type)
            .map(view),
          nextCursor: null,
        },
      };
    if (c.method === "POST" && !key) {
      role(c, "editor");
      fields(c.body, ["content"]);
      validateContent(type, c.body.content);
      const value: Draft = {
        draftId: id(),
        kind: type,
        content: c.body.content,
        authorId: actor,
        reviewStatus: "draft",
        reviewId: null,
        reviews: [],
        published: false,
      };
      const saved = c.store.put(adminOwner, "draft", value.draftId, value);
      c.store.audit(actor, "draft.create", value.draftId);
      return { status: 201, body: view(saved), etag: saved.etag };
    }
    const current = required(c.store.get<Draft>(adminOwner, "draft", key));
    if (current.value.kind !== type)
      throw new HttpError(404, "draft_not_found", "草稿不存在。");
    if (c.method === "GET") return { body: view(current), etag: current.etag };
    role(c, "editor");
    matchEtag(c.request.headers["if-match"], current.etag);
    if (current.value.authorId !== actor)
      throw new HttpError(
        403,
        "draft_owner_required",
        "只能编辑本人录入的草稿。",
      );
    const value = structuredClone(current.value);
    if (c.method === "PUT" && !action) {
      if (value.reviewStatus !== "draft")
        throw new HttpError(
          409,
          "draft_not_editable",
          "请撤回审核后修改；已批准内容须另建修订。",
        );
      fields(c.body, ["content"]);
      validateContent(type, c.body.content);
      value.content = c.body.content;
    } else if (c.method === "POST" && action === "submit-review") {
      if (value.reviewStatus !== "draft")
        throw new HttpError(
          409,
          "invalid_review_state",
          "只有草稿可提交审核。",
        );
      validateContent(type, value.content);
      value.reviewStatus = "pending_review";
      value.reviewId = id();
      value.reviews = [];
      c.store.put(adminOwner, "review", value.reviewId, {
        draftId: value.draftId,
      });
    } else if (c.method === "POST" && action === "withdraw-review") {
      if (!["pending_review", "rejected"].includes(value.reviewStatus))
        throw new HttpError(
          409,
          "invalid_review_state",
          "当前资料不能撤回审核。",
        );
      value.reviewStatus = "draft";
      value.reviewId = null;
      value.reviews = [];
    } else return;
    const saved = c.store.put(adminOwner, "draft", value.draftId, value);
    c.store.audit(actor, `draft.${action ?? "update"}`, value.draftId);
    return { body: view(saved), etag: saved.etag };
  }
  const reviewMatch = /^\/admin\/reviews\/([^/]+)\/decision$/.exec(c.path);
  if (reviewMatch && c.method === "POST") {
    role(c, "reviewer");
    fields(c.body, ["decision", "reason", "checks"]);
    const link = required(
      c.store.get<{ draftId: string }>(adminOwner, "review", reviewMatch[1]),
    );
    const current = required(
      c.store.get<Draft>(adminOwner, "draft", link.value.draftId),
    );
    matchEtag(c.request.headers["if-match"], current.etag);
    const value = structuredClone(current.value);
    if (
      value.reviewId !== reviewMatch[1] ||
      value.reviewStatus !== "pending_review"
    )
      throw new HttpError(409, "review_closed", "审核已关闭或资料已修改。");
    if (
      actor === value.authorId ||
      value.reviews.some((r) => r.actorId === actor)
    )
      throw new HttpError(
        403,
        "independent_review_required",
        "需要独立复核人员，不可自审或重复计入审核人数。",
      );
    if (!["approved", "rejected"].includes(String(c.body.decision)))
      throw new HttpError(422, "invalid_decision", "审核结论无效。");
    const checks = c.body.checks;
    if (
      value.kind === "question" &&
      c.body.decision === "approved" &&
      (!Array.isArray(checks) ||
        checks.length !== QUESTION_REVIEW_CHECKS.length ||
        new Set(checks).size !== checks.length ||
        checks.some(
          (check) =>
            typeof check !== "string" ||
            !QUESTION_REVIEW_CHECKS.includes(check),
        ))
    )
      throw new HttpError(
        422,
        "question_checks_required",
        "题库批准前须由复核人员逐项确认：唯一答案、完整条件、选项差异、解析一致、适用范围、来源版权。",
      );
    if (value.kind !== "question" && checks !== undefined)
      throw new HttpError(
        422,
        "checks_not_applicable",
        "这些审校项目仅用于题库审核。",
      );
    value.reviews.push({
      actorId: actor,
      decision: String(c.body.decision),
      reason: text(c.body.reason, "审核依据", 3000, true),
      at: now(),
      ...(value.kind === "question" && c.body.decision === "approved"
        ? { checks: [...(checks as string[])] }
        : {}),
    });
    value.reviewStatus =
      c.body.decision === "rejected"
        ? "rejected"
        : value.reviews.filter((r) => r.decision === "approved").length >=
            requiredReviewers(value)
          ? "approved"
          : "pending_review";
    const saved = c.store.put(adminOwner, "draft", value.draftId, value);
    c.store.audit(actor, "review.decision", value.reviewId!);
    return { body: view(saved), etag: saved.etag };
  }
  if (c.path === "/admin/publications" && c.method === "POST") {
    role(c, "publisher");
    fields(c.body, ["kind", "draftIds", "summary"]);
    if (
      !["catalog", "questionBank", "rule"].includes(String(c.body.kind)) ||
      !Array.isArray(c.body.draftIds) ||
      !c.body.draftIds.length ||
      c.body.draftIds.length > 100 ||
      new Set(c.body.draftIds).size !== c.body.draftIds.length
    )
      throw new HttpError(
        422,
        "invalid_publication",
        "请选择类型及不重复的获批草稿。",
      );
    const drafts = c.body.draftIds.map((key) =>
      required(
        c.store.get<Draft>(
          adminOwner,
          "draft",
          text(key, "草稿 ID", 200, true),
        ),
      ),
    );
    if (
      drafts.some(
        (row) =>
          row.value.reviewStatus !== "approved" ||
          row.value.published ||
          new Set(
            row.value.reviews
              .filter(
                (r) =>
                  r.decision === "approved" && r.actorId !== row.value.authorId,
              )
              .map((r) => r.actorId),
          ).size < requiredReviewers(row.value),
      )
    )
      throw new HttpError(
        409,
        "not_publishable",
        "所有草稿须已获足够独立批准且未发布。",
      );
    const summary = text(c.body.summary, "变更摘要", 3000, true);
    const publicationId = id();
    let version = "";
    let revisionIds: string[] = [];
    if (c.body.kind === "catalog") {
      if (
        drafts.some(
          (row) => !["program", "claim", "risk"].includes(row.value.kind),
        )
      )
        throw new HttpError(
          422,
          "kind_mismatch",
          "目录发布仅接受招生、事实与风险批次。",
        );
      let state: CatalogState = catalogState(c.store);
      for (const row of drafts) {
        const bundle = structuredClone(row.value.content as CatalogImport);
        for (const project of bundle.programs)
          for (const risk of project.risks)
            if (risk.reviewStatus === "approved")
              risk.reviewers = row.value.reviews
                .filter((r) => r.decision === "approved")
                .map((r) => r.actorId);
        if (!c.config.sampleData && bundle.programs.some((p) => p.isExample))
          throw new HttpError(
            422,
            "example_forbidden",
            "正式资料库不能发布示例。",
          );
        state = importCatalog(state, bundle, {
          actor: row.value.authorId,
          at: now(),
        });
        for (const p of bundle.programs) {
          state = reviewRevision(state, p.programRevisionId, {
            reviewer: row.value.authorId,
            decision: "submit",
            reason: summary,
            at: now(),
          });
          state = reviewRevision(state, p.programRevisionId, {
            reviewer: row.value.reviews[0].actorId,
            decision: "approve",
            reason: row.value.reviews[0].reason,
            at: now(),
          });
          revisionIds.push(p.programRevisionId);
        }
      }
      const replacing = new Set(
        state.revisions
          .filter((p) => revisionIds.includes(p.programRevisionId))
          .map((p) => p.programId),
      );
      const previous =
        state.releases.find(
          (r) => r.catalogVersion === state.activeCatalogVersion,
        )?.programs ?? [];
      revisionIds = [
        ...previous
          .filter(
            (p) =>
              !replacing.has(p.programId) &&
              !state.withdrawnRevisionIds.includes(p.programRevisionId),
          )
          .map((p) => p.programRevisionId),
        ...revisionIds,
      ];
      version = `catalog-${publicationId}`;
      state = publishCatalog(state, {
        catalogVersion: version,
        revisionIds,
        at: now(),
        reviewer: actor,
        summary,
      });
      c.store.put("public", "catalog", "current", state);
    } else if (c.body.kind === "questionBank") {
      if (drafts.length !== 1 || drafts[0].value.kind !== "question")
        throw new HttpError(422, "kind_mismatch", "一次发布一个完整题库快照。");
      const draft = drafts[0].value;
      const bank = structuredClone(draft.content as QuestionBank);
      const reviewer = draft.reviews[0];
      if (
        !reviewer.checks ||
        QUESTION_REVIEW_CHECKS.some(
          (check) => !reviewer.checks!.includes(check),
        )
      )
        throw new HttpError(
          422,
          "question_checks_required",
          "题库缺少逐项审校记录，不能发布。",
        );
      bank.questions = bank.questions.map((q) => ({
        ...q,
        reviewStatus: "approved",
        review: {
          reviewerId: reviewer.actorId,
          reviewedAt: reviewer.at,
          rationale: reviewer.reason,
          checks: [...reviewer.checks!],
        },
      }));
      const previousBanks = c.store
        .list<QuestionBank>("public", "question-bank")
        .map((row) => row.value);
      version = `questions-${publicationId}`;
      const published = publishQuestionBank(bank, version, previousBanks);
      c.store.put("public", "question-bank", version, published);
      c.store.put("public", "question-bank", "current", published);
    } else {
      if (drafts.length !== 1 || drafts[0].value.kind !== "rule")
        throw new HttpError(422, "kind_mismatch", "一次发布一个规则包。");
      const draft = drafts[0].value;
      const rule = {
        ...(draft.content as RecommendationRule),
        reviewStatus: "approved" as const,
        reviewedBy: draft.reviews.map((r) => r.actorId),
      };
      const validation = validateRule(rule);
      if (!validation.valid)
        throw new HttpError(
          422,
          "invalid_rule",
          "获批规则校验失败。",
          validation.errors,
        );
      version = rule.ruleVersion;
      if (c.store.get("public", "rule", version))
        throw new HttpError(409, "version_exists", "规则版本不可覆盖。");
      c.store.put("public", "rule", version, rule);
      c.store.put("public", "rule", "current", rule);
    }
    for (const row of drafts)
      c.store.put(adminOwner, "draft", row.value.draftId, {
        ...row.value,
        published: true,
      });
    const job = {
      jobId: id(),
      publicationId,
      kind: c.body.kind,
      version,
      revisionIds,
      status: "succeeded",
      summary,
      completedAt: now(),
    };
    c.store.put(adminOwner, "publication", publicationId, job);
    c.store.put(adminOwner, "job", job.jobId, job);
    c.store.audit(actor, "publication.publish", publicationId);
    return { status: 202, body: job };
  }
  const withdraw = /^\/admin\/publications\/([^/]+)\/withdraw$/.exec(c.path);
  if (withdraw && c.method === "POST") {
    role(c, "publisher");
    fields(c.body, ["reason", "revisionIds"]);
    const reason = text(c.body.reason, "撤回原因", 3000, true);
    const publication = required(
      c.store.get<{ kind: string; version: string; revisionIds: string[] }>(
        adminOwner,
        "publication",
        withdraw[1],
      ),
    );
    if (publication.value.kind === "catalog") {
      const ids = c.body.revisionIds ?? publication.value.revisionIds;
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.some((key) => !publication.value.revisionIds.includes(String(key)))
      )
        throw new HttpError(
          422,
          "invalid_withdrawal",
          "撤回范围必须属于本次发布。",
        );
      let state = catalogState(c.store);
      for (const key of ids)
        state = withdrawRevision(state, String(key), {
          reason,
          actor,
          at: now(),
        });
      c.store.put("public", "catalog", "current", state);
    } else if (publication.value.kind === "rule") {
      const active = c.store.get<RecommendationRule>("public", "rule");
      if (active?.value.ruleVersion === publication.value.version)
        c.store.put("public", "rule", "current", {
          ...active.value,
          reviewStatus: "draft",
        });
    } else {
      const bank = c.store.get<QuestionBank>("public", "question-bank");
      if (bank?.value.questionBankVersion === publication.value.version)
        c.store.put("public", "question-bank", "current", {
          ...bank.value,
          questions: bank.value.questions.map((q) => ({
            ...q,
            publicationStatus: "withdrawn",
          })),
        });
      c.store.put("public", "withdrawn-banks", publication.value.version, {
        reason,
      });
      const attempts = c.store.db
        .prepare(
          "SELECT owner,id,value FROM resources WHERE kind='attempt' AND json_extract(value,'$.questionBankVersion')=?",
        )
        .all(publication.value.version);
      for (const row of attempts) {
        const attempt = JSON.parse(String(row.value)) as AssessmentAttempt;
        if (attempt.status === "in_progress")
          c.store.put(
            String(row.owner),
            "attempt",
            String(row.id),
            closeAttempt(attempt, "invalidated", `题库已撤回：${reason}`),
          );
      }
    }
    c.store.audit(actor, "publication.withdraw", withdraw[1]);
    return {
      body: { publicationId: withdraw[1], status: "withdrawn", reason },
    };
  }
  const jobMatch = /^\/admin\/jobs\/([^/]+)$/.exec(c.path);
  if (jobMatch && c.method === "GET") {
    role(c, "publisher");
    return {
      body: required(c.store.get(adminOwner, "job", jobMatch[1])).value,
    };
  }
  if (c.path === "/admin/corrections" && c.method === "GET") {
    role(c, "reviewer");
    return {
      body: {
        items: c.store
          .list(adminOwner, "correction")
          .map((row) => ({ ...(row.value as object), etag: row.etag })),
      },
    };
  }
  const correction = /^\/admin\/corrections\/([^/]+)$/.exec(c.path);
  if (correction && c.method === "PATCH") {
    role(c, "reviewer");
    fields(c.body, ["status", "resolution", "programRevisionId"]);
    const current = required(
      c.store.get<Record<string, unknown>>(
        adminOwner,
        "correction",
        correction[1],
      ),
    );
    matchEtag(c.request.headers["if-match"], current.etag);
    if (
      !["pending", "reviewing", "resolved", "rejected"].includes(
        String(c.body.status),
      )
    )
      throw new HttpError(422, "invalid_status", "处理状态无效。");
    const updated: Record<string, unknown> = {
      ...current.value,
      status: c.body.status,
      resolution: text(c.body.resolution, "处理说明", 3000, true),
      resolvedAt: now(),
    };
    const saved = c.store.put(adminOwner, "correction", correction[1], updated);
    if (
      typeof updated.subjectId === "string" &&
      c.store.get(updated.subjectId, "correction", correction[1])
    )
      c.store.put(updated.subjectId, "correction", correction[1], updated);
    c.store.audit(actor, "correction.update", correction[1]);
    return { body: { ...saved.value, etag: saved.etag }, etag: saved.etag };
  }
}
