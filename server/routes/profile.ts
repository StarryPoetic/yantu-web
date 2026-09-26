import { blankProfile, blankSelections, validateProfile } from "../profile.ts";
import type { Selections } from "../profile.ts";
import type { Profile } from "../../shared/profile.ts";
import {
  canonical,
  fields,
  HttpError,
  id,
  matchEtag,
  now,
  object,
  text,
} from "../http.ts";
import type { Reply } from "../http.ts";
import type { Context } from "../context.ts";
import { catalog, program, required } from "../context.ts";
import { reassessApplicability } from "../assessment/index.ts";
import type { AssessmentAttempt } from "../assessment/types.ts";
import type { PlanSnapshot } from "../planning/index.ts";
import { isDisciplineId } from "../disciplines/index.ts";
import { programMatchesDiscipline } from "../../shared/discipline-matching.ts";

export const deletionScopeVersion = "all-personal-v1";
export const deletionScope = [
  "画像及历史版本",
  "测评草稿、作答与诊断",
  "推荐与报告",
  "收藏、屏蔽及确认专业",
  "目标计划与阶段任务",
  "纠错记录与个人解释缓存",
];
export interface ProfileResource {
  profile: Profile;
  profileVersion: number;
  profileSavedAt: string | null;
  profileCompleted: boolean;
}
export function profileResource(c: Context) {
  const current = c.store.get<ProfileResource>(c.session.subjectId, "profile");
  if (
    current &&
    typeof current.value.profileCompleted === "boolean" &&
    current.value.profileSavedAt !== undefined
  )
    return current;
  return c.store.put(c.session.subjectId, "profile", "current", {
    profile: current?.value.profile ?? blankProfile(),
    profileVersion: current?.value.profileVersion ?? 0,
    profileSavedAt: current?.value.profileSavedAt ?? null,
    // Earlier saved resources have a positive version, but their save time was not recorded.
    profileCompleted: (current?.value.profileVersion ?? 0) > 0,
  });
}
export function selectionsResource(c: Context) {
  return (
    c.store.get<Selections>(c.session.subjectId, "selections") ??
    c.store.put(c.session.subjectId, "selections", "current", blankSelections())
  );
}
function requirePlanReview(c: Context, reason: string) {
  const plan = c.store.get<PlanSnapshot | null>(c.session.subjectId, "plan");
  if (!plan?.value) return;
  const updated: PlanSnapshot = {
    ...plan.value,
    status: "needs_review",
    valid: false,
    planVersion: plan.value.planVersion + 1,
    generatedAt: now(),
    pendingItems: [...new Set([...plan.value.pendingItems, reason])],
  };
  c.store.put(c.session.subjectId, "plan", "current", updated);
  c.store.put(
    c.session.subjectId,
    "plan-history",
    `${updated.planId}:${updated.planVersion}`,
    updated,
  );
  for (const task of c.store.list<Record<string, unknown>>(
    c.session.subjectId,
    "task",
  )) {
    if (task.value.planId === updated.planId && !task.value.completed)
      c.store.put(c.session.subjectId, "task", task.id, {
        ...task.value,
        needsReconfirmation: true,
      });
  }
}
function saveSelections(c: Context, desired: Selections): Reply {
  const current = selectionsResource(c);
  matchEtag(c.request.headers["if-match"], current.etag);
  const programs = catalog(c.store).programs;
  if (
    desired.savedProgramIds.some(
      (key) => !programs.some((p) => p.programId === key),
    )
  )
    throw new HttpError(422, "unknown_program", "收藏项目不存在。");
  if (
    desired.confirmedMajorId &&
    !isDisciplineId(desired.confirmedMajorId) &&
    !programs.some((p) =>
      p.majorDirectionIds.includes(desired.confirmedMajorId!),
    )
  )
    throw new HttpError(422, "unknown_major", "专业方向不存在。");
  for (const exclusion of desired.exclusions) {
    const exists =
      (exclusion.scope === "majorDirection" &&
        isDisciplineId(exclusion.objectId)) ||
      programs.some((p) =>
        exclusion.scope === "institution"
          ? p.identity.institutionId === exclusion.objectId
          : exclusion.scope === "majorDirection"
            ? p.majorDirectionIds.includes(exclusion.objectId)
            : p.programId === exclusion.objectId,
      );
    if (!exists)
      throw new HttpError(422, "unknown_exclusion", "屏蔽对象不存在。");
  }
  const value = {
    ...desired,
    selectionVersion: current.value.selectionVersion,
  };
  if (canonical(current.value) === canonical(value))
    return { body: current.value, etag: current.etag };
  value.selectionVersion++;
  const saved = c.store.put(
    c.session.subjectId,
    "selections",
    "current",
    value,
  );
  if (value.confirmedMajorId !== current.value.confirmedMajorId) {
    for (const row of c.store.list<AssessmentAttempt>(
      c.session.subjectId,
      "attempt",
    )) {
      const updated = reassessApplicability(row.value, {
        confirmedMajorId: value.confirmedMajorId ?? undefined,
      });
      c.store.put(c.session.subjectId, "attempt", row.id, updated);
    }
    const plan = c.store.get<PlanSnapshot | null>(c.session.subjectId, "plan");
    if (
      plan?.value &&
      (!value.confirmedMajorId ||
        !programMatchesDiscipline(
          plan.value.programSnapshot,
          value.confirmedMajorId,
        ))
    ) {
      requirePlanReview(c, "确认专业已变化，请重新确认目标项目和备考任务");
    }
  }
  return { body: saved.value, etag: saved.etag };
}
export function profileRoutes(c: Context): Reply | undefined {
  const owner = c.session.subjectId;
  if (c.path === "/me/profile") {
    const current = profileResource(c);
    if (c.method === "GET") return { body: current.value, etag: current.etag };
    if (c.method === "PUT") {
      matchEtag(c.request.headers["if-match"], current.etag);
      const profile = validateProfile(c.body);
      if (
        current.value.profileCompleted &&
        canonical(profile) === canonical(current.value.profile)
      )
        return { body: current.value, etag: current.etag };
      const value = {
        profile,
        profileVersion: current.value.profileVersion + 1,
        profileSavedAt: now(),
        profileCompleted: true,
      };
      const saved = c.store.put(owner, "profile", "current", value);
      c.store.put(
        owner,
        "profile-history",
        String(value.profileVersion),
        value,
      );
      requirePlanReview(c, "个人画像已更新，请重新核验报考资格与目标条件");
      return { body: value, etag: saved.etag };
    }
    if (c.method === "DELETE") {
      matchEtag(c.request.headers["if-match"], current.etag);
      if (c.request.headers["deletion-scope-version"] !== deletionScopeVersion)
        throw new HttpError(
          409,
          "deletion_scope_changed",
          "请重新查看删除范围后确认。",
        );
      const generation = c.store.erase(owner);
      const job = {
        jobId: id(),
        type: "deletion",
        status: "succeeded",
        deletionGeneration: generation,
        deletionScopeVersion,
        completedScope: deletionScope,
        completedAt: now(),
        backupNotice: "此本地实例不创建自动备份；已下载文件不受本次删除影响。",
      };
      c.store.put(owner, "deletion-job", job.jobId, job);
      return { status: 202, body: job };
    }
  }
  if (c.path === "/me/profile/deletion-preview" && c.method === "GET")
    return {
      body: {
        deletionScopeVersion,
        required: deletionScope,
        retained: ["当前会话与删除作业状态", "不包含个人内容的公共资料"],
        deadline: "在线数据在事务完成后不可访问；此实例不创建自动备份。",
      },
    };
  if (c.path.startsWith("/me/jobs/") && c.method === "GET") {
    const key = c.path.split("/")[3];
    return {
      body: required(
        c.store.get(owner, "deletion-job", key) ??
          c.store.get(owner, "job", key),
      ).value,
    };
  }
  if (c.path === "/me/selections") {
    const current = selectionsResource(c);
    if (c.method === "GET") return { body: current.value, etag: current.etag };
    if (c.method === "PUT") {
      fields(c.body, [
        "confirmedMajorId",
        "savedProgramIds",
        "exclusions",
        "targetProgramId",
      ]);
      if (
        c.body.targetProgramId !== undefined &&
        c.body.targetProgramId !== current.value.targetProgramId
      )
        throw new HttpError(422, "use_plan", "请通过目标规划修改目标项目。");
      if (
        !Array.isArray(c.body.savedProgramIds) ||
        c.body.savedProgramIds.length > 200 ||
        !Array.isArray(c.body.exclusions) ||
        c.body.exclusions.length > 200
      )
        throw new HttpError(
          422,
          "invalid_selections",
          "选择清单格式错误或超过 200 项。",
        );
      const exclusions = c.body.exclusions.map((raw) => {
        const item = object(raw);
        fields(item, ["scope", "objectId", "reason"]);
        if (
          !["institution", "majorDirection", "program"].includes(
            String(item.scope),
          )
        )
          throw new HttpError(422, "invalid_scope", "未知屏蔽类型。");
        return {
          scope: item.scope as Selections["exclusions"][number]["scope"],
          objectId: text(item.objectId, "对象", 200, true),
          reason:
            item.reason === undefined
              ? "用户主动排除"
              : text(item.reason, "原因", 500),
        };
      });
      return saveSelections(c, {
        ...current.value,
        confirmedMajorId:
          c.body.confirmedMajorId === null
            ? null
            : text(c.body.confirmedMajorId, "专业", 200, true),
        savedProgramIds: [
          ...new Set(
            c.body.savedProgramIds.map((x) => text(x, "项目", 200, true)),
          ),
        ],
        exclusions: [
          ...new Map(
            exclusions.map((e) => [`${e.scope}:${e.objectId}`, e]),
          ).values(),
        ],
      });
    }
  }
  if (c.path === "/me/confirmed-major" && c.method === "PUT") {
    fields(c.body, ["majorDirectionId", "confirmedMajorId"]);
    const raw = c.body.majorDirectionId ?? c.body.confirmedMajorId ?? null;
    return saveSelections(c, {
      ...selectionsResource(c).value,
      confirmedMajorId: raw === null ? null : text(raw, "专业", 200, true),
    });
  }
  if (c.path === "/me/saved-programs" && c.method === "GET")
    return {
      body: {
        items: selectionsResource(c).value.savedProgramIds.map((key) =>
          program(c.store, key),
        ),
        nextCursor: null,
      },
    };
  if (c.path === "/me/exclusions" && c.method === "GET")
    return { body: { items: selectionsResource(c).value.exclusions } };
  const savedMatch = /^\/me\/saved-programs\/([^/]+)$/.exec(c.path);
  if (savedMatch && ["PUT", "DELETE"].includes(c.method)) {
    const value = selectionsResource(c).value;
    const keys = value.savedProgramIds.filter((k) => k !== savedMatch[1]);
    if (c.method === "PUT") keys.push(savedMatch[1]);
    return saveSelections(c, { ...value, savedProgramIds: keys });
  }
  const exclusionMatch =
    /^\/me\/exclusions\/(institution|majorDirection|program)\/([^/]+)$/.exec(
      c.path,
    );
  if (exclusionMatch && ["PUT", "DELETE"].includes(c.method)) {
    const value = selectionsResource(c).value;
    const exclusions = value.exclusions.filter(
      (e) => e.scope !== exclusionMatch[1] || e.objectId !== exclusionMatch[2],
    );
    if (c.method === "PUT")
      exclusions.push({
        scope: exclusionMatch[1] as Selections["exclusions"][number]["scope"],
        objectId: exclusionMatch[2],
      });
    return saveSelections(c, { ...value, exclusions });
  }
}
