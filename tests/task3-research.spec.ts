import { expect, test, type Browser } from "@playwright/test";
import { resolve } from "node:path";
import { createApplication } from "../server/app";
import type { ResearchReportModule } from "../server/explanation/research";
import { registerAccount } from "./helpers/account";

async function fixture(browser: Browser) {
  let calls = 0;
  const model = {
    name: "deepseek-v4-pro",
    thinking: true,
    effort: "high",
  } as const;
  const engine: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    async generate(input) {
      calls++;
      return {
        schemaVersion: 1,
        reportVersion: "profile-research-v7",
        status: "partial",
        guidanceRunId: input.run.guidanceRunId,
        versions: input.run.versions,
        generatedAt: "2026-10-11T00:00:00Z",
        summary: "离线研究建议",
        facts: [],
        recommendations: [
          {
            institutionName: "流程测试大学",
            disciplineCode: "0301",
            programName: "法学",
            rationale: "待核验的研究建议",
            preparation: ["整理本科课程记录"],
            uncertainties: ["招生资格待核验"],
            citations: ["s1"],
            referenceBasis: {
              year: 2026,
              reason: "历史资料",
              sourceIds: ["s1"],
            },
          },
        ],
        sources: [
          {
            id: "s1",
            title: "学校2026年资料",
            url: "https://yz.chsi.com.cn/",
            excerpt: "离线模拟原文",
            retrievedAt: "2026-10-11T00:00:00Z",
            kind: "official_page",
            verified: false,
          },
        ],
        limitations: ["测试资料，未经人工审核"],
        model,
        searched: true,
      };
    },
  };
  const origins: string[] = [];
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
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  const baseURL = `http://127.0.0.1:${address.port}`;
  origins.push(baseURL);
  const context = await browser.newContext({ baseURL });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  const navigate = async (name: string) =>
    page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name, exact: true })
      .click();
  try {
    await registerAccount(page);
    await page.goto("/#profile");
    await page.getByLabel("本科专业", { exact: true }).fill("法学");
    await page
      .getByRole("button", { name: "保存个人画像", exact: true })
      .click();
    await navigate("推荐结论");
    await page
      .getByRole("button", { name: "联网调研并生成报告", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "流程测试大学", exact: true }),
    ).toBeVisible();
  } catch (error) {
    await context.close();
    await app.close();
    throw error;
  }
  return {
    page,
    navigate,
    calls: () => calls,
    close: async () => {
      await context.close();
      await app.close();
    },
  };
}

test("T3-01 research suggestion persists through favorites, target preparation and refresh without entering the catalogue", async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser);
  const { page, navigate } = f;
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    const catalogue = await (
      await page.request.get("/api/v1/programs?limit=100")
    ).json();
    const card = page.getByRole("article", {
      name: "流程测试大学 · 法学",
      exact: true,
    });
    const summary = card.locator("summary").first();
    const reasons = card.getByRole("region", {
      name: "个人匹配理由与取舍",
      exact: true,
    });
    await expect(reasons).toBeHidden();
    await summary.focus();
    await summary.press("Enter");
    await expect(reasons).toContainText("待核验的研究建议");
    await expect(reasons).toBeVisible();
    await summary.press("Enter");
    await expect(reasons).toBeHidden();
    await expect(
      card.getByRole("heading", { name: "流程测试大学", exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "收藏研究关注项", exact: true }),
    ).toBeHidden();
    await expect(summary).toContainText("展开匹配理由与学校资料");
    await expect(summary).toBeFocused();
    await summary.press("Space");
    await expect(reasons).toBeVisible();
    const recommendation = page.getByRole("region", {
      name: "学校与专业推荐",
      exact: true,
    });
    const materials = page.getByRole("region", {
      name: "研究资料详情",
      exact: true,
    });
    await expect(
      materials.getByRole("region", {
        name: "专业资料覆盖与缺项",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      recommendation.getByRole("region", {
        name: "专业资料覆盖与缺项",
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await materials.boundingBox())!.y).toBeGreaterThan(
      (await recommendation.boundingBox())!.y,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    await page.screenshot({
      path: testInfo.outputPath("research-school-mobile-expanded.png"),
      fullPage: true,
    });
    await card
      .getByRole("button", { name: "收藏研究关注项", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "取消收藏研究关注项", exact: true }),
    ).toBeEnabled();
    await card
      .getByRole("button", { name: "加入目标与规划", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "已加入待核验准备计划" }),
    ).toBeDisabled();
    await navigate("我的收藏");
    await expect(
      page.getByRole("region", { name: "研究关注项", exact: true }),
    ).toContainText("流程测试大学");
    await navigate("目标与规划");
    const plan = page.getByRole("region", { name: "研究关注目标与准备计划" });
    await expect(plan).toContainText("未经人工审核 · 待核验");
    await expect(plan).toContainText("目标年份 2027 · 参考年份 2026");
    await expect(plan).toContainText("来源报告 jobId");
    await plan.getByRole("checkbox", { name: "整理本科课程记录" }).check();
    await expect(
      plan.getByRole("checkbox", { name: "整理本科课程记录" }),
    ).toBeEnabled();
    await page.reload();
    await expect(
      plan.getByRole("checkbox", { name: "整理本科课程记录" }),
    ).toBeChecked();
    const after = await (
      await page.request.get("/api/v1/programs?limit=100")
    ).json();
    const stable = ({
      generatedAt: _time,
      requestId: _request,
      ...catalogue
    }: Record<string, unknown>) => catalogue;
    expect(stable(after)).toEqual(stable(catalogue));
    expect(f.calls()).toBe(1);
    await navigate("我的收藏");
    await page
      .getByRole("region", { name: "研究关注项", exact: true })
      .getByRole("button", { name: "取消收藏研究关注项", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "研究关注项", exact: true }),
    ).not.toContainText("流程测试大学");
    await navigate("目标与规划");
    await expect(plan).toContainText("流程测试大学");
  } finally {
    await f.close();
  }
});

test("T3-02 research history entry is removed while stored snapshots and unrelated planning reports remain", async ({
  browser,
}) => {
  const f = await fixture(browser);
  const { page, navigate } = f;
  try {
    const originalHistory = await (
      await page.request.get("/api/v1/research/history")
    ).json();
    expect(originalHistory.items).toHaveLength(1);
    const jobId = originalHistory.items[0].jobId;
    const original = await (
      await page.request.get(`/api/v1/research/history/${jobId}`)
    ).json();
    const browserHistoryRequests: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/v1/research/history")
      )
        browserHistoryRequests.push(request.url());
    });
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载研究报告", exact: true })
      .click();
    expect((await downloading).suggestedFilename()).toMatch(/\.md$/);
    await navigate("个人画像");
    await page.getByLabel("本科专业", { exact: true }).fill("经济学");
    await page
      .getByRole("button", { name: "保存个人画像", exact: true })
      .click();
    await navigate("推荐结论");
    const history = page.getByRole("region", {
      name: "研究报告历史",
      exact: true,
    });
    await expect(history).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "联网调研并生成报告", exact: true }),
    ).toBeEnabled();
    await page.reload();
    await expect(history).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "只读查看历史报告" }),
    ).toHaveCount(0);
    expect(browserHistoryRequests).toEqual([]);
    const restored = await (
      await page.request.get(`/api/v1/research/history/${jobId}`)
    ).json();
    expect(restored.job.report).toEqual(original.job.report);
    expect(restored.run).toEqual(original.run);
    expect(restored.job.needsRefresh).toBe(true);
    expect(
      (await (await page.request.get("/api/v1/research/history")).json()).items,
    ).toHaveLength(1);
    await navigate("目标与规划");
    await expect(
      page.getByRole("heading", { name: "固定项目规划报告", exact: true }),
    ).toBeVisible();
    expect(f.calls()).toBe(1);
  } finally {
    await f.close();
  }
});
