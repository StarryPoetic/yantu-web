import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const assets = await readdir(new URL("../dist/assets/", import.meta.url));
assert.ok(
  !assets.some((name) => /DemoApp|assessmentQuestions/.test(name)),
  "Production build must omit the offline demo.",
);
const javascript = (
  await Promise.all(
    assets
      .filter((name) => name.endsWith(".js"))
      .map((name) =>
        readFile(new URL(`../dist/assets/${name}`, import.meta.url), "utf8"),
      ),
  )
).join("\n");
const bank = JSON.parse(
  await readFile(
    new URL("../knowledge/questions/example-v1.json", import.meta.url),
    "utf8",
  ),
);
for (const question of bank.questions) {
  assert.ok(
    !javascript.includes(question.explanation),
    "Server-only answer explanations leaked into browser output.",
  );
}
for (const marker of [
  "DEEPSEEK_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "YANTU_ADMIN_CREDENTIALS",
  "node:sqlite",
])
  assert.ok(
    !javascript.includes(marker),
    `Server-only configuration leaked: ${marker}`,
  );
console.log("生产构建检查通过：未包含 Demo 答案或服务端配置。");
