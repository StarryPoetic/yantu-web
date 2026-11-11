import { test, expect, type Page } from "@playwright/test";
import { registerAccount, loginAccount } from "./helpers/account";
import { resolve } from "node:path";
import { createApplication } from "../server/app";

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

test("a real auditor-only account reaches read-only publication and audit views without requesting drafts", async ({
  browser,
}) => {
  const origins: string[] = [];
  const app = await createApplication({
    databasePath: ":memory:",
    sampleData: true,
    staticDirectory: resolve("dist"),
    origins,
    secureCookies: false,
    admins: [],
    bootstrapAdmins: [
      {
        username: "auditor_only",
        password: "Auditor-Test-Password-2026!",
        roles: ["auditor"],
      },
    ],
  });
  // Isolated synthetic listing only; no actual catalog, rule or bank is published.
  app.store.put("administration", "publication", "audit-only-fixture", {
    publicationId: "audit-only-fixture",
    kind: "catalog",
    version: "audit-only-synthetic-v1",
    status: "succeeded",
    summary: "仅供独立审计页面测试的合成发布记录",
  });
  app.store.audit("synthetic-fixture", "audit.fixture", "audit-only-fixture");
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
  const page = await context.newPage();
  const requestedDrafts: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/admin/drafts"))
      requestedDrafts.push(request.url());
  });
  try {
    await loginAccount(page, {
      username: "auditor_only",
      password: "Auditor-Test-Password-2026!",
    });
    await expect(page.getByText(/当前管理身份：.*权限：审计/)).toBeVisible();
    await page.getByRole("button", { name: "刷新发布记录" }).click();
    await expect(
      page.getByText("audit-only-synthetic-v1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "读取审计记录" }).click();
    await expect(
      page.getByRole("cell", { name: "audit.fixture", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "导入与编辑草稿" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "人工复核队列" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "撤回此发布" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "读取成绩审核队列" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "读取纠错队列" }),
    ).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(requestedDrafts).toEqual([]);
    // The UI fix keeps the server's draft confidentiality boundary intact.
    expect(
      (await page.request.get("/api/v1/admin/drafts/program")).status(),
    ).toBe(403);
    const session = await (
      await page.request.get("/api/v1/auth/session")
    ).json();
    expect(
      (
        await page.request.post(
          "/api/v1/admin/publications/audit-only-fixture/withdraw",
          {
            headers: {
              Origin: baseURL,
              "X-CSRF-Token": session.csrfToken,
              "Idempotency-Key": "auditor-denied-withdrawal",
            },
            data: { reason: "审计身份不得执行此合成撤回" },
          },
        )
      ).status(),
    ).toBe(403);
  } finally {
    await context.close();
    await app.close();
  }
});
