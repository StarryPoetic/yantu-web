import type { Context } from "../context.ts";
import { catalog, required } from "../context.ts";
import { fields, HttpError, integer, matchEtag, now, text } from "../http.ts";
import type { ResearchJob } from "./research.ts";
import type { GuidanceRun } from "../disciplines/types.ts";
import { requireResearchInputsUnlocked } from "./research-lock.ts";
import {
  matchResearchProgram,
  type ResearchInterest,
} from "../../shared/research-interest.ts";

export function researchInterestRoutes(c: Context) {
  const owner = c.session.subjectId;
  const path = "/me/research-interests";
  if (c.path === path && c.method === "GET")
    return {
      body: {
        items: c.store
          .list<ResearchInterest>(owner, "research-interest")
          .map((row) => ({ ...row.value, etag: row.etag })),
      },
    };
  if (c.path === path && c.method === "POST") {
    requireResearchInputsUnlocked(c);
    fields(c.body, ["jobId", "recommendationIndex", "target"]);
    if (c.body.target !== undefined && typeof c.body.target !== "boolean")
      throw new HttpError(422, "invalid_target", "目标状态必须为布尔值。");
    const jobId = text(c.body.jobId, "报告编号", 200, true);
    const job = required(
      c.store.get<ResearchJob>(owner, "research-job", jobId),
    ).value;
    const run = required(
      c.store.get<GuidanceRun>(owner, "guidance", job.guidanceRunId),
    ).value;
    const index = integer(
      c.body.recommendationIndex,
      "建议序号",
      0,
      Math.max(0, (job.report?.recommendations.length ?? 0) - 1),
    );
    const recommendation = job.report?.recommendations[index];
    if (!recommendation)
      throw new HttpError(
        422,
        "recommendation_missing",
        "报告中没有这条建议。",
      );
    const interestId = `${jobId}:${index}`;
    const previous = c.store.get<ResearchInterest>(
      owner,
      "research-interest",
      interestId,
    );
    if (!previous && c.store.list(owner, "research-interest").length >= 200)
      throw new HttpError(422, "interest_limit", "研究关注项最多 200 项。");
    const targetYear = Number(run.inputSnapshot.profile.year);
    const snapshot = catalog(c.store);
    const value: ResearchInterest = previous
      ? {
          ...previous.value,
          favorite: true,
          target: previous.value.target || c.body.target === true,
        }
      : {
          interestId,
          jobId,
          recommendationIndex: index,
          targetYear,
          referenceYear: recommendation.referenceBasis?.year ?? null,
          createdAt: now(),
          verified: false,
          reviewStatus: "unreviewed",
          status: "pending_verification",
          recommendation,
          sources: job.report!.sources,
          linkedProgram: matchResearchProgram(
            recommendation,
            targetYear,
            snapshot.programs.filter(
              (program) =>
                !snapshot.withdrawnRevisionIds.includes(
                  program.programRevisionId,
                ),
            ),
          ),
          favorite: true,
          target: c.body.target === true,
          tasks: [
            ...new Set([
              "核验目标年度招生资格、专业身份与考试科目",
              ...recommendation.preparation,
            ]),
          ].map((title) => ({ title, completed: false })),
        };
    const saved = c.store.put(owner, "research-interest", interestId, value);
    return {
      status: previous ? 200 : 201,
      body: saved.value,
      etag: saved.etag,
    };
  }
  const match = /^\/me\/research-interests\/([^/]+)$/.exec(c.path);
  if (match && c.method === "PATCH") {
    requireResearchInputsUnlocked(c);
    fields(c.body, ["favorite", "target", "completedTasks"]);
    const current = required(
      c.store.get<ResearchInterest>(
        owner,
        "research-interest",
        decodeURIComponent(match[1]),
      ),
    );
    matchEtag(c.request.headers["if-match"], current.etag);
    for (const key of ["favorite", "target"])
      if (c.body[key] !== undefined && typeof c.body[key] !== "boolean")
        throw new HttpError(422, "invalid_interest", "关注状态格式错误。");
    const completed = c.body.completedTasks;
    if (
      completed !== undefined &&
      (!Array.isArray(completed) ||
        completed.length !== current.value.tasks.length ||
        completed.some((value) => typeof value !== "boolean"))
    )
      throw new HttpError(422, "invalid_tasks", "准备任务状态格式错误。");
    const value = {
      ...current.value,
      favorite: (c.body.favorite as boolean) ?? current.value.favorite,
      target: (c.body.target as boolean) ?? current.value.target,
      tasks: current.value.tasks.map((task, index) => ({
        ...task,
        completed:
          completed === undefined
            ? task.completed
            : (completed as boolean[])[index],
      })),
    };
    const saved = c.store.put(
      owner,
      "research-interest",
      value.interestId,
      value,
    );
    return { body: saved.value, etag: saved.etag };
  }
}
