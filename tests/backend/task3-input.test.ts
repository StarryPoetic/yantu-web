import test from "node:test";
import assert from "node:assert/strict";
import { blankProfile, validateProfile } from "../../server/profile.ts";

test("T3-05 profile limits identify the Chinese field and preserve the 200/201 boundary", () => {
  for (const [key, label] of [
    ["name", "称呼"],
    ["university", "本科院校"],
    ["major", "本科专业"],
  ]) {
    assert.doesNotThrow(() =>
      validateProfile({ ...blankProfile(), [key]: "字".repeat(200) }),
    );
    assert.throws(
      () => validateProfile({ ...blankProfile(), [key]: "字".repeat(201) }),
      new RegExp(`${label}.*200`),
    );
  }
});
