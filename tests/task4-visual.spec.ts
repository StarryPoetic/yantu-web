import { expect, test, type Browser } from "@playwright/test";
import { resolve } from "node:path";
import { createApplication } from "../server/app";
import type {
  ResearchReportModule,
  ResearchReport,
} from "../server/explanation/research";
import { prefilterResearchSchools } from "../server/explanation/research-prefilter";
import { registerAccount } from "./helpers/account";
import { withPhase6Display } from "./helpers/research-phase6-fixture";
import { auditVisuals } from "./helpers/visual-audit";

async function visualFixture(browser: Browser, width: number) {
  let finish: (failed: boolean) => void = () => {};
  const model = {
    name: "deepseek-v4-pro",
    thinking: true,
    effort: "high",
  } as const;
  const research: ResearchReportModule = {
    getReadiness: () => ({ ready: true, reasons: [], model }),
    clearSubject() {},
    async generate(input) {
      const pending = new Promise<boolean>((done) => {
        finish = done;
      });
      await input.onProgress?.("researching", "正在读取离线示例资料");
      const failed = await pending;
      const base: ResearchReport = {
        schemaVersion: 1,
        reportVersion: "profile-research-v7",
        status: "partial",
        generatedAt: "2026-10-11T00:00:00Z",
        guidanceRunId: input.run.guidanceRunId,
        versions: input.run.versions,
        summary: "界面验证示例；招生条件待核验。",
        facts: [],
        recommendations: [
          {
            institutionName: "视觉测试大学",
            disciplineCode: "0301",
            programName: "法学",
            rationale: "与你保存的法学兴趣相关，招生条件待核验。",
            preparation: ["核对专业目录与本科课程"],
            uncertainties: ["招生资格待核验"],
            citations: ["research-1"],
          },
        ],
        sources: [
          {
            id: "research-1",
            title: "离线测试资料",
            url: "https://yz.chsi.com.cn/",
            excerpt: "仅供离线界面测试",
            retrievedAt: "2026-10-11T00:00:00Z",
            kind: "official_page",
            verified: false,
          },
        ],
        limitations: ["示例资料，不承诺录取结果。"],
        model,
        searched: true,
      };
      const report = withPhase6Display(base);
      report.prefilter = prefilterResearchSchools(
        {
          cities: ["杭州"],
          university: "测试大学",
          year: 2027,
          disciplineCodes: ["0301"],
        },
        Array.from({ length: 12 }, (_, i) => ({
          key: String(i),
          name: `筛选学校${i}`,
          domain: `s${i}.edu.cn`,
          city: "杭州",
          tags: [],
          programs: [],
        })),
      );
      if (failed) {
        report.failureStage = "analyzing";
        report.reason = "MODEL_TIMEOUT";
      }
      return report;
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
    { research },
  );
  await new Promise<void>((done) => app.server.listen(0, "127.0.0.1", done));
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  const baseURL = `http://127.0.0.1:${address.port}`;
  origins.push(baseURL);
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: width === 375 ? 812 : 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  return {
    page: await context.newPage(),
    finish: (failed: boolean) => finish(failed),
    close: async () => {
      finish(false);
      await context.close();
      await app.close();
    },
  };
}

for (const width of [375, 1280]) {
  test(`T4 ${width}: all key scenes preserve geometry, targets, contrast and safe actions`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const f = await visualFixture(browser, width);
    const { page } = f;
    const nav = async (name: string) =>
      page
        .getByRole("navigation", { name: "主要导航" })
        .getByRole("button", { name, exact: true })
        .click();
    const audit = async (name: string, selector?: string) => {
      if (selector)
        await page.locator(selector).first().scrollIntoViewIfNeeded();
      await auditVisuals(page, name);
    };
    try {
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "欢迎回到研途" }),
      ).toBeVisible();
      await audit("login");
      await registerAccount(page);
      await page.reload();
      await page.getByLabel("本科专业", { exact: true }).fill("法学");
      await audit("profile", ".ws-form-grid");
      await page
        .getByRole("button", { name: "保存个人画像", exact: true })
        .click();
      await page.getByLabel("数学 · 5 题").uncheck();
      await page.getByLabel("政治 · 5 题").uncheck();
      await page.getByRole("button", { name: "开始公共课测评 · 5 题" }).click();
      await expect(
        page.getByRole("heading", { name: "英语 · 第 1 / 5 题" }),
      ).toBeVisible();
      await audit("assessment", ".ws-options");
      for (let i = 1; i <= 5; i++) {
        await page
          .getByRole("button", { name: `第${i}题`, exact: true })
          .click();
        await page.getByRole("radio").first().check();
        await expect(
          page.getByText("草稿已保存", { exact: true }),
        ).toBeVisible();
      }
      await page.getByRole("button", { name: "主动提交测评" }).click();
      await expect(
        page.getByRole("heading", { name: "你的下一步练习方向" }),
      ).toBeVisible();
      await audit("assessment results", ".assessment-result-grid");
      await nav("推荐结论");
      await page
        .getByRole("button", { name: "联网调研并生成报告", exact: true })
        .click();
      await expect(page.getByLabel("报告生成状态")).toContainText(
        "正在读取离线示例资料",
      );
      await audit("research running", ".research-progress");
      await expect(page.locator(".research-global-notice")).toHaveCount(0);
      const signs = await page.locator(".research-road-sign").all();
      const boxes = await Promise.all(signs.map((sign) => sign.boundingBox()));
      expect(boxes.length).toBe(4);
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i]!.x).toBeGreaterThanOrEqual(
          boxes[i - 1]!.x + boxes[i - 1]!.width,
        );
      await expect(page.locator(".shinchan-leg").first()).toHaveCSS(
        "animation-name",
        "none",
      );
      f.finish(true);
      const retry = page.getByRole("button", {
        name: "立即重试未完成阶段",
        exact: true,
      });
      await expect(retry).toBeEnabled();
      await audit("research failed", ".research-panel > .ws-actions");
      expect(
        await retry.evaluate(
          (el) =>
            el.getBoundingClientRect().top <
            document.querySelector(".research-report")!.getBoundingClientRect()
              .top,
        ),
      ).toBe(true);
      await retry.click();
      await expect(page.getByLabel("报告生成状态")).toContainText(
        "正在读取离线示例资料",
      );
      f.finish(false);
      await expect(retry).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "重新调研并生成报告", exact: true }),
      ).toBeEnabled();
      await audit("research complete", ".research-availability");
      await audit("coverage", ".research-evidence-coverage");
      await page.locator(".research-prefilter > summary").click();
      await page.locator(".research-prefilter li summary").first().click();
      await audit("filter basis", ".research-prefilter li");
      await page.locator(".research-school-details > summary").first().click();
      await audit("school detail", ".research-school");
      await page
        .getByRole("button", { name: "收藏研究关注项", exact: true })
        .first()
        .click();
      await expect(
        page
          .getByRole("button", { name: "取消收藏研究关注项", exact: true })
          .first(),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "加入目标与规划", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("button", { name: "已加入待核验准备计划" }).first(),
      ).toBeDisabled();
      await nav("专业与院校");
      await expect(
        page.getByLabel("显示未核验的交互示例项目（仅体验流程）"),
      ).toBeVisible();
      await audit("catalog", ".ws-discipline-filters");
      await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
      await audit("catalog example", ".ws-school");
      await nav("我的收藏");
      await expect(
        page.getByRole("region", { name: "研究关注项", exact: true }),
      ).toContainText("已绑定测试大学");
      await audit("favorites", '[aria-label="研究关注项"]');
      await nav("目标与规划");
      await expect(
        page.getByRole("region", { name: "研究关注目标与准备计划" }),
      ).toBeVisible();
      await audit("plan", '[aria-label="研究关注目标与准备计划"]');
      await page
        .getByRole("button", { name: "打开咨询助手", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "清空当前对话", exact: true }),
      ).toBeEnabled();
      await audit("assistant");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "打开咨询助手", exact: true }),
      ).toBeFocused();
      await nav("个人画像");
      for (const fraction of [0, 0.5, 1]) {
        await page.evaluate((fraction) => {
          const w = document.querySelector(".workspace")!;
          w.scrollTop = w.scrollHeight * fraction;
          window.scrollTo(0, document.body.scrollHeight * fraction);
        }, fraction);
        await audit(`profile scroll ${fraction}`);
      }
    } finally {
      await f.close();
    }
  });
}

test("T4 mobile pickers and field boundaries retain usable touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAccount(page);
  await page.goto("/#profile");
  await page.getByLabel("感兴趣的专业或领域（选填）").fill("法学");
  await expect(
    page.getByRole("listbox", { name: "专业兴趣建议" }),
  ).toBeVisible();
  await auditVisuals(page, "interest picker");
  await page.getByRole("option", { name: "法学", exact: true }).click();
  const input = page.getByLabel("本科院校", { exact: true });
  await input.fill("校".repeat(200));
  await input.focus();
  await expect(input).toHaveCSS("outline-style", "solid");
  await auditVisuals(page, "long profile field");
  await page.getByRole("button", { name: "展开全国城市", exact: true }).click();
  const cities = page.getByRole("listbox", { name: "全国城市", exact: true });
  await expect(cities).toBeVisible();
  await auditVisuals(page, "city picker");
  await page
    .getByRole("combobox", { name: "搜索意向城市", exact: true })
    .fill("杭州");
  await cities
    .getByRole("option", { name: "杭州，浙江省", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "搜索意向城市", exact: true })
    .press("Escape");
  await expect(
    page.getByRole("button", { name: "移除意向城市杭州", exact: true }),
  ).toBeVisible();
  await auditVisuals(page, "selected city");
});
