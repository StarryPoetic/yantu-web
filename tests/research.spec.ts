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
    reportVersion: "profile-research-v6",
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
    latestCount = 0;
  const jobId = "browser-research-" + randomUUID();
  await page.route("**/api/v1/research/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ready: true, reasons: [], model }),
    }),
  );
  await page.route(
    /\/api\/v1\/guidance\/[^/]+\/research(?:\/latest)?$/,
    async (route) => {
      if (route.request().method() === "POST") {
        expect(run).not.toBeNull();
        expect(route.request().postDataJSON()).toEqual({});
        expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        postCount++;
        current = {
          jobId,
          guidanceRunId: run!.guidanceRunId,
          status: "queued",
          stage: "queued",
          progress: 0,
          message: "已接收请求，即将开始整理依据",
          createdAt: retrievedAt,
          updatedAt: retrievedAt,
          events: [],
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
  await page.route("**/api/v1/research-jobs/*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(current),
    }),
  );
  return {
    setRun(value: GuidanceRun) {
      run = value;
    },
    postCount: () => postCount,
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
      const report = reportFor(run, status);
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
    panel.getByRole("button", { name: "重新调研并生成报告", exact: true }),
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
    await expect(
      panel.getByRole("progressbar", { name: "报告阶段进度" }),
    ).toHaveAttribute("value", String(stages[stage].progress));
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
        await expect(panel.getByRole("progressbar")).toHaveAttribute(
          "value",
          "30",
        );
      }
    }
  }
  await page.reload();
  await expect(
    panel.getByRole("progressbar", { name: "报告阶段进度" }),
  ).toHaveAttribute("value", "60");
  expect(service.postCount()).toBe(1);
  expect(service.latestCount()).toBeGreaterThanOrEqual(2);
  service.stage("writing");
  await expect(panel.getByRole("progressbar")).toHaveAttribute("value", "90");
  service.finish("completed");
  await expect(panel.getByText("研究报告", { exact: true })).toBeVisible();
  await expect(panel.locator("progress")).toHaveAttribute("value", "100");
  await expect(panel.getByRole("progressbar")).toHaveCount(0);
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
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "下载研究报告", exact: true })
    .click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe("研途-联网研究报告.txt");
  const path = await downloaded.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, "utf8");
  expect(content).toContain(sourceText);
  expect(content).toContain("[research-1]");
  expect(content).toContain(sourceUrl);
  expect(content).toContain(retrievedAt);
  expect(content).toContain("浏览器测试大学");
  expect(content).toContain("法学（民商法方向）");
  expect(content).toContain("本科已有法学基础");
  expect(content).toContain("需要兼顾专业课复习与案例分析训练。");
  expect(service.postCount()).toBe(1);
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
  await expect(panel.getByText("部分研究报告", { exact: true })).toBeVisible();
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
      `${Number(run.inputSnapshot.profile.year) - 2} 年参考学费：40,000 元/全程（非全日制）`,
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
  await expect(panel.getByText(/优先推荐不代表录取率或录取保证/)).toBeVisible();
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
  expect(content).toContain("优先推荐不代表录取率或录取保证");
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
    panel.getByRole("button", { name: "重新调研并生成报告", exact: true }),
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
  await expect(panel.getByText("部分研究报告", { exact: true })).toHaveCount(0);
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
    .getByRole("button", { name: "重新调研并生成报告", exact: true })
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
      "中的模型错误仍显示失败，不误称部分研究报告或缺画像：" +
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
        panel.getByText("部分研究报告", { exact: true }),
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
    panel.getByRole("button", { name: "重新调研并生成报告", exact: true }),
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
