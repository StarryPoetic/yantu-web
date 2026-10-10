import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createApplication } from "../../server/app.ts";
import { createResearchRoutes } from "../../server/routes/research.ts";
import type {
  ResearchReportModule,
  ResearchReport,
  ResearchInput,
} from "../../server/explanation/research.ts";
const model = {
  name: "deepseek-v4-pro",
  thinking: true,
  effort: "high",
} as const;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function output(input: ResearchInput): ResearchReport {
  return {
    schemaVersion: 1,
    status: "completed",
    generatedAt: new Date().toISOString(),
    guidanceRunId: input.run.guidanceRunId,
    versions: input.run.versions,
    summary: "模拟研究完成，等待核实招生条件。",
    facts: [],
    recommendations: [],
    sources: [],
    limitations: ["测试资料"],
    model,
    searched: true,
  };
}
async function fixture(
  t: TestContext,
  engine: ResearchReportModule,
  databasePath = ":memory:",
) {
  const app = await createApplication(
    { databasePath, sampleData: true, staticDirectory: undefined },
    { research: engine },
  );
  t.after(() => app.close());
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const address = app.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  async function client() {
    const initial = await fetch(base + "/guest-sessions", {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    const cookie = initial.headers.get("set-cookie")!.split(";")[0];
    const csrf = (await initial.json()).csrfToken;
    return async (
      path: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: await response.json(),
        etag: response.headers.get("etag")!,
      };
    };
  }
  const request = await client();
  const profile = await request("/me/profile");
  const saved = await request(
    "/me/profile",
    "PUT",
    { ...profile.body.profile, major: "法学", targetMajor: "法学" },
    { "If-Match": profile.etag },
  );
  assert.equal(saved.status, 200);
  const selection = await request("/me/selections");
  const guidance = await request("/guidance", "POST", {
    profileVersion: saved.body.profileVersion,
    selectionVersion: selection.body.selectionVersion,
    assessmentRefs: [],
  });
  assert.equal(guidance.status, 201);
  return { app, request, client, runId: guidance.body.guidanceRunId };
}

test("rejected recommendations, validation issues and read statistics persist in SQLite and return through the owned job API", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yantu-phase2-"));
  let expected!: ResearchReport;
  const finished = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    async generate(input) {
      expected = {
        ...output(input),
        rejectedRecommendations: [
          {
            institutionName: "甲大学",
            programName: "法学",
            code: "UNSUPPORTED_RESEARCH_CLAIM",
            removedSentences: 1,
          },
          {
            institutionName: "未知学院",
            programName: "学科简介",
            code: "UNGROUNDED_RESEARCH_RECOMMENDATION",
            removedSentences: 0,
          },
        ],
        validationIssues: [
          {
            path: "recommendations[0].sentences",
            code: "UNSUPPORTED_RESEARCH_CLAIM",
          },
        ],
        readStatistics: {
          success: 2,
          failed: 3,
          failuresByCode: { HTTP_404: 2, WEB_TLS_CERT: 1 },
        },
      };
      finished.resolve();
      return expected;
    },
  };
  const { request, app, runId } = await fixture(
    t,
    engine,
    join(directory, "research.sqlite"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const started = await request(`/guidance/${runId}/research`, "POST", {});
  await finished.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const fetched = await request(`/research-jobs/${started.body.jobId}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(
    fetched.body.report.rejectedRecommendations,
    expected.rejectedRecommendations,
  );
  assert.deepEqual(
    fetched.body.report.validationIssues,
    expected.validationIssues,
  );
  assert.deepEqual(fetched.body.report.readStatistics, expected.readStatistics);
  const row = app.store.db
    .prepare(
      "SELECT value FROM resources WHERE kind = 'research-job' AND id = ?",
    )
    .get(started.body.jobId) as { value: string } | undefined;
  assert.ok(row);
  assert.deepEqual(
    JSON.parse(row.value).report.readStatistics,
    expected.readStatistics,
  );
});

test("supplement requires an owned base report and passes its immutable snapshot while preventing duplicate jobs", async (t) => {
  const firstDone = deferred(),
    started = deferred(),
    release = deferred(),
    finished = deferred();
  const inputs: ResearchInput[] = [];
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {
      release.resolve();
    },
    generate: async (input) => {
      inputs.push(input);
      if (input.mode !== "supplement") {
        firstDone.resolve();
        return output(input);
      }
      await input.onProgress?.("researching", "正在按缺项继续补查");
      started.resolve();
      await release.promise;
      finished.resolve();
      return { ...output(input), summary: "补查资料已整合" };
    },
  };
  const { request, client, runId } = await fixture(t, engine);
  t.after(() => release.resolve());
  assert.equal(
    (await request(`/guidance/${runId}/research/supplement`, "POST", {}))
      .status,
    409,
  );
  const original = await request(`/guidance/${runId}/research`, "POST", {});
  await firstDone.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const base = (await request(`/research-jobs/${original.body.jobId}`)).body
    .report;
  const key = randomUUID();
  const next = await request(
    `/guidance/${runId}/research/supplement`,
    "POST",
    {},
    { "Idempotency-Key": key },
  );
  assert.equal(next.status, 202);
  assert.equal(next.body.mode, "supplement");
  assert.deepEqual(next.body.report, base);
  await started.promise;
  assert.deepEqual(inputs[1].previousReport, base);
  assert.equal(inputs[1].run.guidanceRunId, inputs[0].run.guidanceRunId);
  const duplicate = await request(
    `/guidance/${runId}/research/supplement`,
    "POST",
    {},
  );
  assert.equal(duplicate.body.jobId, next.body.jobId);
  assert.equal(inputs.length, 2);
  assert.deepEqual(
    (await request(`/guidance/${runId}/research/latest`)).body.job.report,
    base,
  );
  const other = await client();
  assert.equal(
    (await other(`/guidance/${runId}/research/supplement`, "POST", {})).status,
    404,
  );
  assert.equal((await other(`/research-jobs/${next.body.jobId}`)).status, 404);
  release.resolve();
  await finished.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const replay = await request(
    `/guidance/${runId}/research/supplement`,
    "POST",
    {},
    { "Idempotency-Key": key },
  );
  assert.equal(replay.body.jobId, next.body.jobId);
  assert.equal(replay.body.status, "completed");
  assert.equal(inputs.length, 2);
  const profile = await request("/me/profile");
  await request(
    "/me/profile",
    "PUT",
    { ...profile.body.profile, hours: "4–6 小时" },
    { "If-Match": profile.etag },
  );
  assert.equal(
    (await request(`/guidance/${runId}/research/supplement`, "POST", {}))
      .status,
    409,
  );
});

test("a thrown supplementation failure retains the base report across latest-job reload", async (t) => {
  const done = deferred(),
    failed = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    generate: async (input) => {
      if (input.mode === "supplement") {
        failed.resolve();
        throw new Error("provider unavailable");
      }
      done.resolve();
      return { ...output(input), summary: "此前取得的官网依据" };
    },
  };
  const { request, runId } = await fixture(t, engine);
  await request(`/guidance/${runId}/research`, "POST", {});
  await done.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const base = (await request(`/guidance/${runId}/research/latest`)).body.job
    .report;
  await request(`/guidance/${runId}/research/supplement`, "POST", {});
  await failed.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const job = (await request(`/guidance/${runId}/research/latest`)).body.job;
  assert.equal(job.status, "failed");
  assert.deepEqual(job.report, base);
  assert.ok(job.progress < 100);
});

test("an invalid model response during supplementation does not erase previously grounded recommendations", async (t) => {
  const done = deferred(),
    failed = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    generate: async (input) => {
      if (input.mode === "supplement") {
        await input.onProgress?.("analyzing");
        failed.resolve();
        return {
          ...output(input),
          status: "partial",
          failureStage: "analyzing",
          reason: "INVALID_RESEARCH_REPORT",
          summary: "补查报告未通过核对",
        };
      }
      done.resolve();
      return {
        ...output(input),
        recommendations: [
          {
            institutionName: "示例研究大学",
            disciplineCode: "0301",
            programName: "法学理论",
            rationale: "来自已读目录",
            preparation: [],
            uncertainties: [],
            citations: [],
          },
        ],
      };
    },
  };
  const { request, runId } = await fixture(t, engine);
  await request(`/guidance/${runId}/research`, "POST", {});
  await done.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const base = (await request(`/guidance/${runId}/research/latest`)).body.job
    .report;
  await request(`/guidance/${runId}/research/supplement`, "POST", {});
  await failed.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const job = (await request(`/guidance/${runId}/research/latest`)).body.job;
  assert.equal(job.report.failureStage, "analyzing");
  assert.equal(job.report.summary, "补查报告未通过核对");
  assert.deepEqual(job.report.recommendations, base.recommendations);
  assert.equal(job.progress, 60);
});
test("research readiness blocks missing configuration without starting a provider or claiming progress", async (t) => {
  let calls = 0;
  const engine: ResearchReportModule = {
    getReadiness: () => ({
      ready: false,
      reasons: ["尚未配置网页检索服务"],
      model,
    }),
    generate: async (input) => {
      calls++;
      return output(input);
    },
    clearSubject() {},
  };
  const { request, runId } = await fixture(t, engine);
  const readiness = await request("/research/status");
  assert.equal(readiness.body.ready, false);
  const created = await request(`/guidance/${runId}/research`, "POST", {});
  assert.equal(created.status, 202);
  assert.equal(created.body.status, "blocked");
  assert.equal(created.body.progress, 0);
  assert.equal(calls, 0);
  assert.equal(
    (await request(`/guidance/${runId}/research/latest`)).body.job.jobId,
    created.body.jobId,
  );
});

test("editing a saved profile creates a fresh guidance snapshot and research input instead of reusing the prior job", async (t) => {
  const inputs: ResearchInput["run"][] = [];
  const firstCompleted = deferred(),
    secondCompleted = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    generate: async (input) => {
      inputs.push(structuredClone(input.run));
      await input.onProgress?.("preparing");
      (inputs.length === 1 ? firstCompleted : secondCompleted).resolve();
      return output(input);
    },
  };
  const { request, runId } = await fixture(t, engine);
  const first = await request(`/guidance/${runId}/research`, "POST", {});
  await firstCompleted.promise;
  assert.equal(
    (await request(`/research-jobs/${first.body.jobId}`)).body.status,
    "completed",
  );
  const before = await request("/me/profile");
  const updatedProfile = {
    ...before.body.profile,
    targetMajor: "人工智能",
    crossMajor: "接受跨专业",
    hours: "4–6 小时",
    notes: "希望从现有背景转向人工智能应用，暂未确定学校。",
    priorities: { ...before.body.profile.priorities, 就业机会: 100 },
  };
  const saved = await request("/me/profile", "PUT", updatedProfile, {
    "If-Match": before.etag,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profileVersion, before.body.profileVersion + 1);
  const oldGuidance = await request(`/guidance/${runId}`);
  assert.equal(oldGuidance.body.needsRefresh, true);
  const staleStart = await request(`/guidance/${runId}/research`, "POST", {});
  assert.equal(staleStart.status, 409);
  assert.equal(staleStart.body.code, "guidance_changed");
  assert.equal(inputs.length, 1);
  const selection = await request("/me/selections");
  const staleGuidance = await request("/guidance", "POST", {
    profileVersion: before.body.profileVersion,
    selectionVersion: selection.body.selectionVersion,
    assessmentRefs: [],
  });
  assert.equal(staleGuidance.status, 409);
  assert.equal(staleGuidance.body.code, "stale_input");
  const next = await request("/guidance", "POST", {
    profileVersion: saved.body.profileVersion,
    selectionVersion: selection.body.selectionVersion,
    assessmentRefs: [],
  });
  assert.equal(next.status, 201);
  assert.notEqual(next.body.guidanceRunId, runId);
  const second = await request(
    `/guidance/${next.body.guidanceRunId}/research`,
    "POST",
    {},
  );
  assert.equal(second.status, 202);
  await secondCompleted.promise;
  assert.notEqual(second.body.jobId, first.body.jobId);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].versions.profileVersion, before.body.profileVersion);
  assert.equal(inputs[0].inputSnapshot.profile.targetMajor, "法学");
  assert.equal(inputs[1].versions.profileVersion, saved.body.profileVersion);
  assert.deepEqual(inputs[1].inputSnapshot.profile, saved.body.profile);
  const latest = await request(
    `/guidance/${next.body.guidanceRunId}/research/latest`,
  );
  assert.equal(latest.body.job.jobId, second.body.jobId);
  assert.equal(
    latest.body.job.report.versions.profileVersion,
    saved.body.profileVersion,
  );
  assert.equal(latest.body.job.needsRefresh, false);
  const old = await request(`/guidance/${runId}/research/latest`);
  assert.equal(old.body.job.jobId, first.body.jobId);
  assert.equal(old.body.job.needsRefresh, true);
});

test("validation repair updates persist and a failed analysis never becomes 100 percent done", async (t) => {
  const stopped = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    generate: async (input) => {
      await input.onProgress?.("preparing");
      await input.onProgress?.("researching");
      await input.onProgress?.(
        "analyzing",
        "正在核对并修正学校专业建议，无需补填画像",
      );
      stopped.resolve();
      return {
        ...output(input),
        status: "partial",
        reportVersion: "profile-research-v4",
        reason: "INVALID_RESEARCH_REPORT",
        failureStage: "analyzing",
        summary: "系统未能完成报告生成，你的画像已保留。",
      };
    },
  };
  const { request, runId } = await fixture(t, engine);
  await request(`/guidance/${runId}/research`, "POST", {});
  await stopped.promise;
  const job = (await request(`/guidance/${runId}/research/latest`)).body.job;
  assert.equal(job.stage, "analyzing");
  assert.equal(job.progress, 60);
  assert.equal(job.report.failureStage, "analyzing");
  assert.ok(
    job.events.some((event: { message: string }) =>
      event.message.includes("无需补填画像"),
    ),
  );
  assert.ok(
    !job.events.some((event: { stage: string }) => event.stage === "done"),
  );
});
test("research jobs persist actual stages, deduplicate submissions and replay current status with owner isolation", async (t) => {
  const started = deferred(),
    release = deferred(),
    finished = deferred();
  let calls = 0;
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {
      release.resolve();
    },
    generate: async (input) => {
      calls++;
      await input.onProgress?.("preparing");
      await input.onProgress?.("researching");
      started.resolve();
      await release.promise;
      await input.onProgress?.("analyzing");
      await input.onProgress?.("writing");
      finished.resolve();
      return output(input);
    },
  };
  const { request, client, runId } = await fixture(t, engine);
  t.after(() => release.resolve());
  const key = randomUUID();
  const first = await request(
    `/guidance/${runId}/research`,
    "POST",
    {},
    { "Idempotency-Key": key },
  );
  await started.promise;
  const progress = await request(`/research-jobs/${first.body.jobId}`);
  assert.equal(progress.body.stage, "researching");
  assert.equal(progress.body.progress, 30);
  const second = await request(`/guidance/${runId}/research`, "POST", {});
  assert.equal(second.body.jobId, first.body.jobId);
  assert.equal(calls, 1);
  const other = await client();
  assert.equal((await other(`/research-jobs/${first.body.jobId}`)).status, 404);
  release.resolve();
  await finished.promise;
  const replay = await request(
    `/guidance/${runId}/research`,
    "POST",
    {},
    { "Idempotency-Key": key },
  );
  assert.equal(replay.body.status, "completed");
  assert.equal(replay.body.progress, 100);
  assert.deepEqual(
    replay.body.events.map((item: { stage: string }) => item.stage),
    ["preparing", "researching", "analyzing", "writing", "done"],
  );
  const profile = await request("/me/profile");
  await request(
    "/me/profile",
    "PUT",
    { ...profile.body.profile, hours: "4–6 小时" },
    { "If-Match": profile.etag },
  );
  assert.equal(
    (await request(`/research-jobs/${first.body.jobId}`)).body.needsRefresh,
    true,
  );
  assert.equal(
    (await request(`/guidance/${runId}/research`, "POST", {})).status,
    409,
  );
});
test("deleting records during generation cannot resurrect a research job or report", async (t) => {
  const started = deferred(),
    release = deferred(),
    finished = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {
      release.resolve();
    },
    generate: async (input) => {
      await input.onProgress?.("researching");
      started.resolve();
      await release.promise;
      finished.resolve();
      return output(input);
    },
  };
  const { request, runId, app } = await fixture(t, engine);
  t.after(() => release.resolve());
  const created = await request(`/guidance/${runId}/research`, "POST", {});
  await started.promise;
  const profile = await request("/me/profile"),
    preview = await request("/me/profile/deletion-preview");
  assert.equal(
    (
      await request("/me/profile", "DELETE", undefined, {
        "If-Match": profile.etag,
        "Deletion-Scope-Version": preview.body.deletionScopeVersion,
      })
    ).status,
    202,
  );
  release.resolve();
  await finished.promise;
  assert.equal(
    (await request(`/research-jobs/${created.body.jobId}`)).status,
    404,
  );
  assert.equal(
    app.store.db
      .prepare(
        "SELECT count(*) AS count FROM resources WHERE kind='research-job'",
      )
      .get()?.count,
    0,
  );
});
test("signing out cancels delivery and restarted jobs are marked interrupted without automatic paid retry", async (t) => {
  const started = deferred(),
    release = deferred(),
    finished = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {
      release.resolve();
    },
    generate: async (input) => {
      await input.onProgress?.("researching");
      started.resolve();
      await release.promise;
      finished.resolve();
      return output(input);
    },
  };
  const { request, runId, app } = await fixture(t, engine);
  t.after(() => release.resolve());
  const created = await request(`/guidance/${runId}/research`, "POST", {});
  await started.promise;
  assert.equal((await request("/auth/logout", "POST", {})).status, 200);
  release.resolve();
  await finished.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const row = app.store.db
    .prepare("SELECT owner FROM resources WHERE kind='research-job' AND id=?")
    .get(created.body.jobId)!;
  assert.equal(
    app.store.get<any>(String(row.owner), "research-job", created.body.jobId)!
      .value.status,
    "cancelled",
  );
  const interrupted = {
    ...created.body,
    status: "running",
    stage: "analyzing",
    progress: 60,
  };
  app.store.put(
    String(row.owner),
    "research-job",
    created.body.jobId,
    interrupted,
  );
  const recovered = createResearchRoutes(app.store, engine);
  assert.equal(
    app.store.get<any>(String(row.owner), "research-job", created.body.jobId)!
      .value.status,
    "failed",
  );
  await recovered.close();
});

test("a saved profile-based school recommendation survives refresh with admission verification still pending", async (t) => {
  const finished = deferred();
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    generate: async (input) => {
      await input.onProgress?.("preparing");
      await input.onProgress?.("researching");
      await input.onProgress?.("analyzing");
      await input.onProgress?.("writing");
      const report: ResearchReport = {
        ...output(input),
        reportVersion: "profile-research-v3",
        recommendations: [
          {
            institutionName: "测试大学",
            disciplineCode: "0301",
            programName: "民商法学",
            degreeType: "academic",
            admissionStatus: "needs_verification",
            rationale: "可作为进一步比较的方向，目标年度条件仍待核对。",
            fitReasons: [
              {
                profileField: "targetMajor",
                profileValue: "法学",
                reason: "与明确兴趣相关。",
              },
              {
                profileField: "major",
                profileValue: "法学",
                reason: "已有课程基础可用于准备。",
              },
            ],
            tradeoffs: ["具体考试科目尚待核实。"],
            preparation: ["核对目标年度专业目录。"],
            uncertainties: ["当年是否招生尚未确认。"],
            citations: ["research-1"],
          },
        ],
      };
      finished.resolve();
      return report;
    },
  };
  const { request, runId } = await fixture(t, engine);
  const created = await request(`/guidance/${runId}/research`, "POST", {});
  await finished.promise;
  const latest = (await request(`/guidance/${runId}/research/latest`)).body.job;
  assert.equal(latest.jobId, created.body.jobId);
  assert.equal(latest.status, "completed");
  assert.equal(latest.report.reportVersion, "profile-research-v3");
  assert.equal(latest.report.recommendations[0].programName, "民商法学");
  assert.equal(
    latest.report.recommendations[0].admissionStatus,
    "needs_verification",
  );
  assert.equal(latest.report.recommendations[0].fitReasons.length, 2);
  assert.match(latest.message, /匹配理由/);
  assert.doesNotMatch(latest.message, /资格已|条件已|录取/);
});
