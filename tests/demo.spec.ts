import { expect, test, type Locator, type Page } from "@playwright/test";

// Playwright creates a separate browser context for every test; no test uses
// a persistent browser profile or the user's browser storage.
const schoolCard = (page: Page, name: string) =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
const cards = (page: Page) => page.locator(".school-card");
const questionButton = (page: Page, number: number) =>
  page.getByRole("button", {
    name: new RegExp(`^第${number}题(?:，已作答)?$`),
  });

// Independently checked answers for the demo's arithmetic, English, and
// philosophy examples. Keeping this fixture outside the production question
// bank makes the result assertion catch accidental answer-key changes.
const publicAnswers = [2, 1, 3, 0, 2, 1, 0, 2, 3, 1, 1, 2, 0, 3, 1];

async function answerWithAutomaticNavigation(page: Page, answers: number[]) {
  for (let index = 0; index < answers.length; index += 1) {
    await expect(questionButton(page, index + 1)).toHaveAttribute(
      "aria-current",
      "step",
    );
    await page.getByRole("radio").nth(answers[index]).check();
    if (index < answers.length - 1) {
      await expect(questionButton(page, index + 2)).toHaveAttribute(
        "aria-current",
        "step",
      );
    }
  }
}

async function assertCityGroupsStackVertically(list: Locator) {
  const rectangles = await list
    .getByRole("group", { name: /^[A-Z] 开头的城市$/ })
    .evaluateAll((groups) =>
      groups.map((group) => {
        const rectangle = group.getBoundingClientRect();
        return {
          left: rectangle.left,
          top: rectangle.top,
          bottom: rectangle.bottom,
          height: rectangle.height,
        };
      }),
    );
  expect(rectangles.length).toBeGreaterThan(1);
  for (let index = 0; index < rectangles.length; index += 1) {
    expect(rectangles[index].height).toBeGreaterThan(0);
    expect(
      Math.abs(rectangles[index].left - rectangles[0].left),
    ).toBeLessThanOrEqual(0.5);
    if (index > 0)
      expect(rectangles[index].top).toBeGreaterThanOrEqual(
        rectangles[index - 1].bottom,
      );
  }
}

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
  await page
    .getByLabel("简单记录你的思路", { exact: false })
    .fill("测试草稿：使用求导法则");
  await page.getByRole("radio").nth(2).check();
  await expect(questionButton(page, 2)).toHaveAttribute("aria-current", "step");
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

test("fifteen public questions advance automatically, allow revisiting, and require explicit submission", async ({
  page,
}) => {
  await page.goto("/#assessment");
  for (const subject of ["数学", "英语", "政治"]) {
    await expect(
      page.getByRole("checkbox", { name: `参加${subject}测评` }),
    ).toBeChecked();
  }
  await expect(page.locator(".question-dots > button")).toHaveCount(15);
  await answerWithAutomaticNavigation(page, publicAnswers);
  // Give the short selection feedback time to finish: answering the final
  // question must leave the submit decision with the student.
  await page.waitForTimeout(500);
  await expect(questionButton(page, 15)).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(
    page.getByText("公共课基础诊断已完成", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "上一题", exact: true }).click();
  await expect(questionButton(page, 14)).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.getByRole("radio").nth(3)).toBeChecked();
  await page.getByRole("radio").nth(0).check();
  await expect(questionButton(page, 15)).toHaveAttribute(
    "aria-current",
    "step",
  );
  await questionButton(page, 14).click();
  await expect(page.getByRole("radio").nth(0)).toBeChecked();
  await page.getByRole("radio").nth(3).check();
  await expect(questionButton(page, 15)).toHaveAttribute(
    "aria-current",
    "step",
  );
  await page.getByRole("button", { name: "提交并查看诊断" }).click();
  await expect(
    page.getByText("公共课基础诊断已完成", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/完成 15 \/ 15 题，其中 15 题正确/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("公共课基础诊断已完成", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看答案与依据" }).click();
  await expect(
    page.getByRole("heading", { name: "答案与依据", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".answer-review-item")).toHaveCount(15);
  await page.getByRole("button", { name: "返回修改答案", exact: true }).click();
  await expect(questionButton(page, 1)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("radio").nth(2)).toBeChecked();
  await expect(
    page.getByText("公共课基础诊断已完成", { exact: true }),
  ).toHaveCount(0);
  await questionButton(page, 15).click();
  await page
    .getByRole("button", { name: "提交并查看诊断", exact: true })
    .click();
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

test("nationwide cities support alphabetical groups, Chinese and pinyin search, multiple selection, and saved custom values", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#profile");
  await page.getByRole("button", { name: "展开全国城市", exact: true }).click();
  const list = page.getByRole("listbox", { name: "全国城市", exact: true });
  await expect(list).toHaveAttribute("aria-multiselectable", "true");
  const groups = list.getByRole("group", { name: /^[A-Z] 开头的城市$/ });
  const letters = await groups.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label")!.charAt(0)),
  );
  expect(letters.length).toBeGreaterThan(20);
  expect(letters).toEqual([...new Set(letters)].sort());
  expect(letters[0]).toBe("A");
  expect(letters.at(-1)).toBe("Z");
  await assertCityGroupsStackVertically(list);
  await page
    .locator(".city-picker")
    .screenshot({ path: testInfo.outputPath("desktop-city-picker.png") });
  const search = page.getByRole("combobox", {
    name: "搜索意向城市",
    exact: true,
  });
  await search.fill("苏州");
  const suzhou = list.getByRole("option", {
    name: "苏州，江苏省",
    exact: true,
  });
  await expect(suzhou).toBeVisible();
  await suzhou.click();
  await expect(suzhou).toHaveAttribute("aria-selected", "true");
  await search.fill("suzhou");
  await expect(suzhou).toBeVisible();
  await expect(suzhou).toHaveAttribute("aria-selected", "true");
  await search.fill("cq");
  const chongqing = list.getByRole("option", { name: /^重庆，/ });
  await expect(chongqing).toBeVisible();
  await chongqing.click();
  await search.fill("chongqing");
  await expect(chongqing).toHaveAttribute("aria-selected", "true");
  await search.fill("自定义示例城");
  await page
    .getByRole("button", {
      name: "添加自定义城市「自定义示例城」",
      exact: true,
    })
    .click();
  await page.getByRole("heading", { name: "基本情况", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.reload();
  for (const city of ["苏州", "重庆", "自定义示例城"]) {
    await expect(
      page.getByRole("button", { name: `移除意向城市${city}`, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "移除意向城市重庆", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "移除意向城市重庆", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "不确定", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "不确定", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "移除意向城市苏州", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "移除意向城市自定义示例城", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "不确定", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("public modules are optional, with five questions per selected subject and no mandatory math", async ({
  page,
}) => {
  await page.goto("/#assessment");
  await page.getByRole("checkbox", { name: "参加数学测评" }).uncheck();
  await expect(page.locator(".question-dots > button")).toHaveCount(10);
  await expect(
    page.locator(".assessment-question .badge").first(),
  ).toContainText("英语");
  await page.getByRole("checkbox", { name: "参加政治测评" }).uncheck();
  await expect(page.locator(".question-dots > button")).toHaveCount(5);
  await page.getByRole("checkbox", { name: "参加政治测评" }).check();
  await expect(page.locator(".question-dots > button")).toHaveCount(10);
  await answerWithAutomaticNavigation(page, publicAnswers.slice(5));
  await page
    .getByRole("button", { name: "提交并查看诊断", exact: true })
    .click();
  await expect(
    page.getByText(/完成 10 \/ 10 题，其中 10 题正确/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "查看答案与依据", exact: true })
    .click();
  await expect(page.locator(".answer-review-item")).toHaveCount(10);
  await expect(
    page.locator(".answer-review-item").filter({ hasText: "数学" }),
  ).toHaveCount(0);
});

test("old six-question caches never appear as current answers or completed public assessment", async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("yantu-demo-v1")!);
    state.assessment = {
      completed: true,
      answered: 6,
      correct: 6,
      date: "2026-09-22T10:00:00.000Z",
    };
    localStorage.setItem("yantu-demo-v1", JSON.stringify(state));
    localStorage.setItem(
      "yantu-demo-assessment-attempt",
      JSON.stringify({
        answers: { m1: 2, m2: 1, e1: 1, e2: 2, c1: 2, c2: 1 },
        notes: { m1: "不应出现在新版的旧草稿" },
      }),
    );
  });
  await page.goto("/#assessment");
  await page.reload();
  await expect(page.locator(".question-dots > button")).toHaveCount(15);
  await expect(questionButton(page, 1)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(
    page.getByLabel("简单记录你的思路", { exact: false }),
  ).toHaveValue("");
  await expect(
    page.getByText("公共课基础诊断已完成", { exact: true }),
  ).toHaveCount(0);
});

test("professional questions require a confirmed major, stay optional, and keep their own result", async ({
  page,
}) => {
  await page.goto("/#assessment");
  const professionalTab = page.getByRole("button", {
    name: "专业课测评（可选）",
    exact: true,
  });
  await expect(professionalTab).toBeDisabled();
  await expect(
    page.getByText(/专业尚未确定：先完成公共课或直接看联合推荐/),
  ).toBeVisible();
  await page.getByRole("button", { name: "跳过测评", exact: true }).click();
  await expect(cards(page)).toHaveCount(6);
  await page.getByRole("button", { name: "专业方向", exact: true }).click();
  await page
    .getByRole("button", { name: "确认专业方向计算机技术", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "确认专业方向计算机技术", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "选做专业课测评", exact: true })
    .click();
  await expect(professionalTab).toBeEnabled();
  await professionalTab.click();
  await expect(page.locator(".question-dots > button")).toHaveCount(5);
  await expect(page.locator(".assessment-range-hint")).toContainText(
    "计算机技术",
  );
  await answerWithAutomaticNavigation(page, [2, 1, 0, 3, 2]);
  await expect(questionButton(page, 5)).toHaveAttribute("aria-current", "step");
  await page
    .getByRole("button", { name: "提交并查看诊断", exact: true })
    .click();
  await expect(
    page.getByText("专业课基础诊断已完成", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/完成 5 \/ 5 题，其中 5 题正确/)).toBeVisible();
  await page
    .getByRole("button", { name: "带着诊断看推荐", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "能力画像待完善", exact: true }),
  ).toBeVisible();
  await page.goto("/#assessment");
  await expect(page.locator(".question-dots > button")).toHaveCount(15);
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await professionalTab.click();
  await expect(
    page.getByText("专业课基础诊断已完成", { exact: true }),
  ).toBeVisible();
  await page.goto("/#profile");
  await page
    .getByRole("combobox", { name: "已确认的目标专业", exact: true })
    .selectOption("计算机科学与技术");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.goto("/#assessment");
  await professionalTab.click();
  await expect(page.locator(".question-dots > button")).toHaveCount(5);
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(
    page.getByText("专业课基础诊断已完成", { exact: true }),
  ).toHaveCount(0);
});

test("major and campus choices filter projects in both directions", async ({
  page,
}) => {
  const campus = page.getByRole("combobox", {
    name: "按院校探索专业",
    exact: true,
  });
  const direction = page.getByRole("combobox", {
    name: "专业方向筛选",
    exact: true,
  });
  await campus.selectOption("南京理工大学");
  await expect(page.locator(".major-card")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "计算机科学与技术", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "计算机技术", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "查看计算机技术相关院校", exact: true })
    .click();
  await expect(direction).toHaveValue("practice");
  await expect(cards(page)).toHaveCount(1);
  await expect(schoolCard(page, "南京理工大学")).toBeVisible();
  await expect(cards(page).locator(".project-title")).toContainText("专业学位");
  await campus.selectOption("全部院校");
  const practice = page.locator(".major-card").filter({
    has: page.getByRole("heading", { name: "计算机技术", exact: true }),
  });
  await practice
    .getByRole("button", { name: "比较杭州电子科技大学的专业", exact: true })
    .click();
  await expect(campus).toHaveValue("杭州电子科技大学");
  await expect(page.locator(".major-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "查看计算机科学与技术相关院校", exact: true })
    .click();
  await expect(direction).toHaveValue("research");
  await expect(cards(page)).toHaveCount(1);
  await expect(schoolCard(page, "杭州电子科技大学")).toBeVisible();
  await expect(cards(page).locator(".project-title")).toContainText("学术学位");
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await expect(cards(page)).toHaveCount(6);
});

test("academic and professional degree explanations are clickable in exploration and profile", async ({
  page,
}) => {
  const explanation = page.getByRole("button", {
    name: "学硕和专硕有什么区别？",
    exact: true,
  });
  await explanation.click();
  let dialog = page.getByRole("dialog", {
    name: "学硕和专硕有什么区别？",
    exact: true,
  });
  await expect(
    dialog.getByRole("heading", { name: "学硕 · 学术学位", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "专硕 · 专业学位", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("学硕不固定等于");
  await expect(dialog).toContainText("以具体项目为准");
  await page.keyboard.press("Escape");
  await expect(explanation).toBeFocused();
  await page.goto("/#profile");
  await page
    .getByRole("combobox", { name: "学位类型偏好", exact: true })
    .selectOption("专业学位");
  await explanation.click();
  dialog = page.getByRole("dialog", {
    name: "学硕和专硕有什么区别？",
    exact: true,
  });
  await expect(dialog).toContainText("实践课程、项目与实习安排");
  await dialog
    .getByRole("button", { name: "关闭学位说明", exact: true })
    .click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "学位类型偏好", exact: true }),
  ).toHaveValue("专业学位");
});

test("body copy, form labels, controls, and helper text remain readable on desktop and mobile", async ({
  page,
}, testInfo) => {
  const fontSize = async (locator: Locator) =>
    locator.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
    await page.goto("/#explore");
    expect(
      await fontSize(
        page.locator("main .page-heading p:not(.eyebrow)").first(),
      ),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await fontSize(page.locator(".hero-copy > p")),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await fontSize(page.locator("main .eyebrow").first()),
    ).toBeGreaterThanOrEqual(12);
    await page.goto("/#profile");
    expect(
      await fontSize(page.locator(".flow-section .field > span").first()),
    ).toBeGreaterThanOrEqual(14);
    expect(
      await fontSize(
        page.getByRole("textbox", { name: "本科院校", exact: true }),
      ),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await fontSize(
        page.getByRole("button", { name: "保存草稿", exact: true }),
      ),
    ).toBeGreaterThanOrEqual(14);
    await page.screenshot({
      path: testInfo.outputPath(
        `${width === 1440 ? "desktop" : "mobile"}-profile.png`,
      ),
      fullPage: true,
    });
    await page.goto("/#assessment");
    expect(
      await fontSize(page.locator(".question-title")),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await fontSize(page.locator(".answer-option").first()),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await fontSize(page.locator(".assessment-range-hint").first()),
    ).toBeGreaterThanOrEqual(12);
    await page.screenshot({
      path: testInfo.outputPath(
        `${width === 1440 ? "desktop" : "mobile"}-assessment.png`,
      ),
      fullPage: true,
    });
  }
});

test("city picker, long city names, and admin editing fit a 375px viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const assertFits = async () => {
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      body: document.documentElement.scrollWidth,
    }));
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  };
  await page.goto("/#profile");
  const search = page.getByRole("combobox", {
    name: "搜索意向城市",
    exact: true,
  });
  await search.click();
  const list = page.getByRole("listbox", { name: "全国城市", exact: true });
  await expect(list).toBeVisible();
  await assertCityGroupsStackVertically(list);
  await page
    .locator(".city-picker")
    .screenshot({ path: testInfo.outputPath("mobile-city-picker.png") });
  await search.fill("阿坝");
  const option = page.getByRole("option", {
    name: "阿坝藏族羌族自治州，四川省",
    exact: true,
  });
  await expect(option).toBeVisible();
  const optionSize = await option.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(optionSize.scroll).toBeLessThanOrEqual(optionSize.width);
  const dropdown = await page.locator(".city-dropdown").boundingBox();
  expect(dropdown).not.toBeNull();
  expect(dropdown!.x).toBeGreaterThanOrEqual(0);
  expect(dropdown!.x + dropdown!.width).toBeLessThanOrEqual(375);
  await assertFits();
  await search.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "全国城市", exact: true }),
  ).toHaveCount(0);
  await page.goto("/#admin");
  await page.getByRole("button", { name: "添加记录", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "添加招生资料",
    exact: true,
  });
  const dialogSize = await dialog.boundingBox();
  expect(dialogSize).not.toBeNull();
  expect(dialogSize!.x).toBeGreaterThanOrEqual(0);
  expect(dialogSize!.x + dialogSize!.width).toBeLessThanOrEqual(375);
  expect(dialogSize!.height).toBeLessThanOrEqual(812);
  await assertFits();
  await dialog
    .getByRole("textbox", { name: "资料名称", exact: true })
    .fill("移动端表单验证");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
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
