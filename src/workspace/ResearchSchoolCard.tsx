import type { ResearchReport } from "../../server/explanation/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import {
  admissionLabel,
  profileLabel,
  programName,
  tierLabels,
  type SchoolRecommendation,
} from "./research-report";
import { ResearchSourceLinks } from "./ResearchSourceLinks";
import {
  ResearchMatchEvidence,
  ResearchProgramAlternatives,
} from "./ResearchProgramEvidence";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
import { ResearchRecommendationFields } from "./ResearchRecommendationFields";
import { ResearchInterestActions } from "./ResearchInterests";

export function ResearchSchoolCard({
  item,
  run,
  sources,
  gaps,
  interest,
}: {
  item: SchoolRecommendation;
  run: GuidanceRun;
  sources: ResearchReport["sources"];
  gaps: ResearchEvidenceGap[];
  interest?: { jobId: string; index: number };
}) {
  return (
    <article
      className="research-school"
      aria-label={item.institutionName + " · " + programName(item, run)}
    >
      <header className="research-school-heading">
        {item.tier && (
          <span className={"research-tier " + item.tier}>
            {tierLabels[item.tier]}
          </span>
        )}
        <h4>{item.institutionName}</h4>
        <p className="research-program">{programName(item, run)}</p>
        {(item.collegeName || item.majorCode) && (
          <p className="research-program-identity">
            {item.collegeName && <span>招生院系：{item.collegeName}</span>}
            {item.majorCode && <span>专业代码：{item.majorCode}</span>}
          </p>
        )}
        {item.degreeType && (
          <span className="research-degree">
            {item.degreeType === "academic" ? "学术学位" : "专业学位"}
          </span>
        )}
        {!item.programName && (
          <small>旧报告仅记录专业类别，具体招生专业待补充</small>
        )}
      </header>
      {interest && <ResearchInterestActions {...interest} />}
      <p
        className={
          "research-admission " +
          (item.admissionStatus === "current_evidence"
            ? "has-evidence"
            : "needs-verification")
        }
      >
        {admissionLabel(item, run)}
      </p>
      <ResearchMatchEvidence match={item.match} sources={sources} />
      {item.referenceBasis && (
        <section aria-label="历史资料比较依据">
          <h5>{item.referenceBasis.year}年专业资料作为比较基准</h5>
          <p>{item.referenceBasis.reason}</p>
          <ResearchSourceLinks
            ids={item.referenceBasis.sourceIds}
            sources={sources}
            label="历年专业依据来源"
          />
        </section>
      )}
      <section className="research-fit">
        <h5>为什么适合你考虑</h5>
        <p>{item.rationale}</p>
        {!!item.tierReasons?.length && (
          <div className="research-tier-reasons">
            <strong>为什么在这一层</strong>
            <ul>
              {item.tierReasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        {!!item.fitReasons?.length && (
          <dl>
            {item.fitReasons.map((fit, i) => (
              <div key={fit.profileField + ":" + i}>
                <dt>
                  {profileLabel(fit.profileField)}
                  <strong>{fit.profileValue}</strong>
                </dt>
                <dd>{fit.reason}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <ResearchRecommendationFields
        item={item}
        run={run}
        sources={sources}
        gaps={gaps}
      />
      <section className="research-constraints" aria-label="费用与城市核对">
        <h5>费用与城市，与你的偏好相比</h5>
        {!!item.constraintChecks?.length && (
          <dl className="research-constraint-list">
            {item.constraintChecks.map((check) => (
              <div key={check.field} className={check.status}>
                <dt>
                  {check.field === "budget" ? "预算" : "意向城市"}
                  <span>
                    {check.status === "match"
                      ? "已有匹配依据"
                      : check.status === "mismatch"
                        ? "与偏好有差异"
                        : "尚未核实"}
                  </span>
                </dt>
                <dd>
                  {check.reason}
                  <ResearchSourceLinks
                    ids={check.sourceIds}
                    sources={sources}
                    label={
                      (check.field === "budget" ? "预算" : "城市") + "核对来源"
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <div className="research-preparation" aria-label="准备建议">
        {!!item.preparation.length && (
          <section>
            <h5>准备建议</h5>
            <p className="ws-muted">
              这些是复习任务，实际报考科目以招生目录核验结果为准。
            </p>
            <ul>
              {item.preparation.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </section>
        )}
        {!!item.tradeoffs?.length && (
          <section>
            <h5>需要权衡</h5>
            <ul>
              {item.tradeoffs.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <ResearchProgramAlternatives
        items={item.programAlternatives}
        sources={sources}
      />
      {!!item.uncertainties.length && (
        <details className="research-admission-details">
          <summary>报考前需要确认</summary>
          <ul>
            {item.uncertainties.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </details>
      )}
      <footer className="research-school-sources">
        <strong>查看学校与专业依据</strong>
        <ResearchSourceLinks ids={item.citations} sources={sources} />
      </footer>
    </article>
  );
}
