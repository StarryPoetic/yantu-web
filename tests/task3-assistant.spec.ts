import { expect, test } from "@playwright/test";
import { registerAccount } from "./helpers/account";

test("T3-08 mobile consultation traps both Tab directions, makes background inert and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAccount(page);
  await page.goto("/#profile");
  const opener = page.getByRole("button", {
    name: "打开咨询助手",
    exact: true,
  });
  await opener.click();
  const panel = page.locator("#assistant-conversation-panel");
  const clear = panel.getByRole("button", {
    name: "清空当前对话",
    exact: true,
  });
  await expect(clear).toBeEnabled();
  await clear.focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await panel.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(clear).toBeFocused();
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAttribute("aria-modal", "true");
  expect(
    await page
      .locator(".ws-shell")
      .evaluate((element) => (element as HTMLElement).inert),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  expect(
    await page
      .locator(".ws-shell")
      .evaluate((element) => (element as HTMLElement).inert),
  ).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await opener.click();
  await expect(panel).toHaveAttribute("role", "complementary");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("T3-09 mobile consultation toolbar stays outside the actual reading viewport throughout a long page", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAccount(page);
  await page.goto("/#profile");
  const opener = page.getByRole("button", {
    name: "打开咨询助手",
    exact: true,
  });
  await expect(opener).toBeVisible();
  for (const fraction of [0, 0.35, 0.7, 1]) {
    await page
      .locator(".workspace")
      .evaluate(
        (element, fraction) =>
          (element.scrollTop = element.scrollHeight * fraction),
        fraction,
      );
    const reading = await page.locator(".workspace").boundingBox();
    const button = await opener.boundingBox();
    expect(reading!.y + reading!.height).toBeLessThanOrEqual(button!.y);
    expect(button!.y + button!.height).toBeLessThanOrEqual(812);
  }
  await page.getByRole("button", { name: "学硕和专硕有什么区别？" }).click();
  const close = page.getByRole("button", { name: "关闭弹窗" });
  await expect(close).toBeVisible();
  expect(
    await close.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
  ).toBe(true);
  await close.click();
  await page.screenshot({ path: info.outputPath("reading-safe-area.png") });
});
