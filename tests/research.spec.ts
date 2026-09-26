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

async function openGuidance(page: Page): Promise<GuidanceRun> {
  await registerAccount(page);
  await page.goto("/");
  await page.getByLabel("本科专业", { exact: true }).fill("法学");
  await page.getByLabel("感兴趣的专业或领域（选填）").fill("法学");
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
    page.getByRole("heading", { name: "当前结论", exact: true }),
  ).toBeVisible();
  return run;
}

function reportFor(
  run: GuidanceRun,
  status: "completed" | "partial",
): ResearchReport {
  return {
    schemaVersion: 1,
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
        rationale: "结合本科基础比较课程安排，报考条件仍需按原文确认。",
        preparation: ["整理本科课程记录，再对照目标课程安排。"],
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
    finish(status: "completed" | "partial") {
      if (!current || !run)
        throw new Error("Start the report before completing it.");
      current = {
        ...current,
        status,
        stage: "done",
        progress: 100,
        message:
          status === "completed"
            ? "报告已生成，请结合引用来源核对报考条件"
            : "已生成部分报告，缺少的依据已在报告中说明",
        report: reportFor(run, status),
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
  await expect(panel.getByText(/下方基础探索建议仍可查看/)).toBeVisible();
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
    page.getByRole("heading", { name: "当前结论", exact: true }),
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
  await expect(
    panel.getByRole("heading", { name: "研究报告", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("progressbar")).toHaveAttribute("value", "100");
  await expect(
    panel.getByRole("heading", { name: "浏览器测试大学 · 法学", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("参考来源：research-1", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("link", {
      name: "[research-1] 研究生招生资料（浏览器测试）",
      exact: true,
    }),
  ).toHaveAttribute("href", sourceUrl);
  await expect(panel.getByText(/官网原文 ·/)).toBeVisible();
  await expect(
    panel.getByText("此测试报告只用于核验界面，不是招生事实。", {
      exact: true,
    }),
  ).toBeVisible();
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
  await expect(
    panel.getByRole("heading", { name: "部分研究报告", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "研究报告", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText(/搜索摘要 ·/)).toBeVisible();
  await expect(
    panel.getByText("本次只取得搜索摘要，仍需读取官网原文。", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("link", {
      name: "[research-1] 研究生招生资料（浏览器测试）",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: "test-results/research-partial-mobile.png" });
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
  await expect(
    panel.getByRole("heading", { name: "研究报告", exact: true }),
  ).toBeVisible();
  expect(service.postCount()).toBe(1);
});
