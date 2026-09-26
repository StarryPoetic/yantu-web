import { expect, test, type Page } from "@playwright/test";
import { registerAccount } from "./helpers/account";

async function openWorkspace(page: Page) {
  await registerAccount(page);
  await page.goto("/#explore");
  await expect(
    page.getByRole("heading", { name: "找到属于你的下一站。" }),
  ).toBeVisible();
  await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
}
async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("server profile persists without importing local demo identity and new sessions stay isolated", async ({
  page,
  browser,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "yantu-demo-v1",
      JSON.stringify({ profile: { name: "不可迁移的示例用户" } }),
    ),
  );
  await openWorkspace(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-desktop.png"),
    fullPage: true,
  });
  await navigate(page, "个人画像");
  await expect(page.getByLabel("称呼（选填）")).not.toHaveValue(
    "不可迁移的示例用户",
  );
  await page.getByLabel("称呼（选填）").fill("真实会话测试");
  await page.getByLabel("本科院校", { exact: true }).fill("测试大学");
  await page.getByRole("button", { name: "保存个人画像" }).click();
  await expect(
    page.getByText(
      "个人画像已保存到账号。接下来可完成公共课测评，再查看专业推荐结论。",
    ),
  ).toBeVisible();
  await navigate(page, "个人画像");
  await page.reload();
  await expect(page.getByLabel("称呼（选填）")).toHaveValue("真实会话测试");
  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await registerAccount(other);
  await other.goto("/#profile");
  await expect(other.getByLabel("称呼（选填）")).not.toHaveValue(
    "真实会话测试",
  );
  await isolated.close();
});

test("catalog creates honest recommendations, saves target tasks and downloadable reports, then deletes personal records", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "生成联合推荐" }).click();
  await expect(
    page.getByText("暂无可以正式排序的推荐项目", { exact: true }),
  ).toBeVisible();
  const first = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: "查看资料" }) })
    .first();
  await first.getByRole("button", { name: /^收藏/ }).click();
  await expect(
    first.getByRole("button", { name: /^取消收藏/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await first.getByRole("button", { name: "查看资料" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("该项目为开发示例", { exact: false }),
  ).toBeVisible();
  await dialog
    .getByLabel("纠错说明")
    .fill("这条示例的招生年度与来源需要进一步核实。");
  await dialog.getByRole("button", { name: "提交纠错" }).click();
  await expect(
    dialog.getByText("已提交，等待人工核验；不会直接修改已发布资料。"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "屏蔽此项目" }).click();
  await expect(dialog.getByRole("button", { name: "恢复推荐" })).toBeVisible();
  await dialog.getByRole("button", { name: "恢复推荐" }).click();
  await dialog.getByRole("button", { name: "屏蔽这所院校" }).click();
  await expect(
    dialog.getByRole("button", { name: "恢复这所院校" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "恢复这所院校" }).click();
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("button", { name: "生成联合推荐" }).click();
  await expect(
    page.getByText("暂无可以正式排序的推荐项目", { exact: true }),
  ).toBeVisible();
  await first.getByRole("button", { name: "查看资料" }).click();
  await dialog.getByRole("button", { name: "设置目标与计划" }).click();
  // A target change invalidates the old recommendation snapshot.
  await navigate(page, "专业与院校");
  await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
  await page.getByRole("button", { name: "生成联合推荐" }).click();
  await expect(
    page.getByText("暂无可以正式排序的推荐项目", { exact: true }),
  ).toBeVisible();
  await navigate(page, "目标与规划");
  await page.getByRole("button", { name: "保存目标与计划" }).click();
  await expect(page.getByText("目标计划已保存", { exact: true })).toBeVisible();
  const task = page.locator(".ws-task-list").getByRole("checkbox").first();
  await task.check();
  await expect(task).toBeChecked();
  await page.getByRole("button", { name: "生成本次推荐报告" }).click();
  await expect(page.getByRole("heading", { name: "报告已就绪" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Markdown" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  await page.route("**/api/v1/reports/*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        withdrawn: true,
        warning: "报告依据已撤回，请重新核验。",
      },
    });
  });
  await page.getByRole("button", { name: "查看报告", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("报告依据已撤回");
  await expect(
    page.getByRole("button", { name: "下载 Markdown" }),
  ).toBeDisabled();
  await navigate(page, "个人画像");
  await page.getByRole("button", { name: "删除我的个人资料" }).click();
  await page.getByLabel("我已核对删除范围，确认删除").check();
  await page.getByRole("button", { name: "确认删除全部个人资料" }).click();
  await expect(
    page.getByText("个人资料及关联记录已删除。你可以重新开始。"),
  ).toBeVisible();
  await navigate(page, "我的收藏");
  await expect(
    page.getByRole("heading", { name: "当前条件下没有项目" }),
  ).toBeVisible();
  await navigate(page, "目标与规划");
  await expect(
    page.getByRole("heading", { name: "保存目标后生成阶段任务" }),
  ).toBeVisible();
});

test("server assessment saves an English-only draft, resumes, and exposes explanations only after explicit submission", async ({
  page,
}) => {
  await openWorkspace(page);
  await navigate(page, "基础测评");
  await page.getByLabel("数学 · 5 题").uncheck();
  await page.getByLabel("政治 · 5 题").uncheck();
  await page.getByRole("button", { name: "开始公共课测评 · 5 题" }).click();
  await expect(
    page.getByRole("heading", { name: "英语 · 第 1 / 5 题" }),
  ).toBeVisible();
  await expect(page.getByText("标准答案：", { exact: false })).toHaveCount(0);
  await page.getByRole("radio").first().check();
  await expect(
    page.getByRole("heading", { name: "英语 · 第 2 / 5 题" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "恢复草稿" }).click();
  await page
    .getByRole("button", { name: "第1题，已作答", exact: true })
    .click();
  await expect(page.getByRole("radio").first()).toBeChecked();
  for (let index = 2; index <= 5; index += 1) {
    await page
      .getByRole("button", { name: `第${index}题`, exact: true })
      .click();
    await page.getByRole("radio").first().check();
    await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "英语 · 第 5 / 5 题" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "主动提交测评" }).click();
  await expect(
    page.getByRole("heading", { name: "你的下一步练习方向" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "答题结果总览" })
    .getByRole("button", { name: /第1题/ })
    .click();
  await expect(
    page.getByText("标准答案：", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "本题辅助讲解与追问" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await navigate(page, "专业与院校");
  await page.getByLabel(/示例诊断，只作练习参考/).check();
  await page.getByRole("button", { name: "生成联合推荐" }).click();
  await expect(
    page.getByText(/未采用测评依据：示例诊断不作为真实推荐依据/),
  ).toBeVisible();
});

test("stale profile writes require explicit reload instead of overwriting a newer tab", async ({
  page,
  context,
}) => {
  await openWorkspace(page);
  await navigate(page, "个人画像");
  const second = await context.newPage();
  await second.goto("/#profile");
  await expect(second.getByLabel("称呼（选填）")).toBeVisible();
  await page.getByLabel("称呼（选填）").fill("第一页面的新资料");
  await page.getByRole("button", { name: "保存个人画像" }).click();
  await expect(
    page.getByText(
      "个人画像已保存到账号。接下来可完成公共课测评，再查看专业推荐结论。",
    ),
  ).toBeVisible();
  await second.getByLabel("称呼（选填）").fill("过期页面的修改");
  await second.getByRole("button", { name: "保存个人画像" }).click();
  await expect(second.getByRole("alert")).toContainText(
    "此记录已在其他页面更新",
  );
  await expect(second.getByLabel("称呼（选填）")).toHaveValue("过期页面的修改");
  await second.getByRole("button", { name: "重新读取最新记录" }).click();
  await expect(second.getByLabel("称呼（选填）")).toHaveValue(
    "第一页面的新资料",
  );
});

test("mobile layout and keyboard dialogs stay usable and students have no administration entry", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWorkspace(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "学硕 / 专硕" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "学硕 / 专硕" })).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(
    page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "资料管理" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("管理访问凭据")).toHaveCount(0);
});

test("hidden computing examples stay out of recommendations and unrelated targets save without a stale run", async ({
  page,
}) => {
  await registerAccount(page);
  await page.goto("/#explore");
  await expect(
    page.getByLabel("显示未核验的交互示例项目（仅体验流程）"),
  ).not.toBeChecked();
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith("/api/v1/recommendations") &&
      value.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成联合推荐" }).click();
  const run = await (await response).json();
  expect(run.inputSnapshot.filters.includeExamples).toBe(false);
  expect([...run.items, ...run.pendingVerification]).toHaveLength(0);
  await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
  const first = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: "查看资料" }) })
    .first();
  await first.getByRole("button", { name: "查看资料" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "设置目标与计划" })
    .click();
  const saving = page.waitForRequest(
    (value) => value.url().endsWith("/me/plan") && value.method() === "PUT",
  );
  await page.getByRole("button", { name: "保存目标与计划" }).click();
  expect((await saving).postDataJSON().recommendationRunId).toBeUndefined();
  await expect(page.getByText("目标计划已保存", { exact: true })).toBeVisible();
});

test("an unavailable annual catalog keeps profile and nationwide disciplines reachable", async ({
  page,
}) => {
  await page.route("**/api/v1/programs", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "catalog_unavailable", message: "招生目录尚未发布" },
    }),
  );
  await openWorkspace(page);
  await expect(page.getByRole("alert")).toContainText("招生目录尚未发布");
  await navigate(page, "个人画像");
  await expect(page.getByLabel("称呼（选填）")).toBeVisible();
  await navigate(page, "专业与院校");
  await expect(
    page.getByRole("heading", { name: "全国研究生学科专业目录" }),
  ).toBeVisible();
});

test("question reviewers must explicitly complete all six checks before approving", async ({
  page,
}) => {
  await page.route("**/api/v1/admin/me", (route) =>
    route.fulfill({ json: { actorId: "reviewer-test", roles: ["reviewer"] } }),
  );
  await page.route("**/api/v1/admin/drafts/program", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/v1/admin/drafts/question", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            draftId: "question-batch",
            kind: "question",
            reviewStatus: "pending_review",
            reviewId: "review-test",
            authorId: "independent-editor",
            etag: '"test-version"',
            content: {},
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          accountId: "reviewer-test",
          username: "reviewer",
          role: "admin",
          adminRoles: ["reviewer"],
        },
        csrfToken: "test-csrf",
        guest: false,
        guestHasData: false,
        features: { sampleData: true, modelEnabled: false },
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("资料类型").selectOption("question");
  await page
    .getByLabel("审核 / 发布说明")
    .fill("已逐项核对题库来源、答案与适用范围。");
  const approve = page.getByRole("button", { name: "批准", exact: true });
  await expect(approve).toBeDisabled();
  const checks = page
    .getByRole("group", { name: "题库发布前逐项人工核验" })
    .getByRole("checkbox");
  await expect(checks).toHaveCount(6);
  for (let index = 0; index < 5; index += 1) await checks.nth(index).check();
  await expect(approve).toBeDisabled();
  await checks.nth(5).check();
  await expect(approve).toBeEnabled();
  await checks.nth(0).uncheck();
  await expect(approve).toBeDisabled();
});

test("new catalog majors and admission years can be explored, confirmed and recommended without a frontend mapping", async ({
  page,
}) => {
  const requestedSnapshots: string[] = [];
  await page.route("**/api/v1/programs**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${url.origin}${url.pathname}` });
    const catalog = await response.json();
    const template = catalog.items[0];
    const added = {
      ...template,
      programId: "expanded-environment-2028",
      programRevisionId: "expanded-environment-2028-r1",
      majorDirectionIds: ["environmental-science"],
      display: {
        ...template.display,
        institutionName: "扩建测试大学",
        shortName: "扩测",
        majorName: "环境科学与工程",
        directionName: "环境科学与工程",
      },
      identity: {
        ...template.identity,
        institutionId: "expanded-institution",
        majorCode: "083000",
        targetAdmissionYear: 2028,
        degreeType: "academic",
      },
    };
    const isSecondPage = url.searchParams.has("cursor");
    if (isSecondPage) {
      expect(url.searchParams.get("cursor")).toBe("expanded-next-page");
      requestedSnapshots.push(url.searchParams.get("catalogVersion") ?? "");
    }
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...catalog.items[index % catalog.items.length],
      programId: `first-page-${index}`,
      programRevisionId: `first-page-${index}-r1`,
    }));
    await route.fulfill({
      response,
      json: {
        ...catalog,
        catalogVersion: "expanded-snapshot-v1",
        items: isSecondPage ? [added] : firstPage,
        nextCursor: isSecondPage ? null : "expanded-next-page",
        coverage: { ...catalog.coverage, years: [2027, 2028] },
      },
    });
  });
  await page.route("**/api/v1/me/selections", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      json: { ...route.request().postDataJSON(), selectionVersion: 1 },
      headers: { ETag: '"expanded-major-test"' },
    });
  });
  await page.route("**/api/v1/recommendations", (route) =>
    route.fulfill({
      json: {
        recommendationRunId: "expanded-test",
        items: [],
        pendingVerification: [],
        exclusionReasons: [],
        catalogVersion: "expanded-test",
        ruleVersion: "expanded-test",
        degreeAdvice: {
          inclination: "undetermined",
          reasons: ["具体项目的培养资料不足，暂不能给出学位倾向。"],
        },
      },
    }),
  );
  await openWorkspace(page);
  expect(requestedSnapshots).toEqual(["expanded-snapshot-v1"]);
  await page.getByLabel("搜索全国专业").fill("环境科学与工程");
  const direction = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "环境科学与工程",
      exact: true,
      level: 3,
    }),
  });
  await expect(direction).toBeVisible();
  const confirmation = page.waitForRequest(
    (request) =>
      request.url().endsWith("/me/selections") && request.method() === "PUT",
  );
  await direction.getByRole("button", { name: "确认报考专业" }).click();
  expect((await confirmation).postDataJSON().confirmedMajorId).toBe("0830");
  await expect(
    direction.getByRole("button", { name: "已确认 · 取消" }),
  ).toBeVisible();
  // Confirming a national discipline immediately filters annual projects.
  await expect(page.locator(".ws-school")).toHaveCount(1);
  await direction.getByRole("button", { name: "查看招生项目" }).click();
  await page
    .getByRole("combobox", { name: "招生年份", exact: true })
    .selectOption("2027");
  await expect(
    page.getByRole("heading", { name: "当前条件下没有项目" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "招生年份", exact: true })
    .selectOption("2028");
  await page
    .getByRole("combobox", { name: "学位类型", exact: true })
    .selectOption("professional");
  await expect(
    page.getByRole("heading", { name: "当前条件下没有项目" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "学位类型", exact: true })
    .selectOption("academic");
  await expect(
    page.getByRole("button", { name: "扩建测试大学", exact: true }),
  ).toBeVisible();
  const recommendation = page.waitForRequest(
    (request) =>
      request.url().endsWith("/recommendations") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "生成联合推荐" }).click();
  expect((await recommendation).postDataJSON()).toMatchObject({
    targetAdmissionYear: 2028,
    filters: {
      disciplineCodes: ["0830"],
      degreeTypes: ["academic"],
    },
  });
  await expect(
    page.getByText("具体项目的培养资料不足，暂不能给出学位倾向。", {
      exact: true,
    }),
  ).toBeVisible();
});

test("catalog pagination rejects a mixed snapshot and keeps other workspace pages usable", async ({
  page,
}) => {
  await page.route("**/api/v1/programs**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${url.origin}${url.pathname}` });
    const catalog = await response.json();
    const second = url.searchParams.has("cursor");
    await route.fulfill({
      response,
      json: {
        ...catalog,
        catalogVersion: second
          ? "unexpected-new-snapshot"
          : "fixed-old-snapshot",
        nextCursor: second ? null : "second-page",
      },
    });
  });
  await openWorkspace(page);
  await expect(page.getByRole("alert")).toContainText(
    "目录版本在读取过程中变化",
  );
  await expect(
    page.getByRole("heading", { name: "当前条件下没有项目" }),
  ).toBeVisible();
  await navigate(page, "个人画像");
  await expect(page.getByLabel("称呼（选填）")).toBeVisible();
});
