import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers/account";

test("悬浮咨询支持任意问题、多轮记录、收起恢复、清空和手机视口", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAccount(page);
  await page.goto("/");
  await page.getByRole("button", { name: "打开咨询助手", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "研途咨询助手" });
  await expect(
    panel.getByRole("heading", { name: "有什么想聊的？" }),
  ).toBeVisible();
  await panel
    .getByLabel("发送消息", { exact: true })
    .fill("帮我写一段周末散步的文字");
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await expect(panel.getByLabel("助手回答", { exact: true })).toContainText(
    "没有启用模型对话",
  );
  await panel
    .getByLabel("发送消息", { exact: true })
    .fill("接着把语气写得轻松一点");
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await expect(panel.getByLabel("我的消息", { exact: true })).toHaveCount(2);
  await expect(panel.getByLabel("助手回答", { exact: true })).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/floating-assistant-mobile.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开咨询助手", exact: true }),
  ).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: "打开咨询助手", exact: true }).click();
  await expect(panel.getByLabel("我的消息", { exact: true })).toHaveCount(2);
  await panel
    .getByRole("button", { name: "清空当前对话", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "确认清空当前对话", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "有什么想聊的？" }),
  ).toBeVisible();
  await expect(panel.getByLabel("我的消息", { exact: true })).toHaveCount(0);
});

test("逐题提示不提前给答案，交卷后显示行列式公式、图示和每题追问", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAccount(page);
  await page.goto("/#assessment");
  await page.getByLabel("英语 · 5 题", { exact: true }).uncheck();
  await page.getByLabel("政治 · 5 题", { exact: true }).uncheck();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/assessment-attempts") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "开始公共课测评 · 5 题", exact: true })
    .click();
  const attempt = await (await created).json();
  const index = attempt.questions.findIndex(
    (question: { id: string }) => question.id === "v2-m4",
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await page
    .getByRole("navigation", { name: "题号导航" })
    .getByRole("button", { name: "第" + (index + 1) + "题", exact: true })
    .click();
  await expect(page.locator("legend").getByRole("math")).toBeVisible();
  await expect(page.getByRole("img", { name: /二阶矩阵位置示意/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".ws-assessment .tutor-visuals")).toHaveCount(0);
  expect(
    attempt.questions[index].stem.map((part: { kind: string }) => part.kind),
  ).toEqual(["text", "math", "text"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".ws-assessment")
    .screenshot({ path: "test-results/determinant-inline-stem-mobile.png" });
  await page
    .getByRole("button", { name: "本题知识点提示", exact: true })
    .click();
  await expect(
    page.getByText("作答中仅提供知识点与方法提示，不显示答案或本题代入结果。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("标准答案：", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("针对这道题继续追问")).toHaveCount(0);
  await page.getByRole("radio").first().check();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  const wrongIndex = attempt.questions.findIndex(
    (question: { id: string }) => question.id === "v2-m1",
  );
  await page
    .getByRole("navigation", { name: "题号导航" })
    .getByRole("button", { name: "第" + (wrongIndex + 1) + "题", exact: true })
    .click();
  await page.getByRole("radio").first().check();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  await page.getByLabel("确认有未答题，仍提交本次测评").check();
  await page.getByRole("button", { name: "主动提交测评", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你的下一步练习方向" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "本题辅助讲解与追问", exact: true }),
  ).toHaveCount(1);
  const grid = page.getByRole("navigation", { name: "答题结果总览" });
  await expect(grid.getByRole("button")).toHaveCount(5);
  await expect(grid.getByRole("button", { name: /，答对$/ })).toHaveCount(1);
  await expect(grid.getByRole("button", { name: /，答错$/ })).toHaveCount(1);
  await expect(grid.getByRole("button", { name: /，未答$/ })).toHaveCount(3);
  const correctCell = grid.getByRole("button", {
    name: "第" + (index + 1) + "题，答对",
    exact: true,
  });
  await expect(correctCell).toHaveClass(/correct/);
  await expect(
    grid.getByRole("button", {
      name: "第" + (wrongIndex + 1) + "题，答错",
      exact: true,
    }),
  ).toHaveClass(/incorrect/);
  await correctCell.click();
  await expect(correctCell).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".tutor-completed-question")).toHaveCount(1);
  const item = page.locator(".tutor-completed-question");
  await expect(item.getByText(/标准答案：/)).toBeVisible();
  await expect(item.getByText("你的答案：A. 6", { exact: true })).toBeVisible();
  await expect(
    item.getByRole("img", { name: /二阶矩阵位置示意/ }),
  ).toBeVisible();
  await expect(item.getByRole("math")).toHaveCount(3);
  await grid.screenshot({
    path: "test-results/assessment-result-grid-mobile.png",
  });
  await item
    .getByRole("button", { name: "本题辅助讲解与追问", exact: true })
    .click();
  await expect(
    item.getByRole("heading", { name: "本题固定解析", exact: true }),
  ).toBeVisible();
  await item.getByLabel("针对这道题继续追问").fill("为什么使用对角线的乘积？");
  await item.getByRole("button", { name: "发送本题追问", exact: true }).click();
  await expect(
    item.getByText("为什么使用对角线的乘积？", { exact: true }),
  ).toBeVisible();
  await expect(
    item.getByText("模型暂不可用，已保留本题固定解析。", { exact: true }),
  ).toBeVisible();
  await grid
    .getByRole("button", {
      name: "第" + (wrongIndex + 1) + "题，答错",
      exact: true,
    })
    .click();
  await expect(
    item.getByText("为什么使用对角线的乘积？", { exact: true }),
  ).toHaveCount(0);
  await expect(item.getByLabel("针对这道题继续追问")).toHaveCount(0);
  await item
    .getByRole("button", { name: "本题辅助讲解与追问", exact: true })
    .click();
  await item.getByLabel("针对这道题继续追问").fill("导数题如何检查计算？");
  const followup = page.waitForRequest(
    (request) =>
      request.url().endsWith("/tutor") &&
      request.postDataJSON().message === "导数题如何检查计算？",
  );
  await item.getByRole("button", { name: "发送本题追问", exact: true }).click();
  expect((await followup).postDataJSON().questionId).toBe("v2-m1");
  await expect(
    item.getByText("导数题如何检查计算？", { exact: true }),
  ).toBeVisible();
  await correctCell.click();
  await expect(
    item.getByText("导数题如何检查计算？", { exact: true }),
  ).toHaveCount(0);
  await grid.getByRole("button").first().click();
  await expect(item.getByRole("button", { name: "上一题解析" })).toBeDisabled();
  await item.getByRole("button", { name: "下一题解析" }).click();
  await expect(grid.getByRole("button").nth(1)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await grid.getByRole("button").last().click();
  await expect(item.getByRole("button", { name: "下一题解析" })).toBeDisabled();
  await correctCell.click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await item.screenshot({
    path: "test-results/determinant-question-tutor.png",
  });
});

test("自然多段回答支持安全公式与可核对来源，不把文本作为 HTML", async ({
  page,
}) => {
  await registerAccount(page);
  let version = 0;
  const messages: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
    sources?: unknown[];
    status?: string;
  }[] = [];
  await page.route("**/api/v1/assistant/conversation", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      messages.push({
        id: "u" + ++version,
        role: "user",
        content: input.message,
        createdAt: new Date().toISOString(),
      });
      messages.push({
        id: "a" + version,
        role: "assistant",
        content:
          "第一段：行列式是一个数。\n\n第二段：二阶计算可以写为 $$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}=ad-bc$$。\n\n第三段：用几何面积理解。\n\n第四段：继续你的上一条问题。\n\n第五段：资料参考 [web-1]。<img src=x onerror=alert(1)>",
        createdAt: new Date().toISOString(),
        status: "model",
        sources: [
          {
            id: "web-1",
            title: "官方数学课程资料",
            url: "https://www.chsi.com.cn/",
            retrievedAt: new Date().toISOString(),
            kind: "official_page",
            excerpt: "二阶行列式的定义与计算示例。",
            verified: false,
          },
        ],
      });
    }
    await route.fulfill({
      contentType: "application/json",
      headers: { ETag: '"' + version + '"' },
      body: JSON.stringify({
        conversationId: "test-conversation",
        version,
        messages,
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开咨询助手", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "研途咨询助手" });
  await panel
    .getByLabel("发送消息", { exact: true })
    .fill("完整解释行列式，并给出公式");
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await expect(panel.getByText(/第五段：资料参考/)).toBeVisible();
  await expect(panel.locator(".katex")).toBeVisible();
  await expect(panel.locator(".assistant-message img")).toHaveCount(0);
  await panel.getByText("本次参考资料 · 1 条", { exact: true }).click();
  await expect(
    panel.getByRole("link", { name: "[web-1] 官方数学课程资料" }),
  ).toHaveAttribute("href", "https://www.chsi.com.cn/");
  await expect(
    panel.getByText("二阶行列式的定义与计算示例。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/floating-assistant-formula.png",
    fullPage: false,
  });
});
