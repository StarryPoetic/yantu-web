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
    reportVersion: "profile-research-v3",
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
    stage(stage: ResearchStage) {
      if (!current) throw new Error("Start the report before advancing it.");
      const step = stages[stage];
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
  service.finish("partial");
  await expect(panel.getByText("部分研究报告", { exact: true })).toBeVisible();
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

test("没有学校依据时简洁解释原因，保留完整排查内容并提供补充画像入口", async ({
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
      name: "还没有足够依据给出具体学校",
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
  ).toBeVisible();
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

for (const empty of [false, true]) {
  test(
    "旧版" + (empty ? "空" : "学校") + "报告可回顾并提示手动按完整画像重新生成",
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
        reportVersion: undefined,
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
