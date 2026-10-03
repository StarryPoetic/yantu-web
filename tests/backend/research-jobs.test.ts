import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
async function fixture(t: TestContext, engine: ResearchReportModule) {
  const app = await createApplication(
    { databasePath: ":memory:", sampleData: true, staticDirectory: undefined },
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
