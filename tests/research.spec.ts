import { createApplication } from "../server/app";
import type { ResearchReportModule } from "../server/explanation/research";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { GuidanceRun } from "../server/disciplines/types";
import type { ResearchJob } from "../server/routes/research";
import type {
  ResearchReport,
  ResearchStage,
} from "../server/explanation/research";
import { registerAccount } from "./helpers/account";
import { decisionDisplayFixture } from "./helpers/research-decision-fixture";
import { withPhase6Display } from "./helpers/research-phase6-fixture";
import { prefilterResearchSchools } from "../server/explanation/research-prefilter";
import {
  withEvidenceCoverage,
  withSupplementedTuition,
} from "./helpers/research-coverage-fixture";

const model = {
  name: "deepseek-v4-pro",
  thinking: true,
  effort: "high",
} as const;
const retrievedAt = "2026-09-27T03:20:00.000Z";
const sourceUrl = "https://yz.chsi.com.cn/";
const sourceText = "该页面包含目标年度的招生目录与报考说明。";
const stages: Record<ResearchStage, { progress: number; message: string }> = {
  preparing: { progress: 10, message: "正在整理个人画像、测评和目标信息" },
  researching: {
    progress: 30,
    message: "正在检索院校与专业资料，读取可访问的官网原文",
  },
  analyzing: {
    progress: 60,
    message: "正在结合画像、测评和检索资料进行模型分析",
  },
  writing: { progress: 90, message: "正在核对引用与专业代码，整理报告" },
};

async function openGuidance(
  page: Page,
  configure?: (page: Page) => Promise<void>,
): Promise<GuidanceRun> {
  await registerAccount(page);
  await page.goto("/");
  await page.getByLabel("本科专业", { exact: true }).fill("法学");
  await page.getByLabel("感兴趣的专业或领域（选填）").fill("法学");
  await configure?.(page);
  await page.getByRole("button", { name: "保存个人画像", exact: true }).click();
  await expect(page).toHaveURL(/#assessment$/);
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/guidance" &&
      response.request().method() === "POST",
  );
  await page.goto("/#guidance");
  const run = (await (await response).json()) as GuidanceRun;
  await expect(
    page.getByText("查看基础探索与专业选择", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "基础探索提示",
      exact: true,
      includeHidden: true,
    }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "解释基础探索依据",
      exact: true,
      includeHidden: true,
    }),
  ).toBeHidden();
  return run;
}

function reportFor(
  run: GuidanceRun,
  status: "completed" | "partial",
): ResearchReport {
  return {
    schemaVersion: 1,
    reportVersion: "profile-research-v7",
    status,
    generatedAt: retrievedAt,
    guidanceRunId: run.guidanceRunId,
    versions: run.versions,
    summary:
      "浏览器测试报告：结合已有法学基础，继续核对目标方向的培养内容与报考条件。",
    facts: [{ text: sourceText, citations: ["research-1"] }],
    recommendations: [
      {
        institutionName: "浏览器测试大学",
        disciplineCode: "0301",
        programName: "法学（民商法方向）",
        degreeType: "academic",
        match: {
          ruleVersion: "demand-match-v1",
          summary: "已核对法学兴趣，其他条件仍需按资料确认。",
          factors: [
            {
              field: "targetMajor",
              label: "目标专业",
              status: "match",
              reason: "与保存的法学兴趣一致。",
              sourceIds: [],
            },
          ],
        },
        tier: "preferred",
        tierReasons: [],
        constraintChecks: [
          {
            field: "budget",
            status: "unknown",
            reason: "尚未查到可比较的学费资料。",
            sourceIds: [],
          },
          {
            field: "cities",
            status: "unknown",
            reason: "项目城市尚需核对。",
            sourceIds: [],
          },
        ],
        admissionStatus:
          status === "completed" ? "current_evidence" : "needs_verification",
        rationale: "结合本科基础比较课程安排，报考条件仍需按原文确认。",
        fitReasons: [
          {
            profileField: "major",
            profileValue: String(run.inputSnapshot.profile.major),
            reason: "本科已有法学基础，可以沿专业课程继续准备。",
          },
          {
            profileField: "targetMajor",
            profileValue: String(run.inputSnapshot.profile.targetMajor),
            reason: "与你主动填写的法学兴趣一致，适合进一步比较课程。",
          },
        ],
        preparation: ["整理本科课程记录，再对照目标课程安排。"],
        tradeoffs: ["需要兼顾专业课复习与案例分析训练。"],
        uncertainties: ["核对目标年度是否允许该本科背景报考。"],
        citations: ["research-1"],
      },
    ],
    sources: [
      {
        id: "research-1",
        title: "研究生招生资料（浏览器测试）",
        url: sourceUrl,
        excerpt: sourceText,
        retrievedAt,
        kind: status === "completed" ? "official_page" : "search_snippet",
        verified: false,
      },
    ],
    limitations: [
      "此测试报告只用于核验界面，不是招生事实。",
      ...(status === "partial"
        ? ["本次只取得搜索摘要，仍需读取官网原文。"]
        : []),
    ],
    ...(status === "partial" ? { reason: "SEARCH_SNIPPETS_ONLY" } : {}),
    model,
    searched: true,
  };
}

/** Only research endpoints are mocked; registration, profile and guidance use the real server. */
function tieredReport(run: GuidanceRun): ResearchReport {
  const base = reportFor(run, "completed");
  const year = Number(run.inputSnapshot.profile.year);
  const names = [
    "分级测试甲大学",
    "分级测试乙大学",
    "分级测试丙大学",
    "分级测试丁大学",
    "分级测试戊大学",
  ];
  const sources = names.map((name, index) => ({
    id: "fee-" + index,
    title: name + "电子信息项目与学费说明（测试）",
    url: "https://yz.chsi.com.cn/test-fee-" + index,
    excerpt: "仅供浏览器测试的项目、城市和收费资料。",
    retrievedAt,
    kind: "official_page" as const,
    verified: false as const,
  }));
  return {
    ...base,
    sources,
    facts: [],
    coverage: {
      targetMin: 5,
      targetMax: 10,
      schoolCount: 5,
      preferredCount: 3,
      alternativeCount: 1,
      exploratoryCount: 1,
      shortfallReasons: [],
    },
    recommendations: names.map((institutionName, index) => {
      const historical = index === 2,
        budgetMismatch = index === 3,
        cityMismatch = index === 4;
      const sourceId = sources[index].id;
      const city = cityMismatch ? "上海" : "杭州";
      const amount = historical ? 40000 : budgetMismatch ? 60000 : 8000;
      return {
        ...base.recommendations[0],
        institutionName,
        disciplineCode: "0854",
        programName: "电子信息（人工智能技术）",
        degreeType: "professional" as const,
        tier:
          index === 4
            ? ("exploratory" as const)
            : historical
              ? ("alternative" as const)
              : ("preferred" as const),
        tierReasons: budgetMismatch
          ? [
              "虽然学费高于预算，但人工智能兴趣与工程基础形成较强衔接，综合学习目标和准备条件列为优先推荐。",
            ]
          : cityMismatch
            ? [
                "该项目所需学习基础跨度较大，跨考准备成本仍需评估，先作为探索选择；费用和城市另行核对。",
              ]
            : historical
              ? [
                  "与你的兴趣有联系，但课程衔接和备考投入仍需比较，综合列为适合备选。",
                ]
              : [
                  "与你的人工智能兴趣和已有工程基础衔接，综合个人目标列为优先推荐。",
                ],
        rationale: "你愿意跨专业并关注人工智能，可比较该项目的计算与实践课程。",
        fitReasons: [
          {
            profileField: "major",
            profileValue: String(run.inputSnapshot.profile.major),
            reason:
              "机械课程中的工程基础可作为衔接起点，还需要补充编程和数据结构。",
          },
          {
            profileField: "crossMajor",
            profileValue: String(run.inputSnapshot.profile.crossMajor),
            reason: "你接受跨专业，因此保留这个具体项目供比较。",
          },
        ],
        constraintChecks: [
          {
            field: "budget" as const,
            status:
              index === 1 || historical
                ? ("unknown" as const)
                : budgetMismatch
                  ? ("mismatch" as const)
                  : ("match" as const),
            reason:
              index === 1
                ? "尚未查到项目学费，不能判断是否在 2–5 万元年度预算内。"
                : historical
                  ? "仅查到历史全程费用，不能直接判断目标年度是否符合预算。"
                  : budgetMismatch
                    ? "已核对学费为每学年 60,000 元，高于你填写的 2–5 万元年度预算。"
                    : "已核对学费为每学年 8,000 元，生活费和其他支出还需另外估算。",
            sourceIds: index === 1 ? [] : [sourceId],
          },
          {
            field: "cities" as const,
            status: cityMismatch ? ("mismatch" as const) : ("match" as const),
            reason: cityMismatch
              ? "项目位于上海，与你选择的杭州不同。"
              : "项目位于你选择的杭州。",
            sourceIds: [sourceId],
          },
        ],
        ...(index === 1
          ? {}
          : {
              tuition: {
                amount,
                currency: "CNY" as const,
                period: historical
                  ? ("program" as const)
                  : ("academic_year" as const),
                year: historical ? year - 2 : year,
                studyMode: historical
                  ? ("part_time" as const)
                  : ("full_time" as const),
                quote: `${institutionName}电子信息学费${amount}元，按${historical ? "全程" : "学年"}计费。`,
                sourceId,
              },
            }),
        location: {
          city,
          quote: "该电子信息项目在" + city + "校区培养。",
          sourceId,
        },
        citations: [sourceId],
      };
    }),
  };
}

async function researchService(page: Page) {
  let current:
    | (ResearchJob & { needsRefresh?: boolean; refreshReasons?: string[] })
    | null = null;
  let run: GuidanceRun | null = null;
  let postCount = 0,
    latestCount = 0,
    supplementCount = 0;
  let supplementError:
    | { status: number; code: string; message: string }
    | undefined;
  const jobId = "browser-research-" + randomUUID();
  let polls = 0;
  await page.route("**/api/v1/research/latest", (route) =>
    route.fulfill({ json: { job: current, run } }),
  );
  await page.route("**/api/v1/research/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ready: true, reasons: [], model }),
    }),
  );
  await page.route(
    /\/api\/v1\/guidance\/[^/]+\/research(?:\/(?:latest|supplement|retry))?$/,
    async (route) => {
      if (route.request().method() === "POST") {
        const mode = new URL(route.request().url()).pathname.endsWith(
          "/supplement",
        )
          ? "supplement"
          : "generate";
        expect(run).not.toBeNull();
        expect(route.request().postDataJSON()).toEqual({});
        expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        if (mode === "supplement") {
          supplementCount++;
          if (supplementError) {
            const failure = supplementError;
            supplementError = undefined;
            await route.fulfill({
              status: failure.status,
              json: { code: failure.code, message: failure.message },
            });
            return;
          }
        } else postCount++;
        const previousReport =
          mode === "supplement" ? current?.report : undefined;
        current = {
          jobId,
          mode,
          guidanceRunId: run!.guidanceRunId,
          status: "queued",
          stage: "queued",
          progress: 0,
          message:
            mode === "supplement"
              ? "已接收补查请求，继续核验缺少的原文"
              : "已接收请求，即将开始整理依据",
          createdAt: retrievedAt,
          updatedAt: retrievedAt,
          events: [],
          ...(previousReport ? { report: previousReport } : {}),
        };
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify(current),
        });
      } else {
        latestCount++;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ job: current }),
        });
      }
    },
  );
  await page.route("**/api/v1/research-jobs/*", (route) => {
    polls++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(current),
    });
  });
  return {
    setRun(value: GuidanceRun) {
      run = value;
    },
    stale(needsRefresh = true) {
      if (current) current = { ...current, needsRefresh };
    },
    postCount: () => postCount,
    pollCount: () => polls,
    cancel() {
      if (current)
        current = { ...current, status: "cancelled", message: "任务已取消" };
    },
    supplementCount: () => supplementCount,
    failNextSupplement() {
      supplementError = {
        status: 503,
        code: "search_unavailable",
        message: "补查服务暂不可用，已取得的报告仍保留。",
      };
    },
    failSupplementJobWithoutReport() {
      if (!current || current.mode !== "supplement")
        throw new Error("Start supplement before failing it.");
      current = {
        ...current,
        status: "failed",
        stage: "done",
        message: "补查超时，未取得新的原文。",
        report: undefined,
      };
    },
    latestCount: () => latestCount,
    invalidate() {
      if (!current) throw new Error("Start the report before invalidating it.");
      current = {
        ...current,
        needsRefresh: true,
        refreshReasons: ["个人画像已更新"],
      };
    },
    stage(stage: ResearchStage, message?: string) {
      if (!current) throw new Error("Start the report before advancing it.");
      const step = { ...stages[stage], ...(message ? { message } : {}) };
      current = {
        ...current,
        status: "running",
        stage,
        ...step,
        events: [
          ...current.events,
          { stage, message: step.message, at: retrievedAt },
        ],
      };
    },
    finish(
      status: "completed" | "partial",
      change?: (report: ResearchReport) => ResearchReport,
    ) {
      if (!current || !run)
        throw new Error("Start the report before completing it.");
      const report =
        current.mode === "supplement" && current.report
          ? current.report
          : reportFor(run, status);
      current = {
        ...current,
        status,
        stage: "done",
        progress: 100,
        message:
          status === "completed"
            ? "报告已生成，请结合引用来源核对报考条件"
            : "已生成部分报告，缺少的依据已在报告中说明",
        report: change ? change(report) : report,
      };
    },
    stop(stage: ResearchStage, reason: string, withReport = true) {
      if (!current || !run)
        throw new Error("Start the report before stopping it.");
      current = {
        ...current,
        status: withReport ? "blocked" : "failed",
        stage,
        progress: stages[stage].progress,
        message: "本次研究未能完成，请查看失败原因。",
        ...(withReport
          ? {
              report: {
                ...reportFor(run, "partial"),
                status: "blocked" as const,
                reason,
                recommendations: [],
                facts: [],
                sources: [],
                searched: false,
                summary: "浏览器测试：模型规划结构未通过核对。",
              },
            }
          : {}),
      };
    },
  };
}

test("服务未配置时明确提示，基础结论仍可用且不创建研究任务", async ({
  page,
}) => {
  let starts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/guidance\/[^/]+\/research$/.test(new URL(request.url()).pathname)
    )
      starts++;
  });
  await openGuidance(page);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await expect(
    panel.getByText("报告服务尚未准备好", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "联网调研并生成报告", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByText(/可展开“查看基础探索与专业选择”继续浏览/),
  ).toBeVisible();
  await expect(panel.getByRole("progressbar")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "下载研究报告", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "重新检查服务", exact: true })
    .click();
  await expect(
    panel.getByText("报告服务尚未准备好", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新生成结论", exact: true }),
  ).toBeEnabled();
  await page.getByText("查看基础探索与专业选择", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "基础探索提示", exact: true }),
  ).toBeVisible();
  expect(starts).toBe(0);
});

test("修改画像并保存后再次生成使用新版本、新结论和新研究任务，刷新不会复用旧画像", async ({
  page,
}) => {
  // Only enable the UI control. The real server keeps providers disabled and persists blocked jobs.
  await page.route("**/api/v1/research/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ready: true, reasons: [], model }),
    }),
  );
  const guidanceRequests: unknown[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/v1/guidance" &&
      request.method() === "POST"
    )
      guidanceRequests.push(request.postDataJSON());
  });
  const firstRun = await openGuidance(page, async (page) => {
    await page
      .getByRole("combobox", { name: "职业与学习目标", exact: true })
      .selectOption("专业实践与行业就业");
    await page
      .getByRole("textbox", { name: "补充说明", exact: true })
      .fill("旧画像说明，需要在下一次保存时清空。");
  });
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  const firstResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/v1/guidance/${firstRun.guidanceRunId}/research` &&
      response.request().method() === "POST",
  );
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  const first = await firstResponse;
  expect(first.status()).toBe(202);
  const firstJob = await first.json();
  expect(firstJob.status).toBe("blocked");
  expect(firstJob.guidanceRunId).toBe(firstRun.guidanceRunId);

  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "个人画像", exact: true })
    .click();
  await expect(page.getByLabel("本科专业", { exact: true })).toHaveValue(
    "法学",
  );
  await page
    .getByLabel("本科专业", { exact: true })
    .fill("机械设计制造及其自动化");
  await page.getByLabel("感兴趣的专业或领域（选填）").fill("人工智能");
  await page
    .getByRole("combobox", { name: "跨专业意愿", exact: true })
    .selectOption("接受跨专业");
  await page
    .getByRole("combobox", { name: "每天可投入时间", exact: true })
    .selectOption("4–6 小时");
  await page
    .getByRole("slider", { name: "就业机会", exact: true })
    .press("End");
  const notes = page.getByRole("textbox", { name: "补充说明", exact: true });
  await expect(notes).toHaveValue("旧画像说明，需要在下一次保存时清空。");
  await notes.fill("");
  await page
    .getByRole("combobox", { name: "职业与学习目标", exact: true })
    .selectOption("不确定，希望先探索");
  const saving = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/me/profile" &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存个人画像", exact: true }).click();
  const savedResponse = await saving;
  expect(savedResponse.status()).toBe(200);
  const saved = await savedResponse.json();
  expect(saved.profileVersion).toBe(firstRun.versions.profileVersion + 1);
  expect(saved.profile).toMatchObject({
    major: "机械设计制造及其自动化",
    targetMajor: "人工智能",
    crossMajor: "接受跨专业",
    hours: "4–6 小时",
    priorities: { 就业机会: 100 },
    notes: "",
    studyGoal: "不确定，希望先探索",
  });
  await expect(page).toHaveURL(/#assessment$/);
  const nextGuidance = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/guidance" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "查看专业推荐结论", exact: true })
    .click();
  const nextResponse = await nextGuidance;
  expect(nextResponse.status()).toBe(201);
  expect(nextResponse.request().postDataJSON().profileVersion).toBe(
    saved.profileVersion,
  );
  const nextRun = (await nextResponse.json()) as GuidanceRun;
  expect(nextRun.guidanceRunId).not.toBe(firstRun.guidanceRunId);
  expect(nextRun.versions.profileVersion).toBe(saved.profileVersion);
  expect(nextRun.inputSnapshot.profile).toEqual(saved.profile);
  expect(firstRun.inputSnapshot.profile.notes).toBe(
    "旧画像说明，需要在下一次保存时清空。",
  );
  const oldJob = await (
    await page.request.get(`/api/v1/research-jobs/${firstJob.jobId}`)
  ).json();
  expect(oldJob.needsRefresh).toBe(true);
  expect(oldJob.refreshReasons).toContain("个人画像已更新");

  const newResearch = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/v1/guidance/${nextRun.guidanceRunId}/research` &&
      response.request().method() === "POST",
  );
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  const newResponse = await newResearch;
  expect(newResponse.status()).toBe(202);
  expect(newResponse.request().postDataJSON()).toEqual({});
  expect(newResponse.request().headers()["idempotency-key"]).not.toBe(
    first.request().headers()["idempotency-key"],
  );
  const nextJob = await newResponse.json();
  expect(nextJob.status).toBe("blocked");
  expect(nextJob.jobId).not.toBe(firstJob.jobId);
  expect(nextJob.guidanceRunId).toBe(nextRun.guidanceRunId);
  expect(
    (
      await (
        await page.request.get(
          `/api/v1/guidance/${firstRun.guidanceRunId}/research/latest`,
        )
      ).json()
    ).job.jobId,
  ).toBe(firstJob.jobId);
  const latestPath = `/api/v1/guidance/${nextRun.guidanceRunId}/research/latest`;
  const restored = page.waitForResponse(
    (response) => new URL(response.url()).pathname === latestPath,
  );
  await page.reload();
  expect((await (await restored).json()).job.jobId).toBe(nextJob.jobId);
  await expect(
    panel.getByRole("button", {
      name: "一键重试（复用已完成阶段）",
      exact: true,
    }),
  ).toBeEnabled();
  expect(guidanceRequests).toHaveLength(2);
  expect(guidanceRequests[1]).toMatchObject({
    profileVersion: saved.profileVersion,
  });
});

test("阶段进度真实变化，刷新恢复同一任务并展示完整报告及可核对下载", async ({
  page,
}) => {
  const service = await researchService(page);
  const run = await openGuidance(page);
  service.setRun(run);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "报告生成中…", exact: true }),
  ).toBeDisabled();
  for (const stage of ["preparing", "researching", "analyzing"] as const) {
    service.stage(stage);
    await expect(panel.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      new RegExp(
        stage === "preparing"
          ? "选择研究方向"
          : stage === "researching"
            ? "读取官网"
            : "分析匹配",
      ),
    );
    await expect(panel.locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(
      panel.getByText(stages[stage].message, { exact: true }).first(),
    ).toBeVisible();
    if (stage === "researching") {
      for (const detail of [
        "正在检索学校与专业 3/24",
        "正在读取官网资料 8/24",
      ]) {
        service.stage(stage, detail);
        await expect(
          panel.getByRole("status").filter({ hasText: detail }),
        ).toBeVisible();
        expect(
          Number(
            await panel.getByRole("progressbar").getAttribute("aria-valuenow"),
          ),
        ).toBeLessThanOrEqual(60);
      }
    }
  }
  await page.reload();
  await expect(
    panel.getByRole("progressbar", { name: "报告阶段进度" }),
  ).toHaveAttribute("aria-valuetext", /分析匹配/);
  expect(service.postCount()).toBe(1);
  expect(service.latestCount()).toBeGreaterThanOrEqual(2);
  service.stage("writing");
  await expect(panel.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    /整理具体建议/,
  );
  const plaintextNote =
    "明文传输（HTTP）读取，内容可能被网络中间环节篡改，仅作待核验线索。";
  service.finish("completed", (report) => ({
    ...report,
    sources: report.sources.map((source) => ({
      ...source,
      transport: "http",
      retrievalNote: plaintextNote,
    })),
  }));
  await expect(panel.getByText("研究报告", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("progressbar", { includeHidden: true }),
  ).toHaveAttribute("aria-valuenow", "100", { timeout: 15000 });
  await expect(panel.getByRole("progressbar")).toHaveCount(1);
  const school = panel.getByRole("article", {
    name: "浏览器测试大学 · 法学（民商法方向）",
    exact: true,
  });
  await expect(
    school.getByRole("heading", { name: "浏览器测试大学", exact: true }),
  ).toBeVisible();
  await expect(
    school.getByText("法学（民商法方向）", { exact: true }),
  ).toBeVisible();
  await expect(
    school.getByRole("link", {
      name: "研究生招生资料（浏览器测试）",
      exact: true,
    }),
  ).toHaveAttribute("href", sourceUrl);
  await expect(panel.getByText(/已找到.*相关招生依据/)).toBeVisible();
  await expect(
    panel.getByText("此测试报告只用于核验界面，不是招生事实。", {
      exact: true,
    }),
  ).not.toBeVisible();
  await panel.getByText("综合分析与适用范围", { exact: true }).click();
  await expect(
    panel.getByText("此测试报告只用于核验界面，不是招生事实。", {
      exact: true,
    }),
  ).toBeVisible();
  await panel.getByText("全部来源与获取时间 · 1 条", { exact: true }).click();
  await expect(panel.getByText(/官网原文 ·/)).toBeVisible();
  await expect(panel.getByText(plaintextNote, { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe("研途-联网研究报告.md");
  const path = await downloaded.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, "utf8");
  expect(content).toContain(sourceText);
  expect(content).toContain(plaintextNote);
  expect(content).toContain("[research-1]");
  expect(content).toContain(sourceUrl);
  expect(content).toContain(retrievedAt);
  expect(content).toContain("浏览器测试大学");
  expect(content).toContain("法学（民商法方向）");
  expect(content).toContain("本科已有法学基础");
  expect(content).toContain("需要兼顾专业课复习与案例分析训练。");
  expect(service.postCount()).toBe(1);
});

test("待确认原文在手机卡片和下载中保留，不参与城市预算匹配", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", (report) => ({
    ...report,
    recommendations: report.recommendations.map((item) => ({
      ...item,
      tuition: undefined,
      location: undefined,
      pendingEvidence: [
        {
          field: "tuition",
          quote: "法学全程学费待核对。",
          year: 2026,
          sourceId: "research-1",
          reason: "同名专业有不同学习方式。",
        },
      ],
      constraintChecks: [
        {
          field: "budget",
          status: "unknown",
          reason: "费用尚未唯一归属。",
          sourceIds: [],
        },
        {
          field: "cities",
          status: "unknown",
          reason: "培养校区待确认。",
          sourceIds: [],
        },
      ],
    })),
    rejectedRecommendations: [
      {
        institutionName: "浏览器测试大学",
        programName: "法学",
        code: "UNSUPPORTED_RESEARCH_CLAIM",
        removedSentences: 1,
      },
    ],
    validationIssues: [
      {
        path: "recommendations[0].sentences",
        code: "UNSUPPORTED_RESEARCH_CLAIM",
      },
    ],
    readStatistics: { success: 1, failed: 1, failuresByCode: { HTTP_404: 1 } },
  }));
  const evidence = panel
    .getByRole("region", { name: "学费资料状态", exact: true })
    .getByRole("region", {
      name: "待确认原文",
      exact: true,
    });
  await expect(
    evidence.getByText("法学全程学费待核对。", { exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByText("归属待确认：同名专业有不同学习方式。", { exact: true }),
  ).toBeVisible();
  await expect(evidence.getByRole("link")).toHaveAttribute("href", sourceUrl);
  await expect(panel.getByText("尚未核实", { exact: true })).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toContain("待确认原文");
  expect(content).toContain("法学全程学费待核对。");
  expect(content).toContain("技术信息");
  expect(content).toContain("删除无据句子：1 句");
  expect(content).toContain("HTTP_404：1 次");
});

test("手机上明确展示部分报告与搜索摘要，保留来源和适用范围", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", (report) => ({
    ...report,
    failureStage: "analyzing",
    reason: "MODEL_TIMEOUT",
  }));
  await expect(panel.getByText("部分可用报告", { exact: true })).toBeVisible();
  const availability = panel.getByRole("status", { name: "报告可用性" });
  await expect(
    availability.getByText("部分可用", { exact: true }),
  ).toBeVisible();
  await expect(availability.getByText(/本次模型分析超时/)).toBeVisible();
  await expect(availability.getByText("已确认", { exact: true })).toBeVisible();
  await expect(availability.getByText("待补查", { exact: true })).toBeVisible();
  await expect(
    availability.getByText("已确认不存在", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "一键重试（复用已完成阶段）",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("region", { name: "报告生成失败", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText("研究报告", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/报考条件待核验/)).toBeVisible();
  await expect(
    panel.getByText("本次只取得搜索摘要，仍需读取官网原文。", { exact: true }),
  ).not.toBeVisible();
  await expect(
    panel.getByRole("link", {
      name: "研究生招生资料（浏览器测试）",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: "test-results/research-partial-mobile.png" });
  await panel.getByText("全部来源与获取时间 · 1 条", { exact: true }).click();
  await expect(panel.getByText(/搜索摘要 ·/)).toBeVisible();
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const path = await (await downloading).path();
  const content = await readFile(path!, "utf8");
  expect(content).toContain("本次只取得搜索摘要，仍需读取官网原文。");
  expect(content).toContain(sourceUrl);
});

test("确认专业改变基础结论版本后，禁用新研究任务并引导更新结论", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await expect(
    panel.getByRole("button", { name: "联网调研并生成报告", exact: true }),
  ).toBeEnabled();
  const exploration = page.getByText("查看基础探索与专业选择", { exact: true });
  await exploration.press("Enter");
  const direction = page
    .getByRole("heading", { name: "0301 法学", exact: true })
    .locator("..");
  await direction
    .getByRole("button", { name: "确认此报考专业", exact: true })
    .click();
  await expect(page.getByText(/个人条件或确认专业已变化/)).toBeVisible();
  await expect(
    panel.getByText(/已有报告仅供回顾，请先重新生成基础结论/),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "联网调研并生成报告", exact: true }),
  ).toBeDisabled();
  expect(service.postCount()).toBe(0);
  await exploration.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "基础探索提示",
      exact: true,
      includeHidden: true,
    }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "比较全国专业与院校", exact: true }),
  ).toBeVisible();
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/guidance" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "重新生成结论", exact: true }).click();
  expect((await refreshed).ok()).toBe(true);
  await expect(
    panel.getByRole("button", { name: "联网调研并生成报告", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/个人条件或确认专业已变化/)).toHaveCount(0);
  expect(service.postCount()).toBe(0);
});

test("服务端报告过期时即使页面画像版本未变也禁用重新生成", async ({ page }) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("completed");
  const regenerate = panel.getByRole("button", {
    name: "重新调研并生成报告",
    exact: true,
  });
  await expect(regenerate).toBeEnabled();

  // A second session changed the profile; only the report response knows it yet.
  service.invalidate();
  await panel
    .getByRole("button", { name: "重新检查服务", exact: true })
    .click();
  await expect(
    panel.getByText(/已有报告仅供回顾，请先重新生成基础结论/),
  ).toBeVisible();
  await expect(page.getByText(/个人条件或确认专业已变化/)).toHaveCount(0);
  await expect(regenerate).toBeDisabled();
  await expect(panel.getByText("研究报告", { exact: true })).toBeVisible();
  expect(service.postCount()).toBe(1);
});

test("跨专业画像优先展示具体学校专业、真实个人理由与成本，历史招生依据不隐藏建议", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const service = await researchService(page);
  const run = await openGuidance(page, async (page) => {
    await page.getByLabel("本科专业", { exact: true }).fill("生物医学工程");
    await page.getByLabel("感兴趣的专业或领域（选填）").fill("应用统计");
    await page
      .getByRole("combobox", { name: "跨专业意愿", exact: true })
      .selectOption("接受跨专业");
    await page
      .getByRole("combobox", { name: "每天可投入时间", exact: true })
      .selectOption("4–6 小时");
    await page
      .getByRole("combobox", { name: "年度预算", exact: true })
      .selectOption("2–5 万元");
    await page
      .getByRole("combobox", { name: "职业与学习目标", exact: true })
      .selectOption("专业实践与行业就业");
    await page
      .getByRole("slider", { name: "就业机会", exact: true })
      .press("End");
  });
  service.setRun(run);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  const schools = ["画像测试甲大学", "画像测试乙大学", "画像测试丙大学"];
  const historical =
    "2024 年该校应用统计专业介绍，包含数据分析课程与实践安排。";
  service.finish("completed", (report) => ({
    ...report,
    summary:
      "结合你接受跨专业、希望进入行业实践的目标，建议先比较下列应用统计培养安排。",
    facts: [{ text: historical, citations: ["research-1"] }],
    sources: schools.map((school, index) => ({
      id: "research-" + (index + 1),
      title: school + " · 2024 年应用统计招生介绍",
      url: "https://yz.chsi.com.cn/test-program-" + (index + 1),
      excerpt: historical,
      retrievedAt,
      kind: "official_page" as const,
      verified: false as const,
    })),
    recommendations: schools.map((institutionName, index) => ({
      institutionName,
      disciplineCode: "0252",
      programName: "应用统计（数据分析方向）",
      degreeType: "professional" as const,
      admissionStatus: "needs_verification" as const,
      rationale:
        "可先比较其数据分析与实践课程，再结合自身基础决定是否进一步准备。",
      fitReasons: [
        {
          profileField: "major",
          profileValue: String(run.inputSnapshot.profile.major),
          reason:
            "你来自生物医学工程，可从已有数据处理经历衔接统计学习，但还需补足统计课程。",
        },
        {
          profileField: "crossMajor",
          profileValue: String(run.inputSnapshot.profile.crossMajor),
          reason:
            "你明确接受跨专业，因此可以把应用统计纳入具体比较，而不是局限于本科同名专业。",
        },
        {
          profileField: "hours",
          profileValue: String(run.inputSnapshot.profile.hours),
          reason:
            "你每天可投入 4–6 小时，需在公共课之外留出连续时间补概率统计与编程。",
        },
        {
          profileField: "studyGoal",
          profileValue: String(run.inputSnapshot.profile.studyGoal),
          reason:
            "你希望面向行业就业，可以重点核对课程中的实际数据项目和实践安排。",
        },
        {
          profileField: "priorities.就业机会",
          profileValue: String(
            (run.inputSnapshot.profile.priorities as Record<string, number>)
              .就业机会,
          ),
          reason:
            "你把就业机会放在较高侧重，应进一步核对课程项目与目标岗位的联系。",
        },
      ],
      preparation: ["梳理概率统计基础，并完成一个小型数据分析练习。"],
      tradeoffs: [
        "跨专业需要额外补课，不能仅凭本科理工背景跳过统计基础。",
        "你填写年度预算 2–5 万元，仍需核对当年学费和所在城市生活成本。",
      ],
      uncertainties: [
        "现有材料来自 2024 年，需要核对目标年度的跨专业报考条件。",
      ],
      citations: ["research-" + (index + 1)],
    })),
  }));
  await expect(
    panel.getByRole("heading", {
      name: "建议优先比较的学校与专业",
      exact: true,
    }),
  ).toBeVisible();
  for (const [index, school] of schools.entries()) {
    const card = panel.getByRole("article", {
      name: school + " · 应用统计（数据分析方向）",
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(card.getByText("生物医学工程", { exact: true })).toBeVisible();
    await expect(card.getByText("接受跨专业", { exact: true })).toBeVisible();
    await expect(card.getByText(/^选择侧重 · 就业机会/)).toBeVisible();
    await expect(card.getByText("100", { exact: true })).toBeVisible();
    await expect(card.getByText("个人情况", { exact: true })).toHaveCount(0);
    await expect(
      card.getByText(/你明确接受跨专业，因此可以把应用统计/),
    ).toBeVisible();
    await expect(card.getByText(/跨专业需要额外补课/)).toBeVisible();
    await expect(card.getByText(/报考条件待核验/)).toBeVisible();
    await expect(
      card.getByRole("link", {
        name: school + " · 2024 年应用统计招生介绍",
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      "https://yz.chsi.com.cn/test-program-" + (index + 1),
    );
  }
  await expect(panel.getByText(/已找到.*相关招生依据/)).toHaveCount(0);
  await expect(panel.getByText("research-1", { exact: true })).toHaveCount(0);
  await expect(
    panel.getByText(historical, { exact: true }).first(),
  ).not.toBeVisible();
  await expect(
    panel.getByText("此测试报告只用于核验界面，不是招生事实。", {
      exact: true,
    }),
  ).not.toBeVisible();
  await panel.screenshot({
    path: "test-results/research-profile-schools-desktop.png",
  });
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toContain("画像测试甲大学 · 应用统计（数据分析方向）");
  expect(content).toContain("跨专业意愿：接受跨专业");
  expect(content).toContain("选择侧重 · 就业机会：100");
  expect(content).toContain("你每天可投入 4–6 小时");
  expect(content).toContain("跨专业需要额外补课");
  expect(content).toContain("报考条件待核验");
  expect(service.postCount()).toBe(1);
});

test("五所学校按综合适合度分三层，昂贵仍可优先且同价可不同层，费用独立核对并导出", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const service = await researchService(page);
  const run = await openGuidance(page, async (page) => {
    await page.getByLabel("本科专业", { exact: true }).fill("机械工程");
    await page.getByLabel("感兴趣的专业或领域（选填）").fill("人工智能");
    await page
      .getByRole("combobox", { name: "跨专业意愿", exact: true })
      .selectOption("接受跨专业");
    await page
      .getByRole("combobox", { name: "年度预算", exact: true })
      .selectOption("2–5 万元");
    await page.getByRole("button", { name: "杭州", exact: true }).click();
  });
  service.setRun(run);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("completed", () => tieredReport(run));
  await expect(
    panel.getByText("本次建议 5 所不同学校，目标比较 5–10 所", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("complementary", { name: "报告覆盖说明" }),
  ).toHaveCount(0);
  const preferred = panel.getByRole("region", {
    name: "第一级·优先推荐",
    exact: true,
  });
  const alternatives = panel.getByRole("region", {
    name: "第二级·适合备选",
    exact: true,
  });
  await expect(preferred.getByRole("article")).toHaveCount(3);
  await expect(alternatives.getByRole("article")).toHaveCount(1);
  const exploratory = panel.getByRole("region", {
    name: "第三级·探索选择",
    exact: true,
  });
  await expect(exploratory.getByRole("article")).toHaveCount(1);
  const expensive = preferred.getByRole("article", {
    name: "分级测试丁大学 · 电子信息（人工智能技术）",
    exact: true,
  });
  await expect(expensive.getByText("机械工程", { exact: true })).toBeVisible();
  await expect(expensive.getByText(/你接受跨专业/)).toBeVisible();
  await expect(
    expensive.getByText(/60,000 元，高于你填写的 2–5 万元年度预算/),
  ).toBeVisible();
  await expect(
    expensive.getByText(
      /虽然学费高于预算，但人工智能兴趣与工程基础形成较强衔接/,
    ),
  ).toBeVisible();
  await expect(
    expensive.getByRole("list", { name: "学费依据来源" }).getByRole("link"),
  ).toHaveAttribute("href", "https://yz.chsi.com.cn/test-fee-3");
  await expect(
    exploratory
      .getByRole("definition")
      .filter({ hasText: "项目位于上海，与你选择的杭州不同。" }),
  ).toBeVisible();
  const unknown = preferred.getByRole("article", {
    name: "分级测试乙大学 · 电子信息（人工智能技术）",
    exact: true,
  });
  await expect(
    unknown.getByText(
      "尚未查到可核对的学费金额，暂不能判断是否符合你的年度预算。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    unknown.getByText("尚未查到项目学费，不能判断是否在 2–5 万元年度预算内。", {
      exact: true,
    }),
  ).toBeVisible();
  const historical = alternatives.getByRole("article", {
    name: "分级测试丙大学 · 电子信息（人工智能技术）",
    exact: true,
  });
  await expect(
    historical.getByText(
      `${Number(run.inputSnapshot.profile.year) - 2} 年参考学费：40,000 元/全程（该专业标准；非全日制）`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    preferred
      .getByRole("article", {
        name: "分级测试甲大学 · 电子信息（人工智能技术）",
        exact: true,
      })
      .getByText(/年学费：8,000 元\/学年/),
  ).toBeVisible();
  await expect(exploratory.getByText(/年学费：8,000 元\/学年/)).toBeVisible();
  await expect(
    exploratory.getByText(/跨考准备成本仍需评估，先作为探索选择/),
  ).toBeVisible();
  await expect(panel.getByText(/分级不换算录取率，也不保证录取/)).toBeVisible();
  await expect(
    panel.getByText(/尚未发现已核实的预算或城市偏好冲突/),
  ).toHaveCount(0);
  await expect(
    historical.getByText(/该费用为其他年度参考，目标年度收费尚需核对/),
  ).toBeVisible();
  await expect(
    historical.getByText(/此金额不是按学年计费，不能直接与年度预算比较/),
  ).toBeVisible();
  await expect(panel.getByText(/这是旧版报告/)).toHaveCount(0);
  await preferred.screenshot({
    path: "test-results/research-tiers-desktop.png",
  });
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toContain("本次建议 5 所不同学校，目标比较 5–10 所。");
  expect(content).toContain("## 第一级·优先推荐");
  expect(content).toContain("## 第二级·适合备选");
  expect(content).toContain("## 第三级·探索选择");
  expect(content).toContain("分级不换算录取率，也不保证录取");
  expect(content).toContain(
    "虽然学费高于预算，但人工智能兴趣与工程基础形成较强衔接",
  );
  expect(content).toContain("分级测试丁大学 · 电子信息（人工智能技术）");
  expect(content).toContain("60,000 元/学年");
  expect(content).toContain("参考学费：40,000 元/全程");
  expect(content).toContain("不能直接与年度预算比较");
  expect(content).toContain("https://yz.chsi.com.cn/test-fee-3");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(expensive.getByText(/60,000 元，高于你填写/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expensive.screenshot({
    path: "test-results/research-tiers-mobile.png",
  });
  expect(service.postCount()).toBe(1);
});

test("五所外地学校仍显示真实部分结果及杭州覆盖缺口，不误报失败或缺画像", async ({
  page,
}) => {
  const service = await researchService(page);
  const run = await openGuidance(page, async (page) => {
    await page.getByRole("button", { name: "杭州", exact: true }).click();
  });
  service.setRun(run);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  const cityGap =
    "意向城市杭州：目前可核验符合杭州的学校建议为 0 所；已保留五所外地学校供比较，这不代表杭州没有适合学校。";
  service.finish("partial", () => {
    const report = tieredReport(run);
    return {
      ...report,
      status: "partial",
      reason: "PREFERRED_CITY_COVERAGE_INCOMPLETE",
      coverage: {
        ...report.coverage!,
        preferredCities: ["杭州"],
        preferredCitySchoolCount: 0,
        unknownCitySchoolCount: 0,
        shortfallReasons: [cityGap],
      },
      recommendations: report.recommendations.map((item) => ({
        ...item,
        tierReasons: ["已有学校与专业依据，可作为需权衡城市偏好的备选。"],
        location: {
          ...item.location!,
          city: "上海",
          quote: "该电子信息项目在上海校区培养。",
        },
        constraintChecks: item.constraintChecks!.map((check) =>
          check.field === "cities"
            ? {
                ...check,
                status: "mismatch",
                reason: "官网培养地址位于上海，与意向城市杭州不同。",
              }
            : check,
        ),
      })),
    };
  });
  await expect(panel.getByText("部分可用报告", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("本次建议 5 所不同学校，目标比较 5–10 所", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("article", {
      name: /^分级测试[甲乙丙丁戊]大学 · 电子信息/,
    }),
  ).toHaveCount(5);
  const coverage = panel.getByRole("complementary", { name: "报告覆盖说明" });
  await expect(
    coverage.getByText("意向城市覆盖仍不足，先保留已有建议", { exact: true }),
  ).toBeVisible();
  await expect(coverage.getByText(cityGap, { exact: true })).toBeVisible();
  await expect(panel.getByText(/尚未达到 5 所/)).toHaveCount(0);
  await expect(
    panel.getByRole("region", { name: "报告生成失败", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "补充个人情况", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText("需要补充信息", { exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "下载研究报告", exact: true }),
  ).toBeEnabled();
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toContain(cityGap);
  expect(content).toContain("本次建议 5 所不同学校");
  expect(service.postCount()).toBe(1);
});

test("不足五所仍保留适合与备选学校，并说明尚未查到而非不存在", async ({
  page,
}) => {
  const service = await researchService(page);
  const run = await openGuidance(page);
  service.setRun(run);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", () => {
    const report = tieredReport(run);
    return {
      ...report,
      status: "partial",
      recommendations: [report.recommendations[0], report.recommendations[2]],
      coverage: {
        targetMin: 5,
        targetMax: 10,
        schoolCount: 2,
        preferredCount: 1,
        alternativeCount: 1,
        shortfallReasons: [
          "本次只核对到两所学校的具体项目，其他候选学校的官网资料尚未查到足够依据。",
        ],
      },
    };
  });
  await expect(
    panel.getByText("本次建议 2 所不同学校，目标比较 5–10 所", { exact: true }),
  ).toBeVisible();
  const coverage = panel.getByRole("complementary", { name: "报告覆盖说明" });
  await expect(
    coverage.getByText("尚未达到 5 所，先保留已有建议", { exact: true }),
  ).toBeVisible();
  await expect(
    coverage.getByText(/其他候选学校的官网资料尚未查到足够依据/),
  ).toBeVisible();
  await expect(
    panel
      .getByRole("region", { name: "第一级·优先推荐", exact: true })
      .getByRole("article"),
  ).toHaveCount(1);
  await expect(
    panel
      .getByRole("region", { name: "第二级·适合备选", exact: true })
      .getByRole("article"),
  ).toHaveCount(1);
  await expect(
    panel.getByRole("region", { name: "暂无学校推荐", exact: true }),
  ).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toContain("本次建议 2 所不同学校");
  expect(content).toContain("其他候选学校的官网资料尚未查到足够依据");
});

test("模型供应服务故障显示真实原因，不误称画像或资料校验失败", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.stop("preparing", "PROVIDER_UNAVAILABLE");
  const failure = panel.getByRole("region", {
    name: "报告生成失败",
    exact: true,
  });
  await expect(
    failure.getByText(
      "模型服务未完成本次请求，请检查服务状态与配置；无需修改画像。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(failure.getByText(/校验|来源核对/)).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "补充个人情况", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: "一键重试（复用已完成阶段）",
      exact: true,
    }),
  ).toBeEnabled();
});

test("确有待补充问题时展示问题与画像入口，保留完整排查内容", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", (report) => ({
    ...report,
    reason: "NO_WEB_EVIDENCE",
    recommendations: [],
    facts: [],
    sources: [],
    searched: false,
    followUpQuestions: ["你是否有更希望工作的城市？"],
    limitations: ["测试排查详情：所请求的学校官网暂未返回可核对的正文。"],
  }));
  const empty = panel.getByRole("region", {
    name: "暂无学校推荐",
    exact: true,
  });
  await expect(
    empty.getByRole("heading", {
      name: "补充这些信息后继续研究",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    empty.getByText("尚未取得可引用的网页资料，不能生成院校研究结论。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    empty.getByText("你是否有更希望工作的城市？", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText(/测试排查详情/)).not.toBeVisible();
  await expect(
    empty.getByRole("button", { name: "浏览专业与院校", exact: true }),
  ).toHaveCount(0);
  await panel.getByText("综合分析与适用范围", { exact: true }).click();
  await expect(panel.getByText(/测试排查详情/)).toBeVisible();
  await empty
    .getByRole("button", { name: "补充个人情况", exact: true })
    .click();
  await expect(page.getByLabel("本科专业", { exact: true })).toHaveValue(
    "法学",
  );
  expect(service.postCount()).toBe(1);
});

test("规划技术失败显示停止阶段，刷新保留画像且仅手动重试", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const service = await researchService(page);
  const run = await openGuidance(page);
  service.setRun(run);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.stop("preparing", "INVALID_RESEARCH_REPORT");
  const failure = panel.getByRole("region", {
    name: "报告生成失败",
    exact: true,
  });
  await expect(
    failure.getByRole("heading", { name: "系统未能完成本次报告", exact: true }),
  ).toBeVisible();
  await expect(
    failure.getByText("未完成阶段：结合画像选择研究方向。", { exact: true }),
  ).toBeVisible();
  await expect(
    failure.getByText(/你的个人画像仍已保存，无需重新填写/),
  ).toBeVisible();
  await expect(panel.getByText("部分可用报告", { exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "补充个人情况", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "浏览专业与院校", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "下载研究报告", exact: true }),
  ).toHaveCount(0);
  await panel.getByText("生成过程与服务信息", { exact: true }).click();
  await expect(panel.getByText(/本次处理已停止，不会在后台继续/)).toBeVisible();
  await expect(
    panel
      .getByRole("listitem")
      .filter({ hasText: "结合画像选择研究方向（未完成）" }),
  ).toBeVisible();
  await expect(panel.locator('[aria-current="step"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(failure).toBeVisible();
  expect(service.postCount()).toBe(1);
  const profile = await (await page.request.get("/api/v1/me/profile")).json();
  expect(profile.profile).toMatchObject(run.inputSnapshot.profile);
  await panel
    .getByRole("button", { name: "一键重试（复用已完成阶段）", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(service.postCount()).toBe(2);
});

for (const { reason, failureStage } of [
  { reason: "INVALID_RESEARCH_REPORT", failureStage: undefined },
  { reason: "INVALID_RESEARCH_REPORT", failureStage: "analyzing" },
  { reason: "RESPONSE_TOO_LARGE", failureStage: undefined },
  { reason: "INCOMPLETE_RESPONSE", failureStage: undefined },
  { reason: "UNKNOWN_USAGE", failureStage: undefined },
] as const) {
  test(
    (failureStage ? "明确失败阶段" : "旧 partial 完成态") +
      "中的模型错误仍显示失败，不误称部分可用报告或缺画像：" +
      reason,
    async ({ page }) => {
      const service = await researchService(page);
      service.setRun(await openGuidance(page));
      const panel = page.getByRole("region", {
        name: "联网研究报告",
        exact: true,
      });
      await panel
        .getByRole("button", { name: "联网调研并生成报告", exact: true })
        .click();
      await expect(
        panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
      ).toBeVisible();
      service.finish("partial", (report) => ({
        ...report,
        reason,
        failureStage,
        recommendations: [],
        followUpQuestions: ["旧结果遗留的补充问题"],
      }));
      await expect(
        panel.getByRole("region", { name: "报告生成失败", exact: true }),
      ).toBeVisible();
      if (failureStage) {
        await expect(
          panel.getByText("未完成阶段：分析匹配与准备成本。", { exact: true }),
        ).toBeVisible();
      }
      await expect(
        panel.getByText("部分可用报告", { exact: true }),
      ).toHaveCount(0);
      await expect(
        panel.getByText("旧结果遗留的补充问题", { exact: true }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: "补充个人情况", exact: true }),
      ).toHaveCount(0);
      await panel.getByText("生成过程与服务信息", { exact: true }).click();
      await expect(
        panel.getByText(/本次处理已停止，不会在后台继续/),
      ).toBeVisible();
      await expect(panel.getByRole("progressbar")).toHaveCount(0);
      await panel
        .getByText("全部来源与获取时间 · 1 条", { exact: true })
        .click();
      await expect(
        panel.getByRole("link", {
          name: "研究生招生资料（浏览器测试）",
          exact: true,
        }),
      ).toHaveAttribute("href", sourceUrl);
      expect(service.postCount()).toBe(1);
    },
  );
}

test("画像已足但无学校证据时由系统继续调研，不要求用户先选学校", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", (report) => ({
    ...report,
    reason: "NO_WEB_EVIDENCE",
    recommendations: [],
    facts: [],
    sources: [],
  }));
  await expect(
    panel.getByRole("heading", {
      name: "本次尚未找到足够的学校依据",
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByText(/你无需先列出目标学校/)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "补充个人情况", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "浏览专业与院校", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "重新调研并生成报告", exact: true }),
  ).toBeEnabled();
  await expect(panel.getByText("报告生成失败", { exact: true })).toHaveCount(0);
  expect(service.postCount()).toBe(1);
});

test("真正缺画像的阻断状态保留补充入口，任务未生成报告时失败也可重试", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.stop("preparing", "RESEARCH_PROFILE_REQUIRED");
  await expect(panel.getByText("需要补充信息", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "补充个人情况", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("报告生成失败", { exact: true })).toHaveCount(0);
  await panel
    .getByRole("button", { name: "重新调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.stop("analyzing", "MODEL_UNAVAILABLE", false);
  await expect(
    panel.getByRole("region", { name: "报告生成失败", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("未完成阶段：分析匹配与准备成本。", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "一键重试（复用已完成阶段）",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "补充个人情况", exact: true }),
  ).toHaveCount(0);
});

for (const { empty, reportVersion } of [
  { empty: false, reportVersion: undefined },
  { empty: true, reportVersion: undefined },
  { empty: false, reportVersion: "profile-research-v3" },
  { empty: false, reportVersion: "profile-research-v4" },
  { empty: false, reportVersion: "profile-research-v6" },
] as const) {
  test(
    "旧版" +
      (reportVersion ?? "无版本") +
      (empty ? "空" : "学校") +
      "报告可回顾并提示手动按完整画像重新生成",
    async ({ page }) => {
      const service = await researchService(page);
      service.setRun(await openGuidance(page));
      const panel = page.getByRole("region", {
        name: "联网研究报告",
        exact: true,
      });
      await panel
        .getByRole("button", { name: "联网调研并生成报告", exact: true })
        .click();
      await expect(
        panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
      ).toBeVisible();
      service.finish("partial", (report) => ({
        ...report,
        reportVersion,
        recommendations: empty
          ? []
          : [
              {
                institutionName: "浏览器测试大学",
                disciplineCode: "0301",
                rationale: "旧报告仅记录法学专业类别，请重新核对具体专业。",
                preparation: ["核对培养方案。"],
                uncertainties: ["具体招生专业尚未记录。"],
                citations: ["research-1"],
              },
            ],
      }));
      await expect(panel.getByText(/这是旧版报告/)).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "重新调研并生成报告", exact: true }),
      ).toBeEnabled();
      if (empty) {
        await expect(
          panel.getByText(/可按完整画像重新调查学校与具体专业/),
        ).toBeVisible();
      } else {
        await expect(
          panel.getByRole("heading", { name: "浏览器测试大学", exact: true }),
        ).toBeVisible();
        await expect(
          panel.getByText("旧报告仅记录专业类别，具体招生专业待补充", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(panel.getByText(/报考条件待核验/)).toBeVisible();
      }
      await page.reload();
      await expect(panel.getByText(/这是旧版报告/)).toBeVisible();
      expect(service.postCount()).toBe(1);
    },
  );
}

test("v7展示测评依据、真实科目与同校专业对比，并明确杭州候选的资料缺口和排除原因", async ({
  page,
}) => {
  const service = await researchService(page);
  const run = await openGuidance(page);
  service.setRun(run);
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("completed", (report) => {
    const match = {
      ruleVersion: "demand-match-v1" as const,
      summary: "杭州培养地址已有依据，预算尚待精确学费资料。",
      factors: [
        {
          field: "cities",
          label: "意向城市",
          status: "match" as const,
          reason: "已核对项目位于杭州。",
          sourceIds: ["research-1"],
        },
        {
          field: "budget",
          label: "预算",
          status: "unknown" as const,
          reason: "尚未取得该项目精确收费原文。",
          sourceIds: [],
        },
        {
          field: "degreeType",
          label: "学位偏好",
          status: "not_requested" as const,
          reason: "本人尚未限定学位类型，保留两条路线比较。",
          sourceIds: [],
        },
      ],
    };
    return {
      ...report,
      decisionBasis: decisionDisplayFixture(),
      candidateAudit: [
        {
          institutionName: "浏览器测试大学",
          status: "recommended",
          reasons: ["具体项目已核验，列入本次比较。"],
          sourceIds: ["research-1"],
        },
        {
          institutionName: "杭州电子科技大学",
          status: "awaiting_evidence",
          reasons: [
            "已找到目录入口，电子信息项目正文尚未读取，不能据此排除杭电。",
          ],
          sourceIds: ["research-1"],
        },
        {
          institutionName: "测试排除学院",
          status: "excluded",
          reasons: ["已读取目录，所申请项目明确要求本科背景条件，本次不满足。"],
          sourceIds: ["research-1"],
        },
        {
          institutionName: "测试未选学院",
          status: "not_selected",
          reasons: ["本次比较数量已达目标，未选入不代表不适合。"],
          sourceIds: [],
        },
      ],
      recommendations: [
        {
          ...report.recommendations[0],
          degreeType: "professional",
          collegeName: "主项目法学院",
          majorCode: "035101",
          match,
          exams: {
            status: "verified_current",
            year: 2027,
            subjects: [
              { code: "301", name: "数学一" },
              { code: "201", name: "英语一" },
            ],
            quote: "2027年项目目录：301数学一、201英语一。",
            sourceId: "research-1",
            reason: "已读取具体项目的目标年度目录。",
          },
          preparation: ["先复习导数基础，不用练习正确率替代项目报考科目。"],
          programAlternatives: [
            {
              programName: "计算机科学与技术",
              disciplineCode: "0812",
              collegeName: "计算机学院",
              majorCode: "081200",
              degreeType: "academic",
              tier: "alternative",
              rationale: "按该计算机项目的独立条件保留比较。",
              preparation: ["该项目先补数据结构与算法。"],
              tradeoffs: ["该项目需要额外安排算法训练时间。"],
              uncertainties: ["该项目2027年考试组仍需核对。"],
              match: {
                ruleVersion: "demand-match-v1",
                summary: "该项目预算已有依据，培养城市与杭州偏好有差异。",
                factors: [
                  {
                    field: "budget",
                    label: "预算",
                    status: "match",
                    reason: "该计算机项目学费符合年度预算。",
                    sourceIds: ["research-1"],
                  },
                  {
                    field: "cities",
                    label: "意向城市",
                    status: "mismatch",
                    reason: "该计算机项目培养地点位于杭州之外。",
                    sourceIds: ["research-1"],
                  },
                ],
              },
              exams: {
                status: "historical",
                year: 2026,
                subjects: [{ code: "302", name: "数学二" }],
                quote: "2026年测试项目目录：302数学二。",
                sourceId: "research-1",
                reason: "仅取得历史目录，2027年科目仍需核验。",
              },
              citations: ["research-1"],
            },
            {
              programName: "软件工程",
              disciplineCode: "0835",
              degreeType: "academic",
              tier: "exploratory",
              match: {
                ruleVersion: "demand-match-v1",
                summary: "该专业资料待独立核对。",
                factors: [],
              },
              exams: {
                status: "unknown",
                subjects: [],
                reason: "没有该专业的已核验目录。",
              },
              citations: [],
            },
          ],
        },
      ],
    };
  });
  const basis = panel.getByRole("region", {
    name: "测评与学位路线依据",
    exact: true,
  });
  await expect(basis).toBeVisible();
  await expect(basis.getByText("示例练习观察", { exact: true })).toBeVisible();
  await expect(
    basis.getByText("练习范围：数学一", { exact: true }),
  ).toBeVisible();
  await expect(basis.getByText(/练习范围：math-one/)).toHaveCount(0);
  await expect(
    basis.getByText(/答对 1 题，答错 1 题，未答 1 题，共 3 题/),
  ).toBeVisible();
  await expect(
    basis.getByText("英语尚未测评，不推定英语基础强弱。", { exact: true }),
  ).toBeVisible();
  await expect(
    basis.getByText(/不能把小题量示例换算为数学一或数学二/),
  ).toBeVisible();
  await basis.getByText("查看测评记录与版本", { exact: true }).click();
  await expect(basis.getByText(/诊断版本 diagnosis-display-v1/)).toBeVisible();
  await expect(basis.getByText(/题库版本 example-bank-v1/)).toBeVisible();
  await expect(
    basis
      .getByRole("region", { name: "专业学位路线", exact: true })
      .getByText(/不能据此认定必考数学二或英语二/),
  ).toBeVisible();
  const card = panel.getByRole("article", {
    name: "浏览器测试大学 · 法学（民商法方向）",
    exact: true,
  });
  await expect(
    card.getByText("招生院系：主项目法学院", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("专业代码：035101", { exact: true }),
  ).toBeVisible();
  const exams = card.getByRole("region", { name: "实际考试科目", exact: true });
  await expect(
    exams.getByText("2027 年考试科目已有官网依据", { exact: true }),
  ).toBeVisible();
  await expect(exams.getByText("301 数学一", { exact: true })).toBeVisible();
  await expect(exams.getByText("201 英语一", { exact: true })).toBeVisible();
  await expect(exams.getByText(/先复习导数基础/)).toHaveCount(0);
  await expect(
    card
      .getByRole("region", { name: "需求匹配依据", exact: true })
      .getByText("尚未取得该项目精确收费原文。", { exact: true }),
  ).toBeVisible();
  await exams.getByText("查看考试科目原文", { exact: true }).click();
  await expect(
    exams.getByText("2027年项目目录：301数学一、201英语一。", { exact: true }),
  ).toBeVisible();
  await expect(exams.getByRole("link")).toHaveAttribute("href", sourceUrl);
  await card.getByText("同校其他专业比较 · 2 项", { exact: true }).click();
  const alternative = card.getByRole("region", {
    name: "同校专业：计算机科学与技术",
    exact: true,
  });
  await expect(
    alternative.getByText("2026 年考试科目参考，目标年度待核验", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    alternative.getByText("302 数学二", { exact: true }),
  ).toBeVisible();
  await expect(
    alternative.getByText("招生院系：计算机学院", { exact: true }),
  ).toBeVisible();
  await expect(
    alternative.getByText("专业代码：081200", { exact: true }),
  ).toBeVisible();
  await expect(
    alternative.getByText("按该计算机项目的独立条件保留比较。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    alternative
      .getByRole("definition")
      .filter({ hasText: "该计算机项目学费符合年度预算。" }),
  ).toBeVisible();
  await expect(
    alternative
      .getByRole("definition")
      .filter({ hasText: "该计算机项目培养地点位于杭州之外。" }),
  ).toBeVisible();
  await expect(
    alternative
      .getByRole("region", { name: "同校专业准备建议", exact: true })
      .getByText("该项目先补数据结构与算法。", { exact: true }),
  ).toBeVisible();
  await expect(
    alternative
      .getByRole("region", { name: "同校专业需要权衡", exact: true })
      .getByText("该项目需要额外安排算法训练时间。", { exact: true }),
  ).toBeVisible();
  await expect(
    alternative
      .getByRole("region", { name: "同校专业待确认事项", exact: true })
      .getByText("该项目2027年考试组仍需核对。", { exact: true }),
  ).toBeVisible();
  await expect(
    alternative.getByText(/主项目法学院|035101|先复习导数基础|301 数学一/),
  ).toHaveCount(0);
  const sparseAlternative = card.getByRole("region", {
    name: "同校专业：软件工程",
    exact: true,
  });
  await expect(
    sparseAlternative.getByText("考试科目尚未核验", { exact: true }),
  ).toBeVisible();
  await expect(
    sparseAlternative.getByText(
      /招生院系：|专业代码：|先复习导数基础|数据结构与算法/,
    ),
  ).toHaveCount(0);
  await expect(
    sparseAlternative.getByRole("region", {
      name: "同校专业准备建议",
      exact: true,
    }),
  ).toHaveCount(0);
  const audit = panel.getByRole("region", {
    name: "候选院校覆盖与排除说明",
    exact: true,
  });
  await expect(
    audit.getByText("杭州电子科技大学", { exact: true }),
  ).toBeVisible();
  await expect(audit.getByText("资料待补充", { exact: true })).toBeVisible();
  await expect(audit.getByText(/不能据此排除杭电/)).toBeVisible();
  await expect(
    audit.getByText("已排除（有明确依据）", { exact: true }),
  ).toBeVisible();
  await expect(audit.getByText(/明确要求本科背景条件/)).toBeVisible();
  await expect(panel.getByText(/这是旧版报告/)).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe("研途-联网研究报告.md");
  const content = await readFile((await downloaded.path())!, "utf8");
  expect(content).toContain("测评与学位路线依据");
  expect(content).toContain("diagnosis-display-v1");
  expect(content).toContain("练习范围：数学一");
  expect(content).not.toContain("练习范围：math-one");
  expect(content).toContain("招生院系：主项目法学院\n专业代码：035101");
  expect(content).toContain("招生院系：计算机学院\n专业代码：081200");
  expect(content).toContain(
    "###### 该专业的准备建议\n- 准备：该项目先补数据结构与算法。",
  );
  expect(content).toContain(
    "###### 该专业需要权衡\n- 需要权衡：该项目需要额外安排算法训练时间。",
  );
  expect(content).toContain("301 数学一");
  expect(content).toContain("2026 年考试科目参考，目标年度待核验");
  expect(content).toContain("杭州电子科技大学 · 资料待补充");
  expect(content).toContain("已排除（有明确依据）");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(basis).toBeVisible();
  await expect(
    audit.getByText("杭州电子科技大学", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await basis.screenshot({ path: "test-results/research-v7-basis-mobile.png" });
  expect(service.postCount()).toBe(1);
});

test("v7没有可核验院校时仍展示测评和学位依据，不把资料缺口误称学校不存在", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", (report) => ({
    ...report,
    reason: "NO_WEB_EVIDENCE",
    recommendations: [],
    decisionBasis: decisionDisplayFixture(),
    candidateAudit: [
      {
        institutionName: "杭州电子科技大学",
        status: "awaiting_evidence",
        reasons: [
          "招生目录官网本次未返回正文，不能据此认定没有符合需求的项目。",
        ],
        sourceIds: [],
      },
    ],
  }));
  await expect(
    panel.getByRole("region", { name: "测评与学位路线依据", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", {
      name: "本次尚未找到足够的学校依据",
      exact: true,
    }),
  ).toBeVisible();
  const audit = panel.getByRole("region", {
    name: "候选院校覆盖与排除说明",
    exact: true,
  });
  await expect(audit.getByText(/不能据此认定没有符合需求的项目/)).toBeVisible();
  await expect(panel.getByText(/这是旧版报告/)).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toContain("## 测评与学位路线依据");
  expect(content).toContain("数学一、数学二");
  expect(content).toContain("杭州电子科技大学 · 资料待补充");
});

test("只有一年历史资料时仍显示目标年度的已知改科并同步下载", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  const historical = {
    status: "historical" as const,
    year: 2026,
    subjects: [{ code: "204", name: "英语二" }],
    reason: "2026年科目作为备考参考。",
    sourceId: "research-1",
  };
  service.finish("partial", (report) => ({
    ...report,
    recommendations: [
      {
        ...report.recommendations[0],
        exams: {
          status: "verified_current",
          year: 2027,
          subjects: [{ code: "201", name: "英语一" }],
          reason: "2027年已改为英语一。",
          historicalReference: historical,
          history: [historical],
          historicalChanges: [
            {
              fromYear: 2026,
              toYear: 2027,
              sourceIds: ["research-1"],
              summary: "2026年至2027年英语二改为英语一，按目标年度要求确认。",
            },
          ],
        },
      },
    ],
  }));
  await expect(
    panel.getByText("近年考试科目对照", { exact: true }),
  ).toHaveCount(0);
  const changes = panel.getByRole("region", {
    name: "考试科目年度变化",
    exact: true,
  });
  await expect(changes).toContainText("2026年至2027年英语二改为英语一");
  await expect(
    panel.getByRole("heading", { name: "2027年科目补充核验", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await download).path())!, "utf8");
  expect(content).toContain("2026年至2027年英语二改为英语一");
  expect(content).toContain("2027 年考试科目已有官网依据");
});

test("历年政策优先展示2026备考参考与2025对照，2027科目作为补充核验并同步下载", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", (report) => ({
    ...report,
    referencePolicy: {
      strategy: "history-first-v1",
      targetYear: "2027",
      referenceYears: [2026, 2025, 2024],
      summary:
        "优先整合2026年、2025年、2024年官网政策；2027年资料用于补充核验与识别变化。",
    },
    recommendations: [
      {
        ...report.recommendations[0],
        referenceBasis: {
          year: 2026,
          sourceIds: ["research-1"],
          reason: "依据2026年硕士专业目录形成专业比较，2027年资格尚待确认。",
        },
        location: {
          city: "南京",
          year: 2026,
          sourceId: "research-1",
          quote: "2026年培养安排参考",
        },
        exams: {
          status: "verified_current",
          year: 2027,
          subjects: [{ code: "201", name: "英语一" }],
          reason: "2027年目录要求英语一，不能用历史英语二替代。",
          historicalReference: {
            status: "historical",
            year: 2026,
            subjects: [{ code: "204", name: "英语二" }],
            reason: "2026年考试科目供备考参考，目标年度另行核对。",
            sourceId: "research-1",
          },
          history: [
            {
              status: "historical",
              year: 2026,
              subjects: [{ code: "204", name: "英语二" }],
              reason: "2026年参考",
            },
            {
              status: "historical",
              year: 2025,
              subjects: [{ code: "201", name: "英语一" }],
              reason: "2025年参考",
            },
          ],
          historicalChanges: [
            {
              fromYear: 2025,
              toYear: 2026,
              sourceIds: ["research-1"],
              summary: "2025年至2026年英语一变为英语二。",
            },
          ],
        },
      },
    ],
  }));
  await expect(
    panel.getByRole("region", { name: "资料年份与使用顺序", exact: true }),
  ).toContainText("2026年、2025年、2024年");
  const card = panel.getByRole("article", {
    name: "浏览器测试大学 · 法学（民商法方向）",
    exact: true,
  });
  await expect(
    card.getByRole("heading", {
      name: "2026年专业资料作为比较基准",
      exact: true,
    }),
  ).toBeVisible();
  const reference = card.getByRole("region", {
    name: "历年备考参考科目",
    exact: true,
  });
  await expect(
    reference.getByText("204 英语二", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("heading", { name: "2027年科目补充核验", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("项目所在城市：南京（2026年培养安排参考）", { exact: true }),
  ).toBeVisible();
  await card.getByText("近年考试科目对照", { exact: true }).click();
  await expect(card.getByRole("table")).toContainText("2025年");
  await expect(card.getByRole("table")).toContainText("201 英语一");
  await expect(
    card
      .getByRole("listitem")
      .filter({ hasText: "2025年至2026年英语一变为英语二。" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await download).path())!, "utf8");
  expect(content).toContain("2026年备考参考科目");
  expect(content).toContain("2025年至2026年英语一变为英语二");
  expect(content).toContain("2027 年考试科目已有官网依据");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(reference).toBeVisible();
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    elements: [...document.querySelectorAll("*")]
      .filter(
        (element) => element.getBoundingClientRect().right > innerWidth + 1,
      )
      .slice(-10)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        width: element.getBoundingClientRect().width,
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(overflow.width, JSON.stringify(overflow.elements)).toBeLessThanOrEqual(
    overflow.viewport,
  );
});

async function openProgrammeCoverage(page: Page) {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(
    panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
  ).toBeVisible();
  service.finish("partial", withEvidenceCoverage);
  await expect(
    panel.getByRole("region", { name: "专业资料覆盖与缺项", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(
      "继续补查会复用已有资料，优先补齐缺少的原文；已有报告在补查期间仍可查看。",
      { exact: true },
    ),
  ).toBeVisible();
  return { service, panel };
}

test("逐专业缺项独立展示已读原文、历史与当年状态、失败原因和补查动作，并同步导出", async ({
  page,
}) => {
  const { panel } = await openProgrammeCoverage(page);
  const overview = panel.getByRole("region", {
    name: "专业资料覆盖与缺项",
    exact: true,
  });
  await expect(
    overview.getByText(
      /调查记录包含 2 所学校、2 个候选专业，其中 2 个有项目原文/,
    ),
  ).toBeVisible();
  await expect(
    overview.getByText(/仅统计本次实际调查的学校与专业/),
  ).toBeVisible();
  const school = panel.getByRole("region", {
    name: "浏览器测试大学逐专业资料",
    exact: true,
  });
  const academic = school.getByRole("region", {
    name: "机械工程 · 080200 · 机械工程学院资料核验",
    exact: true,
  });
  await academic
    .getByText("机械工程 · 080200 · 机械工程学院", { exact: true })
    .click();
  await expect(
    academic.getByText(/学术学位 · 全日制 · 2026 年项目原文/),
  ).toBeVisible();
  await expect(
    academic.getByRole("term").filter({ hasText: "具体专业与招生目录" }),
  ).toContainText("已有历史参考原文");
  await expect(
    academic.getByRole("term").filter({ hasText: "学费" }),
  ).toContainText("尚缺原文");
  await expect(
    academic.getByRole("term").filter({ hasText: "报考资格" }),
  ).toContainText("原文有歧义，待核对");
  await expect(
    academic.getByRole("term").filter({ hasText: "课程与培养" }),
  ).toContainText("此项不适用");
  const programProof = academic
    .getByRole("definition")
    .filter({ hasText: "已取得2026年机械工程学院的具体专业目录原文。" });
  await programProof
    .getByText("查看已取得的原文 · 1 条", { exact: true })
    .click();
  await expect(
    programProof.getByText("机械工程学院 | 080200机械工程 | 全日制学术学位。", {
      exact: true,
    }),
  ).toBeVisible();
  const academicGaps = academic.getByRole("region", {
    name: "该专业待补资料",
    exact: true,
  });
  await expect(
    academicGaps.getByText(
      "下一步：继续读取机械工程学院的2026年收费附件，并核对学习形式与计费单位。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    academicGaps.getByText("目标年度核对", { exact: true }),
  ).toBeVisible();
  await academicGaps.getByText("查看读取失败记录", { exact: true }).click();
  await expect(
    academicGaps.getByText("读取未成功：官网收费附件读取超时。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    academicGaps.getByRole("link", { name: "查看已尝试的网址", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://grad.example.edu.cn/mechanical-fees-2026.pdf",
  );
  await expect(academic.getByText(/36000/)).toHaveCount(0);
  const professional = school.getByRole("region", {
    name: "机械 · 085500 · 先进制造学院资料核验",
    exact: true,
  });
  await professional
    .getByText("机械 · 085500 · 先进制造学院", { exact: true })
    .click();
  await expect(
    professional.getByRole("term").filter({ hasText: "培养城市与校区" }),
  ).toContainText("目标年度已有原文");
  await expect(
    professional.getByRole("term").filter({ hasText: "报考资格" }),
  ).toContainText("原文不适用本项目");
  const feeProof = professional
    .getByRole("definition")
    .filter({ hasText: "仅该非全日制机械专业有2025年学年收费参考。" });
  await feeProof.getByText("查看已取得的原文 · 1 条", { exact: true }).click();
  await expect(
    feeProof.getByText("2025年机械非全日制学费36000元/学年。", { exact: true }),
  ).toBeVisible();
  const hdu = panel.getByRole("region", {
    name: "杭州电子科技大学逐专业资料",
    exact: true,
  });
  await expect(
    hdu.getByText("尚未取得可列出具体专业的目录原文，先补查目录。", {
      exact: true,
    }),
  ).toBeVisible();
  await hdu.getByText("查看读取失败记录", { exact: true }).click();
  await expect(
    hdu.getByText("读取未成功：官网返回403，当前入口无法读取。", {
      exact: true,
    }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await download).path())!, "utf8");
  expect(content).toContain("专业资料覆盖与缺项");
  expect(content).toContain("课程与培养：此项不适用");
  expect(content).toContain("机械工程学院 | 080200机械工程");
  expect(content).toContain("官网收费附件读取超时");
  expect(content).toContain("官网返回403");
  expect(content).toContain("目标年度核对");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(overview).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await overview.screenshot({
    path: "test-results/research-program-coverage-mobile.png",
  });
});

test("继续补查复用已有报告，重复点击和刷新不创建第二个任务，新增原文只解决对应专业缺项", async ({
  page,
}) => {
  const { service, panel } = await openProgrammeCoverage(page);
  await panel
    .getByRole("button", { name: "继续补查缺少的资料", exact: true })
    .dblclick();
  await expect(
    panel.getByText("正在补查缺少的资料，已有报告可继续查看。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "正在补查资料…", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "补查进行中…", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("heading", { name: "浏览器测试大学", exact: true }),
  ).toBeVisible();
  expect(service.supplementCount()).toBe(1);
  await panel.getByText("补查过程与服务信息", { exact: true }).click();
  await expect(
    panel.getByText("已接收补查请求，继续核验缺少的原文", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    panel.getByText("正在补查缺少的资料，已有报告可继续查看。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "专业资料覆盖与缺项", exact: true }),
  ).toBeVisible();
  expect(service.supplementCount()).toBe(1);
  service.finish("completed", withSupplementedTuition);
  await expect(
    panel.getByText("已补入机械工程2026年学费原文，其他资料缺项仍逐项保留。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "继续补查缺少的资料", exact: true }),
  ).toBeEnabled();
  const academic = panel.getByRole("region", {
    name: "机械工程 · 080200 · 机械工程学院资料核验",
    exact: true,
  });
  await academic
    .getByText("机械工程 · 080200 · 机械工程学院", { exact: true })
    .click();
  await expect(
    academic.getByRole("term").filter({ hasText: "学费" }),
  ).toContainText("已有历史参考原文");
  await expect(
    academic.getByText("已补得机械工程全日制的2026年学年收费参考原文。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    academic.getByText(/尚缺机械工程学院对应的培养校区地址/).first(),
  ).toBeVisible();
  await expect(
    academic.getByText(/下一步：继续读取机械工程学院的2026年收费附件/),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const content = await readFile((await (await download).path())!, "utf8");
  expect(content).toContain("本轮新增资料 1 条");
  expect(content).toContain("2026年机械工程全日制学费8000元/学年");
  expect(content).toContain("2025年机械非全日制学费36000元/学年");
  expect(service.postCount()).toBe(1);
  expect(service.supplementCount()).toBe(1);
});

test("补查请求错误及后台失败均保留已有报告与逐专业缺项，允许重试补查", async ({
  page,
}) => {
  const { service, panel } = await openProgrammeCoverage(page);
  service.failNextSupplement();
  await panel
    .getByRole("button", { name: "继续补查缺少的资料", exact: true })
    .click();
  await expect(
    panel
      .getByRole("alert")
      .getByText("补查服务暂不可用，已取得的报告仍保留。", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "浏览器测试大学", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "专业资料覆盖与缺项", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "继续补查缺少的资料", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "继续补查缺少的资料", exact: true })
    .click();
  await expect(
    panel.getByText("正在补查缺少的资料，已有报告可继续查看。", {
      exact: true,
    }),
  ).toBeVisible();
  service.failSupplementJobWithoutReport();
  await expect(
    panel.getByRole("region", { name: "补查未完成", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("本次补查未完成，已有报告已保留", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "浏览器测试大学", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "专业资料覆盖与缺项", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "下载研究报告", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "继续补查缺少的资料", exact: true }),
  ).toBeEnabled();
  expect(service.supplementCount()).toBe(2);
  expect(service.postCount()).toBe(1);
});

for (const width of [1280, 375]) {
  test(`阶段6：${width}px 覆盖统计、四字段三态、来源标记及原文折叠均可核对`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const service = await researchService(page);
    service.setRun(await openGuidance(page));
    const panel = page.getByRole("region", {
      name: "联网研究报告",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    await expect(
      panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
    ).toBeVisible();
    service.finish("partial", withPhase6Display);
    const coverage = panel.getByRole("region", {
      name: "专业资料覆盖与缺项",
      exact: true,
    });
    await expect(
      coverage.getByText(
        "资料库已收录 12 校 34 专业、本次复用 2 条、新读 3 条",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      coverage.getByText("本次失败读取 2 次（失败不计入新读）。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      coverage.getByText(/调查记录包含 2 所学校、2 个候选专业/),
    ).toBeVisible();
    await expect(coverage).not.toContainText("全国覆盖");
    await coverage.getByText("查看读取失败原因分布", { exact: true }).click();
    await expect(
      coverage.getByText("网页不存在（404）。 · 1 次", { exact: true }),
    ).toBeVisible();
    await expect(
      coverage.getByText("网页 TLS 证书校验失败，已拒绝读取。 · 1 次", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(coverage).not.toContainText("HTTP_404");
    const bound = panel.getByRole("article", {
      name: "已绑定测试大学 · 法学（民商法方向）",
      exact: true,
    });
    const pending = panel.getByRole("article", {
      name: "待确认测试大学 · 法学（民商法方向）",
      exact: true,
    });
    const missing = panel.getByRole("article", {
      name: "未找到测试大学 · 法学（民商法方向）",
      exact: true,
    });
    for (const label of ["初试科目", "学费", "培养校区/城市", "资料年度"]) {
      await expect(
        bound
          .getByRole("region", { name: label + "资料状态", exact: true })
          .getByRole("heading")
          .first(),
      ).toContainText("已绑定");
      await expect(
        pending
          .getByRole("region", { name: label + "资料状态", exact: true })
          .getByRole("heading")
          .first(),
      ).toContainText("待确认");
      await expect(
        missing
          .getByRole("region", { name: label + "资料状态", exact: true })
          .getByRole("heading")
          .first(),
      ).toContainText("未找到");
    }
    await expect(
      bound.getByText(/按学位类型的全校标准（学术学位）/),
    ).toBeVisible();
    await expect(
      bound.getByText("城市已核验，具体校区待确认", { exact: true }),
    ).toBeVisible();
    await expect(
      bound.getByText(/历史参考，目标年度待核验/).first(),
    ).toBeVisible();
    const boundFee = bound.getByRole("region", {
      name: "学费资料状态",
      exact: true,
    });
    await expect(boundFee.getByText(/2027 年学费连续原文/)).toBeHidden();
    const fee = pending.getByRole("region", {
      name: "学费资料状态",
      exact: true,
    });
    await expect(fee.locator(".research-pending-passage:visible")).toHaveCount(
      2,
    );
    await expect(
      fee.locator(".research-pending-passage:visible").first(),
    ).toContainText("2027 年学费连续原文");
    await expect(
      fee.locator(".research-pending-passage:visible").nth(1),
    ).toContainText("2028 年学费连续原文");
    await expect(
      fee
        .getByText("归属待确认：同名项目有不同学院或学习方式。", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    const more = fee.getByText("查看更多待确认原文（2 条）", { exact: true });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(fee.locator(".research-pending-passage:visible")).toHaveCount(
      4,
    );
    await page.keyboard.press("Space");
    await expect(fee.locator(".research-pending-passage:visible")).toHaveCount(
      2,
    );
    const links = boundFee.getByRole("list", { name: "学费依据来源" });
    await expect(links.getByRole("link")).toHaveAttribute("target", "_blank");
    await expect(links.getByRole("link")).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    await expect(links.getByText("明文传输", { exact: true })).toHaveAttribute(
      "title",
      /内容可能被网络中间环节篡改/,
    );
    await expect(links.getByText(/资料库复用 · 原获取时间/)).toBeVisible();
    await expect(links.locator("time")).toHaveAttribute(
      "datetime",
      "2026-09-01T01:02:03.000Z",
    );
    await expect(
      pending.getByText("研招网平台", { exact: true }),
    ).toBeVisible();
    const raw = panel.getByRole("region", {
      name: "待确认测试大学已读未结构化原文",
      exact: true,
    });
    const rawSummary = raw.getByText("已读但未结构化的原文 · 1 条", {
      exact: true,
    });
    await expect(raw.getByText(/未结构化页面首段/)).toBeHidden();
    await rawSummary.focus();
    await page.keyboard.press("Enter");
    await expect(raw.getByText(/未结构化页面首段/)).toBeVisible();
    expect(
      (await raw.locator("blockquote").first().textContent())!.length,
    ).toBe(600);
    await expect(raw.getByText(/获取时间：/)).toBeVisible();
    await raw
      .getByText("展开更多原文（最多 6000 字）", { exact: true })
      .click();
    expect(
      (await raw.locator("blockquote").allTextContents()).join("").length,
    ).toBe(6000);
    await expect(raw.getByText(/已达到展示上限/)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect(boundFee.locator(".research-field-status")).toHaveCSS(
      "font-size",
      "14px",
    );
    await expect(raw.locator("blockquote").first()).toHaveCSS(
      "font-size",
      "16px",
    );
    await rawSummary.click();
    await expect(raw.getByText(/未结构化页面首段/)).toBeHidden();
    await expect(
      panel.getByRole("button", { name: "继续补查缺少的资料", exact: true }),
    ).toBeEnabled();
    await panel.getByText("技术信息", { exact: true }).click();
    await expect(
      panel.getByText("HTTP_404：1 次", { exact: true }),
    ).toBeVisible();
  });
}

for (const reportVersion of [
  "profile-research-v3",
  "profile-research-v4",
  "profile-research-v5",
  "profile-research-v6",
  "profile-research-v7",
] as const) {
  test(`阶段6：${reportVersion} 缺少覆盖统计时如实显示未记录`, async ({
    page,
  }) => {
    const service = await researchService(page);
    service.setRun(await openGuidance(page));
    const panel = page.getByRole("region", {
      name: "联网研究报告",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    await expect(
      panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
    ).toBeVisible();
    service.finish("completed", (report) => ({ ...report, reportVersion }));
    const coverage = panel.getByRole("region", {
      name: "专业资料覆盖与缺项",
      exact: true,
    });
    await expect(
      coverage.getByText("该报告生成时未记录资料覆盖统计", { exact: true }),
    ).toBeVisible();
    await expect(coverage).not.toContainText("资料库已收录 0");
    await expect(
      panel.getByRole("heading", { name: "浏览器测试大学", exact: true }),
    ).toBeVisible();
  });
}

for (const width of [1280, 375]) {
  test(`任务一：${width}px 连续进度、跨栏目锁定、刷新恢复与完成通知`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const service = await researchService(page);
    service.setRun(await openGuidance(page));
    const panel = page.getByRole("region", {
      name: "联网研究报告",
      exact: true,
    });
    const progress = panel.getByRole("progressbar");
    await panel
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    service.stage("researching");
    await expect(progress).toHaveAttribute("aria-valuetext", /读取官网/);
    await expect
      .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
      .toBeGreaterThan(1);
    const samples = await progress.evaluate(async (element) => {
      const result: { value: number; left: number; time: number }[] = [];
      for (let i = 0; i < 24; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        result.push({
          value: Number(element.getAttribute("aria-valuenow")),
          left: element
            .querySelector(".research-walker")!
            .getBoundingClientRect().left,
          time: performance.now(),
        });
      }
      return result;
    });
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].value).toBeGreaterThanOrEqual(samples[i - 1].value);
      expect(samples[i].value).toBeLessThanOrEqual(60);
      expect(samples[i].value - samples[i - 1].value).toBeLessThan(1);
      expect(samples[i].left).toBeGreaterThanOrEqual(samples[i - 1].left);
    }
    expect(samples.at(-1)!.value).toBeGreaterThan(samples[0].value);
    await expect
      .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
      .toBeGreaterThanOrEqual(30);
    await page.getByRole("main").focus();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `var/task1-${width}.png`, fullPage: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const position = Number(await progress.getAttribute("aria-valuenow"));
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "个人画像", exact: true })
      .click();
    await expect(page.getByLabel("本科专业", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "保存个人画像", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("报告生成中，完成、失败或取消后可修改。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "查看报告", exact: true }).click();
    await expect(progress).toBeVisible();
    expect(
      Number(await progress.getAttribute("aria-valuenow")),
    ).toBeGreaterThanOrEqual(position);
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "个人画像", exact: true })
      .click();
    await page.reload();
    await expect(page.getByLabel("本科专业", { exact: true })).toBeDisabled();
    await expect(
      page.getByText("报告生成中，完成、失败或取消后可修改。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "查看报告", exact: true }).click();
    await expect(progress).toHaveAttribute("aria-valuetext", /读取官网/);
    expect(
      Number(await progress.getAttribute("aria-valuenow")),
    ).toBeGreaterThanOrEqual(30);
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "基础测评", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "查看专业推荐结论", exact: true }),
    ).toBeEnabled();
    service.finish("completed");
    await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
      "部分可用",
    );
    const polls = service.pollCount();
    await page.getByRole("button", { name: "查看报告", exact: true }).click();
    await expect(
      panel.getByRole("heading", { name: "浏览器测试大学", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "个人画像", exact: true })
      .click();
    await expect(page.getByLabel("本科专业", { exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "保存个人画像", exact: true }),
    ).toBeEnabled();
    // Advance a controlled browser clock to prove that terminal tasks do not poll.
    await page.clock.install();
    await page.clock.runFor(3500);
    expect(service.pollCount()).toBe(polls);
    expect(service.postCount()).toBe(1);
  });
}

test("任务一：失败停止、导航跳回续跑及取消恢复", async ({ page }) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  service.stage("analyzing");
  await expect(panel.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    /分析匹配/,
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "个人画像", exact: true })
    .click();
  service.stop("analyzing", "MODEL_TIMEOUT", false);
  await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
    "未完成",
  );
  await expect(page.getByLabel("本科专业", { exact: true })).toBeEnabled();
  await page.getByLabel("报告状态", { exact: true }).click();
  const progress = panel.getByRole("progressbar");
  await expect(
    panel.getByRole("region", { name: "报告生成失败", exact: true }),
  ).toContainText("本次研究未能完成");
  const stopped = await progress.getAttribute("aria-valuenow");
  await page.clock.install();
  await page.clock.runFor(2000);
  await expect(progress).toHaveAttribute("aria-valuenow", stopped!);
  await expect(panel.locator(".is-walking")).toHaveCount(0);
  await page.clock.resume();
  await panel
    .getByRole("button", { name: "一键重试（复用已完成阶段）", exact: true })
    .click();
  await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
    "生成中",
  );
  service.cancel();
  await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
    "未完成",
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "个人画像", exact: true })
    .click();
  await expect(page.getByLabel("本科专业", { exact: true })).toBeEnabled();
});

test("任务一：减少动画模式使用静态阶段位置", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  service.stage("researching");
  await expect(panel.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "30",
  );
  await expect(panel.locator(".shinchan-leg").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.clock.install();
  await page.clock.runFor(10000);
  await expect(panel.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "30",
  );
  service.stage("analyzing");
  await page.clock.resume();
  await expect(panel.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "60",
  );
});

test("任务一：浏览器直接修改和另一标签页保存均被真实后端拒绝，测评仍可作答", async ({
  browser,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  const origins: string[] = [];
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {
      release();
    },
    async generate(input) {
      await input.onProgress?.("analyzing");
      await pending;
      return reportFor(input.run, "completed");
    },
  };
  const app = await createApplication(
    {
      databasePath: ":memory:",
      sampleData: true,
      staticDirectory: resolve("dist"),
      origins,
      bootstrapAdmins: [],
      admins: [],
      secureCookies: false,
    },
    { research: engine },
  );
  await new Promise<void>((done) => app.server.listen(0, "127.0.0.1", done));
  const address = app.server.address();
  if (!address || typeof address !== "object")
    throw new Error("Missing test listener");
  const baseURL = `http://127.0.0.1:${address.port}`;
  origins.push(baseURL);
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    await openGuidance(page);
    const staleTab = await context.newPage();
    await staleTab.goto("/#profile");
    await staleTab.getByLabel("本科专业", { exact: true }).fill("经济学");
    await page
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
      "生成中",
    );
    const rejected = staleTab.waitForResponse(
      (response) =>
        response.url().endsWith("/me/profile") &&
        response.request().method() === "PUT",
    );
    await staleTab
      .getByRole("button", { name: "保存个人画像", exact: true })
      .click();
    const response = await rejected;
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("research_inputs_locked");
    await expect(staleTab.getByRole("alert")).toContainText(
      "报告生成中，完成、失败或取消后可修改。",
    );
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "个人画像", exact: true })
      .click();
    await expect(page.getByLabel("本科专业", { exact: true })).toHaveValue(
      "经济学",
    );
    // The other tab's account-scoped draft survives; it has not changed the locked server snapshot.
    expect(
      (await (await page.request.get(baseURL + "/api/v1/me/profile")).json())
        .profile.major,
    ).toBe("法学");
    await expect(page.getByLabel("本科专业", { exact: true })).toBeDisabled();
    const attempts = await page.request.get(
      baseURL + "/api/v1/assessment-attempts",
    );
    expect(attempts.status()).toBe(200);
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "基础测评", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "查看专业推荐结论", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: /开始公共课测评/ }).click();
    await expect(page.getByRole("radio").first()).toBeEnabled();
    const answerSaved = page.waitForResponse(
      (response) =>
        /assessment-attempts/.test(response.url()) &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("radio").first().check();
    expect((await answerSaved).ok()).toBe(true);
    await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
      "生成中",
    );
    release();
    await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
      "部分可用",
    );
    await page.getByRole("button", { name: "查看报告", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "浏览器测试大学", exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await context.close();
    await app.close();
  }
});

test("任务一：切换栏目和手动刷新始终只有一个活动轮询，短暂网络失败后恢复", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  await page
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  await expect(page.getByLabel("报告状态", { exact: true })).toHaveText(
    "生成中",
  );
  await page.clock.install();
  for (const name of ["个人画像", "推荐结论", "基础测评", "推荐结论"]) {
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  const before = service.pollCount();
  await page.clock.runFor(3200);
  expect(service.pollCount() - before).toBeGreaterThanOrEqual(2);
  expect(service.pollCount() - before).toBeLessThanOrEqual(4);
  let fail = true;
  await page.route("**/api/v1/research-jobs/*", async (route) => {
    if (fail) {
      await route.abort();
    } else await route.fallback();
  });
  await page.clock.runFor(1500);
  await expect(
    page
      .getByRole("region", { name: "联网研究报告", exact: true })
      .getByRole("alert"),
  ).toContainText("暂时无法连接服务");
  fail = false;
  service.stage("analyzing");
  await page.clock.runFor(2000);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    /分析匹配/,
  );
  await expect(
    page
      .getByRole("region", { name: "联网研究报告", exact: true })
      .getByRole("alert"),
  ).toHaveCount(0);
});

test("任务一：创建请求尚未返回时切换栏目仍保留状态且不会重复创建", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route(/\/api\/v1\/guidance\/[^/]+\/research$/, async (route) => {
    if (route.request().method() === "POST") await pending;
    await route.fallback();
  });
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  try {
    await panel
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "正在创建报告任务…", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "个人画像", exact: true })
      .click();
    await expect(page.getByLabel("本科专业", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "查看报告", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "正在创建报告任务…", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      panel.getByRole("button", { name: "报告生成中…", exact: true }),
    ).toBeDisabled();
    await expect(panel.getByRole("progressbar")).toBeVisible();
    expect(service.postCount()).toBe(1);
  } finally {
    release();
  }
});
for (const width of [1280, 375]) {
  test(`two-stage screening reasons expand, collapse and fit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const service = await researchService(page);
    service.setRun(await openGuidance(page));
    const panel = page.getByRole("region", {
      name: "联网研究报告",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    await expect(
      panel.getByText("已接收请求，即将开始整理依据", { exact: true }),
    ).toBeVisible();
    const prefilter = prefilterResearchSchools(
      {
        cities: ["杭州", "上海"],
        university: "本科大学",
        year: 2027,
        disciplineCodes: ["0802"],
      },
      Array.from({ length: 32 }, (_, index) => ({
        key: String(index).padStart(3, "0"),
        name: `筛选学校${index}`,
        domain: `s${index}.edu.cn`,
        city: index < 16 ? "杭州" : "上海",
        tags: [],
        programs: [],
      })),
    );
    service.finish("partial", (report) => ({ ...report, prefilter }));
    const heading = panel.getByText("筛选依据：从 32 所中选出 20 所精查", {
      exact: true,
    });
    await expect(heading).toBeVisible();
    const explanation = panel.getByText(
      "以下分数只决定调查顺序，不是录取概率。缺少证据的维度记 0。",
      { exact: true },
    );
    await expect(explanation).toBeHidden();
    await heading.click();
    await expect(explanation).toBeVisible();
    await expect(
      panel.getByText("城市名额上限", { exact: true }),
    ).toBeVisible();
    await panel.getByText("筛选学校0的分项分与依据", { exact: true }).click();
    await expect(
      panel
        .getByText(
          "没有适用本科优势政策证据，记0；同校、同省或同系统不自动加分。",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await heading.focus();
    await page.keyboard.press("Enter");
    await expect(explanation).toBeHidden();
  });
}

for (const width of [1280, 375]) {
  test(`T3-10 progress labels never intersect at ${width}px including reduced motion`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    const service = await researchService(page);
    service.setRun(await openGuidance(page));
    await page
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    const labels = page.locator(".research-road-sign");
    await expect(labels).toHaveCount(4);
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      const boxes = await labels.evaluateAll((elements) =>
        elements.map((element) => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
      );
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          expect(
            a.right <= b.left ||
              b.right <= a.left ||
              a.bottom <= b.top ||
              b.bottom <= a.top,
          ).toBe(true);
        }
    }
  });
}

test("T3-11 partial report retry is reachable above school cards and shares the request lock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  await page
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  service.finish("partial", (report) => ({
    ...report,
    reason: "MODEL_TIMEOUT",
    failureStage: "analyzing",
  }));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  const retry = panel.getByRole("button", {
    name: "立即重试未完成阶段",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  const bottom = panel.getByRole("button", {
    name: "一键重试（复用已完成阶段）",
    exact: true,
  });
  const card = panel.locator(".research-school").first();
  expect((await retry.boundingBox())!.y).toBeLessThan(
    (await card.boundingBox())!.y,
  );
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(/\/research\/retry$/, async (route) => {
    posts++;
    await gate;
    await route.fallback();
  });
  try {
    await retry.click();
    await expect(bottom).toBeDisabled();
    await expect(retry).toBeDisabled();
    expect(posts).toBe(1);
  } finally {
    release();
  }
});

test("T3-12 new report entrance targets 10 while historical snapshots keep 5–10", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  const panel = page.getByRole("region", { name: "联网研究报告", exact: true });
  await expect(panel).toContainText("目标比较 10 所不同学校");
  await panel
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  service.finish("partial", (report) => ({
    ...report,
    coverage: {
      targetMin: 5,
      targetMax: 10,
      schoolCount: 1,
      preferredCount: 1,
      alternativeCount: 0,
      shortfallReasons: ["旧版目标"],
    },
  }));
  await expect(panel).toContainText("目标比较 5–10 所");
});

test("T3-13 global status matches partial and stale report availability", async ({
  page,
}) => {
  const service = await researchService(page);
  service.setRun(await openGuidance(page));
  await page
    .getByRole("button", { name: "联网调研并生成报告", exact: true })
    .click();
  service.finish("partial");
  const badge = page.getByLabel("报告状态", { exact: true });
  await expect(badge).toHaveText("部分可用");
  await expect(page.locator(".research-global-notice")).toContainText(
    "部分可用",
  );
  service.stale();
  await page.getByRole("button", { name: "重新检查服务", exact: true }).click();
  await expect(badge).toHaveText("需更新");
  await expect(page.locator(".research-global-notice")).toContainText("需更新");
  await expect(page.getByLabel("报告可用性", { exact: true })).toContainText(
    "需更新",
  );
  service.stale(false);
  await page.getByRole("button", { name: "重新检查服务", exact: true }).click();
  await expect(badge).toHaveText("部分可用");
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "个人画像", exact: true })
    .click();
  await page.getByLabel("本科专业", { exact: true }).fill("经济学");
  await page.getByRole("button", { name: "保存个人画像", exact: true }).click();
  await expect(page).toHaveURL(/#assessment$/);
  await expect(badge).toHaveText("需更新");
  await expect(page.locator(".research-global-notice")).toContainText("需更新");
});
