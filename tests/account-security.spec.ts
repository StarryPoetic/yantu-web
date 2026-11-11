import { test, expect } from "@playwright/test";
import { registerAccount, loginAccount } from "./helpers/account";

test("user changes password recovers with one-time code and explicitly deletes their account", async ({
  page,
}) => {
  const account = await registerAccount(page);
  await page.goto("/");
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await page.getByLabel("当前密码", { exact: true }).fill(account.password);
  await page
    .getByLabel("新密码", { exact: true })
    .fill("Browser-New-Password-2026!");
  await page
    .getByLabel("确认新密码", { exact: true })
    .fill("Browser-New-Password-2026!");
  await page.getByRole("button", { name: "更新密码", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "密码已更新" }),
  ).toBeVisible();
  await page
    .getByLabel("当前密码", { exact: true })
    .fill("Browser-New-Password-2026!");
  await page.getByRole("button", { name: "生成或替换恢复码" }).click();
  const recovery = page.getByLabel("账号恢复码", { exact: true });
  await expect(recovery).toHaveText(/^[A-Za-z0-9_-]{43}$/);
  const code = await recovery.innerText();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "忘记密码 / 使用恢复码" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(account.username);
  await page.getByLabel("一次性恢复码", { exact: true }).fill(code);
  await page
    .getByLabel("新密码", { exact: true })
    .fill("Browser-Recovered-Password-2026!");
  await page
    .getByLabel("确认新密码", { exact: true })
    .fill("Browser-Recovered-Password-2026!");
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/密码已重置/);
  await page.getByRole("button", { name: "返回登录" }).click();
  await loginAccount(page, {
    ...account,
    password: "Browser-Recovered-Password-2026!",
  });
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认注销账号", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("当前密码", { exact: true })
    .fill("Browser-Recovered-Password-2026!");
  await page.getByLabel("我确认注销账号及全部个人资料").check();
  await page.getByRole("button", { name: "确认注销账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到研途" }),
  ).toBeVisible();
  await page.getByLabel("用户名", { exact: true }).fill(account.username);
  await page
    .getByLabel("密码", { exact: true })
    .fill("Browser-Recovered-Password-2026!");
  await page.getByRole("button", { name: "登录并继续", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("用户名或密码不正确");
});
