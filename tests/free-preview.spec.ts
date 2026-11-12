import { expect, test, type Browser } from "@playwright/test";
import { resolve } from "node:path";
import { createApplication } from "../server/app";
import { loginAccount, registerAccountInUI } from "./helpers/account";

async function preview(browser: Browser, width: number) {
  const origins: string[] = [];
  const app = await createApplication({
    databasePath: ":memory:",
    previewMode: true,
    sampleData: true,
    // Exercise the production build, including its disabled ?demo=1 route.
    staticDirectory: resolve("dist"),
    origins,
    secureCookies: false, // Isolated loopback transport; HTTPS/Secure is covered by API tests.
    admins: [],
    bootstrapAdmins: [
      {
        username: "preview_auditor",
        password: "Synthetic-Preview-Admin-2026!",
        roles: ["auditor"],
      },
    ],
  });
  await new Promise<void>((done) => app.server.listen(0, "127.0.0.1", done));
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  const baseURL = `http://127.0.0.1:${address.port}`;
  origins.push(baseURL);
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: width === 375 ? 812 : 900 },
  });
  const externalRequests: string[] = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === baseURL)
      return route.continue();
    externalRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  return {
    page: await context.newPage(),
    externalRequests,
    async close() {
      await context.close();
      await app.close();
    },
  };
}

for (const width of [1280, 375]) {
  test(`free preview keeps its boundaries visible across login, recovery and sample flows at ${width}px`, async ({
    browser,
  }, testInfo) => {
    const fixture = await preview(browser, width);
    const { page } = fixture;
    const notice = page.getByRole("complementary", { name: "免费测试站说明" });
    try {
      await page.goto("/?demo=1");
      await expect(
        page.getByRole("heading", { name: "欢迎回到研途" }),
      ).toBeVisible();
      await expect(notice).toContainText(
        "休眠、重启或重新部署后，账号和记录可能清除",
      );
      await expect(notice).toContainText("未正式审校的示例");
      await expect(notice).toContainText("模型与联网搜索已关闭");
      await expect(
        page.getByText("换一台设备也能继续。", { exact: false }),
      ).toHaveCount(0);
      await expect(notice).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath("preview-login.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "忘记密码 / 使用恢复码" }).click();
      await expect(
        page.getByRole("heading", { name: "恢复账号" }),
      ).toBeVisible();
      await expect(notice).toBeVisible();
      await page.getByRole("button", { name: "返回登录" }).click();
      const account = await registerAccountInUI(page);
      await expect(notice).toBeVisible();
      await expect(
        page.getByText("示例资料环境", { exact: true }),
      ).toBeVisible();
      const navigation = page.getByRole("navigation", { name: "主要导航" });
      await navigation
        .getByRole("button", { name: "基础测评", exact: true })
        .click();
      await page.getByRole("button", { name: /开始公共课测评/ }).click();
      await expect(
        page.getByRole("heading", { name: /数学 · 第 1/ }),
      ).toBeVisible();
      await expect(notice).toBeVisible();
      await navigation
        .getByRole("button", { name: "专业与院校", exact: true })
        .click();
      await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
      await expect(
        page.getByText("示例 · 待核验", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: /^收藏/ }).first().click();
      await expect(
        page.getByRole("button", { name: /^取消收藏/ }).first(),
      ).toBeVisible();
      await navigation
        .getByRole("button", { name: "我的收藏", exact: true })
        .click();
      await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
      await expect(
        page.getByRole("button", { name: /^取消收藏/ }).first(),
      ).toBeVisible();
      await expect(notice).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("preview-signed-in.png"),
        fullPage: true,
      });
      const viewportWidth = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      expect(viewportWidth.content).toBeLessThanOrEqual(
        viewportWidth.viewport + 1,
      );
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await expect(notice).toBeVisible();
      await loginAccount(page, account);
      await expect(notice).toBeVisible();
      await page.reload();
      await expect(notice).toBeVisible();
      const status = await page.request.get("/api/v1/research/status");
      expect((await status.json()).ready).toBe(false);
      expect(fixture.externalRequests).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
}

test("preview warning remains visible in the administrative workspace", async ({
  browser,
}) => {
  const fixture = await preview(browser, 1280);
  try {
    await loginAccount(fixture.page, {
      username: "preview_auditor",
      password: "Synthetic-Preview-Admin-2026!",
    });
    await expect(
      fixture.page.getByText(/当前管理身份：.*权限：审计/),
    ).toBeVisible();
    await expect(
      fixture.page.getByRole("complementary", { name: "免费测试站说明" }),
    ).toBeVisible();
    expect(fixture.externalRequests).toEqual([]);
  } finally {
    await fixture.close();
  }
});
