import type { ProgramRevision } from "../catalog/types.ts";
import type { CurrentPerformance, PlanSnapshot } from "../planning/index.ts";
import type { Store } from "../store.ts";
import { catalog } from "../context.ts";
import { now } from "../http.ts";

/** Operational expiry only; this is not a validated measurement/calibration claim. */
export const performanceValidityDays = 180;
export const performanceReviewChecks = [
  "evidence_verified",
  "scope_comparable",
  "score_checked",
] as const;
export interface PerformanceRecord {
  performanceId: string;
  ownerId: string;
  programId: string;
  programRevisionId: string;
  targetAdmissionYear: number;
  examGroupId: string;
  subjectId: string;
  subjectName: string;
  programLabel: string;
  score: number;
  maxScore: number;
  measuredAt: string;
  expiresAt: string;
  kind: "standardized_mock" | "validated_assessment";
  source: string;
  evidenceReference: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  reviewChecks: string[];
  withdrawnAt: string | null;
  withdrawalReason: string | null;
}

export function performanceApplicability(
  item: PerformanceRecord,
  target: ProgramRevision | undefined,
  at = now(),
): string | null {
  if (item.status !== "approved") return "成绩尚未审核通过或已经撤回";
  if (!item.reviewedBy || item.reviewedBy === item.ownerId || !item.reviewedAt)
    return "缺少独立审核记录";
  if (
    !performanceReviewChecks.every((check) => item.reviewChecks.includes(check))
  )
    return "审核检查项不完整";
  if (
    !Number.isFinite(Date.parse(item.expiresAt)) ||
    Date.parse(item.expiresAt) <= Date.parse(at)
  )
    return "已超过测量日起180天的操作有效期，请重新提交可核验成绩";
  if (
    !Number.isFinite(Date.parse(item.measuredAt)) ||
    Date.parse(item.measuredAt) > Date.parse(at) ||
    Number(item.measuredAt.slice(0, 4)) < item.targetAdmissionYear - 1 ||
    Number(item.measuredAt.slice(0, 4)) > item.targetAdmissionYear
  )
    return "测量日期无效";
  if (
    !target ||
    target.availability !== "verified_current" ||
    target.programId !== item.programId ||
    target.programRevisionId !== item.programRevisionId ||
    target.identity.targetAdmissionYear !== item.targetAdmissionYear ||
    !item.examGroupId ||
    target.identity.examGroupId !== item.examGroupId
  )
    return "目标年度、项目修订或考试组已变更，须重新核验成绩适用范围";
  const subject = target.subjects.find(
    (row) => row.subjectId === item.subjectId,
  );
  if (
    !subject ||
    subject.availability !== "verified_current" ||
    subject.maxScore !== item.maxScore ||
    !Number.isFinite(item.score) ||
    item.score < 0 ||
    item.score > item.maxScore
  )
    return "科目或满分口径不匹配";
  return null;
}

export function currentPerformance(
  store: Store,
  owner: string,
  target: ProgramRevision,
  at = now(),
): CurrentPerformance[] {
  return store
    .list<PerformanceRecord>(owner, "performance")
    .flatMap(({ value }) =>
      performanceApplicability(value, target, at)
        ? []
        : [
            {
              performanceId: value.performanceId,
              subjectId: value.subjectId,
              score: value.score,
              maxScore: value.maxScore,
              measuredAt: value.measuredAt,
              source: value.source,
              kind: value.kind,
              examGroupId: value.examGroupId,
              reviewed: true,
            },
          ],
    );
}

export function stalePlanPerformance(
  store: Store,
  owner: string,
  plan: PlanSnapshot,
): boolean {
  const snapshot = catalog(store);
  const target = snapshot.programs.find(
    (item) =>
      item.programId === plan.programId &&
      !snapshot.withdrawnRevisionIds.includes(item.programRevisionId),
  );
  return plan.subjects.some(({ currentEvidence }) => {
    if (!currentEvidence) return false;
    const record = currentEvidence.performanceId
      ? store.get<PerformanceRecord>(
          owner,
          "performance",
          currentEvidence.performanceId,
        )?.value
      : undefined;
    return (
      !record ||
      Boolean(performanceApplicability(record, target)) ||
      record.score !== currentEvidence.score ||
      record.maxScore !== currentEvidence.maxScore
    );
  });
}

/** Keep historical snapshots, but never present withdrawn/expired scores as the current plan. */
export function invalidatePerformancePlan(
  store: Store,
  owner: string,
  reason: string,
  performanceId?: string,
) {
  const current = store.get<PlanSnapshot | null>(owner, "plan");
  if (
    !current?.value ||
    !current.value.subjects.some(
      (item) =>
        item.currentEvidence &&
        (!performanceId ||
          item.currentEvidence.performanceId === performanceId),
    )
  )
    return;
  const plan: PlanSnapshot = {
    ...current.value,
    planVersion: current.value.planVersion + 1,
    generatedAt: now(),
    valid: false,
    status: "needs_review",
    subjects: current.value.subjects.map((item) => ({
      ...item,
      currentScore: null,
      currentEvidence: null,
      gap: null,
      gapStatus: "pending",
    })),
    pendingItems: [...new Set([...current.value.pendingItems, reason])],
  };
  store.put(owner, "plan", "current", plan);
  store.put(owner, "plan-history", `${plan.planId}:${plan.planVersion}`, plan);
  for (const row of store.list<Record<string, unknown>>(owner, "task")) {
    if (row.value.planId === plan.planId && !row.value.completed)
      store.put(owner, "task", row.id, {
        ...row.value,
        needsReconfirmation: true,
      });
  }
}
