import { catalog, program, required } from "../context.ts";
import type { Context } from "../context.ts";
import {
  canonical,
  fields,
  HttpError,
  id,
  integer,
  matchEtag,
  now,
  object,
  text,
} from "../http.ts";
import type { Reply } from "../http.ts";
import { profileResource, selectionsResource } from "./profile.ts";
import { recommend, exampleRule } from "../recommendation/index.ts";
import type {
  AssessmentReference,
  RecommendationRun,
  RecommendationRule,
  RecommendationFilters,
} from "../recommendation/index.ts";
import type { AssessmentAttempt } from "../assessment/types.ts";
import { buildPlan } from "../planning/index.ts";
import type { PlanSnapshot, PlanTask } from "../planning/index.ts";
import { buildReport } from "../reports/index.ts";
import type { ReportSnapshot } from "../reports/index.ts";

type TaskState = PlanTask & { completed: boolean };
function candidates(run: RecommendationRun) {
  return [...run.ranked, ...run.pendingVerification, ...run.eligibleUnranked];
}
function currentPlan(c: Context) {
  return (
    c.store.get<PlanSnapshot | null>(c.session.subjectId, "plan") ??
    c.store.put<PlanSnapshot | null>(
      c.session.subjectId,
      "plan",
      "current",
      null,
    )
  );
}
function runView(c: Context, run: RecommendationRun) {
  const current = catalog(c.store);
  const withdrawn = current.withdrawnRevisionIds;
  const rule = c.store.get<RecommendationRule>("public", "rule")?.value;
  const ruleChanged = rule
    ? rule.ruleVersion !== run.versions.ruleVersion ||
      rule.reviewStatus !== "approved"
    : !c.config.sampleData;
  const inputsChanged =
    profileResource(c).value.profileVersion !== run.versions.profileVersion ||
    selectionsResource(c).value.selectionVersion !==
      run.versions.selectionVersion;
  return {
    ...run,
    items: run.ranked,
    catalogVersion: run.versions.catalogVersion,
    ruleVersion: run.versions.ruleVersion,
    profileVersion: run.versions.profileVersion,
    selectionVersion: run.versions.selectionVersion,
    assessmentRefs: run.versions.assessmentRefs,
    ignoredAssessmentRefs: run.excludedAssessmentRefs,
    exclusionReasons: run.excluded,
    coverage: catalog(c.store, run.versions.catalogVersion).coverage,
    needsRefresh:
      inputsChanged ||
      ruleChanged ||
      current.catalogVersion !== run.versions.catalogVersion ||
      candidates(run).some((p) => withdrawn.includes(p.programRevisionId)),
  };
}
function planContent(plan: PlanSnapshot) {
  // Identity, creation time and generated task IDs describe the save operation, not the user's plan.
  const {
    planId: _planId,
    planVersion: _planVersion,
    generatedAt: _generatedAt,
    tasks: _tasks,
    previousTaskIdsNeedingReconfirmation: _previousTasks,
    ...content
  } = plan;
  return canonical(content);
}
export function workRoutes(c: Context): Reply | undefined {
  const owner = c.session.subjectId;
  if (c.path === "/recommendations" && c.method === "POST") {
    fields(c.body, [
      "profileVersion",
      "selectionVersion",
      "targetAdmissionYear",
      "filters",
      "assessmentRefs",
    ]);
    const profile = profileResource(c).value;
    const selection = selectionsResource(c).value;
    if (
      c.body.profileVersion !== profile.profileVersion ||
      c.body.selectionVersion !== selection.selectionVersion
    )
      throw new HttpError(
        412,
        "version_conflict",
        "画像或选择已更新，请刷新后重新推荐。",
      );
    const year = integer(c.body.targetAdmissionYear, "招生年度", 2000, 2200);
    const filters = object(c.body.filters ?? {});
    fields(filters, [
      "institutionIds",
      "majorDirectionIds",
      "degreeTypes",
      "studyModes",
      "cities",
    ]);
    for (const [key, value] of Object.entries(filters))
      if (
        !Array.isArray(value) ||
        value.length > 100 ||
        value.some((v) => typeof v !== "string" || v.length > 200)
      )
        throw new HttpError(422, "invalid_filters", `${key}筛选格式错误。`);
    if (
      !Array.isArray(c.body.assessmentRefs ?? []) ||
      (c.body.assessmentRefs as unknown[] | undefined)?.length! > 20
    )
      throw new HttpError(422, "invalid_assessments", "测评引用最多 20 项。");
    const refs: AssessmentReference[] = [];
    const ignored: (AssessmentReference & { reason: string })[] = [];
    for (const raw of (c.body.assessmentRefs as unknown[]) ?? []) {
      const value = object(raw);
      fields(value, ["assessmentAttemptId", "diagnosisVersion"]);
      const ref = {
        assessmentAttemptId: text(
          value.assessmentAttemptId,
          "测评 ID",
          200,
          true,
        ),
        diagnosisVersion: text(value.diagnosisVersion, "诊断版本", 200, true),
      };
      const attempt = required(
        c.store.get<AssessmentAttempt>(
          owner,
          "attempt",
          ref.assessmentAttemptId,
        ),
      ).value;
      if (
        attempt.status !== "submitted" ||
        attempt.diagnosis?.diagnosisVersion !== ref.diagnosisVersion
      )
        throw new HttpError(
          409,
          "diagnosis_not_current",
          "诊断版本不存在或已更正，请重新选择。",
        );
      if (c.store.get("public", "withdrawn-banks", attempt.questionBankVersion))
        ignored.push({ ...ref, reason: "题库版本已撤回" });
      else if (attempt.example || !attempt.diagnosis.usableForRecommendation)
        ignored.push({ ...ref, reason: "示例诊断不作为真实推荐依据" });
      else if (attempt.applicability.applicability !== "applicable")
        ignored.push({ ...ref, reason: attempt.applicability.reason });
      else if (
        !refs.some((r) => r.assessmentAttemptId === ref.assessmentAttemptId)
      )
        refs.push(ref);
    }
    const rule = c.store.get<RecommendationRule>("public", "rule")?.value;
    if (!c.config.sampleData && (!rule || rule.reviewStatus !== "approved"))
      throw new HttpError(
        503,
        "rules_not_ready",
        "推荐规则尚未独立复核发布，可以继续查询招生资料。",
      );
    const run = recommend({
      recommendationRunId: id(),
      subjectId: owner,
      profileVersion: profile.profileVersion,
      selectionVersion: selection.selectionVersion,
      targetAdmissionYear: year,
      profile: profile.profile as unknown as Record<string, unknown>,
      selection: {
        confirmedMajorId: selection.confirmedMajorId,
        targetProgramId: selection.targetProgramId,
        favoriteProgramIds: selection.savedProgramIds,
        blockedInstitutionIds: selection.exclusions
          .filter((e) => e.scope === "institution")
          .map((e) => e.objectId),
        blockedMajorIds: selection.exclusions
          .filter((e) => e.scope === "majorDirection")
          .map((e) => e.objectId),
        blockedProgramIds: selection.exclusions
          .filter((e) => e.scope === "program")
          .map((e) => e.objectId),
      },
      filters: filters as RecommendationFilters,
      assessmentRefs: refs,
      excludedAssessmentRefs: ignored,
      catalog: catalog(c.store),
      rule: rule ?? exampleRule,
      generatedAt: now(),
    });
    c.store.put(owner, "recommendation", run.recommendationRunId, run);
    return { status: 201, body: runView(c, run) };
  }
  const runMatch = /^\/recommendations\/([^/]+)$/.exec(c.path);
  if (runMatch && c.method === "GET")
    return {
      body: runView(
        c,
        required(
          c.store.get<RecommendationRun>(owner, "recommendation", runMatch[1]),
        ).value,
      ),
    };
  if (c.path === "/recommendations" && c.method === "GET")
    return {
      body: {
        items: c.store
          .list<RecommendationRun>(owner, "recommendation")
          .map((row) => runView(c, row.value)),
        nextCursor: null,
      },
    };
  if (c.path === "/me/plan") {
    const current = currentPlan(c);
    if (c.method === "GET")
      return {
        body: {
          plan: current.value,
          planVersion: current.value?.planVersion ?? 0,
        },
        etag: current.etag,
      };
    if (c.method === "PUT") {
      fields(c.body, [
        "selectionVersion",
        "programId",
        "programRevisionId",
        "recommendationRunId",
        "subjectTargets",
        "selectedSubjectIds",
        "targetTotalScore",
      ]);
      matchEtag(c.request.headers["if-match"], current.etag);
      const selectionResource = selectionsResource(c);
      const selection = selectionResource.value;
      if (c.body.selectionVersion !== selection.selectionVersion)
        throw new HttpError(
          412,
          "version_conflict",
          "选择已更新，请刷新后确认目标。",
        );
      const target = program(
        c.store,
        text(c.body.programId, "项目 ID", 200, true),
      );
      if (target.programRevisionId !== c.body.programRevisionId)
        throw new HttpError(
          409,
          "revision_changed",
          "项目资料已更新，请重新查看。",
        );
      let run: RecommendationRun | undefined;
      if (c.body.recommendationRunId) {
        run = required(
          c.store.get<RecommendationRun>(
            owner,
            "recommendation",
            text(c.body.recommendationRunId, "推荐 ID", 200, true),
          ),
        ).value;
        if (
          !candidates(run).some(
            (p) => p.programRevisionId === target.programRevisionId,
          ) ||
          run.versions.catalogVersion !== catalog(c.store).catalogVersion ||
          run.inputSnapshot.targetAdmissionYear !==
            target.identity.targetAdmissionYear
        )
          throw new HttpError(
            409,
            "plan_run_mismatch",
            "目标不属于该推荐版本，请重新推荐。",
          );
      }
      const targetScores =
        c.body.subjectTargets === undefined
          ? undefined
          : object(c.body.subjectTargets);
      if (
        targetScores &&
        Object.values(targetScores).some(
          (value) =>
            value !== null &&
            (typeof value !== "number" || !Number.isFinite(value) || value < 0),
        )
      )
        throw new HttpError(
          422,
          "invalid_scores",
          "分数必须是非负数或待制定。",
        );
      if (
        c.body.selectedSubjectIds !== undefined &&
        (!Array.isArray(c.body.selectedSubjectIds) ||
          c.body.selectedSubjectIds.some((x) => typeof x !== "string"))
      )
        throw new HttpError(422, "invalid_subjects", "科目选择格式错误。");
      const plan = buildPlan({
        planId: current.value?.planId ?? id(),
        planVersion: (current.value?.planVersion ?? 0) + 1,
        subjectId: owner,
        program: target,
        profile: profileResource(c).value.profile as unknown as Record<
          string,
          unknown
        >,
        catalogVersion: catalog(c.store).catalogVersion,
        ruleVersion: run?.versions.ruleVersion,
        recommendationRunId: run?.recommendationRunId,
        generatedAt: now(),
        targetScores: targetScores as Record<string, number | null> | undefined,
        targetTotalScore: c.body.targetTotalScore as number | undefined,
        selectedSubjectIds: c.body.selectedSubjectIds as string[] | undefined,
        confirmedMajorId: selection.confirmedMajorId,
        previousPlan: current.value ?? undefined,
      });
      if (plan.errors.length)
        throw new HttpError(422, "invalid_plan", "分数规划未通过校验。", {
          errors: plan.errors,
        });
      if (
        current.value &&
        selection.targetProgramId === target.programId &&
        planContent(current.value) === planContent(plan)
      )
        return {
          body: {
            plan: current.value,
            planVersion: current.value.planVersion,
            selectionVersion: selection.selectionVersion,
            selectionETag: selectionResource.etag,
          },
          etag: current.etag,
        };
      const saved = c.store.put(owner, "plan", "current", plan);
      c.store.put(
        owner,
        "plan-history",
        `${plan.planId}:${plan.planVersion}`,
        plan,
      );
      const selections = c.store.put(owner, "selections", "current", {
        ...selection,
        targetProgramId: target.programId,
        selectionVersion: selection.selectionVersion + 1,
      });
      for (const taskId of plan.previousTaskIdsNeedingReconfirmation) {
        const task = c.store.get<TaskState>(owner, "task", taskId);
        if (task)
          c.store.put(owner, "task", taskId, {
            ...task.value,
            needsReconfirmation: !task.value.completed,
          });
      }
      for (const task of plan.tasks) {
        const old =
          current.value?.programRevisionId === plan.programRevisionId
            ? current.value.tasks.find((t) => t.subjectId === task.subjectId)
            : undefined;
        const completed = old
          ? (c.store.get<TaskState>(owner, "task", old.taskId)?.value
              .completed ?? false)
          : false;
        c.store.put(owner, "task", task.taskId, { ...task, completed });
      }
      return {
        body: {
          plan,
          planVersion: plan.planVersion,
          selectionVersion: selections.value.selectionVersion,
          selectionETag: selections.etag,
        },
        etag: saved.etag,
      };
    }
  }
  const planHistory = /^\/me\/plans\/([^/]+)\/versions\/(\d+)$/.exec(c.path);
  if (planHistory && c.method === "GET")
    return {
      body: {
        plan: required(
          c.store.get(
            owner,
            "plan-history",
            `${planHistory[1]}:${planHistory[2]}`,
          ),
        ).value,
      },
    };
  if (c.path === "/me/tasks" && c.method === "GET") {
    const plan = currentPlan(c).value;
    const taskIds = new Set(plan?.tasks.map((t) => t.taskId) ?? []);
    return {
      body: {
        items: c.store
          .list<TaskState>(owner, "task")
          .filter((row) => taskIds.has(row.id))
          .map((row) => ({
            ...row.value,
            etag: row.etag,
            needsConfirmation: row.value.needsReconfirmation,
          })),
      },
    };
  }
  const taskMatch = /^\/me\/tasks\/([^/]+)$/.exec(c.path);
  if (taskMatch && c.method === "PATCH") {
    fields(c.body, ["completed"]);
    if (typeof c.body.completed !== "boolean")
      throw new HttpError(422, "invalid_task", "任务完成状态必须明确。");
    const task = required(c.store.get<TaskState>(owner, "task", taskMatch[1]));
    matchEtag(c.request.headers["if-match"], task.etag);
    const saved = c.store.put(owner, "task", taskMatch[1], {
      ...task.value,
      completed: c.body.completed,
    });
    return { body: { ...saved.value, etag: saved.etag }, etag: saved.etag };
  }
  if (c.path === "/reports" && c.method === "POST") {
    fields(c.body, ["recommendationRunId", "planId", "planVersion", "format"]);
    if (c.body.format !== "markdown")
      throw new HttpError(
        422,
        "unsupported_format",
        "当前支持 Markdown 报告。",
      );
    const run = required(
      c.store.get<RecommendationRun>(
        owner,
        "recommendation",
        text(c.body.recommendationRunId, "推荐 ID", 200, true),
      ),
    ).value;
    if ((c.body.planId === undefined) !== (c.body.planVersion === undefined))
      throw new HttpError(
        422,
        "plan_pair_required",
        "计划 ID 与版本须同时提供。",
      );
    const plan = c.body.planId
      ? required(
          c.store.get<PlanSnapshot>(
            owner,
            "plan-history",
            `${text(c.body.planId, "计划 ID", 200, true)}:${integer(c.body.planVersion, "计划版本", 1, 1000000)}`,
          ),
        ).value
      : undefined;
    if (plan) {
      const active = currentPlan(c).value;
      const confirmedMajorId = selectionsResource(c).value.confirmedMajorId;
      if (
        (active?.planId === plan.planId && active.status === "needs_review") ||
        (confirmedMajorId &&
          !plan.programSnapshot.majorDirectionIds.includes(confirmedMajorId))
      )
        throw new HttpError(
          409,
          "plan_needs_review",
          "当前画像或专业与该计划依据不一致，请重新确认计划；已有历史报告仍可查看。",
        );
    }
    const snapshot = catalog(c.store, run.versions.catalogVersion);
    if (
      candidates(run).some((p) =>
        snapshot.withdrawnRevisionIds.includes(p.programRevisionId),
      )
    )
      throw new HttpError(
        409,
        "source_withdrawn",
        "报告依据已撤回，请重新推荐。",
      );
    if (
      plan &&
      (plan.status === "needs_review" ||
        plan.recommendationRunId !== run.recommendationRunId ||
        plan.catalogVersion !== run.versions.catalogVersion ||
        plan.ruleVersion !== run.versions.ruleVersion ||
        plan.programSnapshot.identity.targetAdmissionYear !==
          run.inputSnapshot.targetAdmissionYear ||
        !candidates(run).some(
          (p) => p.programRevisionId === plan.programRevisionId,
        ))
    )
      throw new HttpError(
        409,
        "report_dependencies_mismatch",
        "报告与计划依据不一致，请重新推荐并保存目标。",
      );
    const report = buildReport({
      reportId: id(),
      subjectId: owner,
      generatedAt: now(),
      recommendation: run,
      plan,
      catalog: snapshot,
    });
    const job = {
      jobId: id(),
      type: "report",
      status: "succeeded",
      reportId: report.reportId,
      completedAt: now(),
    };
    c.store.put(owner, "report", report.reportId, report);
    c.store.put(owner, "job", job.jobId, job);
    return {
      status: 202,
      body: {
        reportId: report.reportId,
        jobId: job.jobId,
        status: "succeeded",
      },
    };
  }
  if (c.path === "/reports" && c.method === "GET")
    return {
      body: {
        items: c.store.list<ReportSnapshot>(owner, "report").map((row) => ({
          reportId: row.id,
          generatedAt: row.value.generatedAt,
          status: "succeeded",
          recommendationRunId: row.value.recommendation.recommendationRunId,
        })),
        nextCursor: null,
      },
    };
  const reportMatch = /^\/reports\/([^/]+)$/.exec(c.path);
  if (reportMatch && c.method === "GET") {
    const report = required(
      c.store.get<ReportSnapshot>(owner, "report", reportMatch[1]),
    ).value;
    const current = catalog(c.store);
    const withdrawn = candidates(report.recommendation).some((p) =>
      current.withdrawnRevisionIds.includes(p.programRevisionId),
    );
    return {
      body: {
        ...report,
        status: "succeeded",
        needsRefresh: runView(c, report.recommendation).needsRefresh,
        withdrawn,
        warning: withdrawn
          ? "依据已撤回，仅保留历史记录，请勿继续作为报考依据。"
          : null,
      },
    };
  }
  if (c.path === "/corrections" && c.method === "POST") {
    fields(c.body, [
      "programId",
      "programRevisionId",
      "field",
      "description",
      "evidenceUrls",
    ]);
    const target = program(
      c.store,
      text(c.body.programId, "项目 ID", 200, true),
    );
    if (target.programRevisionId !== c.body.programRevisionId)
      throw new HttpError(
        409,
        "revision_changed",
        "请基于最新项目资料提交纠错。",
      );
    const urls = c.body.evidenceUrls ?? [];
    if (
      !Array.isArray(urls) ||
      urls.length > 5 ||
      urls.some(
        (url) =>
          typeof url !== "string" ||
          url.length > 2048 ||
          !/^https:\/\//.test(url),
      )
    )
      throw new HttpError(
        422,
        "invalid_evidence",
        "最多提供 5 个 HTTPS 资料链接。",
      );
    const value = {
      correctionId: id(),
      subjectId: owner,
      programId: target.programId,
      programRevisionId: target.programRevisionId,
      field: text(c.body.field, "字段", 200, true),
      description: text(c.body.description, "说明", 3000, true),
      evidenceUrls: urls,
      status: "pending",
      createdAt: now(),
    };
    c.store.put(owner, "correction", value.correctionId, value);
    c.store.put("administration", "correction", value.correctionId, value);
    return { status: 201, body: value };
  }
  if (c.path === "/me/corrections" && c.method === "GET")
    return {
      body: {
        items: c.store.list(owner, "correction").map((row) => row.value),
      },
    };
}
