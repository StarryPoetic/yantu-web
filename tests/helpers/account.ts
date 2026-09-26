import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export interface TestAccount {
  username: string;
  password: string;
}

export function createTestAccount(prefix = "journey"): TestAccount {
  return {
    username: `${prefix.slice(0, 12)}_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    password: "Journey-Password-2026!",
  };
}

/** Prepare an isolated account using this page's cookie jar. UI auth is tested separately. */
export async function registerAccount(
  page: Page,
  account = createTestAccount(),
): Promise<TestAccount> {
  const sessionResponse = await page.request.get("/api/v1/auth/session");
  await expect(sessionResponse).toBeOK();
  const session = await sessionResponse.json();
  const response = await page.request.post("/api/v1/auth/register", {
    headers: {
      Origin: new URL(sessionResponse.url()).origin,
      ...(session.csrfToken ? { "X-CSRF-Token": session.csrfToken } : {}),
    },
    data: { ...account, migrateGuestData: true },
  });
  expect(response.status()).toBe(201);
  return account;
}

export async function registerAccountInUI(
  page: Page,
  account = createTestAccount(),
): Promise<TestAccount> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎回到研途" }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "登录或注册" })
    .getByRole("button", { name: "注册", exact: true })
    .click();
  await page.getByLabel("用户名", { exact: true }).fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByLabel("确认密码", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "注册并开始", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
  return account;
}

export async function loginAccount(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎回到研途" }),
  ).toBeVisible();
  await page.getByLabel("用户名", { exact: true }).fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登录并继续", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
}
