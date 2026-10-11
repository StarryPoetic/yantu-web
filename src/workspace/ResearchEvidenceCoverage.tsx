import type { ResearchReport } from "../../server/explanation/research.ts";
import {
  RESEARCH_EVIDENCE_FIELDS,
  type ResearchCandidateCoverage,
  type ResearchEvidenceGap,
  type ResearchEvidenceReference,
} from "../../shared/research-coverage.ts";
import {
  evidenceFieldLabels,
  evidenceStatusLabels,
  evidencePriorityLabels,
  libraryCoverageDescription,
} from "./research-report";
import { researchReason } from "../../shared/research-status.ts";
import { ResearchSourceLinks } from "./ResearchSourceLinks";
import { safeUrl } from "./ui";

type Sources = ResearchReport["sources"];

function EvidenceReferences({
  references,
  sources,
}: {
  references: ResearchEvidenceReference[];
  sources: Sources;
}) {
  if (!references.length) return null;
  return (
    <details className="research-field-references">
      <summary>查看已取得的原文 · {references.length} 条</summary>
      {references.map((reference, index) => (
        <div key={reference.sourceId + ":" + index}>
          {reference.year && <small>{reference.year} 年原文</small>}
          <blockquote>{reference.quote}</blockquote>
          <ResearchSourceLinks
            ids={[reference.sourceId]}
            sources={sources}
            label="这段原文的来源"
          />
        </div>
      ))}
    </details>
  );
}

export function ResearchGapList({
  gaps,
  sources,
  label = "待补资料与下一步",
}: {
  gaps: ResearchEvidenceGap[];
  sources: Sources;
  label?: string;
}) {
  if (!gaps.length) return null;
  return (
    <section className="research-evidence-gaps" aria-label={label}>
      <h5>{label}</h5>
      <ul>
        {gaps.map((gap) => (
          <li key={gap.id}>
            <div className="research-gap-heading">
              <span>
                {gap.institutionName}
                {gap.programName ? " · " + gap.programName : ""}
              </span>
              <strong>{evidenceFieldLabels[gap.field]}</strong>
              <span>{evidencePriorityLabels[gap.priority]}</span>
            </div>
            <p>{gap.reason}</p>
            <p>下一步：{gap.nextAction}</p>
            <small>
              目标年度：{gap.targetYear} 年
              {gap.referenceYears.length
                ? "；参考年度：" + gap.referenceYears.join("、") + " 年"
                : ""}
            </small>
            <ResearchSourceLinks
              ids={gap.sourceIds}
              sources={sources}
              label="缺项调查来源"
            />
            <EvidenceReferences references={gap.references} sources={sources} />
            {gap.attempts.some((attempt) => attempt.status === "failed") && (
              <details className="research-read-attempts">
                <summary>查看读取失败记录</summary>
                <ul>
                  {gap.attempts
                    .filter((attempt) => attempt.status === "failed")
                    .map((attempt, index) => (
                      <li key={attempt.url + ":" + index}>
                        <p>
                          读取未成功：
                          {attempt.reason
                            ? researchReason(attempt.reason)
                            : "未记录具体原因"}
                        </p>
                        <a
                          href={safeUrl(attempt.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          查看已尝试的网址
                        </a>
                        <small>
                          {new Date(attempt.attemptedAt).toLocaleString(
                            "zh-CN",
                          )}
                        </small>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ResearchSchoolEvidenceCoverage({
  institutionName,
  coverage,
  sources,
}: {
  institutionName: string;
  coverage: ResearchCandidateCoverage;
  sources: Sources;
}) {
  const programGapIds = new Set(
    coverage.programs.flatMap((program) =>
      program.missing.map((gap) => gap.id),
    ),
  );
  const schoolGaps = coverage.missing.filter(
    (gap) => !programGapIds.has(gap.id),
  );
  return (
    <section
      className="research-school-evidence"
      aria-label={institutionName + "逐专业资料"}
    >
      <h4>逐专业资料</h4>
      {!coverage.programs.length && (
        <p>尚未取得可列出具体专业的目录原文，先补查目录。</p>
      )}
      {coverage.programs.map((program) => (
        <section
          key={program.identity}
          aria-label={
            program.programName +
            " · " +
            (program.majorCode || program.disciplineCode) +
            (program.collegeName ? " · " + program.collegeName : "") +
            "资料核验"
          }
        >
          <details className="research-program-coverage">
            <summary>
              {program.programName}
              {program.majorCode
                ? " · " + program.majorCode
                : " · " + program.disciplineCode}
              {program.collegeName ? " · " + program.collegeName : ""}
            </summary>
            <p className="research-evidence-route-meta">
              {program.degreeType
                ? (program.degreeType === "academic"
                    ? "学术学位"
                    : "专业学位") + " · "
                : ""}
              {program.studyMode === "full_time"
                ? "全日制"
                : program.studyMode === "part_time"
                  ? "非全日制"
                  : "学习形式待核对"}
              {program.referenceYear
                ? " · " + program.referenceYear + " 年项目原文"
                : ""}
            </p>
            <dl className="research-coverage-fields">
              {RESEARCH_EVIDENCE_FIELDS.map((field) => (
                <div key={field} className={program.fields[field].status}>
                  <dt>
                    {evidenceFieldLabels[field]}
                    <span>
                      {evidenceStatusLabels[program.fields[field].status]}
                    </span>
                  </dt>
                  <dd>
                    <p>{program.fields[field].reason}</p>
                    <ResearchSourceLinks
                      ids={program.fields[field].sourceIds}
                      sources={sources}
                      label={evidenceFieldLabels[field] + "资料来源"}
                    />
                    <EvidenceReferences
                      references={program.fields[field].references}
                      sources={sources}
                    />
                  </dd>
                </div>
              ))}
            </dl>
            <ResearchGapList
              gaps={program.missing}
              sources={sources}
              label="该专业待补资料"
            />
          </details>
        </section>
      ))}
      <ResearchGapList
        gaps={schoolGaps}
        sources={sources}
        label="该校待补资料"
      />
    </section>
  );
}

export function ResearchEvidenceCoverage({
  report,
}: {
  report: ResearchReport;
}) {
  const coverage = report.evidenceCoverage;
  const coveredGapIds = new Set(
    report.candidateAudit?.flatMap(
      (candidate) => candidate.coverage?.missing.map((gap) => gap.id) ?? [],
    ) ?? [],
  );
  const remaining =
    coverage?.gaps.filter((gap) => !coveredGapIds.has(gap.id)) ?? [];
  return (
    <section
      className="research-evidence-coverage"
      aria-label="专业资料覆盖与缺项"
    >
      <h3>专业资料覆盖与缺项</h3>
      <p className="research-library-statistics">
        {libraryCoverageDescription(report)}
      </p>
      <p className="research-field-help">
        全库收录是资料库累计数量；下方调查数量仅属于这份报告。
      </p>
      {report.readStatistics ? (
        <>
          <p>
            本次失败读取 {report.readStatistics.failed} 次（失败不计入新读）。
          </p>
          {report.readStatistics.failed > 0 && (
            <details>
              <summary>查看读取失败原因分布</summary>
              <ul>
                {Object.entries(report.readStatistics.failuresByCode).map(
                  ([code, count]) => (
                    <li key={code}>
                      {researchReason(code)} · {count} 次
                    </li>
                  ),
                )}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="research-field-help">该报告生成时未记录失败读取次数。</p>
      )}
      {coverage && (
        <>
          <p>{coverage.summary}</p>
          <p>
            调查记录包含 {coverage.schoolCount} 所学校、{coverage.programCount}{" "}
            个候选专业，其中 {coverage.supportedProgramCount} 个有项目原文。
            这些是调查线索，推荐所需资料见顶部三类状态与学校卡片。
          </p>
          <p className="ws-muted">
            仅统计本次实际调查的学校与专业；未出现的学校不据此排除。目录已有原文时，学费、校区或考试缺项会分别记录。
          </p>
          {!!report.candidateAudit?.some((candidate) => candidate.coverage) && (
            <p>展开下方每校专业，查看已取得原文和下一步补查动作。</p>
          )}
          <ResearchGapList gaps={remaining} sources={report.sources} />
        </>
      )}
    </section>
  );
}
