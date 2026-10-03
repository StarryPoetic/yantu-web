import type { ResearchReport } from "../../server/explanation/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import { researchReason } from "../../shared/research-status";
import { safeUrl } from "./ui";
import {
  admissionLabel,
  profileLabel,
  programName,
  type researchOutcome,
} from "./research-report";

function SourceLinks({
  ids,
  sources,
}: {
  ids: string[];
  sources: ResearchReport["sources"];
}) {
  const links = ids.flatMap((id) => {
    const source = sources.find((entry) => entry.id === id);
    const url = source && safeUrl(source.url);
    return source && url ? [{ ...source, url }] : [];
  });
  if (!links.length) return null;
  return (
    <ul className="research-reference-links" aria-label="推荐依据来源">
      {links.map((source) => (
        <li key={source.id}>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ResearchReportView({
  report,
  run,
  onProfile,
  outcome,
}: {
  report: ResearchReport;
  run: GuidanceRun;
  onProfile: () => void;
  outcome: ReturnType<typeof researchOutcome>;
}) {
  const hasRecommendations = report.recommendations.length > 0;
  const legacy =
    report.reportVersion !== "profile-research-v4" ||
    report.recommendations.some(
      (item) => !item.programName || !item.fitReasons?.length,
    );
  return (
    <div className="research-report">
      {hasRecommendations ? (
        <>
          <div className="research-result-heading">
            <h3>建议优先比较的学校与专业</h3>
            <span>
              {report.recommendations.length} 个选项，结合你的个人情况逐项比较
            </span>
          </div>
          <div className="research-school-grid">
            {report.recommendations.map((item, index) => (
              <article
                className="research-school"
                aria-label={
                  item.institutionName + " · " + programName(item, run)
                }
                key={
                  item.institutionName + ":" + item.disciplineCode + ":" + index
                }
              >
                <header className="research-school-heading">
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
                  <SourceLinks ids={item.citations} sources={report.sources} />
                </footer>
              </article>
            ))}
          </div>
          {legacy && (
            <p className="research-legacy" role="status">
              这是旧版报告。重新生成后，可查看具体招生专业、逐项个人理由与准备成本。
            </p>
          )}
        </>
      ) : outcome !== "failure" ? (
        <section className="research-empty" aria-label="暂无学校推荐">
          <h3>
            {outcome === "profile"
              ? "补充这些信息后继续研究"
              : "本次尚未找到足够的学校依据"}
          </h3>
          {legacy && (
            <p className="research-legacy" role="status">
              这是旧版报告。点击下方“重新调研并生成报告”，可按完整画像重新调查学校与具体专业。
            </p>
          )}
          <p>
            {report.reason
              ? researchReason(report.reason)
              : "本次没有取得可支持学校与具体专业建议的资料。你的画像已保存，可以重新发起研究。"}
          </p>
          {!!report.followUpQuestions?.length && (
            <ul>
              {report.followUpQuestions.map((question, i) => (
                <li key={i}>{question}</li>
              ))}
            </ul>
          )}
          {outcome === "profile" ? (
            <div className="ws-actions">
              <button className="ws-secondary" onClick={onProfile}>
                补充个人情况
              </button>
            </div>
          ) : (
            <p>
              你无需先列出目标学校。可点击下方“重新调研并生成报告”，由系统继续检索与比较。
            </p>
          )}
        </section>
      ) : null}
      <div className="research-supporting-details">
        <details>
          <summary>
            {outcome === "failure"
              ? "查看失败详情与已取得的资料"
              : "综合分析与适用范围"}
          </summary>
          <p className="research-summary">{report.summary}</p>
          {hasRecommendations && report.reason && (
            <p>{researchReason(report.reason)}</p>
          )}
          <ul>
            {report.limitations.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
          {hasRecommendations && !!report.followUpQuestions?.length && (
            <>
              <h4>还可以补充</h4>
              <ul>
                {report.followUpQuestions.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </>
          )}
        </details>
        <details>
          <summary>原文摘录 · {report.facts.length} 条</summary>
          {report.facts.length ? (
            report.facts.map((fact, i) => (
              <article className="research-excerpt" key={i}>
                <p>{fact.text}</p>
                <SourceLinks ids={fact.citations} sources={report.sources} />
              </article>
            ))
          ) : (
            <p>本次没有可展示的原文摘录。</p>
          )}
        </details>
        <details className="research-sources">
          <summary>全部来源与获取时间 · {report.sources.length} 条</summary>
          {report.sources.map((source) => (
            <article key={source.id}>
              <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                {source.title}
              </a>
              <small>
                {source.kind === "official_page" ? "官网原文" : "搜索摘要"} ·{" "}
                {new Date(source.retrievedAt).toLocaleString("zh-CN")}
              </small>
              <p>{source.excerpt}</p>
            </article>
          ))}
        </details>
      </div>
    </div>
  );
}
