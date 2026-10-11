import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveSubjectAdvice,
  type AssessmentEvidence,
} from "../../shared/assessment-advice.ts";

const points = {
  math: [
    "高数：积分",
    "线性代数：秩",
    "概率统计：方差",
    "数一拓展：空间",
    "经济应用：弹性",
  ],
  english: [
    "英语阅读：推断",
    "英语长难句：从句",
    "英语翻译：限定",
    "英语写作：论证",
  ],
};
export function evidence(
  module: "math" | "english",
  correctByArea: number[],
): AssessmentEvidence {
  const items = correctByArea.flatMap((correct, area) =>
    Array.from({ length: 100 }, (_, i) => ({
      module,
      point: points[module][area],
      outcome: i < correct ? ("correct" as const) : ("incorrect" as const),
    })),
  );
  const correct = correctByArea.reduce((a, b) => a + b, 0);
  return {
    modules: [
      {
        module,
        correct,
        incorrect: items.length - correct,
        unanswered: 0,
        total: items.length,
      },
    ],
    items,
  };
}

test("V3B exact math thresholds cover all four routes and math-one/math-three ties", () => {
  const cases: [number[], string][] = [
    [[100, 100, 100, 100, 100], "math-one"],
    [[80, 80, 60, 100, 80], "math-one"],
    [[80, 80, 60, 100, 79], "math-three"],
    [[100, 100, 100, 60, 100], "math-one"],
    [[100, 100, 100, 59, 100], "math-three"],
    [[60, 60, 100, 100, 100], "math-one"],
    [[59, 59, 100, 100, 100], "math-three"],
    [[100, 100, 60, 100, 100], "math-one"],
    [[100, 100, 59, 100, 100], "math-two"],
    [[50, 50, 60, 80, 60], "math-three"],
    [[50, 50, 60, 79, 60], "math-two"],
    [[50, 50, 100, 100, 100], "math-three"],
    [[49, 49, 100, 100, 100], "math-two"],
    [[50, 50, 100, 100, 60], "math-three"],
    [[50, 50, 100, 100, 59], "math-two"],
    [[40, 40, 40, 40, 40], "math-two"],
    [[39, 39, 39, 39, 39], "math-none"],
    [[40, 40, 50, 50, 50], "math-two"],
    [[39, 39, 50, 50, 50], "math-none"],
    [[0, 0, 0, 0, 0], "math-none"],
  ];
  for (const [scores, expected] of cases)
    assert.equal(
      deriveSubjectAdvice(evidence("math", scores)).math.subject,
      expected,
      JSON.stringify(scores),
    );
});

test("V3B English exact overall, reading/sentence and translation/writing boundaries", () => {
  for (const [scores, expected] of [
    [[80, 80, 80, 80], "english-one"],
    [[79, 80, 80, 80], "english-two"],
    [[75, 100, 100, 100], "english-one"],
    [[74, 100, 100, 100], "english-two"],
    [[100, 75, 100, 100], "english-one"],
    [[100, 74, 100, 100], "english-two"],
    [[100, 100, 50, 100], "english-one"],
    [[100, 100, 49, 100], "english-two"],
    [[100, 100, 100, 50], "english-one"],
    [[100, 100, 100, 49], "english-two"],
    [[0, 0, 0, 0], "english-two"],
  ] as [number[], string][])
    assert.equal(
      deriveSubjectAdvice(evidence("english", scores)).english.subject,
      expected,
      JSON.stringify(scores),
    );
});

test("V3B missing, unanswered, inconsistent and legacy evidence cannot silently become no-math", () => {
  assert.equal(deriveSubjectAdvice().math.subject, null);
  assert.equal(
    deriveSubjectAdvice(evidence("english", [100, 100, 100, 100])).math.subject,
    null,
  );
  const empty = evidence("math", [0, 0, 0, 0, 0]);
  empty.items!.forEach((i) => (i.outcome = "unanswered"));
  Object.assign(empty.modules[0], { incorrect: 0, unanswered: 500 });
  assert.equal(deriveSubjectAdvice(empty).math.subject, null);
  const broken = evidence("math", [100, 100, 100, 100, 100]);
  broken.modules[0].total = 4;
  assert.equal(deriveSubjectAdvice(broken).math.subject, null);
  const old = evidence("math", [100, 100, 100, 100, 100]);
  old.items!.forEach((i) => (i.point = "导数的基本运算"));
  assert.equal(deriveSubjectAdvice(old).math.subject, null);
  const partial = evidence("math", [100, 100, 100, 100, 100]);
  partial.items!.forEach((i, index) => {
    if (index >= 300) i.outcome = "unanswered";
  });
  Object.assign(partial.modules[0], { correct: 300, unanswered: 200 });
  assert.equal(deriveSubjectAdvice(partial).math.subject, "math-two");
  partial.items![299].outcome = "unanswered";
  Object.assign(partial.modules[0], { correct: 299, unanswered: 201 });
  assert.equal(deriveSubjectAdvice(partial).math.subject, null);
});

test("V3B weaknesses sort by observed error rate, cap five, and keep unanswered points unassessed", () => {
  const input: AssessmentEvidence = {
    modules: [],
    items: [
      { module: "major", point: "研究方法：对照", outcome: "unanswered" },
      ...["A", "B", "C", "D", "E", "F"].flatMap((point, index) => [
        { module: "politics", point, outcome: "incorrect" as const },
        ...Array.from({ length: index }, () => ({
          module: "politics",
          point,
          outcome: "correct" as const,
        })),
      ]),
    ],
  };
  const original = structuredClone(input);
  const output = deriveSubjectAdvice(input);
  assert.deepEqual(
    output.improvements.map((p) => p.point),
    ["A", "B", "C", "D", "E"],
  );
  assert.ok(
    output.improvements.every(
      (p) => p.advice.includes(p.point) && p.status === "weak",
    ),
  );
  assert.deepEqual(input, original);
  assert.deepEqual(output, deriveSubjectAdvice(input));
  const unassessed = deriveSubjectAdvice({
    modules: [],
    items: input.items!.slice(0, 1),
  }).improvements[0];
  assert.equal(unassessed.status, "unassessed");
  assert.equal(unassessed.accuracy, null);
  assert.match(unassessed.advice, /先独立完成/);
});

test("V3B minimum sample and answered count boundaries keep skipped challenges from a high-route conclusion", () => {
  const input: AssessmentEvidence = {
    modules: [
      { module: "math", correct: 3, incorrect: 0, unanswered: 2, total: 5 },
    ],
    items: points.math.map((point, i) => ({
      module: "math",
      point,
      outcome: i < 3 ? "correct" : "unanswered",
    })),
  };
  assert.equal(deriveSubjectAdvice(input).math.subject, "math-two");
  input.items![2].outcome = "unanswered";
  Object.assign(input.modules[0], { correct: 2, unanswered: 3 });
  assert.equal(deriveSubjectAdvice(input).math.subject, null);
  const four: AssessmentEvidence = {
    modules: [
      { module: "english", correct: 4, incorrect: 0, unanswered: 0, total: 4 },
    ],
    items: points.english.map((point) => ({
      module: "english",
      point,
      outcome: "correct",
    })),
  };
  assert.equal(deriveSubjectAdvice(four).english.subject, null);
  four.items!.push({
    module: "english",
    point: points.english[0],
    outcome: "unanswered",
  });
  Object.assign(four.modules[0], { total: 5, unanswered: 1 });
  assert.equal(deriveSubjectAdvice(four).english.subject, "english-two");
});
