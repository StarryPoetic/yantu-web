import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { performanceFixture } from "./helpers/performance-fixture";
import { registerAccount, loginAccount } from "./helpers/account";

test("成绩提交、独立审核、刷新规划差距与本人撤回形成真实页面闭环", async ({
  browser,
}) => {
  const origins: string[] = [];
  const f = await performanceFixture({
    staticDirectory: resolve("dist"),
    origins,
    secureCookies: false,
    bootstrapAdmins: [
      {
        username: "performance_reviewer",
        password: "Performance-Test-Reviewer-2026!",
        roles: ["reviewer"],
      },
    ],
  });
  origins.push(f.base);
  const student = await browser.newContext({ baseURL: f.base });
  const reviewer = await browser.newContext({ baseURL: f.base });
  for (const context of [student, reviewer])
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === f.base
        ? route.continue()
        : route.abort(),
    );
  const page = await student.newPage(),
    reviewPage = await reviewer.newPage();
  try {
    await registerAccount(page);
    await page.goto("/#plan");
    await page
      .getByRole("combobox", { name: "目标院校与专业" })
      .selectOption(f.target.programId);
    await page
      .getByRole("radio", { name: "英语一 · 满分 100", exact: true })
      .check();
    await page
      .getByRole("spinbutton", { name: "英语一目标分数", exact: true })
      .fill("80");
    await page
      .getByRole("button", { name: "保存目标与计划", exact: true })
      .click();
    await expect(
      page.getByText("目标计划已保存", { exact: true }),
    ).toBeVisible();
    const panel = page.getByRole("region", {
      name: "可靠成绩与审核",
      exact: true,
    });
    await panel.getByLabel("成绩科目").selectOption("english");
    await panel.getByLabel("核验成绩").fill("61");
    await panel
      .getByLabel("考试日期")
      .fill(new Date().toISOString().slice(0, 10));
    await panel
      .getByLabel("考试名称与来源")
      .fill("浏览器自动化合成模拟考试，不是真实考试");
    await panel
      .getByLabel("成绩证明定位")
      .fill("测试夹具中的合成证明位置，仅验证页面与接口流程");
    await panel
      .getByRole("button", { name: "提交成绩审核", exact: true })
      .click();
    await expect(panel.getByText("待独立审核", { exact: false })).toBeVisible();
    const gap = page.getByRole("region", { name: "已保存计划分数与差距" });
    await expect(gap).toContainText(
      "英语一：目标 80 · 当前 待评估 · 差距 待评估",
    );
    await loginAccount(reviewPage, {
      username: "performance_reviewer",
      password: "Performance-Test-Reviewer-2026!",
    });
    const queue = reviewPage.getByRole("region", { name: "成绩独立复核" });
    await queue.getByRole("button", { name: "读取成绩审核队列" }).click();
    const record = queue.getByRole("article", { name: "英语一审核记录" });
    await expect(record).toContainText("测试夹具中的合成证明位置");
    await expect(
      record.getByRole("button", { name: "通过成绩审核", exact: true }),
    ).toBeDisabled();
    for (const checkbox of await record.getByRole("checkbox").all())
      await checkbox.check();
    await record
      .getByLabel("成绩审核说明")
      .fill("仅核对自动化测试夹具中的合成材料，不代表真实人工审核");
    await record
      .getByRole("button", { name: "通过成绩审核", exact: true })
      .click();
    await expect(record.getByText(/^审核通过/)).toBeVisible();
    await panel.getByRole("button", { name: "刷新成绩状态" }).click();
    await expect(panel.getByText(/^审核通过/)).toBeVisible();
    await page
      .getByRole("button", { name: "保存目标与计划", exact: true })
      .click();
    await expect(gap).toContainText("英语一：目标 80 · 当前 61 · 差距 19");
    await page.reload();
    await expect(gap).toContainText("英语一：目标 80 · 当前 61 · 差距 19");
    await panel
      .getByLabel("撤回成绩原因")
      .fill("测试撤回：原材料口径需重新核对");
    await panel.getByRole("button", { name: "撤回这条成绩" }).click();
    await expect(panel.getByText(/^已撤回/)).toBeVisible();
    await expect(gap).toContainText(
      "英语一：目标 80 · 当前 待评估 · 差距 待评估",
    );
    await expect(gap).toContainText("计划依据已变化");
  } finally {
    await student.close();
    await reviewer.close();
    await f.close();
  }
});

test("未知考试组保持待核验，移动端不会提供伪造可靠成绩的入口", async ({
  browser,
}) => {
  const origins: string[] = [];
  const f = await performanceFixture({
    staticDirectory: resolve("dist"),
    origins,
    secureCookies: false,
  });
  origins.push(f.base);
  f.target.identity.examGroupId = null;
  f.app.store.put("public", "catalog", "current", f.state);
  const context = await browser.newContext({
    baseURL: f.base,
    viewport: { width: 375, height: 812 },
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === f.base
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  try {
    await registerAccount(page);
    await page.goto("/#plan");
    await page
      .getByRole("combobox", { name: "目标院校与专业" })
      .selectOption(f.target.programId);
    const panel = page.getByRole("region", { name: "可靠成绩与审核" });
    await expect(panel).toContainText("暂不能提交可比成绩");
    await expect(
      panel.getByRole("button", { name: "提交成绩审核" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await context.close();
    await f.close();
  }
});
