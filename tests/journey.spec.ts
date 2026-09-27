import { expect, test, type Page } from "@playwright/test";
import {
  createTestAccount,
  loginAccount,
  registerAccount,
  registerAccountInUI,
} from "./helpers/account";

async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("注册后从空白画像开始，保存进入测评，刷新和另一浏览器登录恢复账号资料", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const account = await registerAccountInUI(page);
  await expect(
    page.getByRole("heading", { name: "为你的下一站，建立起点。" }),
  ).toBeVisible();
  await expect(page.getByLabel("称呼（选填）")).toHaveValue("");
  await expect(page.getByLabel("本科院校", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("本科专业", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("感兴趣的专业或领域（选填）")).toHaveValue("");
  await expect(
    page.getByText("个人画像尚未保存 · 版本 0", { exact: true }),
  ).toBeVisible();

  const choices = [
    ["毕业年份", String(new Date().getFullYear())],
    ["报考年份", String(new Date().getFullYear() + 1)],
    ["英语经历", "大学英语四级"],
    ["数学基础", "未系统学习高等数学"],
    ["每天可投入时间", "2–4 小时"],
    ["年度预算", "1–2 万元"],
    ["备考进度", "刚开始了解"],
    ["职业与学习目标", "公共服务与社会发展"],
  ] as const;
  for (const [label, value] of choices) {
    const field = page.getByRole("combobox", { name: label, exact: true });
    if (label === "报考年份") await expect(field).toHaveValue(/^20\d{2}$/);
    else await expect(field).toHaveValue("");
    await field.selectOption({ label: value });
  }
  await page.getByLabel("称呼（选填）").fill("法律探索同学");
  await page.getByLabel("本科院校", { exact: true }).fill("账号持久化测试大学");
  await page.getByLabel("本科专业", { exact: true }).fill("法学");
  await page.getByRole("button", { name: "保存个人画像", exact: true }).click();
  await expect(page).toHaveURL(/#assessment$/);
  await expect(
    page.getByRole("heading", { name: "选择本次测评模块" }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("准备进度")
      .getByRole("button", { name: /个人画像.*已保存/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始专业课测评", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "选择本次测评模块" }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("准备进度")
      .getByRole("button", { name: /个人画像.*已保存/ }),
  ).toBeVisible();
  await navigate(page, "个人画像");
  await expect(page.getByLabel("本科专业", { exact: true })).toHaveValue(
    "法学",
  );
  for (const [label, value] of choices)
    await expect(
      page.getByRole("combobox", { name: label, exact: true }),
    ).toHaveValue(value);
  await page.screenshot({
    path: testInfo.outputPath("account-profile-desktop.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到研途" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要导航" })).toBeHidden();
  const otherContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const otherPage = await otherContext.newPage();
    await loginAccount(otherPage, account);
    await expect(otherPage.getByLabel("称呼（选填）")).toHaveValue(
      "法律探索同学",
    );
    await expect(otherPage.getByLabel("本科院校", { exact: true })).toHaveValue(
      "账号持久化测试大学",
    );
    await expect(otherPage.getByLabel("本科专业", { exact: true })).toHaveValue(
      "法学",
    );
    await expect(
      otherPage.getByRole("combobox", { name: "职业与学习目标", exact: true }),
    ).toHaveValue("公共服务与社会发展");
    await expect(
      otherPage.getByText("个人画像已保存 · 版本 1", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "欢迎回到研途" }),
    ).toBeVisible();
    await otherPage.screenshot({
      path: testInfo.outputPath("account-profile-mobile.png"),
      fullPage: true,
    });
    await otherPage
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await expect(
      otherPage.getByRole("heading", { name: "欢迎回到研途" }),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test("注册入口不能选择管理员，学生导航和直接后台地址均不授予管理权限", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("group", { name: "登录或注册" })
    .getByRole("button", { name: "注册", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "创建你的研途账号" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  const forged = await page.request.post("/api/v1/auth/register", {
    headers: { Origin: new URL(page.url()).origin },
    data: { ...createTestAccount("forged"), role: "admin" },
  });
  expect(forged.status()).toBe(400);
  await registerAccountInUI(page);
  await expect(
    page.getByRole("navigation", { name: "主要导航" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /资料管理|管理工作台/ }),
  ).toHaveCount(0);
  await page.goto("/#admin");
  await expect(
    page.getByRole("heading", { name: "为你的下一站，建立起点。" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "每一项结论，都有来处。" }),
  ).toHaveCount(0);
  const denied = await page.request.get("/api/v1/admin/me");
  expect(denied.status()).toBe(403);
  const session = await page.request.get("/api/v1/auth/session");
  expect((await session.json()).user.role).toBe("student");
});

test("独立管理员账号使用同一登录入口后进入管理工作台", async ({ page }) => {
  await loginAccount(page, {
    username: "editor_account",
    password: "Test-Admin-Password-2026!",
  });
  await expect(
    page.getByText("研途 · 管理工作台", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "每一项结论，都有来处。" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "导入与编辑草稿" }),
  ).toBeVisible();
  await expect(page.getByText(/当前管理身份：.*权限：录入/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要导航" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel(/管理凭据|管理员令牌/)).toHaveCount(0);
  const session = await page.request.get("/api/v1/auth/session");
  expect((await session.json()).user.role).toBe("admin");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到研途" }),
  ).toBeVisible();
});

test("全国目录可探索法学和医学且不会自动确认专业", async ({ page }) => {
  await registerAccount(page);
  await page.goto("/#explore");
  const catalog = page.getByRole("region", { name: "全国专业目录" });
  await expect(
    catalog.getByRole("heading", { name: "全国研究生学科专业目录" }),
  ).toBeVisible();
  await expect(catalog.getByText(/^你尚未确认报考专业。/)).toBeVisible();
  await catalog.getByLabel("搜索全国专业").fill("法学");
  await expect(
    catalog.getByRole("heading", { name: "法学", exact: true }),
  ).toBeVisible();
  await expect(catalog.getByText(/^你尚未确认报考专业。/)).toBeVisible();
  await catalog.getByLabel("搜索全国专业").fill("医学");
  await catalog
    .getByRole("combobox", { name: "学位类别", exact: true })
    .selectOption({ label: "学术学位" });
  await expect(
    catalog.getByRole("heading", { name: "基础医学", exact: true }),
  ).toBeVisible();
  await expect(
    catalog.getByRole("heading", { name: "临床医学", exact: true }),
  ).toBeVisible();
  await expect(
    catalog.getByRole("button", { name: "已确认 · 取消", exact: true }),
  ).toHaveCount(0);
  await expect(catalog.getByText(/^你尚未确认报考专业。/)).toBeVisible();
  await navigate(page, "基础测评");
  await expect(
    page.getByRole("button", { name: "开始专业课测评", exact: true }),
  ).toBeDisabled();
});

test("未保存画像时引导补充，保存后访问推荐结论会自动生成并保留专业选择权", async ({
  page,
}) => {
  await registerAccount(page);
  await page.goto("/#guidance");
  await expect(
    page.getByRole("heading", { name: "先保存你的个人画像" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "基础探索提示" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "填写个人画像", exact: true }).click();
  await page.getByLabel("本科专业", { exact: true }).fill("法学");
  await page.getByLabel("感兴趣的专业或领域（选填）").fill("法学、公共管理");
  await page
    .getByRole("combobox", { name: "职业与学习目标", exact: true })
    .selectOption({ label: "公共服务与社会发展" });
  await page.getByRole("button", { name: "保存个人画像", exact: true }).click();
  await expect(page).toHaveURL(/#assessment$/);
  await page
    .getByRole("button", { name: "查看专业推荐结论", exact: true })
    .click();
  await expect(page).toHaveURL(/#guidance$/);
  const exploration = page.getByText("查看基础探索与专业选择", { exact: true });
  await expect(exploration).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "基础探索提示", includeHidden: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "解释基础探索依据", includeHidden: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "比较全国专业与院校", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新生成结论", exact: true }),
  ).toBeEnabled();
  await exploration.click();
  await expect(
    page.getByRole("heading", { name: "基础探索提示" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "公共课诊断如何影响建议" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "可进一步探索的专业类别" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "0301 法学", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "比较全国专业与院校", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "全国专业目录" })
      .getByText(/^你尚未确认报考专业。/),
  ).toBeVisible();
});
