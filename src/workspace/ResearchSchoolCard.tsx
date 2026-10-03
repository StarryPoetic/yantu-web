import type { ResearchReport } from "../../server/explanation/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import {
  admissionLabel,
  profileLabel,
  programName,
  tierLabels,
  tuitionDescription,
  tuitionCaution,
  type SchoolRecommendation,
} from "./research-report";
import { ResearchSourceLinks } from "./ResearchSourceLinks";

export function ResearchSchoolCard({
  item,
  run,
  sources,
}: {
  item: SchoolRecommendation;
  run: GuidanceRun;
  sources: ResearchReport["sources"];
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
        {item.degreeType && (
          <span className="research-degree">
            {item.degreeType === "academic" ? "学术学位" : "专业学位"}
          </span>
        )}
        {!item.programName && (
          <small>旧报告仅记录专业类别，具体招生专业待补充</small>
        )}
      </header>
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
      <section className="research-constraints" aria-label="费用与城市核对">
        <h5>费用与城市，与你的偏好相比</h5>
        <p className="research-tuition">{tuitionDescription(item, run)}</p>
        {item.tuition && (
          <>
            <p className="research-cost-note">{tuitionCaution(item, run)}</p>
            <ResearchSourceLinks
              ids={[item.tuition.sourceId]}
              sources={sources}
              label="学费依据来源"
            />
          </>
        )}
        {item.location && <p>项目所在城市：{item.location.city}</p>}
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
      <div className="research-preparation">
        {!!item.preparation.length && (
          <section>
            <h5>准备重点</h5>
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
