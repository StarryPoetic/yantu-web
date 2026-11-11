import type { ResearchDecisionBasis } from "../../shared/research-decision.ts";
import {
  assessmentLabels,
  degreePriorityLabels,
  assessmentScopeLabel,
} from "./research-report";

export function ResearchDecisionBasisView({
  basis,
}: {
  basis: ResearchDecisionBasis;
}) {
  return (
    <section
      className="research-decision-basis"
      aria-label="测评与学位路线依据"
    >
      <details className="research-basis-disclosure">
        <summary>
          <h3>测评与学位路线依据</h3>
          <span className="when-closed">展开依据</span>
          <span className="when-open">收起依据</span>
        </summary>
        <p>{basis.summary}</p>
        <div className="research-basis-grid">
          {basis.assessments.map((assessment) => (
            <section
              className="research-assessment"
              key={assessment.module + ":" + (assessment.scope ?? "unknown")}
              aria-label={
                assessment.module === "math" ? "数学准备观察" : "英语准备观察"
              }
            >
              <h4>
                {assessment.module === "math" ? "数学准备观察" : "英语准备观察"}
              </h4>
              <span className="research-evidence-status">
                {assessmentLabels[assessment.status]}
              </span>
              {assessment.scope && (
                <p>练习范围：{assessmentScopeLabel(assessment.scope)}</p>
              )}
              {assessment.status !== "unassessed" && (
                <p>
                  答题记录：答对 {assessment.counts.correct} 题，答错{" "}
                  {assessment.counts.incorrect} 题，未答{" "}
                  {assessment.counts.unanswered} 题，共{" "}
                  {assessment.counts.total} 题。
                </p>
              )}
              {assessment.points.length > 0 && (
                <p>已观察知识点：{assessment.points.join("、")}</p>
              )}
              {assessment.weakPoints.length > 0 && (
                <p>需要复习的知识点：{assessment.weakPoints.join("、")}</p>
              )}
              <ul>
                {assessment.observations.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
              {assessment.nextSteps.length > 0 && (
                <>
                  <h5>下一步复习</h5>
                  <ul>
                    {assessment.nextSteps.map((text, index) => (
                      <li key={index}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
              <ul className="ws-muted">
                {assessment.limitations.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
              {assessment.references.length > 0 && (
                <details>
                  <summary>查看测评记录与版本</summary>
                  <ul>
                    {assessment.references.map((reference, index) => (
                      <li key={index}>
                        记录 {reference.assessmentAttemptId} · 诊断版本{" "}
                        {reference.diagnosisVersion}
                        {reference.questionBankVersion
                          ? ` · 题库版本 ${reference.questionBankVersion}`
                          : ""}
                        {reference.submittedAt
                          ? ` · 提交时间 ${new Date(reference.submittedAt).toLocaleString("zh-CN")}`
                          : ""}
                        {reference.example ? " · 示例练习" : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          ))}
        </div>
        <div className="research-basis-grid">
          {basis.degreeRoutes.map((route) => (
            <section
              className="research-degree-route"
              key={route.degreeType}
              aria-label={
                route.degreeType === "academic"
                  ? "学术学位路线"
                  : "专业学位路线"
              }
            >
              <h4>
                {route.degreeType === "academic"
                  ? "学术学位路线"
                  : "专业学位路线"}
              </h4>
              <span className="research-evidence-status">
                {degreePriorityLabels[route.priority]}
              </span>
              <ul>
                {route.reasons.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
              {route.verificationNeeded.length > 0 && (
                <>
                  <h5>仍需核对</h5>
                  <ul>
                    {route.verificationNeeded.map((text, index) => (
                      <li key={index}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
        </div>
        <section className="research-exam-policy" aria-label="考试类型比较依据">
          <h4>考试类型怎么比较</h4>
          <p>{basis.examPolicy.summary}</p>
          {basis.examPolicy.comparisons.map((comparison) => (
            <div key={comparison.module}>
              <h5>
                {comparison.module === "math" ? "数学科目" : "英语科目"}：
                {comparison.options.join("、")}
              </h5>
              <p>{comparison.assessmentUse}</p>
              <ul>
                {comparison.nextSteps.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        {basis.ignoredAssessments.length > 0 && (
          <details>
            <summary>未用于本次判断的测评记录</summary>
            <ul>
              {basis.ignoredAssessments.map((item, index) => (
                <li key={index}>
                  记录 {item.assessmentAttemptId} · 诊断版本{" "}
                  {item.diagnosisVersion}：{item.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        <ul className="ws-muted">
          {basis.limitations.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
