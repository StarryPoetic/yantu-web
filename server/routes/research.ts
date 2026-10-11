import type { ResearchCheckpoint } from "../explanation/research-resume.ts";
import type { Context } from "../context.ts";
import { catalog, program, required } from "../context.ts";
import type { Store } from "../store.ts";
import type { GuidanceRun } from "../disciplines/types.ts";
import type { ProgramRevision } from "../catalog/types.ts";
import type {
  createResearchReportModule,
  ResearchReport,
  ResearchStage,
} from "../explanation/research.ts";
import { fields, HttpError, id, now } from "../http.ts";
import type { Reply } from "../http.ts";
import { guidanceFreshness } from "./guidance.ts";
import { selectionsResource } from "./profile.ts";
import { researchReason } from "../../shared/research-status.ts";

export type ResearchEngine = ReturnType<typeof createResearchReportModule>;
export interface ResearchJob {
  jobId: string;
  guidanceRunId: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "blocked"
    | "failed"
    | "cancelled";
  stage: ResearchStage | "queued" | "done";
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  events: { stage: string; message: string; at: string }[];
  report?: ResearchReport;
  mode?: "generate" | "supplement" | "retry";
  target?: {
    programId: string;
    programRevisionId: string;
    catalogVersion: string;
  };
}
const stages: Record<ResearchStage, { progress: number; message: string }> = {
  preparing: {
    progress: 10,
    message: "正在按保存需求建立调查方向，并整理测评准备依据",
  },
  researching: {
    progress: 30,
    message: "正在检索院校与专业资料，读取可访问的官网原文",
  },
  analyzing: {
    progress: 60,
    message: "正在核对实际项目与需求，补充准备成本和培养路线分析",
  },
  writing: { progress: 90, message: "正在核对引用与专业代码，整理报告" },
};
const activeStatus = (job: ResearchJob) =>
  ["queued", "running"].includes(job.status);

/** Persist real stage transitions; network/model work runs outside database transactions. */
export function createResearchRoutes(store: Store, engine: ResearchEngine) {
  const running = new Map<string, { owner: string; promise: Promise<void> }>();
  let closed = false;
  // A restarted process cannot resume an upstream paid request safely.
  store.db
    .prepare(
      "UPDATE resources SET value=json_set(value,'$.status','failed','$.message',?,'$.updatedAt',?),version=version+1 WHERE kind='research-job' AND json_extract(value,'$.status') IN ('queued','running')",
    )
    .run("服务已重启，本次生成中断。可以保留已有记录并重新生成。", now());
  function currentRun(c: Context, runId: string, fresh = true) {
    const run = required(
      store.get<GuidanceRun>(c.session.subjectId, "guidance", runId),
    ).value;
    if (run.subjectId !== c.session.subjectId)
      throw new HttpError(404, "not_found", "未找到本次专业结论。");
    if (fresh && guidanceFreshness(c, run).needsRefresh)
      throw new HttpError(
        409,
        "guidance_changed",
        "画像、测评或目标已变化，请先更新基础结论再生成报告。",
      );
    return run;
  }
  function live(c: Context, run: GuidanceRun, job?: ResearchJob) {
    if (closed)
      throw new HttpError(
        409,
        "service_stopping",
        "服务正在重启，本次生成已中断。",
      );
    if (store.generation(c.session.subjectId) !== c.session.generation)
      throw new HttpError(
        409,
        "data_deleted",
        "个人资料已删除，本次生成已取消。",
      );
    if (c.sessionHash && !store.session(c.sessionHash))
      throw new HttpError(
        409,
        "session_changed",
        "登录状态已变化，本次生成已取消。",
      );
    currentRun(c, run.guidanceRunId);
    if (job?.target) {
      const current = program(store, job.target.programId);
      if (
        current.programRevisionId !== job.target.programRevisionId ||
        catalog(store).catalogVersion !== job.target.catalogVersion
      )
        throw new HttpError(
          409,
          "target_changed",
          "目标院校资料已变化，请重新生成报告。",
        );
    }
  }
  function view(c: Context, job: ResearchJob) {
    const run = currentRun(c, job.guidanceRunId, false);
    const freshness = guidanceFreshness(c, run);
    if (job.target) {
      const snapshot = catalog(store);
      const current = snapshot.programs.find(
        (p) => p.programId === job.target!.programId,
      );
      if (
        !current ||
        current.programRevisionId !== job.target.programRevisionId ||
        snapshot.catalogVersion !== job.target.catalogVersion ||
        snapshot.withdrawnRevisionIds.includes(job.target.programRevisionId)
      ) {
        freshness.needsRefresh = true;
        freshness.refreshReasons.push("目标院校资料已变化或撤回");
      }
    }
    return { ...job, ...freshness };
  }
  function launch(
    c: Context,
    run: GuidanceRun,
    initial: ResearchJob,
    selectedProgram?: ProgramRevision,
    previousReport?: ResearchReport,
  ) {
    const owner = c.session.subjectId;
    const promise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        let job = initial;
        const save = () => store.put(owner, "research-job", job.jobId, job);
        try {
          live(c, run, job);
          const report = await engine.generate({
            subjectId: owner,
            run,
            selectedProgram,
            mode: initial.mode,
            previousReport,
            checkpoint: store.get<ResearchCheckpoint>(
              owner,
              "research-checkpoint",
              initial.jobId,
            )?.value,
            onCheckpoint: (checkpoint) => {
              live(c, run, job);
              store.put(
                owner,
                "research-checkpoint",
                initial.jobId,
                checkpoint,
              );
            },
            checkLive: () => live(c, run, job),
            onProgress: async (stage, detail) => {
              live(c, run, job);
              const step = stages[stage];
              if (!step || step.progress < job.progress) return;
              const message = detail ?? step.message;
              job = {
                ...job,
                status: "running",
                stage,
                ...step,
                message,
                updatedAt: now(),
                events: [...job.events, { stage, message, at: now() }],
              };
              save();
            },
          });
          live(c, run, job);
          const delivered =
            previousReport &&
            report.failureStage &&
            !report.recommendations.length
              ? {
                  ...previousReport,
                  status: report.status,
                  reason: report.reason,
                  failureStage: report.failureStage,
                  validationIssues: report.validationIssues,
                  rejectedRecommendations: report.rejectedRecommendations,
                  readStatistics: report.readStatistics,
                  summary: report.summary,
                  limitations: [
                    ...new Set([
                      ...previousReport.limitations,
                      ...report.limitations,
                      "本次补查未完成，已保留上次核对过的报告与来源。",
                    ]),
                  ],
                }
              : report;
          const done = report.status !== "blocked" && !report.failureStage;
          const usable = delivered.recommendations.length > 0;
          const message = report.failureStage
            ? `${usable ? "部分可用，已保留建议。" : "生成失败。"}${researchReason(report.reason ?? "MODEL_UNAVAILABLE")}可一键重试，复用已完成阶段。`
            : report.status === "completed"
              ? "学校与专业建议已生成，可逐项查看匹配理由和报考条件"
              : report.status === "partial"
                ? "本次研究已结束，可查看候选建议及仍需补充的信息"
                : report.summary || "生成条件尚不具备，请检查配置或补充资料";
          job = {
            ...job,
            report: delivered,
            status: report.failureStage && !usable ? "failed" : report.status,
            stage: done ? "done" : job.stage,
            progress: done ? 100 : job.progress,
            message,
            updatedAt: now(),
            events: [
              ...job.events,
              { stage: done ? "done" : "blocked", message, at: now() },
            ],
          };
          save();
        } catch (error) {
          if (
            !closed &&
            store.generation(owner) === c.session.generation &&
            store.get(owner, "research-job", job.jobId)
          ) {
            const cancelled =
              error instanceof HttpError &&
              ["session_changed", "data_deleted"].includes(error.code);
            job = {
              ...job,
              status: cancelled ? "cancelled" : "failed",
              message:
                error instanceof HttpError
                  ? error.message
                  : "生成未完成，模型或检索服务暂不可用。请检查配置后重试。",
              updatedAt: now(),
            };
            save();
          }
        }
      })
      .finally(() => running.delete(initial.jobId));
    running.set(initial.jobId, { owner, promise });
  }
  return {
    handle(c: Context): Reply | undefined {
      if (c.path === "/research/status" && c.method === "GET")
        return { body: engine.getReadiness() };
      const existing = /^\/research-jobs\/([^/]+)$/.exec(c.path);
      if (existing && c.method === "GET")
        return {
          body: view(
            c,
            required(
              store.get<ResearchJob>(
                c.session.subjectId,
                "research-job",
                existing[1],
              ),
            ).value,
          ),
        };
      const route =
        /^\/guidance\/([^/]+)\/research(?:\/(latest|supplement|retry))?$/.exec(
          c.path,
        );
      if (!route) return;
      const owner = c.session.subjectId;
      const run = currentRun(c, route[1], c.method === "POST");
      const latest = store.get<{ jobId: string }>(
        owner,
        "research-latest",
        run.guidanceRunId,
      );
      const previous = latest
        ? store.get<ResearchJob>(owner, "research-job", latest.value.jobId)
            ?.value
        : undefined;
      if (route[2] === "latest" && c.method === "GET")
        return { body: { job: previous ? view(c, previous) : null } };
      if (route[2] === "latest" || c.method !== "POST") return;
      fields(c.body, []);
      live(c, run);
      if (previous && activeStatus(previous))
        return { status: 202, body: view(c, previous) };
      const supplement = route[2] === "supplement";
      const retry = route[2] === "retry";
      if (retry && !previous)
        throw new HttpError(
          409,
          "research_missing",
          "请先生成研究任务再重试。",
        );
      if (supplement && !previous?.report)
        throw new HttpError(
          409,
          "research_missing",
          "请先生成研究报告，再按已记录缺项继续补查。",
        );
      const active = [...running.values()].filter(
        (item) => item.owner === owner,
      );
      if (active.length || running.size >= 4)
        throw new HttpError(
          429,
          "research_busy",
          "已有报告正在生成，请等待当前任务完成。",
        );
      const selectedId = selectionsResource(c).value.targetProgramId;
      const selectedProgram = selectedId
        ? program(store, selectedId)
        : undefined;
      const readiness = engine.getReadiness();
      const created = now();
      const job: ResearchJob = {
        jobId: id(),
        guidanceRunId: run.guidanceRunId,
        status: readiness.ready ? "queued" : "blocked",
        stage: "queued",
        progress: 0,
        message: readiness.ready
          ? "已接收请求，即将开始整理依据"
          : readiness.reasons.map(researchReason).join("；"),
        createdAt: created,
        updatedAt: created,
        events: [],
        mode: supplement ? "supplement" : retry ? "retry" : "generate",
        ...(supplement ? { report: previous!.report } : {}),
        ...(selectedProgram
          ? {
              target: {
                programId: selectedProgram.programId,
                programRevisionId: selectedProgram.programRevisionId,
                catalogVersion: catalog(store).catalogVersion,
              },
            }
          : {}),
      };
      if (retry && previous) {
        const saved = store.get<ResearchCheckpoint>(
          owner,
          "research-checkpoint",
          previous.jobId,
        );
        if (saved)
          store.put(owner, "research-checkpoint", job.jobId, saved.value);
      }
      store.put(owner, "research-job", job.jobId, job);
      store.put(owner, "research-latest", run.guidanceRunId, {
        jobId: job.jobId,
      });
      if (readiness.ready)
        launch(
          c,
          run,
          job,
          selectedProgram,
          supplement || retry ? previous?.report : undefined,
        );
      return { status: 202, body: view(c, job) };
    },
    replay(c: Context, saved: Record<string, unknown>): Reply | undefined {
      if (
        c.method !== "POST" ||
        !/^\/guidance\/[^/]+\/research(?:\/(?:supplement|retry))?$/.test(
          c.path,
        ) ||
        typeof saved.jobId !== "string"
      )
        return;
      return {
        status: 202,
        body: view(
          c,
          required(
            store.get<ResearchJob>(
              c.session.subjectId,
              "research-job",
              saved.jobId,
            ),
          ).value,
        ),
      };
    },
    async close() {
      closed = true;
      for (const { owner } of running.values()) engine.clearSubject(owner);
      await Promise.allSettled(
        [...running.values()].map((item) => item.promise),
      );
    },
  };
}
