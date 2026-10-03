import type { ResearchReport } from "../../server/explanation/research.ts";
import { candidateStatusLabels } from "./research-report";
import { ResearchSourceLinks } from "./ResearchSourceLinks";

export function ResearchCandidateAudit({ report }: { report: ResearchReport }) {
  if (!report.candidateAudit?.length)
    return report.reportVersion === "profile-research-v7" ? (
      <section
        className="research-candidate-audit"
        aria-label="候选院校覆盖与排除说明"
      >
        <h3>候选院校覆盖与排除说明</h3>
        <p>本报告未记录逐校调查结果，未出现的院校不能据此排除。</p>
      </section>
    ) : null;
  return (
    <section
      className="research-candidate-audit"
      aria-label="候选院校覆盖与排除说明"
    >
      <h3>候选院校覆盖与排除说明</h3>
      <p>
        本次记录了 {report.candidateAudit.length}{" "}
        所候选院校的调查结果。待补充资料或本次未选入，不代表学校不适合或没有该专业。
      </p>
      <ul className="research-audit-list">
        {report.candidateAudit.map((candidate, index) => (
          <li key={candidate.institutionName + ":" + index}>
            <div className="research-audit-heading">
              <strong>{candidate.institutionName}</strong>
              <span className={"research-evidence-status " + candidate.status}>
                {candidateStatusLabels[candidate.status]}
              </span>
            </div>
            <ul>
              {candidate.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            <ResearchSourceLinks
              ids={candidate.sourceIds}
              sources={report.sources}
              label={candidate.institutionName + "调查来源"}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
