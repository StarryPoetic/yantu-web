import { test, expect } from "@playwright/test";
import { registerAccount, loginAccount } from "./helpers/account";

test("T3-03 account drafts survive navigation and refresh, stay unsaved, and are isolated", async ({
  page,
}) => {
  const account = await registerAccount(page);
  await page.goto("/#profile");
  const major = page.getByRole("textbox", { name: "本科专业", exact: true });
  await major.fill("此修改未保存");
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "基础测评", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "个人画像", exact: true })
    .click();
  await expect(major).toHaveValue("此修改未保存");
  await expect(
    page.getByRole("status").filter({ hasText: "有未保存的画像草稿" }),
  ).toBeVisible();
  await page.reload();
  await expect(major).toHaveValue("此修改未保存");
  expect(
    (await (await page.request.get("/api/v1/me/profile")).json()).profile.major,
  ).toBe("");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到研途" }),
  ).toBeVisible();
  const other = await registerAccount(page);
  await page.goto("/#profile");
  await page.reload();
  await expect(major).toHaveValue("");
  await major.fill("其他账号草稿");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到研途" }),
  ).toBeVisible();
  await loginAccount(page, account);
  await expect(major).toHaveValue("此修改未保存");
  await page.getByRole("button", { name: "放弃画像草稿", exact: true }).click();
  await expect(major).toHaveValue("");
  await page.reload();
  await expect(major).toHaveValue("");
  await major.fill("保存后的值");
  await page.getByRole("button", { name: "保存个人画像", exact: true }).click();
  await expect(page).toHaveURL(/#assessment$/);
  await page.goto("/#profile");
  await expect(major).toHaveValue("保存后的值");
  await expect(
    page.getByText("有未保存的画像草稿", { exact: false }),
  ).toHaveCount(0);
  expect(other.username).not.toBe(account.username);
});

test("T3-04 hidden favorites retain their real count and can be revealed after navigation and refresh", async ({
  page,
}) => {
  await registerAccount(page);
  await page.goto("/#explore");
  await page.getByLabel("显示未核验的交互示例项目（仅体验流程）").check();
  await page
    .getByRole("button", { name: /^收藏.+/ })
    .first()
    .click();
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "我的收藏", exact: true })
    .click();
  await expect(
    page.getByText("共收藏 1 项，其中 1 项被当前条件隐藏", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("共收藏 1 项，其中 1 项被当前条件隐藏", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "显示全部已收藏项目", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "示例 · 待核验" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("共收藏 1 项，其中 0 项被当前条件隐藏", { exact: true }),
  ).toBeVisible();
});
