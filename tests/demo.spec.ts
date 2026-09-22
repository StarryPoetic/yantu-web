import { expect, test, type Page } from "@playwright/test";

// Playwright creates a separate browser context for every test; no test uses
// a persistent browser profile or the user's browser storage.
const schoolCard = (page: Page, name: string) =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
const cards = (page: Page) => page.locator(".school-card");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "找到属于你的下一站。", exact: true }),
  ).toBeVisible();
});

test("search and combined filters show empty states and can be cleared", async ({
  page,
}) => {
  await expect(cards(page)).toHaveCount(6);
  await page.getByRole("textbox", { name: "搜索院校或专业" }).fill("南京理工");
  await expect(cards(page)).toHaveCount(1);
  await expect(schoolCard(page, "南京理工大学")).toBeVisible();
  await page.getByRole("button", { name: "清除搜索", exact: true }).click();
  await page.getByLabel("城市筛选", { exact: true }).selectOption("杭州");
  await expect(cards(page)).toHaveCount(2);
  await page.getByLabel("梯度筛选", { exact: true }).selectOption("冲刺");
  await expect(
    page.getByRole("heading", { name: "暂时没有符合条件的项目" }),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: "清空筛选", exact: true })
    .first()
    .click();
  await expect(cards(page)).toHaveCount(6);
  await expect(page.getByLabel("城市筛选", { exact: true })).toHaveValue(
    "全部城市",
  );
  await expect(page.getByLabel("梯度筛选", { exact: true })).toHaveValue(
    "全部梯度",
  );
  await page.getByRole("button", { name: "更多筛选" }).click();
  await page
    .getByLabel("学位类型筛选", { exact: true })
    .selectOption("学术学位");
  await expect(cards(page)).toHaveCount(2);
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await expect(cards(page)).toHaveCount(6);
});

test("favorites persist across reloads and can be removed", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "收藏南京理工大学", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "取消收藏南京理工大学", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "取消收藏南京理工大学", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /我的收藏/ })
    .click();
  await expect(cards(page)).toHaveCount(2);
  await expect(schoolCard(page, "南京理工大学")).toBeVisible();
  await page
    .getByRole("button", { name: "取消收藏南京理工大学", exact: true })
    .click();
  await expect(cards(page)).toHaveCount(1);
  await expect(schoolCard(page, "南京理工大学")).toHaveCount(0);
});

test("excluded projects stay excluded after reload and can be restored", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "暂不考虑南京理工大学", exact: true })
    .click();
  await expect(schoolCard(page, "南京理工大学")).toHaveCount(0);
  await page.reload();
  await expect(cards(page)).toHaveCount(5);
  await page.getByRole("button", { name: "已排除项目 (1)" }).click();
  const dialog = page.getByRole("dialog", { name: "已排除的项目" });
  await expect(dialog).toContainText("南京理工大学");
  await expect(dialog).toContainText("由你主动排除");
  await dialog.getByRole("button", { name: "恢复推荐" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(cards(page)).toHaveCount(6);
  await expect(schoolCard(page, "南京理工大学")).toBeVisible();
});

test("compare accepts two or three projects and rejects a fourth", async ({
  page,
}) => {
  await schoolCard(page, "南京理工大学")
    .getByRole("checkbox", { name: "加入对比" })
    .check();
  await expect(page.getByRole("button", { name: "开始对比" })).toBeDisabled();
  await schoolCard(page, "杭州电子科技大学")
    .getByRole("checkbox", { name: "加入对比" })
    .check();
  await page.getByRole("button", { name: "开始对比" }).click();
  const dialog = page.getByRole("dialog", { name: "并排看，让选择更清晰" });
  await expect(dialog.getByRole("columnheader")).toHaveCount(3);
  await expect(
    dialog.getByRole("columnheader", { name: "南京理工大学" }),
  ).toBeVisible();
  await expect(dialog).toContainText("考试科目（模拟）");
  await expect(dialog).toContainText("主要风险");
  await page.keyboard.press("Escape");
  await schoolCard(page, "苏州大学")
    .getByRole("checkbox", { name: "加入对比" })
    .check();
  await schoolCard(page, "南京邮电大学")
    .getByRole("checkbox", { name: "加入对比" })
    .click();
  await expect(
    schoolCard(page, "南京邮电大学").getByRole("checkbox"),
  ).not.toBeChecked();
  await expect(page.getByRole("status")).toContainText("最多同时对比 3 个项目");
  await page.getByRole("button", { name: "开始对比" }).click();
  await expect(dialog.getByRole("columnheader")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始对比" })).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "加入对比", checked: true }),
  ).toHaveCount(0);
});

test("project drawer supports tabs, keyboard navigation, and focus restoration", async ({
  page,
}) => {
  const trigger = schoolCard(page, "南京理工大学").getByRole("button", {
    name: "查看详情",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "南京理工大学",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "关闭项目详情" }),
  ).toBeFocused();
  await dialog.getByRole("tab", { name: "分数参考" }).click();
  await expect(
    dialog.getByRole("table", { name: "近三年模拟分数数据" }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "分数参考" }).press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "就业方向" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialog.getByRole("tab", { name: "评价与依据" }).click();
  await expect(
    dialog.getByRole("heading", { name: "官方资料与评价证据尚未接入" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("correction drafts restore their type and explanation when the project is reopened", async ({
  page,
}) => {
  const openCorrectionForm = async () => {
    await schoolCard(page, "南京理工大学")
      .getByRole("button", { name: "查看详情" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "南京理工大学",
      exact: true,
    });
    await dialog.getByRole("tab", { name: "评价与依据" }).click();
    await dialog
      .getByRole("button", { name: "填写纠错草稿", exact: true })
      .click();
    return dialog;
  };
  let dialog = await openCorrectionForm();
  await dialog
    .getByRole("combobox", { name: "信息类型", exact: true })
    .selectOption("分数口径");
  await dialog
    .getByRole("textbox", { name: "补充说明与依据", exact: true })
    .fill("交互验证草稿：请核对 2027 年统考口径与招生目录。");
  await dialog
    .getByRole("button", { name: "保存纠错草稿", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "纠错草稿已保存在此浏览器，未发送给学校或管理员。",
  );
  await dialog.getByRole("button", { name: "关闭项目详情" }).click();
  await page.reload();
  dialog = await openCorrectionForm();
  await expect(
    dialog.getByRole("combobox", { name: "信息类型", exact: true }),
  ).toHaveValue("分数口径");
  await expect(
    dialog.getByRole("textbox", { name: "补充说明与依据", exact: true }),
  ).toHaveValue("交互验证草稿：请核对 2027 年统考口径与招生目录。");
});

test("a chosen project becomes the persistent target and planning tasks are saved", async ({
  page,
}) => {
  await expect(
    page.getByRole("img", {
      name: "杭州电子科技大学近三年模拟复试线走势：2024年318分、2025年325分、2026年322分",
      exact: true,
    }),
  ).toBeVisible();
  await schoolCard(page, "南京理工大学")
    .getByRole("button", { name: "查看详情" })
    .click();
  await page.getByRole("dialog").getByRole("tab", { name: "分数参考" }).click();
  const detailAllocations = (
    await page.locator(".detail-subjects strong").allTextContents()
  ).map((value) => Number.parseInt(value, 10));
  expect(detailAllocations.reduce((total, value) => total + value, 0)).toBe(
    365,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "设为备考目标" })
    .click();
  await expect(page).toHaveURL(/#plan$/);
  await expect(
    page.getByRole("heading", { name: "南京理工大学", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".plan-stats")).toContainText("365");
  await expect(page.locator(".plan-stats")).toContainText("待评估");
  const planAllocations = (
    await page.locator(".subject-score strong").allTextContents()
  ).map((value) => Number.parseInt(value, 10));
  expect(planAllocations).toEqual(detailAllocations);
  const task = page.getByRole("checkbox", {
    name: /核对目标年份招生目录与报考条件/,
  });
  await task.check();
  await expect(
    page.getByText("已完成 1 / 5 项", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "南京理工大学", exact: true }),
  ).toBeVisible();
  await expect(task).toBeChecked();
  await page.goto("/#explore");
  await expect(
    page.getByRole("img", {
      name: "南京理工大学近三年模拟复试线走势：2024年335分、2025年342分、2026年340分",
      exact: true,
    }),
  ).toBeVisible();
});

test("profile draft persists, and deleting personal data also removes assessment drafts", async ({
  page,
}) => {
  await page.goto("/#assessment");
  await page.getByRole("radio").nth(2).check();
  await page
    .getByLabel("简单记录你的思路", { exact: false })
    .fill("测试草稿：使用求导法则");
  await page.goto("/#profile");
  await page
    .getByRole("textbox", { name: "怎么称呼你", exact: true })
    .fill("测试同学");
  await page
    .getByRole("textbox", { name: "本科院校", exact: true })
    .fill("测试本科院校");
  await page
    .getByRole("textbox", { name: "本科专业", exact: true })
    .fill("软件工程");
  await page.getByRole("button", { name: "成都", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "本科院校", exact: true }),
  ).toHaveValue("测试本科院校");
  await expect(
    page.getByRole("button", { name: "成都", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "保存并查看推荐" }).click();
  await expect(page).toHaveURL(/#explore$/);
  await expect(page.locator(".right-rail .profile-summary")).toContainText(
    "测试本科院校",
  );
  await page.goto("/#profile");
  await page.getByRole("button", { name: "删除资料", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除个人资料？" })
    .getByRole("button", { name: "确认删除" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "本科院校", exact: true }),
  ).toHaveValue("");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "本科专业", exact: true }),
  ).toHaveValue("");
  await page.goto("/#assessment");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(
    page.getByLabel("简单记录你的思路", { exact: false }),
  ).toHaveValue("");
});

test("all assessment questions can be answered and the sample diagnosis survives reload", async ({
  page,
}) => {
  await page.goto("/#assessment");
  const correctAnswers = [2, 1, 1, 2, 2, 1];
  for (let index = 0; index < correctAnswers.length; index += 1) {
    await page.getByRole("radio").nth(correctAnswers[index]).check();
    if (index < correctAnswers.length - 1)
      await page.getByRole("button", { name: "下一题" }).click();
  }
  await page.getByRole("button", { name: "提交并查看诊断" }).click();
  await expect(page.getByText("基础诊断已完成", { exact: true })).toBeVisible();
  await expect(page.getByText(/完成 6 \/ 6 题，其中 6 题正确/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("基础诊断已完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看答案与依据" }).click();
  await expect(
    page.getByRole("heading", { name: "答案与依据", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".answer-review-item")).toHaveCount(6);
  await page.getByRole("button", { name: "重新测评" }).click();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
});

test("assessment can be skipped and the plan clearly marks insufficient evidence", async ({
  page,
}) => {
  await page.goto("/#assessment");
  await page.getByRole("button", { name: "跳过测评", exact: true }).click();
  await expect(page).toHaveURL(/#explore$/);
  await expect(
    page.getByRole("button", { name: "能力画像待完善" }),
  ).toBeVisible();
  await page.goto("/#plan");
  await expect(page.locator(".target-panel .notice")).toContainText(
    "能力评估依据不足",
  );
  await expect(page.locator(".plan-stats")).toContainText("待评估");
});

test("admin records can be added, reviewed, filtered, and restored after reload", async ({
  page,
}) => {
  await page.goto("/#admin");
  await page.getByRole("button", { name: "添加记录" }).click();
  let editor = page.getByRole("dialog", { name: "添加招生资料" });
  await editor
    .getByRole("textbox", { name: "资料名称", exact: true })
    .fill("交互验证资料");
  await editor
    .getByRole("textbox", { name: "适用院校 / 学院 / 专业", exact: true })
    .fill("示例学院 / 计算机技术");
  await editor
    .getByRole("textbox", { name: "来源或依据", exact: true })
    .fill("本地测试示例");
  await editor.getByRole("button", { name: "保存记录" }).click();
  const record = page.getByRole("row").filter({ hasText: "交互验证资料" });
  await expect(record).toContainText("待复核");
  await record
    .getByRole("button", { name: "复核交互验证资料", exact: true })
    .click();
  editor = page.getByRole("dialog", { name: "人工复核招生资料" });
  await editor
    .getByRole("combobox", { name: "复核状态", exact: true })
    .selectOption("已复核");
  await editor.getByRole("button", { name: "保存复核结果" }).click();
  await page.reload();
  await expect(record).toContainText("已复核");
  await page
    .getByRole("textbox", { name: "搜索管理记录" })
    .fill("不存在的记录");
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的资料" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(record).toBeVisible();
  await page.getByRole("tab", { name: "题库", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "二分查找的复杂度" }),
  ).toBeVisible();
});

test("report export contains the chosen project and explicit demo boundaries", async ({
  page,
}) => {
  await page.getByRole("button", { name: "我的择校报告" }).click();
  const dialog = page.getByRole("dialog", { name: "我的择校与备考报告" });
  await expect(dialog).toContainText("杭州电子科技大学");
  await expect(dialog).toContainText("招生数据与分析结论均为模拟");
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载报告 .md" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("研途-择校与备考报告-demo.md");
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const report = Buffer.concat(chunks).toString("utf8");
  expect(report).toContain("杭州电子科技大学");
  expect(report).toContain("能力评估依据不足");
  expect(report).toContain("均为模拟数据");
});

test("mobile pages, navigation, detail, and comparison do not overflow the body", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const assertFits = async () => {
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width);
  };
  await page.getByRole("button", { name: "展开导航" }).click();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "个人画像", exact: true })
    .click();
  await expect(page).toHaveURL(/#profile$/);
  await expect(page.getByRole("button", { name: "收起导航" })).toHaveCount(0);
  for (const route of [
    "explore",
    "profile",
    "assessment",
    "favorites",
    "plan",
    "admin",
  ]) {
    await page.goto(`/#${route}`);
    await expect(page.locator("main h1")).toBeVisible();
    await assertFits();
  }
  await page.goto("/#explore");
  await page.screenshot({
    path: testInfo.outputPath("mobile-home.png"),
    fullPage: true,
  });
  await schoolCard(page, "南京理工大学")
    .getByRole("button", { name: "查看详情" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "南京理工大学" }),
  ).toBeVisible();
  await assertFits();
  await page.getByRole("tab", { name: "分数参考" }).click();
  await assertFits();
  await page.keyboard.press("Escape");
  for (const name of ["南京理工大学", "杭州电子科技大学", "苏州大学"])
    await schoolCard(page, name)
      .getByRole("checkbox", { name: "加入对比" })
      .check();
  await page.getByRole("button", { name: "开始对比" }).click();
  await expect(
    page.getByRole("dialog", { name: "并排看，让选择更清晰" }),
  ).toBeVisible();
  await assertFits();
});

test("desktop home renders without browser errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.reload();
  await expect(cards(page)).toHaveCount(6);
  await page.screenshot({
    path: testInfo.outputPath("desktop-home.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
