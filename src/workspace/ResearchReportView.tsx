import type { ResearchReport } from "../../server/explanation/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import { researchReason } from "../../shared/research-status";
import { safeUrl } from "./ui";
import { ResearchSchoolCard } from "./ResearchSchoolCard";
import {
  ResearchSourceLinks,
  ResearchSourceMetadata,
} from "./ResearchSourceLinks";
import { ResearchUnstructuredSources } from "./ResearchUnstructuredSources";
import { ResearchDecisionBasisView } from "./ResearchDecisionBasisView";
import { ResearchCandidateAudit } from "./ResearchCandidateAudit";
import { ResearchEvidenceCoverage } from "./ResearchEvidenceCoverage";
import { ResearchPrefilterView } from "./ResearchPrefilterView";
import {
  recommendationGroups,
  researchCoverage,
  suitabilityNotice,
  isLegacyResearchReport,
  legacyResearchNotice,
  reportAvailability,
  type researchOutcome,
} from "./research-report";

export function ResearchReportView({
  report,
  run,
  onProfile,
  outcome,
  jobId,
  readOnly = false,
  outdated = false,
}: {
  report: ResearchReport;
  run: GuidanceRun;
  onProfile: () => void;
  outcome: ReturnType<typeof researchOutcome>;
  jobId?: string;
  readOnly?: boolean;
  outdated?: boolean;
}) {
  const hasRecommendations = report.recommendations.length > 0;
  const coverage = researchCoverage(report);
  const groups = recommendationGroups(report.recommendations);
  const legacy = isLegacyResearchReport(report);
  const availability = reportAvailability(report, outdated);
  return (
    <div className="research-report">
      <section
        className="research-availability"
        aria-label="报告可用性"
        role="status"
        data-report-state={availability.title}
      >
        <strong>{availability.title}</strong>
        <p>{availability.message}</p>
        <dl>
          <div>
            <dt>已确认</dt>
            <dd>
              {availability.confirmed} 项推荐相关资料（公开原文，未经人工审核）
            </dd>
          </div>
          <div>
            <dt>待补查</dt>
            <dd>{availability.pending} 项推荐相关资料，未查到不等于不存在</dd>
          </div>
          <div>
            <dt>已确认不存在</dt>
            <dd>
              {availability.absent} 个明确停招项目；仅凭对应年度官网原文确认
            </dd>
          </div>
        </dl>
      </section>
      {legacy && (
        <p className="research-legacy" role="status">
          {legacyResearchNotice}
        </p>
      )}
      <ResearchEvidenceCoverage report={report} />
      <ResearchPrefilterView value={report.prefilter} />
      {report.referencePolicy && (
        <section
          className="research-exam-policy"
          aria-label="资料年份与使用顺序"
        >
          <h3>资料年份与使用顺序</h3>
          <p>{report.referencePolicy.summary}</p>
        </section>
      )}
      {report.decisionBasis && (
        <ResearchDecisionBasisView basis={report.decisionBasis} />
      )}
      {hasRecommendations ? (
        <>
          <div className="research-result-heading">
            <h3>建议优先比较的学校与专业</h3>
            <span>
              本次建议 {coverage.schoolCount} 所不同学校，目标比较{" "}
              {coverage.targetMin === coverage.targetMax
                ? coverage.targetMax
                : `${coverage.targetMin}–${coverage.targetMax}`}{" "}
              所
            </span>
            <p className="ws-muted">{suitabilityNotice}</p>
          </div>
          {coverage.shortfall && (
            <aside className="research-coverage" aria-label="报告覆盖说明">
              <strong>{coverage.noticeTitle}</strong>
              <ul>
                {coverage.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </aside>
          )}
          {groups.map((group) => (
            <section
              className="research-tier-group"
              key={group.tier}
              aria-label={group.title}
            >
              <div className="research-group-heading">
                <h3>{group.title}</h3>
                <p>{group.description}</p>
              </div>
              <div className="research-school-grid">
                {group.items.map((item, index) => (
                  <ResearchSchoolCard
                    interest={
                      !readOnly && jobId
                        ? { jobId, index: report.recommendations.indexOf(item) }
                        : undefined
                    }
                    item={item}
                    run={run}
                    sources={report.sources}
                    gaps={(report.evidenceCoverage?.gaps ?? []).filter(
                      (gap) =>
                        gap.institutionName === item.institutionName &&
                        (!gap.programIdentity ||
                          ((gap.majorCode
                            ? gap.majorCode === item.majorCode
                            : gap.programName === item.programName) &&
                            (!gap.collegeName ||
                              gap.collegeName === item.collegeName) &&
                            (!gap.studyMode ||
                              gap.studyMode === item.studyMode))),
                    )}
                    key={
                      item.institutionName +
                      ":" +
                      item.disciplineCode +
                      ":" +
                      index
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : outcome !== "failure" ? (
        <section className="research-empty" aria-label="暂无学校推荐">
          <h3>
            {outcome === "profile"
              ? "补充这些信息后继续研究"
              : "本次尚未找到足够的学校依据"}
          </h3>
          <p>
            {report.reason
              ? researchReason(report.reason)
              : "本次没有取得可支持学校与具体专业建议的资料。你的画像已保存，可以重新发起研究。"}
          </p>
          {outcome !== "profile" && (
            <p>
              本次可用学校建议为 0 所，尚未达到 {coverage.targetMin}–
              {coverage.targetMax} 所的比较目标。尚未查到不代表不存在合适学校。
            </p>
          )}
          {!!report.followUpQuestions?.length && (
            <ul>
              {report.followUpQuestions.map((question, i) => (
                <li key={i}>{question}</li>
              ))}
            </ul>
          )}
          {outcome === "profile" && !readOnly ? (
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
      <ResearchUnstructuredSources report={report} />
      <ResearchCandidateAudit report={report} />
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
                {fact.year && <small>{fact.year}年资料摘录</small>}
                <p>{fact.text}</p>
                <ResearchSourceLinks
                  ids={fact.citations}
                  sources={report.sources}
                />
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
              <a
                href={safeUrl(source.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.title}
              </a>
              <small>
                {source.kind === "official_page"
                  ? "学校官网原文"
                  : source.kind === "authority_page"
                    ? "权威官方原文"
                    : source.kind === "reference_page"
                      ? "非官方，仅供参考"
                      : "搜索摘要"}{" "}
                · {new Date(source.retrievedAt).toLocaleString("zh-CN")}
              </small>
              <ResearchSourceMetadata source={source} full />
              <p>{source.excerpt}</p>
            </article>
          ))}
        </details>
        <details className="research-technical-info">
          <summary>技术信息</summary>
          <p>校验问题：{report.validationIssues?.length ?? 0} 项</p>
          <ul>
            {Object.entries(report.readStatistics?.failuresByCode ?? {}).map(
              ([code, count]) => (
                <li key={code}>
                  {code}：{count} 次
                </li>
              ),
            )}
          </ul>
        </details>
      </div>
    </div>
  );
}
