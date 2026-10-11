import {
  deriveSubjectAdvice,
  SUBJECT_ADVICE_RULES,
  SUBJECT_LABELS,
  type SubjectAdvice,
  type MathSubject,
  type EnglishSubject,
} from "../../shared/assessment-advice.ts";
import type { GuidanceRun } from "../disciplines/types.ts";
import type {
  DemandMatchFactor,
  ResearchExamEvidence,
} from "../../shared/research-matching.ts";

/** One fixed latest usable snapshot per module; retests never accumulate sample size.
 * Unreviewed practice is an explicitly labelled exploration signal, not formal diagnosis. */
export function researchSubjectAdvice(
  run: GuidanceRun,
): SubjectAdvice | undefined {
  const references = [...run.assessmentSummary.references]
    .filter((a) => a.example || a.usableForRecommendation)
    .sort(
      (a, b) =>
        Number(b.usableForRecommendation && !b.example) -
          Number(a.usableForRecommendation && !a.example) ||
        (Date.parse(b.submittedAt ?? "") || 0) -
          (Date.parse(a.submittedAt ?? "") || 0) ||
        a.assessmentAttemptId.localeCompare(b.assessmentAttemptId, "en") ||
        a.diagnosisVersion.localeCompare(b.diagnosisVersion, "en"),
    );
  const chosen = ["math", "english"].map((module) => ({
    module,
    assessment: references.find((a) =>
      a.modules.some((m) => m.module === module),
    ),
  }));
  const advice = deriveSubjectAdvice({
    modules: chosen.flatMap(
      ({ module, assessment }) =>
        assessment?.modules.filter((m) => m.module === module) ?? [],
    ),
    items: chosen.flatMap(
      ({ module, assessment }) =>
        assessment?.items?.filter((i) => i.module === module) ?? [],
    ),
    example: chosen.some(({ assessment }) => assessment?.example),
  });
  return advice.math.subject || advice.english.subject ? advice : undefined;
}

/** Compare only already-bound programme exam evidence, never degree-type guesses. */
export function compareExamAdvice(
  advice: SubjectAdvice | undefined,
  exams?: ResearchExamEvidence,
) {
  const factors: DemandMatchFactor[] = [],
    risks: string[] = [];
  let bonus = 0;
  if (!advice) return { bonus, factors, risks };
  const historical =
    exams?.status === "historical" ? exams.historicalReference : undefined;
  const usable =
    exams?.status === "verified_current" ||
    (exams?.status === "historical" && historical?.status !== "ambiguous");
  const subjects = usable
    ? (historical?.subjects ?? exams?.subjects ?? [])
    : [];
  const sourceId = historical?.sourceId ?? exams?.sourceId;
  const year = historical?.year ?? exams?.year;
  const codes = subjects.map((s) => s.code);
  const mathCodes = codes.filter((c) => ["301", "302", "303"].includes(c));
  let math: MathSubject | undefined;
  if (new Set(mathCodes).size === 1)
    math = (
      { "301": "math-one", "302": "math-two", "303": "math-three" } as const
    )[mathCodes[0] as "301" | "302" | "303"];
  else if (
    !mathCodes.length &&
    subjects.length === 4 &&
    new Set(codes).size === 4 &&
    codes.includes("101") &&
    codes.some((c) => /^2\d{2}$/.test(c)) &&
    !subjects.some(
      (s) =>
        /数学|高数|概率|线性代数|经济类综合|管理类综合/.test(s.name) ||
        ["199", "396"].includes(s.code),
    )
  )
    math = "math-none";
  const englishCodes = [
    ...new Set(codes.filter((c) => ["201", "204"].includes(c))),
  ];
  const english: EnglishSubject | undefined =
    englishCodes.length === 1
      ? englishCodes[0] === "201"
        ? "english-one"
        : "english-two"
      : undefined;
  for (const module of ["math", "english"] as const) {
    const recommended = advice[module].subject;
    if (!recommended) continue;
    const actual =
      sourceId && year ? (module === "math" ? math : english) : undefined;
    const status = !actual
      ? "unknown"
      : actual === recommended
        ? "match"
        : "mismatch";
    const prefix =
      exams?.status === "historical" ? `${year}年历史目录参考：` : "";
    const reason = !actual
      ? "初试科目证据缺失、冲突或不能确定，不按科目建议加分。"
      : status === "match"
        ? `${prefix}该专业${actual === "math-none" ? "不考数学" : `考${SUBJECT_LABELS[actual]}`}，与测评的${SUBJECT_LABELS[recommended]}初步建议相符（+${SUBJECT_ADVICE_RULES.pointsPerMatchingSubject}）。`
        : `${prefix}该专业${actual === "math-none" ? "不考数学" : `考${SUBJECT_LABELS[actual]}`}，你的测评更适合${SUBJECT_LABELS[recommended]}（初步建议）；保留比较，需补充相应范围练习。`;
    factors.push({
      field: `assessment-${module}`,
      label: module === "math" ? "数学科目初步建议" : "英语科目初步建议",
      status,
      reason:
        reason +
        (exams?.status === "historical" ? "目标年度科目仍需核验。" : ""),
      sourceIds: actual && sourceId ? [sourceId] : [],
    });
    if (status === "match")
      bonus += SUBJECT_ADVICE_RULES.pointsPerMatchingSubject;
    if (status === "mismatch") risks.push(factors.at(-1)!.reason);
  }
  return { bonus, factors, risks };
}
