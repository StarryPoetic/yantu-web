import { test, expect, type Page } from "@playwright/test";
import { registerAccount } from "./helpers/account";

async function admin(page: Page, roles: string[]) {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: {
          accountId: "review-ui",
          username: "review-ui",
          role: "admin",
          adminRoles: roles,
        },
        csrfToken: "test-csrf",
        guest: false,
        guestHasData: false,
        features: { sampleData: true, modelEnabled: false },
      },
    }),
  );
  await page.route("**/api/v1/admin/me", (route) =>
    route.fulfill({ json: { actorId: "review-ui", roles } }),
  );
  await page.route("**/api/v1/admin/drafts/program", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

test("reviewer handles a correction with its version and user can read the resolution", async ({
  page,
}) => {
  let item = {
    correctionId: "c1",
    description: "测试：核对机械专业科目",
    status: "pending",
    resolution: "",
    etag: '"v1"',
  };
  await admin(page, ["reviewer"]);
  await page.route("**/api/v1/admin/corrections", (route) =>
    route.fulfill({ json: { items: [item] } }),
  );
  await page.route("**/api/v1/admin/corrections/c1", async (route) => {
    expect(route.request().headers()["if-match"]).toBe('"v1"');
    expect(route.request().method()).toBe("PATCH");
    item = { ...item, ...route.request().postDataJSON(), etag: '"v2"' };
    await route.fulfill({ json: item });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "读取纠错队列" }).click();
  await page.getByLabel("处理状态").selectOption("reviewing");
  await page
    .getByLabel("处理说明", { exact: true })
    .fill("已登记，等待原文复核。");
  await page.getByRole("button", { name: "保存处理结果" }).click();
  await expect(page.getByLabel("处理说明", { exact: true })).toHaveValue(
    "已登记，等待原文复核。",
  );
  await expect(page.getByRole("button", { name: "刷新发布记录" })).toHaveCount(
    0,
  );
  await page.unroute("**/api/v1/auth/session");
  await registerAccount(page);
  await page.route("**/api/v1/me/corrections", (route) =>
    route.fulfill({ json: { items: [item] } }),
  );
  await page.goto("/#explore");
  await page.reload();
  await page.getByText("我的纠错处理记录", { exact: true }).click();
  await page.getByRole("button", { name: "刷新我的纠错" }).click();
  await expect(
    page.getByText("处理说明：已登记，等待原文复核。", { exact: true }),
  ).toBeVisible();
});

test("publisher must confirm withdrawal and can inspect persisted status and audit", async ({
  page,
}) => {
  await admin(page, ["publisher", "auditor"]);
  let item = {
    publicationId: "p1",
    kind: "catalog",
    version: "synthetic-v1",
    status: "succeeded",
    summary: "模拟发布记录",
  };
  await page.route("**/api/v1/admin/publications", (route) =>
    route.fulfill({ json: { items: [item] } }),
  );
  await page.route(
    "**/api/v1/admin/publications/p1/withdraw",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        reason: "测试原文待核验",
      });
      item = { ...item, status: "withdrawn" };
      await route.fulfill({ json: item });
    },
  );
  await page.route("**/api/v1/admin/audit-events", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "a1",
            actor: "review-ui",
            action: "publication.withdraw",
            objectId: "p1",
            at: "2026-11-11T00:00:00Z",
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "刷新发布记录" }).click();
  await page.getByRole("button", { name: "撤回此发布" }).click();
  await expect(
    page.getByRole("button", { name: "确认撤回发布" }),
  ).toBeDisabled();
  await page.getByLabel("撤回原因", { exact: true }).fill("测试原文待核验");
  await page.getByLabel("我已核对撤回范围").check();
  await page.getByRole("button", { name: "确认撤回发布" }).click();
  await expect(page.getByText("状态：已撤回", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "读取审计记录" }).click();
  await expect(
    page.getByRole("cell", { name: "publication.withdraw", exact: true }),
  ).toBeVisible();
});
