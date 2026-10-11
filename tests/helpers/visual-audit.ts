import { expect, type Page } from "@playwright/test";

/** Rendered geometry and computed colours, independent of class/token values. */
export async function auditVisuals(page: Page, scene: string) {
  const result = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".workspace")!;
    const shown = (el: Element) => {
      if (el.closest('[inert], [aria-hidden="true"], svg, .katex, math'))
        return false;
      for (let p: Element | null = el; p; p = p.parentElement) {
        if (
          p.matches("details:not([open])") &&
          !p.querySelector(":scope > summary")?.contains(el)
        )
          return false;
      }
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // Clipped live-region text remains accessible, but has no painted glyphs.
      if (
        r.width <= 1 &&
        r.height <= 1 &&
        (s.clip !== "auto" || s.clipPath !== "none")
      )
        return false;
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
    };
    const describe = (el: Element) =>
      `${el.tagName}.${el.className}: ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 65)}`;
    const targets = [
      ...root.querySelectorAll("button, summary, input, select, textarea, a"),
    ]
      .filter(shown)
      .filter((el) => !el.matches('input[type="hidden"], input[type="range"]'));
    const small = targets.flatMap((el) => {
      const target = el.matches('input[type="checkbox"], input[type="radio"]')
        ? (el.closest("label") ?? el)
        : el;
      const r = target.getBoundingClientRect();
      return r.width < 39.9 || r.height < 39.9
        ? [`${describe(el)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`]
        : [];
    });
    const rgba = (value: string) => {
      const n = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      return [n[0], n[1], n[2], n[3] ?? 1];
    };
    const composite = (fg: number[], bg: number[]) =>
      fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = (rgb: number[]) =>
      rgb.slice(0, 3).reduce((sum, v, i) => {
        const s = v / 255;
        return (
          sum +
          (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][i]
        );
      }, 0);
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (x + 0.05) / (y + 0.05);
    };
    const background = (el: Element) => {
      const ancestors = [];
      for (let p: Element | null = el; p; p = p.parentElement)
        ancestors.unshift(p);
      return ancestors.reduce(
        (bg, p) => composite(rgba(getComputedStyle(p).backgroundColor), bg),
        [255, 255, 255],
      );
    };
    const textRects: { el: Element; text: string; r: DOMRect }[] = [];
    const contrast: string[] = [];
    let contrastSamples = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement!;
      if (
        !node.textContent?.trim() ||
        !shown(el) ||
        el.closest("style, script")
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(
        (r) => r.width > 0 && r.height > 0,
      );
      if (!rects.length) continue;
      const s = getComputedStyle(el);
      if (
        !el.closest(":disabled") &&
        !el.closest(".research-inputs:disabled")
      ) {
        const bg = background(el);
        const value = ratio(composite(rgba(s.color), bg), bg);
        const large =
          parseFloat(s.fontSize) >= 24 ||
          (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
        contrastSamples++;
        if (value + 0.01 < (large ? 3 : 4.5))
          contrast.push(`${describe(el)} ${value.toFixed(2)}:1`);
      }
      for (const r of rects) {
        // Actual visible viewport: overlays and sticky picker headers are tested at their rendered position.
        const boundary = root.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= Math.min(innerHeight, boundary.bottom))
          continue;
        if (el.closest(".interest-popup, .city-dropdown")) continue;
        textRects.push({ el, text: node.textContent.trim().slice(0, 30), r });
      }
    }
    const overlaps: string[] = [];
    for (let i = 0; i < textRects.length; i++)
      for (let j = i + 1; j < textRects.length; j++) {
        const a = textRects[i],
          b = textRects[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // A non-modal desktop consultation intentionally covers the page behind it.
        if (
          a.el.closest(".assistant-panel") !== b.el.closest(".assistant-panel")
        )
          continue;
        if (
          Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 1 &&
          Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 1
        )
          overlaps.push(`${a.text} / ${b.text}`);
      }
    const obscured = targets
      .filter((el) => el.tagName === "BUTTON" && !el.matches(":disabled"))
      .flatMap((el) => {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2,
          y = r.y + r.height / 2;
        const boundary = root.getBoundingClientRect();
        if (
          x < 0 ||
          x >= innerWidth ||
          y < 0 ||
          y >= Math.min(innerHeight, boundary.bottom) ||
          el.closest(".interest-popup, .city-dropdown")
        )
          return [];
        const hit = document.elementFromPoint(x, y);
        return hit &&
          !el.contains(hit) &&
          !hit.closest(".interest-popup, .city-dropdown, .assistant-panel")
          ? [describe(el)]
          : [];
      });
    return {
      overflow:
        Math.max(document.documentElement.scrollWidth, root.scrollWidth) >
        innerWidth,
      small,
      contrast,
      overlaps,
      obscured,
      contrastSamples,
    };
  });
  expect(result.overflow, `${scene}: horizontal overflow`).toBe(false);
  expect(result.small, `${scene}: target minimum 40×40`).toEqual([]);
  expect(result.overlaps, `${scene}: overlapping text`).toEqual([]);
  expect(result.obscured, `${scene}: obscured buttons`).toEqual([]);
  expect(
    result.contrastSamples,
    `${scene}: rendered text contrast samples`,
  ).toBeGreaterThan(5);
  expect(result.contrast, `${scene}: WCAG AA text contrast`).toEqual([]);
}
