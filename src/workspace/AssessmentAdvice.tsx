import {
  deriveSubjectAdvice,
  SUBJECT_LABELS,
} from "../../shared/assessment-advice";
import type { Diagnosis } from "../../server/assessment/types";

export function AssessmentAdvice({ diagnosis }: { diagnosis: Diagnosis }) {
  const advice = deriveSubjectAdvice(diagnosis);
  return (
    <section
      className="assessment-advice"
      aria-labelledby="subject-advice-heading"
    >
      <h3 id="subject-advice-heading">考试科目 · 初步建议</h3>
      <div className="assessment-advice-cards">
        {(["math", "english"] as const).map((module) => {
          const suggestion = advice[module];
          return (
            <article
              key={module}
              aria-label={module === "math" ? "数学建议" : "英语建议"}
            >
              <span className="ws-eyebrow">
                {module === "math" ? "数学" : "英语"} · {suggestion.label}
              </span>
              <h4>
                {suggestion.subject
                  ? SUBJECT_LABELS[suggestion.subject]
                  : "待补充测评"}
              </h4>
              <p>{suggestion.reason}</p>
              <p>{suggestion.suitableMajors}</p>
            </article>
          );
        })}
      </div>
      <p className="ws-muted">{advice.notice}</p>
      <h3>接下来要加强</h3>
      {advice.improvements.length ? (
        <ol
          className="assessment-improvements"
          aria-label="接下来要加强的知识点"
        >
          {advice.improvements.map((item) => (
            <li key={`${item.module}:${item.point}`}>
              <strong>{item.point}</strong>
              <span className="ws-pill">
                {item.status === "unassessed"
                  ? "待评估"
                  : `本次已答题答对率 ${Math.round(item.accuracy! * 100)}%`}
              </span>
              <p>{item.advice}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          本次已测知识点暂无错题；接下来用变式题和完整限时练习检查稳定性，补充未测内容。
        </p>
      )}
    </section>
  );
}
