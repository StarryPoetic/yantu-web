import type { Context } from "../context.ts";
import { catalog, program, required } from "../context.ts";
import { fields, HttpError, id, matchEtag, now, text } from "../http.ts";
import type { Reply } from "../http.ts";
import type { Resource } from "../store.ts";
import {
  invalidatePerformancePlan,
  performanceApplicability,
  performanceValidityDays,
} from "../performance/index.ts";
import type { PerformanceRecord } from "../performance/index.ts";

function view(c: Context, row: Resource<PerformanceRecord>) {
  const snapshot = catalog(c.store);
  const target = snapshot.programs.find(
    (item) =>
      item.programId === row.value.programId &&
      !snapshot.withdrawnRevisionIds.includes(item.programRevisionId),
  );
  const limitation = performanceApplicability(row.value, target);
  return {
    ...row.value,
    etag: row.etag,
    applicable: limitation === null,
    limitation,
  };
}
function reviewer(c: Context) {
  if (!c.admin?.roles.includes("reviewer"))
    throw new HttpError(403, "reviewer_required", "需要独立成绩复核权限。");
  return c.admin.actorId;
}
function adminRecord(c: Context, performanceId: string) {
  const index = required(
    c.store.get<{ ownerId: string }>(
      "administration",
      "performance-index",
      performanceId,
    ),
  );
  return required(
    c.store.get<PerformanceRecord>(
      index.value.ownerId,
      "performance",
      performanceId,
    ),
  );
}

export function performanceReplay(
  c: Context,
  saved: Record<string, unknown>,
): Reply | undefined {
  if (
    !/^\/(?:me|admin)\/performance(?:\/|$)/.test(c.path) ||
    typeof saved.performanceId !== "string"
  )
    return;
  if (c.admin) {
    reviewer(c);
    const row = adminRecord(c, saved.performanceId);
    return {
      body: {
        performanceId: row.value.performanceId,
        status: row.value.status,
      },
      etag: row.etag,
    };
  }
  const row = required(
    c.store.get<PerformanceRecord>(
      c.session.subjectId,
      "performance",
      saved.performanceId,
    ),
  );
  return { body: view(c, row), etag: row.etag };
}

export function performanceRoutes(c: Context): Reply | undefined {
  if (!/^\/(?:me|admin)\/performance(?:\/|$)/.test(c.path)) return;
  const owner = c.session.subjectId;
  if (c.path === "/me/performance") {
    if (c.method === "GET")
      return {
        body: {
          items: c.store
            .list<PerformanceRecord>(owner, "performance")
            .map((row) => view(c, row)),
          validityDays: performanceValidityDays,
        },
      };
    if (c.method === "POST") {
      if (!c.session.user)
        throw new HttpError(403, "account_required", "请登录账号后提交成绩。");
      fields(c.body, [
        "programId",
        "programRevisionId",
        "targetAdmissionYear",
        "examGroupId",
        "subjectId",
        "score",
        "maxScore",
        "measuredAt",
        "kind",
        "source",
        "evidenceReference",
      ]);
      const target = program(
        c.store,
        text(c.body.programId, "项目", 200, true),
      );
      const subject = target.subjects.find(
        (item) => item.subjectId === c.body.subjectId,
      );
      if (
        target.availability !== "verified_current" ||
        target.programRevisionId !== c.body.programRevisionId ||
        target.identity.targetAdmissionYear !== c.body.targetAdmissionYear ||
        !target.identity.examGroupId ||
        target.identity.examGroupId !== c.body.examGroupId ||
        !subject ||
        subject.availability !== "verified_current" ||
        subject.maxScore === null ||
        subject.maxScore !== c.body.maxScore
      )
        throw new HttpError(
          422,
          "performance_scope",
          "目标年度、项目修订、科目、满分和考试组须与已核验目录一致。",
        );
      if (
        typeof c.body.score !== "number" ||
        !Number.isFinite(c.body.score) ||
        c.body.score < 0 ||
        c.body.score > subject.maxScore
      )
        throw new HttpError(
          422,
          "performance_score",
          "成绩须在该科目满分范围内。",
        );
      if (
        !["standardized_mock", "validated_assessment"].includes(
          String(c.body.kind),
        )
      )
        throw new HttpError(
          422,
          "performance_kind",
          "只接受有可核验依据的实际考试或同口径模拟考试，五题小测和自报估分不适用。",
        );
      const measured = text(c.body.measuredAt, "测量日期", 10, true);
      const measuredAt = `${measured}T00:00:00.000Z`;
      const at = now();
      const expiresAt = new Date(
        Date.parse(measuredAt) + performanceValidityDays * 86400000,
      );
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(measured) ||
        !Number.isFinite(expiresAt.getTime()) ||
        new Date(measuredAt).toISOString().slice(0, 10) !== measured ||
        measured > at.slice(0, 10) ||
        expiresAt.getTime() <= Date.parse(at) ||
        Number(measured.slice(0, 4)) <
          target.identity.targetAdmissionYear - 1 ||
        Number(measured.slice(0, 4)) > target.identity.targetAdmissionYear
      )
        throw new HttpError(
          422,
          "performance_date",
          "成绩日期须属于目标招生年度或前一年，且在最近180天内，不能使用未来日期。",
        );
      const value: PerformanceRecord = {
        performanceId: id(),
        ownerId: owner,
        programId: target.programId,
        programRevisionId: target.programRevisionId,
        targetAdmissionYear: target.identity.targetAdmissionYear,
        examGroupId: target.identity.examGroupId,
        subjectId: subject.subjectId,
        subjectName: subject.name,
        programLabel: `${target.display.institutionName} · ${target.display.majorName}`,
        score: c.body.score,
        maxScore: subject.maxScore,
        measuredAt,
        expiresAt: expiresAt.toISOString(),
        kind: c.body.kind as PerformanceRecord["kind"],
        source: text(c.body.source, "考试名称与来源", 300, true),
        evidenceReference: text(
          c.body.evidenceReference,
          "成绩证明定位",
          2000,
          true,
        ),
        submittedAt: at,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        reviewReason: null,
        reviewChecks: [],
        withdrawnAt: null,
        withdrawalReason: null,
      };
      const saved = c.store.put(
        owner,
        "performance",
        value.performanceId,
        value,
      );
      c.store.put("administration", "performance-index", value.performanceId, {
        ownerId: owner,
      });
      c.store.audit(owner, "performance.submit", value.performanceId);
      return { status: 201, body: view(c, saved), etag: saved.etag };
    }
  }
  const own = /^\/me\/performance\/([^/]+)(?:\/(withdraw))?$/.exec(c.path);
  if (own) {
    const row = required(
      c.store.get<PerformanceRecord>(owner, "performance", own[1]),
    );
    if (c.method === "GET" && !own[2])
      return { body: view(c, row), etag: row.etag };
    if (c.method === "POST" && own[2]) {
      fields(c.body, ["reason"]);
      matchEtag(c.request.headers["if-match"], row.etag);
      if (row.value.status === "withdrawn")
        throw new HttpError(409, "performance_closed", "成绩已经撤回。");
      const value: PerformanceRecord = {
        ...row.value,
        status: "withdrawn",
        withdrawnAt: now(),
        withdrawalReason: text(c.body.reason, "撤回原因", 1000, true),
      };
      const saved = c.store.put(owner, "performance", own[1], value);
      invalidatePerformancePlan(
        c.store,
        owner,
        "成绩依据已撤回，请重新核验并保存计划",
        own[1],
      );
      c.store.audit(owner, "performance.withdraw", own[1]);
      return { body: view(c, saved), etag: saved.etag };
    }
  }
  if (c.path === "/admin/performance" && c.method === "GET") {
    reviewer(c);
    return {
      body: {
        items: c.store
          .list<{ ownerId: string }>("administration", "performance-index")
          .flatMap((index) => {
            const row = c.store.get<PerformanceRecord>(
              index.value.ownerId,
              "performance",
              index.id,
            );
            return row ? [view(c, row)] : [];
          }),
      },
    };
  }
  const decision = /^\/admin\/performance\/([^/]+)\/(decision|withdraw)$/.exec(
    c.path,
  );
  if (decision && c.method === "POST") {
    const actor = reviewer(c);
    const row = adminRecord(c, decision[1]);
    matchEtag(c.request.headers["if-match"], row.etag);
    fields(
      c.body,
      decision[2] === "decision"
        ? ["decision", "reason", "checks"]
        : ["reason"],
    );
    const reason = text(c.body.reason, "审核说明", 1000, true);
    if (reason.length < 10)
      throw new HttpError(
        422,
        "performance_reason",
        "请填写至少10字的核验依据或撤回原因。",
      );
    let value: PerformanceRecord;
    if (decision[2] === "withdraw") {
      if (row.value.status !== "approved")
        throw new HttpError(
          409,
          "performance_state",
          "只能撤回已审核通过的成绩。",
        );
      value = {
        ...row.value,
        status: "withdrawn",
        withdrawnAt: now(),
        withdrawalReason: reason,
      };
    } else {
      if (row.value.status !== "pending")
        throw new HttpError(
          409,
          "performance_state",
          "该成绩已处理，请刷新队列。",
        );
      if (
        actor === row.value.ownerId ||
        c.session.user?.accountId === row.value.ownerId
      )
        throw new HttpError(
          403,
          "independent_review",
          "提交人不能审核自己的成绩。",
        );
      if (!["approved", "rejected"].includes(String(c.body.decision)))
        throw new HttpError(422, "performance_decision", "请选择通过或拒绝。");
      const checks = Array.isArray(c.body.checks)
        ? c.body.checks.filter(
            (check): check is string => typeof check === "string",
          )
        : [];
      value = {
        ...row.value,
        status: c.body.decision as "approved" | "rejected",
        reviewedBy: actor,
        reviewedAt: now(),
        reviewReason: reason,
        reviewChecks: checks,
      };
      if (value.status === "approved") {
        const target = program(c.store, value.programId);
        const limitation = performanceApplicability(value, target);
        if (limitation)
          throw new HttpError(422, "performance_not_comparable", limitation);
      }
    }
    const saved = c.store.put(
      value.ownerId,
      "performance",
      value.performanceId,
      value,
    );
    invalidatePerformancePlan(
      c.store,
      value.ownerId,
      "成绩审核状态已变化，请重新核验并保存计划",
      value.performanceId,
    );
    c.store.audit(actor, `performance.${decision[2]}`, value.performanceId);
    // Admin idempotency records retain no score, source, evidence or personal text.
    return {
      body: { performanceId: value.performanceId, status: value.status },
      etag: saved.etag,
    };
  }
}
