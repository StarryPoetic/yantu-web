import { knowledgeArea, SCREENING_AREAS } from "./assessment-knowledge.ts";

export type MathSubject = "math-one" | "math-two" | "math-three" | "math-none";
export type EnglishSubject = "english-one" | "english-two";
export const SUBJECT_LABELS = {
  "math-one": "数一",
  "math-two": "数二",
  "math-three": "数三",
  "math-none": "不考数学",
  "english-one": "英一",
  "english-two": "英二",
} as const;

/** Product exploration thresholds, NOT calibrated ability or entrance-score estimates.
 * Compare exact ratios before rounding for display; bounds are inclusive.
 * Missing answers are unknown, never wrong. At least 3 of 5 must be answered.
 * Math one wins a tie with math three. No exam choice is an eligibility filter. */
export const SUBJECT_ADVICE_RULES = {
  version: "subject-advice-v1",
  minimumQuestions: 5,
  minimumAnswered: 3,
  minimumAnswerRate: 0.6,
  mathOneOverall: 0.8,
  mathOneCore: 0.6,
  mathOneExtension: 0.6,
  mathProbability: 0.6,
  mathThreeOverall: 0.6,
  mathThreeCore: 0.5,
  mathThreeEconomics: 0.6,
  mathTwoOverall: 0.4,
  mathTwoCore: 0.4,
  englishOneOverall: 0.8,
  englishOneCompletionRate: 1,
  englishOneReadingSentence: 0.75,
  englishOneTranslationWriting: 0.5,
  maxImprovements: 5,
  pointsPerMatchingSubject: 3,
} as const;

export interface AssessmentEvidence {
  modules: {
    module: string;
    correct: number;
    incorrect: number;
    unanswered: number;
    total: number;
  }[];
  items?: {
    module: string;
    point: string;
    outcome: "correct" | "incorrect" | "unanswered";
  }[];
  example?: boolean;
}
export interface SubjectSuggestion<T extends MathSubject | EnglishSubject> {
  subject: T | null;
  status: "ready" | "insufficient";
  label: "初步建议";
  reason: string;
  suitableMajors: string;
}
export interface SubjectAdvice {
  ruleVersion: typeof SUBJECT_ADVICE_RULES.version;
  math: SubjectSuggestion<MathSubject>;
  english: SubjectSuggestion<EnglishSubject>;
  improvements: {
    module: string;
    point: string;
    status: "weak" | "unassessed";
    accuracy: number | null;
    advice: string;
  }[];
  notice: string;
}

const R = SUBJECT_ADVICE_RULES;
const majors = {
  "math-one": "可优先比较要求数一的工科、理科相关学硕及部分专硕。",
  "math-two":
    "可优先比较要求数二的部分工科专硕及部分工科学硕；数二不考概率统计。",
  "math-three":
    "可优先比较要求数三的经济、管理类学硕及部分经管专硕，仍需掌握概率统计。",
  "math-none":
    "可先探索初试不考数学的文学、历史、哲学等部分文科专业（含学硕或专硕）。",
  "english-one":
    "可优先比较要求英一的多数相关学硕及部分专硕，具体以专业目录为准。",
  "english-two":
    "可优先比较要求英二的部分专硕，如部分经管、工程类项目；不能仅凭学位类型判断。",
} as const;
function pending<T extends MathSubject | EnglishSubject>(
  label: string,
): SubjectSuggestion<T> {
  return {
    subject: null,
    status: "insufficient",
    label: "初步建议",
    reason: `${label}未测、作答不足或知识域覆盖不足，请补充覆盖关键知识点的测评。`,
    suitableMajors: "暂不按本项缩小专业范围；未测不等于基础薄弱。",
  };
}
function suggestion<T extends MathSubject | EnglishSubject>(
  subject: T,
  reason: string,
): SubjectSuggestion<T> {
  return {
    subject,
    status: "ready",
    label: "初步建议",
    reason,
    suitableMajors: majors[subject],
  };
}

/** Reject inconsistent legacy/tampered summaries instead of inferring missing outcomes. */
export function moduleEvidence(
  evidence: AssessmentEvidence | undefined,
  module: "math" | "english",
) {
  const counts = evidence?.modules.filter((c) => c.module === module) ?? [];
  const items = evidence?.items?.filter((i) => i.module === module) ?? [];
  const c = counts[0];
  if (
    counts.length !== 1 ||
    !c ||
    ![c.total, c.correct, c.incorrect, c.unanswered].every(
      (v) => Number.isInteger(v) && v >= 0,
    ) ||
    c.total !== c.correct + c.incorrect + c.unanswered ||
    c.total !== items.length ||
    c.correct !== items.filter((i) => i.outcome === "correct").length ||
    c.incorrect !== items.filter((i) => i.outcome === "incorrect").length ||
    c.unanswered !== items.filter((i) => i.outcome === "unanswered").length
  )
    return null;
  const answered = c.correct + c.incorrect;
  if (
    c.total < R.minimumQuestions ||
    answered < R.minimumAnswered ||
    answered / c.total < R.minimumAnswerRate
  )
    return null;
  if (
    !SCREENING_AREAS[module].every((area) =>
      items.some((i) => knowledgeArea(module, i.point) === area),
    )
  )
    return null;
  const rate = (...areas: string[]) => {
    const subset = items.filter(
      (i) =>
        i.outcome !== "unanswered" &&
        (!areas.length || areas.includes(knowledgeArea(module, i.point))),
    );
    return subset.length
      ? subset.filter((i) => i.outcome === "correct").length / subset.length
      : null;
  };
  return { rate, correct: c.correct, answered, total: c.total };
}

const atLeast = (value: number | null, threshold: number) =>
  value !== null && value >= threshold;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function improvementAdvice(module: string, point: string, unassessed: boolean) {
  if (unassessed)
    return `先独立完成“${point}”的3道基础题并写出过程，再判断是否需要补习。`;
  const actions: Record<string, string> = {
    calculus: "重写公式的适用条件，完成3道求导或积分变式并逐步验算",
    linear: "用矩阵行变换复核结论，完成3道秩、方程组或二次型变式",
    probability: "列出事件与随机变量条件，先辨独立性，再练3道概率或方差题",
    "math-one": "先画空间图并确认积分区域与方向，再练3道空间几何或多重积分变式",
    economics: "先定义价格、产量和成本变量，写出目标函数，再求导检查经济含义",
    reading: "逐句标出转折与限定词，为每个选项定位原文证据，精读2篇短文",
    sentence: "划出主谓宾，括起从句并标明修饰对象，每天拆解3句后复述主干",
    translation: "先标出否定、比较和从句范围，翻译3句后对照解析检查逻辑关系",
    writing:
      "写一段含观点、理由和例子的短文，逐句检查衔接、语域与证据是否支持结论",
  };
  return `针对“${point}”，${actions[knowledgeArea(module, point)] ?? (module === "politics" ? "用自己的话解释概念，再分析2个情境并说明排除其他选项的理由" : "先列出研究变量、对照与可能偏差，再为一个案例设计验证步骤")}。`;
}

export function deriveSubjectAdvice(
  evidence?: AssessmentEvidence,
): SubjectAdvice {
  let math = pending<MathSubject>("数学"),
    english = pending<EnglishSubject>("英语");
  const m = moduleEvidence(evidence, "math");
  if (m && m.rate("calculus") !== null && m.rate("linear") !== null) {
    const score = m.rate()!;
    const core = m.rate("calculus", "linear");
    const basis = `数学已作答${m.answered}/${m.total}题，答对${m.correct}题（${percent(score)}）。`;
    if (
      atLeast(score, R.mathOneOverall) &&
      atLeast(core, R.mathOneCore) &&
      atLeast(m.rate("math-one"), R.mathOneExtension) &&
      atLeast(m.rate("probability"), R.mathProbability)
    ) {
      math = suggestion(
        "math-one",
        `${basis}高数、线代及数一拓展和概率题表现支持先探索数一范围。`,
      );
    } else if (
      atLeast(score, R.mathThreeOverall) &&
      atLeast(core, R.mathThreeCore) &&
      atLeast(m.rate("economics"), R.mathThreeEconomics) &&
      atLeast(m.rate("probability"), R.mathProbability)
    ) {
      math = suggestion(
        "math-three",
        `${basis}经济应用与概率题表现较好，可先探索数三对应方向。`,
      );
    } else if (
      atLeast(score, R.mathTwoOverall) &&
      atLeast(core, R.mathTwoCore)
    ) {
      math = suggestion(
        "math-two",
        `${basis}高数与线代已有部分基础，可先以数二范围安排复习；不表示已经掌握数二。`,
      );
    } else {
      math = suggestion(
        "math-none",
        `${basis}当前高数、线代基础还需加强，可先比较不考数学的项目，并在补习后重测。`,
      );
    }
  }
  const e = moduleEvidence(evidence, "english");
  if (e) {
    const high =
      e.answered / e.total >= R.englishOneCompletionRate &&
      atLeast(e.rate(), R.englishOneOverall) &&
      ["reading", "sentence"].every((area) =>
        atLeast(e.rate(area), R.englishOneReadingSentence),
      ) &&
      ["translation", "writing"].every((area) =>
        atLeast(e.rate(area), R.englishOneTranslationWriting),
      );
    english = suggestion(
      high ? "english-one" : "english-two",
      `英语已作答${e.answered}/${e.total}题，答对${e.correct}题（${percent(e.rate()!)}）。${high ? "阅读、长难句及翻译写作判断表现较均衡，可先探索英一。" : "阅读或语言运用仍需巩固，可先探索英二，并补做完整阅读、翻译与写作。"}`,
    );
  }
  const points = new Map<
    string,
    {
      module: string;
      point: string;
      correct: number;
      incorrect: number;
      unanswered: number;
    }
  >();
  for (const item of evidence?.items ?? []) {
    const key = `${item.module}:${item.point}`;
    const entry = points.get(key) ?? {
      module: item.module,
      point: item.point,
      correct: 0,
      incorrect: 0,
      unanswered: 0,
    };
    entry[item.outcome]++;
    points.set(key, entry);
  }
  const improvements = [...points.values()]
    .filter((p) => p.incorrect || p.unanswered)
    .sort(
      (a, b) =>
        Number(!a.incorrect) - Number(!b.incorrect) ||
        a.correct / (a.correct + a.incorrect || 1) -
          b.correct / (b.correct + b.incorrect || 1) ||
        b.incorrect - a.incorrect ||
        (`${a.module}:${a.point}` < `${b.module}:${b.point}` ? -1 : 1),
    )
    .slice(0, R.maxImprovements)
    .map((p) => ({
      module: p.module,
      point: p.point,
      status: p.incorrect ? ("weak" as const) : ("unassessed" as const),
      accuracy:
        p.correct + p.incorrect ? p.correct / (p.correct + p.incorrect) : null,
      advice: improvementAdvice(p.module, p.point, !p.incorrect),
    }));
  return {
    ruleVersion: R.version,
    math,
    english,
    improvements,
    notice: `${evidence?.example ? "本次为未经独立学科审校的练习。" : ""}初步建议仅用于探索与安排复习，不是能力定级或录取预测；短篇单选不能代替完整阅读、翻译和写作。考试科目由学校专业规定，须核对目标年度目录。`,
  };
}
