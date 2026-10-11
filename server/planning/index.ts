import type {
  ProgramRevision,
  ScoreRecord,
  SubjectRequirement,
} from "../catalog/types.ts";
import { evaluateEligibility } from "../recommendation/index.ts";
import { programMatchesDiscipline } from "../../shared/discipline-matching.ts";

export class PlanningError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "PlanningError";
  }
}

export interface CurrentPerformance {
  subjectId: string;
  score: number;
  maxScore: number;
  measuredAt: string;
  source: string;
  kind:
    | "standardized_mock"
    | "validated_assessment"
    | "five_question_screening"
    | "self_report";
  examGroupId: string | null;
  reviewed: boolean;
}
export interface PlanInput {
  planId: string;
  planVersion: number;
  subjectId: string;
  program: ProgramRevision;
  catalogVersion: string;
  ruleVersion?: string;
  recommendationRunId?: string | null;
  generatedAt: string;
  targetScores?: Record<string, number | null>;
  targetTotalScore?: number | null;
  selectedSubjectIds?: string[];
  currentPerformance?: CurrentPerformance[];
  confirmedMajorId?: string | null;
  profile?: Record<string, unknown>;
  previousPlan?: PlanSnapshot;
}
export interface PlanSubject {
  subjectId: string;
  name: string;
  maxScore: number | null;
  minimumScore: number | null;
  targetScore: number | null;
  targetOrigin: "user" | "pending";
  currentScore: number | null;
  currentEvidence: CurrentPerformance | null;
  gap: number | null;
  gapStatus: "pending" | "reached" | "below_target";
  limitations: string[];
}
export interface PlanTask {
  taskId: string;
  planId: string;
  planVersion: number;
  subjectId: string | null;
  title: string;
  source: "catalog_verification" | "confirmed_subject";
  needsReconfirmation: boolean;
}
export interface PlanSnapshot {
  schemaVersion: 1;
  planId: string;
  planVersion: number;
  subjectId: string;
  programId: string;
  programRevisionId: string;
  programSnapshot: ProgramRevision;
  catalogVersion: string;
  ruleVersion: string;
  recommendationRunId: string | null;
  generatedAt: string;
  status: "draft" | "pending_verification" | "valid" | "needs_review";
  valid: boolean;
  subjects: PlanSubject[];
  totalTargetScore: number | null;
  totalMaxScore: number | null;
  totalMinimumScore: number | null;
  interviewRequirement: string | null;
  errors: string[];
  pendingItems: string[];
  warnings: string[];
  historicalReferences: ScoreRecord[];
  tasks: PlanTask[];
  previousTaskIdsNeedingReconfirmation: string[];
}

function chooseSubjects(
  program: ProgramRevision,
  selected: string[] | undefined,
  errors: string[],
  pending: string[],
): SubjectRequirement[] {
  const groups = new Map<string, SubjectRequirement[]>();
  const required: SubjectRequirement[] = [];
  for (const subject of program.subjects) {
    if (!subject.optionGroupId) required.push(subject);
    else
      groups.set(subject.optionGroupId, [
        ...(groups.get(subject.optionGroupId) ?? []),
        subject,
      ]);
  }
  if (
    selected?.some(
      (id) => !program.subjects.some((subject) => subject.subjectId === id),
    )
  )
    errors.push("含目标项目以外的考试科目");
  for (const [groupId, options] of groups) {
    const chosen = options.filter((subject) =>
      selected?.includes(subject.subjectId),
    );
    if (chosen.length > 1)
      errors.push(`官方可选科目组 ${groupId} 只能选择一项`);
    if (!chosen.length) pending.push(`待确认官方可选科目组 ${groupId}`);
    else required.push(chosen[0]);
  }
  return required;
}

/** Produces a new immutable plan. It never turns diagnostic correctness into exam marks. */
export function buildPlan(input: PlanInput): PlanSnapshot {
  if (!Number.isInteger(input.planVersion) || input.planVersion < 1)
    throw new PlanningError("INVALID_PLAN_VERSION");
  if (!Number.isFinite(Date.parse(input.generatedAt)))
    throw new PlanningError("INVALID_GENERATED_AT");
  if (
    input.previousPlan &&
    (input.previousPlan.planId !== input.planId ||
      input.previousPlan.subjectId !== input.subjectId ||
      input.planVersion !== input.previousPlan.planVersion + 1)
  )
    throw new PlanningError("PLAN_VERSION_CONFLICT");
  const program = input.program;
  const errors: string[] = [];
  const pendingItems: string[] = [];
  const warnings = [
    "目标分数是备考安排，不是录取保证；历史最低录取分不能作为安全线。",
  ];
  if (!input.profile) pendingItems.push("尚未针对当前画像核验报考资格");
  else {
    const eligibility = evaluateEligibility(
      program,
      input.profile,
      program.identity.targetAdmissionYear,
    );
    if (eligibility.status === "ineligible")
      errors.push(
        ...eligibility.reasons.map((reason) => `报考资格不满足：${reason}`),
      );
    else if (eligibility.status === "unknown")
      pendingItems.push(
        ...eligibility.reasons.map((reason) => `报考资格待核验：${reason}`),
      );
  }
  const selected = chooseSubjects(
    program,
    input.selectedSubjectIds,
    errors,
    pendingItems,
  );
  if (!selected.length) pendingItems.push("实际考试科目尚未明确");
  if (
    program.isExample ||
    program.availability !== "verified_current" ||
    program.publicationStatus !== "published" ||
    program.reviewStatus !== "approved"
  )
    pendingItems.push("目标年度项目资料尚未核验或不能用于当前规划");
  if (program.scoreRequirements.availability !== "verified_current")
    pendingItems.push("目标年度总分、单科与复试要求待核验");
  if (!program.scoreRequirements.interviewRequirement)
    pendingItems.push("复试条件待核验");
  if (program.scoreRequirements.totalMaxScore === null)
    pendingItems.push("总分满分待核验");
  if (program.scoreRequirements.totalMinimumScore === null)
    pendingItems.push("目标年度总分门槛待核验");
  for (const id of Object.keys(input.targetScores ?? {}))
    if (!selected.some((subject) => subject.subjectId === id))
      errors.push(`不能为未选定的科目 ${id} 设定目标`);
  const subjects = selected.map((subject): PlanSubject => {
    const targetScore = input.targetScores?.[subject.subjectId] ?? null;
    const limitations: string[] = [];
    if (
      targetScore !== null &&
      (!Number.isFinite(targetScore) || targetScore < 0)
    )
      errors.push(`${subject.name} 目标必须是非负有限数值`);
    if (targetScore === null) pendingItems.push(`${subject.name} 目标待制定`);
    if (subject.availability !== "verified_current")
      pendingItems.push(`${subject.name} 的科目、满分与门槛尚未核验`);
    if (subject.maxScore === null)
      pendingItems.push(`${subject.name} 满分待核验`);
    if (subject.maxScore === null && targetScore !== null)
      errors.push(`${subject.name} 满分未知，目标分数只能为空，请清除历史数值`);
    if (subject.minimumScore === null)
      pendingItems.push(`${subject.name} 单科最低要求待核验`);
    if (
      subject.availability === "verified_current" &&
      targetScore !== null &&
      subject.maxScore !== null &&
      targetScore > subject.maxScore
    )
      errors.push(`${subject.name} 目标超过实际满分 ${subject.maxScore}`);
    if (
      subject.availability === "verified_current" &&
      targetScore !== null &&
      subject.minimumScore !== null &&
      targetScore < subject.minimumScore
    )
      errors.push(
        `${subject.name} 目标低于已核验单科门槛 ${subject.minimumScore}`,
      );
    const evidence =
      (input.currentPerformance ?? [])
        .filter(
          (item) =>
            item.subjectId === subject.subjectId &&
            item.reviewed &&
            ["standardized_mock", "validated_assessment"].includes(item.kind) &&
            item.maxScore === subject.maxScore &&
            item.examGroupId === program.identity.examGroupId &&
            Boolean(item.source.trim()) &&
            Number.isFinite(Date.parse(item.measuredAt)) &&
            Date.parse(item.measuredAt) <= Date.parse(input.generatedAt) &&
            Number.isFinite(item.score) &&
            item.score >= 0 &&
            item.score <= item.maxScore &&
            subject.availability === "verified_current",
        )
        .sort(
          (a, b) =>
            b.measuredAt.localeCompare(a.measuredAt) ||
            a.source.localeCompare(b.source),
        )[0] ?? null;
    if (!evidence)
      limitations.push(
        "当前能力缺少同科目、同满分、同口径的可靠测量，差距保持待评估",
      );
    if (targetScore !== null)
      limitations.push("用户自定目标，尚未经目标建议规则核验");
    const currentScore = evidence?.score ?? null;
    const gap =
      targetScore !== null &&
      Number.isFinite(targetScore) &&
      currentScore !== null
        ? Math.max(0, targetScore - currentScore)
        : null;
    return {
      subjectId: subject.subjectId,
      name: subject.name,
      maxScore: subject.maxScore,
      minimumScore: subject.minimumScore,
      targetScore,
      targetOrigin: targetScore === null ? "pending" : "user",
      currentScore,
      currentEvidence: evidence ? structuredClone(evidence) : null,
      gap,
      gapStatus:
        gap === null ? "pending" : gap === 0 ? "reached" : "below_target",
      limitations,
    };
  });
  const allTargets =
    subjects.length > 0 &&
    subjects.every(
      (subject) =>
        subject.targetScore !== null &&
        Number.isFinite(subject.targetScore) &&
        subject.targetScore >= 0,
    );
  const computedTotal = allTargets
    ? subjects.reduce((sum, subject) => sum + subject.targetScore!, 0)
    : null;
  const explicitTotal = input.targetTotalScore ?? null;
  if (
    program.scoreRequirements.totalMaxScore === null &&
    explicitTotal !== null
  )
    errors.push("总分满分未知，目标总分只能为空");
  if (
    explicitTotal !== null &&
    (!Number.isFinite(explicitTotal) || explicitTotal < 0)
  )
    errors.push("总分目标必须是非负有限数值");
  if (
    explicitTotal !== null &&
    computedTotal !== null &&
    Math.abs(explicitTotal - computedTotal) > 0.000001
  )
    errors.push("总分目标与各科目标合计不一致");
  const totalTargetScore = computedTotal ?? explicitTotal;
  if (
    program.scoreRequirements.availability === "verified_current" &&
    totalTargetScore !== null
  ) {
    if (
      program.scoreRequirements.totalMaxScore !== null &&
      totalTargetScore > program.scoreRequirements.totalMaxScore
    )
      errors.push("目标合计超过该项目实际总分满分");
    if (
      program.scoreRequirements.totalMinimumScore !== null &&
      totalTargetScore < program.scoreRequirements.totalMinimumScore
    )
      errors.push("目标合计低于当年已核验总分门槛");
  }
  if (
    subjects.length &&
    subjects.every((subject) => subject.maxScore !== null) &&
    program.scoreRequirements.totalMaxScore !== null &&
    Math.abs(
      subjects.reduce((sum, subject) => sum + subject.maxScore!, 0) -
        program.scoreRequirements.totalMaxScore,
    ) > 0.000001
  )
    errors.push("目录科目满分合计与总分口径不一致，需要更正资料");
  const incompatible = Boolean(
    input.confirmedMajorId &&
      !programMatchesDiscipline(program, input.confirmedMajorId),
  );
  if (incompatible)
    pendingItems.push("当前确认专业与目标项目不兼容，请重新确认目标");
  const status = incompatible
    ? "needs_review"
    : errors.length
      ? "draft"
      : pendingItems.length
        ? "pending_verification"
        : "valid";
  const tasks: PlanTask[] = [
    {
      taskId: `${input.planId}:v${input.planVersion}:verify`,
      planId: input.planId,
      planVersion: input.planVersion,
      subjectId: null,
      title: "核验目标年度招生资格、考试科目与复试要求",
      source: "catalog_verification",
      needsReconfirmation: incompatible,
    },
    ...subjects.map((subject) => ({
      taskId: `${input.planId}:v${input.planVersion}:${subject.subjectId}`,
      planId: input.planId,
      planVersion: input.planVersion,
      subjectId: subject.subjectId,
      title: `${subject.name}：核对考试范围并安排基础复习`,
      source: "confirmed_subject" as const,
      needsReconfirmation: incompatible,
    })),
  ];
  const changed =
    input.previousPlan &&
    (input.previousPlan.programRevisionId !== program.programRevisionId ||
      JSON.stringify(
        input.previousPlan.subjects.map((s) => s.subjectId).sort(),
      ) !== JSON.stringify(subjects.map((s) => s.subjectId).sort()) ||
      incompatible);
  return {
    schemaVersion: 1,
    planId: input.planId,
    planVersion: input.planVersion,
    subjectId: input.subjectId,
    programId: program.programId,
    programRevisionId: program.programRevisionId,
    programSnapshot: structuredClone(program),
    catalogVersion: input.catalogVersion,
    ruleVersion: input.ruleVersion ?? "planning-rules-pending-review",
    recommendationRunId: input.recommendationRunId ?? null,
    generatedAt: input.generatedAt,
    status,
    valid: status === "valid",
    subjects,
    totalTargetScore,
    totalMaxScore: program.scoreRequirements.totalMaxScore,
    totalMinimumScore: program.scoreRequirements.totalMinimumScore,
    interviewRequirement: program.scoreRequirements.interviewRequirement,
    errors,
    pendingItems: [...new Set(pendingItems)],
    warnings,
    historicalReferences: structuredClone(program.historyScoreRecords),
    tasks,
    previousTaskIdsNeedingReconfirmation: changed
      ? input.previousPlan!.tasks.map((task) => task.taskId)
      : [],
  };
}
