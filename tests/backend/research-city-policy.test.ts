import test from "node:test";
import assert from "node:assert/strict";
import {
  sortCityRecommendations,
  validateCityPreferenceClaim,
} from "../../server/explanation/research-city-policy.ts";
import { ModelError } from "../../server/explanation/deepseek.ts";

const profile = { cities: ["杭州"], notes: "" };
const unsupported = (work: () => unknown) =>
  assert.throws(
    work,
    (error) =>
      error instanceof ModelError &&
      error.code === "UNSUPPORTED_RESEARCH_CLAIM",
  );

test("city matches lead only within the same holistic tier, with stable order and no input mutation", () => {
  const items = [
    {
      id: "preferred-away",
      tier: "preferred" as const,
      constraintChecks: [{ field: "cities", status: "mismatch" }],
    },
    {
      id: "alternative-away",
      tier: "alternative" as const,
      constraintChecks: [{ field: "cities", status: "mismatch" }],
    },
    { id: "alternative-unknown", tier: "alternative" as const },
    {
      id: "exploratory-local",
      tier: "exploratory" as const,
      constraintChecks: [{ field: "cities", status: "match" }],
    },
    {
      id: "alternative-local-1",
      tier: "alternative" as const,
      constraintChecks: [{ field: "cities", status: "match" }],
    },
    {
      id: "alternative-local-2",
      tier: "alternative" as const,
      constraintChecks: [{ field: "cities", status: "match" }],
    },
  ];
  const snapshot = structuredClone(items);
  assert.deepEqual(
    sortCityRecommendations(items).map(({ id }) => id),
    [
      "preferred-away",
      "alternative-local-1",
      "alternative-local-2",
      "alternative-away",
      "alternative-unknown",
      "exploratory-local",
    ],
  );
  assert.deepEqual(items, snapshot);
  assert.notEqual(sortCityRecommendations(items), items);
});

test("missing city evidence and budget matches do not create a city tie-break", () => {
  const items = [
    { id: "unknown", tier: "alternative" as const },
    {
      id: "budget-match",
      tier: "alternative" as const,
      constraintChecks: [{ field: "budget", status: "match" }],
    },
  ];
  assert.deepEqual(
    sortCityRecommendations(items).map(({ id }) => id),
    ["unknown", "budget-match"],
  );
});

test("an explicitly outside city cannot be called a match before or after the structured evidence check", () => {
  for (const statement of [
    "上海满足本人杭州城市偏好。",
    "上海区位满足就业与城市偏好。",
    "城市偏好与上海区位相符。",
  ]) {
    unsupported(() => validateCityPreferenceClaim(statement, profile));
    unsupported(() =>
      validateCityPreferenceClaim(statement, profile, "unknown"),
    );
  }
  unsupported(() =>
    validateCityPreferenceClaim("成都符合本人城市偏好。", { cities: ["西安"] }),
  );
  unsupported(() =>
    validateCityPreferenceClaim("武汉区位满足城市偏好。", {
      cities: ["长沙市"],
    }),
  );
});

test("generic match claims defer to the structured check and require match once city status is known", () => {
  validateCityPreferenceClaim("项目符合本人城市偏好。", profile);
  validateCityPreferenceClaim("项目符合本人城市偏好。", profile, "match");
  unsupported(() =>
    validateCityPreferenceClaim("项目符合本人城市偏好。", profile, "unknown"),
  );
  unsupported(() =>
    validateCityPreferenceClaim("城市偏好相符。", profile, "mismatch"),
  );
});

test("a supported preferred city and a mere university name are not treated as explicit outside-city claims", () => {
  validateCityPreferenceClaim("杭州市符合本人城市偏好。", profile, "match");
  validateCityPreferenceClaim("相比上海，杭州满足城市偏好。", profile, "match");
  validateCityPreferenceClaim("上海大学培养项目符合城市偏好。", profile);
});

test("outside-city differences and reasonable other strengths remain valid alternatives", () => {
  for (const statement of [
    "上海不符合杭州城市偏好，但专业方向与职业目标仍有联系，可作为备选。",
    "培养地点偏离意向城市，需要权衡异地生活成本。",
    "该专业有研究训练价值，城市是否符合偏好尚待核验。",
    "需核验是否符合城市偏好。",
    "并不符合城市偏好，仍需比较其他优势。",
    "不能认定通勤可接受。",
  ])
    validateCityPreferenceClaim(statement, profile, "mismatch");
});

test("conditional widening or explicitly asking about commuting is not asserted user consent", () => {
  for (const statement of [
    "若本人愿意放宽城市到上海，则可再比较培养项目。",
    "上海不是杭州，需接受通勤或住宿成本后才可作为备选。",
    "是否能够接受跨城通勤还需确认。",
    "如果愿意接受通勤，上海项目可作为外地备选。",
    "若放宽城市偏好后，上海可符合调整后的城市偏好。",
    "如果调整城市偏好到上海，则上海满足新的城市偏好。",
    "城市是否符合偏好还需确认。",
    "城市不符合偏好，但培养方向有优势。",
  ])
    validateCityPreferenceClaim(statement, profile, "mismatch");
});

test("a later commute condition cannot excuse an earlier false city preference claim", () => {
  for (const statement of [
    "上海符合本人城市偏好，但通勤是否可接受仍需确认。",
    "上海满足杭州城市偏好，若需要接受通勤请确认。",
  ]) {
    unsupported(() => validateCityPreferenceClaim(statement, profile));
    unsupported(() =>
      validateCityPreferenceClaim(statement, profile, "mismatch"),
    );
  }
});

test("commuting cannot be declared acceptable without real positive profile consent", () => {
  unsupported(() => validateCityPreferenceClaim("长三角通勤可接受。", profile));
  unsupported(() => validateCityPreferenceClaim("本人愿意跨城通勤。", profile));
  validateCityPreferenceClaim("长三角通勤可接受。", {
    ...profile,
    notes: "愿意接受跨城通勤。",
  });
  for (const notes of [
    "不接受跨城通勤。",
    "通勤不可接受。",
    "是否接受通勤待确认。",
    "愿意跨专业，但不愿意通勤。",
  ])
    unsupported(() =>
      validateCityPreferenceClaim("长三角通勤可接受。", { ...profile, notes }),
    );
});

test("profiles without a city preference do not acquire an invented geography restriction", () => {
  for (const cities of [[], ["不确定"], ["不限"], ["无偏好"], undefined])
    validateCityPreferenceClaim(
      "上海符合城市偏好，通勤可接受。",
      { cities },
      "unknown",
    );
});
