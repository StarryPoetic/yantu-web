import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { resolve } from "node:path";
import { createApplication } from "../server/app";
import { createSeedCatalog } from "../server/catalog/index";
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

test("T3-07 historical unknown-maximum scores can be cleared and stay cleared after reload", async ({
  page,
}) => {
  await openExampleTarget(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "设置目标与计划" })
    .click();
  await page
    .getByRole("button", { name: "保存目标与计划", exact: true })
    .click();
  await expect(page.getByText("目标计划已保存", { exact: true })).toBeVisible();
  await page.route("**/api/v1/me/plan", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.plan.subjects[0].targetScore = 99999;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  const input = page.getByRole("spinbutton").first();
  await expect(input).toHaveValue("99999");
  await expect(input).toBeDisabled();
  await page.getByRole("button", { name: /清除.*历史异常分数/ }).click();
  await expect(input).toHaveValue("");
  await page.unroute("**/api/v1/me/plan");
  await page
    .getByRole("button", { name: "保存目标与计划", exact: true })
    .click();
  await expect(page.getByText("目标计划已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue("");
  expect(
    (await (await page.request.get("/api/v1/me/plan")).json()).plan.subjects[0]
      .targetScore,
  ).toBeNull();
});

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

async function optionalSubjectFixture(browser: Browser) {
  const origins: string[] = [];
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: resolve("dist"),
    origins,
    admins: [],
    bootstrapAdmins: [],
    secureCookies: false,
  });
  const catalog = createSeedCatalog();
  const target = catalog.releases[0].programs[0];
  // Synthetic data exists only in this test's isolated memory database.
  target.subjects = [
    {
      subjectId: "politics",
      name: "思想政治理论",
      maxScore: 100,
      optionGroupId: null,
    },
    {
      subjectId: "english",
      name: "英语一",
      maxScore: 100,
      optionGroupId: "foreign-language",
    },
    {
      subjectId: "japanese",
      name: "日语",
      maxScore: 100,
      optionGroupId: "foreign-language",
    },
    { subjectId: "math", name: "数学一", maxScore: 150, optionGroupId: null },
    {
      subjectId: "major",
      name: "专业基础",
      maxScore: 150,
      optionGroupId: null,
    },
  ].map((subject) => ({
    ...subject,
    minimumScore: 0,
    availability: "verified_current" as const,
    sourceIds: ["synthetic-planning-test"],
  }));
  target.scoreRequirements = {
    totalMaxScore: 500,
    totalMinimumScore: 0,
    interviewRequirement: "仅供离线浏览器测试",
    availability: "verified_current",
  };
  app.store.put("public", "catalog", "current", catalog);
  await new Promise<void>((done) => app.server.listen(0, "127.0.0.1", done));
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  const baseURL = `http://127.0.0.1:${address.port}`;
  origins.push(baseURL);
  const context = await browser.newContext({ baseURL });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort(),
  );
  return {
    page: await context.newPage(),
    targetId: target.programId,
    otherTargetId: catalog.releases[0].programs[1].programId,
    close: async () => {
      await context.close();
      await app.close();
    },
  };
}

test("官方可选科目单选后可保存分数，刷新恢复，切换清除旧分且合计只含所选科目", async ({
  browser,
}) => {
  const f = await optionalSubjectFixture(browser);
  const page = f.page;
  try {
    await registerAccount(page);
    await page.goto("/#plan");
    const target = page.getByRole("combobox", { name: "目标院校与专业" });
    await target.selectOption(f.targetId);
    const english = page.getByRole("radio", {
      name: "英语一 · 满分 100",
      exact: true,
    });
    const japanese = page.getByRole("radio", {
      name: "日语 · 满分 100",
      exact: true,
    });
    const englishScore = page.getByRole("spinbutton", {
      name: "英语一目标分数",
      exact: true,
    });
    const japaneseScore = page.getByRole("spinbutton", {
      name: "日语目标分数",
      exact: true,
    });
    const total = page.getByText("已填写目标总分：", { exact: false });
    const save = page.getByRole("button", {
      name: "保存目标与计划",
      exact: true,
    });
    await expect(english).not.toBeChecked();
    await expect(japanese).not.toBeChecked();
    await expect(englishScore).toHaveCount(0);
    await expect(japaneseScore).toHaveCount(0);
    await english.check();
    await englishScore.fill("80");
    await page
      .getByRole("spinbutton", { name: "思想政治理论目标分数", exact: true })
      .fill("70");
    await page
      .getByRole("spinbutton", { name: "数学一目标分数", exact: true })
      .fill("85");
    await page
      .getByRole("spinbutton", { name: "专业基础目标分数", exact: true })
      .fill("85");
    await expect(total).toContainText("320 分");
    const firstSave = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/me/plan") &&
        response.request().method() === "PUT",
    );
    await save.click();
    const firstResponse = await firstSave;
    expect(firstResponse.status()).toBe(200);
    expect(firstResponse.request().postDataJSON()).toMatchObject({
      selectedSubjectIds: ["politics", "english", "math", "major"],
      subjectTargets: { politics: 70, english: 80, math: 85, major: 85 },
    });
    await expect(
      page.getByText("目标计划已保存", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(english).toBeChecked();
    await expect(japanese).not.toBeChecked();
    await expect(englishScore).toHaveValue("80");
    await expect(total).toContainText("320 分");
    await japanese.check();
    await expect(english).not.toBeChecked();
    await expect(englishScore).toHaveCount(0);
    await expect(japaneseScore).toHaveValue("");
    await expect(total).toContainText("240 分");
    await japaneseScore.fill("75");
    await expect(total).toContainText("315 分");
    const secondSave = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/me/plan") &&
        response.request().method() === "PUT",
    );
    await save.click();
    const secondResponse = await secondSave;
    expect(secondResponse.status()).toBe(200);
    expect(secondResponse.request().postDataJSON()).toMatchObject({
      selectedSubjectIds: ["politics", "japanese", "math", "major"],
      subjectTargets: { politics: 70, japanese: 75, math: 85, major: 85 },
    });
    expect(
      secondResponse.request().postDataJSON().subjectTargets,
    ).not.toHaveProperty("english");
    await page.reload();
    await expect(japanese).toBeChecked();
    await expect(japaneseScore).toHaveValue("75");
    await expect(total).toContainText("315 分");
    await english.check();
    await expect(englishScore).toHaveValue("");
    await expect(total).toContainText("240 分");
    await target.selectOption(f.otherTargetId);
    await expect(english).toHaveCount(0);
    await expect(japanese).toHaveCount(0);
    await expect(total).toContainText("0 分");
  } finally {
    await f.close();
  }
});
