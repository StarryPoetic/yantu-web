import { expect, test, type Locator, type Page } from "@playwright/test";
import { registerAccount } from "./helpers/account";
import type { Program } from "../src/workspace/contracts";

const interestLabel = "感兴趣的专业或领域（选填）";
async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function expectAligned(input: Locator, popup: Locator, width: number) {
  await expect(popup).toBeVisible();
  const field = await input.boundingBox(),
    list = await popup.boundingBox();
  expect(field).not.toBeNull();
  expect(list).not.toBeNull();
  expect(Math.abs(field!.x - list!.x)).toBeLessThan(1);
  expect(Math.abs(field!.width - list!.width)).toBeLessThan(1);
  expect(list!.x).toBeGreaterThanOrEqual(0);
  expect(list!.x + list!.width).toBeLessThanOrEqual(width);
}

test("专业兴趣按实际拼音首字母分组，同宽下拉支持键盘与多个自由兴趣", async ({
  page,
}, testInfo) => {
  await registerAccount(page);
  await page.goto("/#profile");
  const input = page.getByRole("combobox", { name: interestLabel });
  await input.click();
  const list = page.getByRole("listbox", { name: "专业兴趣建议" });
  await expect(
    list.getByRole("option", { name: "法学", exact: true }),
  ).toBeAttached();
  await expectAligned(input, list, page.viewportSize()!.width);
  const groups = list.getByRole("group");
  const labels = await groups.evaluateAll((elements) =>
    elements.map(
      (element) =>
        document.getElementById(element.getAttribute("aria-labelledby")!)!
          .textContent!,
    ),
  );
  expect(labels).toEqual([...labels].sort());
  expect(labels).toContain("F");
  expect(labels).toContain("J");
  for (const absent of ["I", "U", "V"]) expect(labels).not.toContain(absent);
  for (const group of await groups.all())
    expect(await group.getByRole("option").count()).toBeGreaterThan(0);
  await expect(
    list
      .getByRole("group", { name: "F", exact: true })
      .getByRole("option", { name: "法学", exact: true }),
  ).toBeAttached();
  await expect(
    list
      .getByRole("group", { name: "J", exact: true })
      .getByRole("option", { name: "计算机科学与技术", exact: true }),
  ).toBeAttached();
  const jNames = await list
    .getByRole("group", { name: "J", exact: true })
    .getByRole("option")
    .allTextContents();
  expect(jNames).toEqual(
    [...jNames].sort(new Intl.Collator("zh-CN-u-co-pinyin").compare),
  );
  await page.screenshot({
    path: testInfo.outputPath("interest-dropdown-desktop.png"),
    fullPage: true,
  });

  await input.fill("乡村公益、法学");
  await expect(list.getByRole("group")).toHaveCount(1);
  await expect(
    list.getByRole("group", { name: "F", exact: true }),
  ).toBeVisible();
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", /option-0$/);
  await input.press("Enter");
  await expect(input).toHaveValue("乡村公益、法学");
  await expect(list).toBeHidden();
  await page.getByRole("button", { name: "展开专业兴趣建议" }).click();
  await list.getByRole("option", { name: "教育学", exact: true }).click();
  await expect(input).toHaveValue("乡村公益、法学、教育学");
  await input.fill("乡村公益、法学、教育学、社区服务");
  await expect(
    list.getByText("没有匹配的目录名称。", { exact: false }),
  ).toBeVisible();
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "保存个人画像", exact: true }).click();
  await expect(page).toHaveURL(/#assessment$/);
  await navigate(page, "个人画像");
  await page.reload();
  await expect(input).toHaveValue("乡村公益、法学、教育学、社区服务");
});

test.describe("手机兴趣选择", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("下拉与输入框同宽且保持在视口内，触屏可选择", async ({
    page,
  }, testInfo) => {
    await registerAccount(page);
    await page.goto("/#profile");
    const input = page.getByRole("combobox", { name: interestLabel });
    await input.scrollIntoViewIfNeeded();
    await input.tap();
    const list = page.getByRole("listbox", { name: "专业兴趣建议" });
    await expect(
      list.getByRole("option", { name: "法学", exact: true }),
    ).toBeAttached();
    await expectAligned(input, list, 390);
    const bounds = await list.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath("interest-dropdown-mobile.png"),
      fullPage: true,
    });
    await input.fill("法学");
    await list.getByRole("option", { name: "法学", exact: true }).tap();
    await expect(input).toHaveValue("法学");
    await expect(list).toBeHidden();
  });
});

async function openExampleTarget(page: Page) {
  await registerAccount(page);
  await page.goto("/#explore");
  await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
  const items = await (
    await page.request.get("/api/v1/programs?limit=100")
  ).json();
  const programs: Program[] = items.items;
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: "查看资料" }) })
    .first()
    .getByRole("button", { name: "查看资料" })
    .click();
  return programs;
}

test("选择目标立即保存，刷新和导航可恢复，更换取消不会复活旧计划", async ({
  page,
}) => {
  const programs = await openExampleTarget(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "设置目标与计划" })
    .click();
  await expect(page).toHaveURL(/#plan$/);
  const selected = await (
    await page.request.get("/api/v1/me/selections")
  ).json();
  const first = programs.find(
    (program) => program.programId === selected.targetProgramId,
  )!;
  expect(first).toBeTruthy();
  expect(selected.confirmedMajorId).toBe(first.identity.majorCode.slice(0, 4));
  expect(
    (await (await page.request.get("/api/v1/me/plan")).json()).plan,
  ).toBeNull();
  const target = page.getByRole("region", { name: "当前已选目标" });
  await expect(target).toContainText(
    `${first.display.institutionName} · ${first.display.majorName}`,
  );
  await page.reload();
  await expect(target).toContainText(first.display.institutionName);
  await navigate(page, "个人画像");
  await navigate(page, "目标与规划");
  await expect(
    page.getByRole("combobox", { name: "目标院校与专业" }),
  ).toHaveValue(first.programId);
  await page
    .getByRole("button", { name: "保存目标与计划", exact: true })
    .click();
  await expect(page.getByText("目标计划已保存", { exact: true })).toBeVisible();
  const initialPlan = await (await page.request.get("/api/v1/me/plan")).json();
  const second = programs.find(
    (program) =>
      program.programId !== first.programId &&
      program.identity.degreeType !== first.identity.degreeType,
  )!;
  await page
    .getByRole("combobox", { name: "目标院校与专业" })
    .selectOption(second.programId);
  await expect(target).toContainText(second.display.institutionName);
  const changed = await (
    await page.request.get("/api/v1/me/selections")
  ).json();
  expect(changed.targetProgramId).toBe(second.programId);
  expect(changed.confirmedMajorId).toBe(second.identity.majorCode.slice(0, 4));
  const oldPlan = (await (await page.request.get("/api/v1/me/plan")).json())
    .plan;
  expect(oldPlan.programId).toBe(first.programId);
  expect(oldPlan.status).toBe("needs_review");
  expect(oldPlan.valid).toBe(false);
  expect(oldPlan.planVersion).toBe(initialPlan.planVersion + 1);
  await expect(
    page.getByText("此前的目标计划已保留为历史记录", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(target).toContainText(second.display.institutionName);
  await expect(
    page.getByRole("combobox", { name: "目标院校与专业" }),
  ).toHaveValue(second.programId);
  await page.getByRole("button", { name: "取消当前目标", exact: true }).click();
  await expect(target).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "目标院校与专业" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "还没有确定目标", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/me/selections")).json())
      .targetProgramId,
  ).toBeNull();
  await expect(
    page.getByRole("button", { name: "保存目标与计划", exact: true }),
  ).toBeDisabled();
});

test("目标保存失败保留项目详情和原页面，不展示成功状态", async ({ page }) => {
  await openExampleTarget(page);
  await page.route("**/api/v1/me/target", (route) =>
    route.fulfill({
      status: 409,
      json: {
        code: "revision_changed",
        message: "项目资料已更新，请重新查看后选择。",
      },
    }),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "设置目标与计划" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "项目资料已更新",
  );
  await expect(page).toHaveURL(/#explore$/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("目标已保存：", { exact: false })).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/v1/me/selections")).json())
      .targetProgramId,
  ).toBeNull();
});
