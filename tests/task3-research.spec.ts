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
}) => {
  const f = await fixture(browser);
  const { page, navigate } = f;
  try {
    const catalogue = await (
      await page.request.get("/api/v1/programs?limit=100")
    ).json();
    const card = page.getByRole("article", {
      name: "流程测试大学 · 法学",
      exact: true,
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

test("T3-02 old reports remain viewable and downloadable after a new input version, with no generation or retrieval requests", async ({
  browser,
}) => {
  const f = await fixture(browser);
  const { page, navigate } = f;
  try {
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
    await expect(history).toContainText("需更新，与当前输入不同");
    await expect(
      page.getByRole("button", { name: "联网调研并生成报告", exact: true }),
    ).toBeEnabled();
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") mutations.push(request.url());
    });
    await history.getByRole("button", { name: "只读查看历史报告" }).click();
    const content = page.getByRole("region", { name: "历史报告只读内容" });
    await expect(content).toContainText("画像版本 1");
    await expect(content).toContainText("流程测试大学");
    await expect(
      content.getByRole("button", { name: /收藏|加入|生成|重试/ }),
    ).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await content.getByRole("button", { name: "下载历史研究报告" }).click();
    expect((await downloading).suggestedFilename()).toMatch(/\.md$/);
    expect(mutations).toEqual([]);
    expect(f.calls()).toBe(1);
    await page.reload();
    await expect(
      history.getByRole("button", { name: "只读查看历史报告" }),
    ).toBeVisible();
    expect(f.calls()).toBe(1);
  } finally {
    await f.close();
  }
});
