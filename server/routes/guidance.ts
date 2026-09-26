import { fields, HttpError, id, integer, now, object, text } from "../http.ts";
import type { Reply } from "../http.ts";
import { required } from "../context.ts";
import type { Context } from "../context.ts";
import type { AssessmentAttempt } from "../assessment/types.ts";
import {
  generateGuidance,
  getDisciplineCatalog,
  guidanceRuleVersion,
} from "../disciplines/index.ts";
import type { GuidanceAssessment, GuidanceRun } from "../disciplines/types.ts";
import { profileResource, selectionsResource } from "./profile.ts";

export function guidanceFreshness(c: Context, run: GuidanceRun) {
  const refreshReasons: string[] = [];
  if (run.versions.profileVersion !== profileResource(c).value.profileVersion)
    refreshReasons.push("个人画像已更新");
  if (
    run.versions.selectionVersion !==
    selectionsResource(c).value.selectionVersion
  )
    refreshReasons.push("确认专业或屏蔽选择已更新");
  if (run.versions.catalogVersion !== getDisciplineCatalog().catalogVersion)
    refreshReasons.push("全国学科目录版本已更新");
  if (run.versions.guidanceRuleVersion !== guidanceRuleVersion)
    refreshReasons.push("探索解释规则已更新");
  for (const reference of run.versions.assessmentRefs) {
    const attempt = c.store.get<AssessmentAttempt>(
      c.session.subjectId,
      "attempt",
      reference.assessmentAttemptId,
    )?.value;
    if (
      !attempt ||
      attempt.status !== "submitted" ||
      attempt.applicability.applicability !== "applicable" ||
      attempt.diagnosis?.diagnosisVersion !== reference.diagnosisVersion ||
      c.store.get("public", "withdrawn-banks", attempt.questionBankVersion)
    ) {
      refreshReasons.push("引用测评的状态、适用范围或诊断版本已变化");
      break;
    }
  }
  return { needsRefresh: refreshReasons.length > 0, refreshReasons };
}

function guidanceView(c: Context, run: GuidanceRun) {
  return { ...run, ...guidanceFreshness(c, run) };
}

export function guidanceRoutes(c: Context): Reply | undefined {
  if (c.path === "/disciplines" && c.method === "GET") {
    for (const key of c.query.keys()) {
      if (!["q", "groupCode", "degreeType"].includes(key))
        throw new HttpError(400, "unknown_filter", "不支持的学科目录筛选。");
      if (c.query.getAll(key).length > 1)
        throw new HttpError(
          400,
          "duplicate_filter",
          "同一目录筛选不能重复提交。",
        );
    }
    const q = text(c.query.get("q") ?? "", "搜索词", 100);
    const groupCode = c.query.get("groupCode") || undefined;
    const degreeType = c.query.get("degreeType") || undefined;
    const directory = getDisciplineCatalog();
    if (
      groupCode &&
      !directory.groups.some((group) => group.code === groupCode)
    )
      throw new HttpError(422, "invalid_group", "未知学科门类。");
    if (degreeType && !["academic", "professional"].includes(degreeType))
      throw new HttpError(422, "invalid_degree_type", "未知学位类型。");
    return {
      body: getDisciplineCatalog({
        q,
        groupCode,
        degreeType: degreeType as "academic" | "professional" | undefined,
      }),
    };
  }
  if (c.path === "/guidance/latest" && c.method === "GET") {
    const latest = c.store.get<{ guidanceRunId: string }>(
      c.session.subjectId,
      "guidance-latest",
    );
    const run = latest
      ? c.store.get<GuidanceRun>(
          c.session.subjectId,
          "guidance",
          latest.value.guidanceRunId,
        )?.value
      : null;
    return { body: { guidance: run ? guidanceView(c, run) : null } };
  }
  const match = /^\/guidance\/([^/]+)$/.exec(c.path);
  if (match && c.method === "GET") {
    const run = required(
      c.store.get<GuidanceRun>(c.session.subjectId, "guidance", match[1]),
    );
    return { body: guidanceView(c, run.value), etag: run.etag };
  }
  if (c.path !== "/guidance" || c.method !== "POST") return;
  fields(c.body, ["profileVersion", "selectionVersion", "assessmentRefs"]);
  const profile = profileResource(c).value;
  const selections = selectionsResource(c).value;
  if (!profile.profileCompleted)
    throw new HttpError(
      409,
      "profile_required",
      "请先确认并保存个人画像；尚未确定的内容可以留空。",
    );
  if (
    integer(c.body.profileVersion, "画像版本", 0, Number.MAX_SAFE_INTEGER) !==
      profile.profileVersion ||
    integer(c.body.selectionVersion, "选择版本", 0, Number.MAX_SAFE_INTEGER) !==
      selections.selectionVersion
  ) {
    throw new HttpError(
      409,
      "stale_input",
      "个人画像或选择已更新，请刷新后重新生成。",
    );
  }
  if (
    !Array.isArray(c.body.assessmentRefs) ||
    c.body.assessmentRefs.length > 20
  )
    throw new HttpError(
      422,
      "invalid_assessments",
      "测评引用格式错误或超过20项。",
    );
  const assessments: GuidanceAssessment[] = [];
  const ignored: GuidanceRun["assessmentSummary"]["ignored"] = [];
  const seen = new Set<string>();
  for (const value of c.body.assessmentRefs) {
    const reference = object(value);
    fields(reference, ["assessmentAttemptId", "diagnosisVersion"]);
    const assessmentAttemptId = text(
      reference.assessmentAttemptId,
      "测评编号",
      200,
      true,
    );
    const diagnosisVersion = text(
      reference.diagnosisVersion,
      "诊断版本",
      200,
      true,
    );
    if (seen.has(assessmentAttemptId))
      throw new HttpError(
        422,
        "duplicate_assessment",
        "同一测评只能引用一次。",
      );
    seen.add(assessmentAttemptId);
    const attempt = required(
      c.store.get<AssessmentAttempt>(
        c.session.subjectId,
        "attempt",
        assessmentAttemptId,
      ),
    ).value;
    const diagnosis = attempt.diagnosis;
    if (
      attempt.subjectId !== c.session.subjectId ||
      attempt.status !== "submitted" ||
      !diagnosis ||
      diagnosis.diagnosisVersion !== diagnosisVersion
    ) {
      throw new HttpError(
        409,
        "assessment_changed",
        "测评尚未提交、已失效或诊断版本已变化。",
      );
    }
    if (c.store.get("public", "withdrawn-banks", attempt.questionBankVersion)) {
      ignored.push({
        assessmentAttemptId,
        diagnosisVersion,
        reason: "引用测评的题库已撤回，本次结论不使用该诊断",
      });
      continue;
    }
    if (
      attempt.applicability.applicability !== "applicable" ||
      attempt.stage === "major"
    ) {
      ignored.push({
        assessmentAttemptId,
        diagnosisVersion,
        reason:
          attempt.stage === "major"
            ? "单一专业测评不用于全目录专业探索"
            : "本次测评适用性尚未确认或已不适用",
      });
      continue;
    }
    assessments.push({
      assessmentAttemptId,
      diagnosisVersion,
      example: diagnosis.example,
      usableForRecommendation: diagnosis.usableForRecommendation,
      modules: structuredClone(
        diagnosis.modules.filter((module) => module.module !== "major"),
      ),
      weakPoints: [
        ...new Set(
          diagnosis.items
            .filter(
              (item) => item.module !== "major" && item.outcome !== "correct",
            )
            .map((item) => item.point),
        ),
      ],
      limitations: [...diagnosis.limitations],
    });
  }
  const run = generateGuidance({
    subjectId: c.session.subjectId,
    guidanceRunId: id(),
    generatedAt: now(),
    profile: profile.profile,
    profileVersion: profile.profileVersion,
    selectionVersion: selections.selectionVersion,
    confirmedMajorId: selections.confirmedMajorId,
    excludedMajorIds: selections.exclusions
      .filter((item) => item.scope === "majorDirection")
      .map((item) => item.objectId),
    assessments,
    ignoredAssessments: ignored,
  });
  const saved = c.store.put(
    c.session.subjectId,
    "guidance",
    run.guidanceRunId,
    run,
  );
  c.store.put(c.session.subjectId, "guidance-latest", "current", {
    guidanceRunId: run.guidanceRunId,
  });
  return { status: 201, body: guidanceView(c, run), etag: saved.etag };
}
