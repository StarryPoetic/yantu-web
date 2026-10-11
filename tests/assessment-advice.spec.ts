import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers/account";
import { loadQuestionBank } from "../server/assessment/index";
import { knowledgeArea } from "../shared/assessment-knowledge";
import type { PublicAttempt } from "../server/assessment/types";

const bank = await loadQuestionBank();
for (const scenario of [
  { label: "数一", wrong: [] },
  { label: "数三", wrong: ["math-one"] },
  { label: "数二", wrong: ["probability", "math-one", "economics"] },
  {
    label: "不考数学",
    wrong: ["calculus", "linear", "probability", "math-one", "economics"],
  },
]) {
  test(`V3B 375宽度真实测评展示${scenario.label}初步建议、英语建议与加强任务`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await registerAccount(page);
    await page.goto("/#assessment");
    await page.getByLabel("政治 · 5 题", { exact: true }).uncheck();
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/assessment-attempts") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "开始公共课测评 · 10 题", exact: true })
      .click();
    const attempt: PublicAttempt = await (await created).json();
    for (const [index, question] of attempt.questions.entries()) {
      const internal = bank.questions.find((q) => q.id === question.id)!;
      const area = knowledgeArea(question.module, question.point);
      const wrong =
        question.module === "math"
          ? scenario.wrong.includes(area)
          : scenario.label === "不考数学" && area === "reading";
      const option = wrong
        ? (internal.correct + 1) % internal.options.length
        : internal.correct;
      await expect(
        page
          .getByRole("navigation", { name: "题号导航" })
          .getByRole("button")
          .nth(index),
      ).toHaveAttribute("aria-current", "step");
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith(attempt.assessmentAttemptId) &&
          r.request().method() === "PATCH",
      );
      await page.getByRole("radio").nth(option).check();
      await saved;
      if (index === attempt.questions.length - 1)
        await expect(
          page.getByText("草稿已保存", { exact: true }),
        ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "主动提交测评", exact: true })
      .click();
    const advice = page.getByRole("region", { name: "考试科目 · 初步建议" });
    await expect(advice).toBeVisible();
    await expect(
      advice
        .getByRole("article", { name: "数学建议" })
        .getByRole("heading", { name: scenario.label, exact: true }),
    ).toBeVisible();
    await expect(
      advice.getByRole("article", { name: "英语建议" }).getByRole("heading", {
        name: scenario.label === "不考数学" ? "英二" : "英一",
        exact: true,
      }),
    ).toBeVisible();
    await expect(advice).toContainText("考试科目由学校专业规定");
    await expect(advice).toContainText("未经独立学科审校");
    if (scenario.wrong.length) {
      const tasks = advice
        .getByRole("list", { name: "接下来要加强的知识点" })
        .getByRole("listitem");
      expect(await tasks.count()).toBeGreaterThan(0);
      expect(await tasks.count()).toBeLessThanOrEqual(5);
      await expect(tasks.first()).toContainText("针对");
      await tasks.last().scrollIntoViewIfNeeded();
      await expect(tasks.last().locator("p")).toBeVisible();
      await advice
        .getByRole("list", { name: "接下来要加强的知识点" })
        .screenshot({
          path: `test-results/v3b-improvements-${scenario.label}-375.png`,
        });
    } else await expect(advice).toContainText("暂无错题");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await advice.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await advice.screenshot({
      path: `test-results/v3b-advice-${scenario.label}-375.png`,
    });
    await page.reload();
    await page.getByRole("button", { name: "查看记录", exact: true }).click();
    await expect(
      advice
        .getByRole("article", { name: "数学建议" })
        .getByRole("heading", { name: scenario.label, exact: true }),
    ).toBeVisible();
  });
}

test("V3B skipped mathematics and unanswered English remain pending on the result page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAccount(page);
  await page.goto("/#assessment");
  await page.getByLabel("数学 · 5 题", { exact: true }).uncheck();
  await page.getByLabel("政治 · 5 题", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "开始公共课测评 · 5 题", exact: true })
    .click();
  await page.getByLabel("确认有未答题，仍提交本次测评").check();
  await page.getByRole("button", { name: "主动提交测评", exact: true }).click();
  const advice = page.getByRole("region", { name: "考试科目 · 初步建议" });
  await expect(
    advice.getByRole("heading", { name: "待补充测评", exact: true }),
  ).toHaveCount(2);
  await expect(
    advice.getByRole("heading", { name: "不考数学", exact: true }),
  ).toHaveCount(0);
  await expect(advice.getByRole("listitem").first()).toContainText("待评估");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
