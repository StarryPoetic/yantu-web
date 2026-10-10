import type { GuidanceRun } from "../../server/disciplines/types.ts";
import type { ResearchReport } from "../../server/explanation/research.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";
import {
  orderedPendingEvidence,
  recommendationFieldState,
  recommendationYears,
  tuitionDescription,
  tuitionCaution,
  type SchoolRecommendation,
} from "./research-report";
import { ResearchSourceLinks } from "./ResearchSourceLinks";
import { ResearchExamEvidence } from "./ResearchProgramEvidence";

const fields = [
  ["exams", "初试科目"],
  ["tuition", "学费"],
  ["location", "培养校区/城市"],
  ["year", "资料年度"],
] as const;

function PendingPassages({
  evidence,
  sources,
}: {
  evidence: NonNullable<SchoolRecommendation["pendingEvidence"]>;
  sources: ResearchReport["sources"];
}) {
  return (
    <>
      {evidence.map((entry, index) => (
        <div
          key={entry.sourceId + ":" + index}
          className="research-pending-passage"
        >
          <small>
            {entry.year ? `${entry.year} 年原文` : "原文年度待确认"}
          </small>
          <blockquote>{entry.quote}</blockquote>
          <p>归属待确认：{entry.reason}</p>
          <ResearchSourceLinks
            ids={[entry.sourceId]}
            sources={sources}
            label="待确认原文来源"
          />
        </div>
      ))}
    </>
  );
}

export function ResearchRecommendationFields({
  item,
  run,
  sources,
  gaps,
}: {
  item: SchoolRecommendation;
  run: GuidanceRun;
  sources: ResearchReport["sources"];
  gaps: ResearchEvidenceGap[];
}) {
  const targetYear = Number(run.inputSnapshot.profile.year);
  return (
    <section
      className="research-recommendation-fields"
      aria-label="四字段资料状态"
    >
      <h5>专业资料核对</h5>
      {fields.map(([field, label]) => {
        const status = recommendationFieldState(item, field);
        const pending = orderedPendingEvidence(item, field, targetYear);
        const bound = status === "已绑定";
        const years =
          field === "year"
            ? recommendationYears(item)
            : [
                field === "exams"
                  ? item.exams?.year
                  : field === "tuition"
                    ? item.tuition?.year
                    : item.location?.year,
              ].filter((year): year is number => year !== undefined);
        const ids =
          field === "year"
            ? [
                ...(item.referenceBasis?.sourceIds ?? []),
                item.tuition?.sourceId,
                item.location?.sourceId,
                item.exams?.sourceId,
              ].filter((id): id is string => !!id)
            : [];
        const fieldGaps = gaps.filter(
          (gap) => gap.field === (field === "year" ? "program" : field),
        );
        const pendingView = (
          <>
            <p className="research-field-help">
              以下原文尚未确定适用项目，不用于预算或城市匹配。
            </p>
            <PendingPassages evidence={pending.slice(0, 2)} sources={sources} />
            {pending.length > 2 && (
              <details>
                <summary>查看更多待确认原文（{pending.length - 2} 条）</summary>
                <PendingPassages
                  evidence={pending.slice(2)}
                  sources={sources}
                />
              </details>
            )}
          </>
        );
        return (
          <section
            key={field}
            className="research-recommendation-field"
            aria-label={label + "资料状态"}
          >
            <h5>
              {label}
              <span className="research-field-status">{status}</span>
            </h5>
            {bound && (
              <p className="research-field-help">
                {years.length
                  ? `资料年度：${years.join("、")} 年`
                  : "资料年度待确认"}
                {years.some((year) => year < targetYear)
                  ? " · 历史参考，目标年度待核验"
                  : ""}
              </p>
            )}
            {field === "exams" && (
              <ResearchExamEvidence exams={item.exams} sources={sources} />
            )}
            {field === "tuition" && (
              <>
                <p className="research-tuition">
                  {tuitionDescription(item, run)}
                </p>
                {item.tuition && (
                  <>
                    <p className="research-cost-note">
                      {tuitionCaution(item, run)}
                    </p>
                    <ResearchSourceLinks
                      ids={[item.tuition.sourceId]}
                      sources={sources}
                      label="学费依据来源"
                    />
                  </>
                )}
              </>
            )}
            {field === "location" && item.location && (
              <>
                <p>
                  项目所在城市：{item.location.city}
                  {item.location.year && item.location.year !== targetYear
                    ? `（${item.location.year}年培养安排参考）`
                    : ""}
                </p>
                <p className="research-field-help">
                  城市已核验，具体校区待确认
                </p>
                <ResearchSourceLinks
                  ids={[
                    item.location.sourceId,
                    ...(item.location.supportingEvidence?.map(
                      (ref) => ref.sourceId,
                    ) ?? []),
                  ]}
                  sources={sources}
                  label="培养城市依据来源"
                />
              </>
            )}
            {field === "year" && bound && (
              <ResearchSourceLinks
                ids={[...new Set(ids)]}
                sources={sources}
                label="资料年度依据来源"
              />
            )}
            {status === "未找到" && (
              <p>
                {fieldGaps.length
                  ? "可以继续补查，具体动作见下方缺口列表。"
                  : "本报告未记录此字段的补查任务，可重新调研核对。"}
              </p>
            )}
            {pending.length > 0 &&
              (bound ? (
                <details className="research-bound-pending">
                  <summary>待确认原文（{pending.length} 条）</summary>
                  {pendingView}
                </details>
              ) : (
                <section aria-label="待确认原文">{pendingView}</section>
              ))}
          </section>
        );
      })}
    </section>
  );
}
