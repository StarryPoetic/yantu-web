import type { ResearchSupplementResult } from "../../shared/research-supplement";

const fields: Record<string, string> = {
  program: "招生项目",
  exams: "考试科目",
  location: "培养地点",
  tuition: "学费",
  eligibility: "报考资格",
  curriculum: "培养内容",
  priorityFacts: "专项资料",
  ranking: "推荐顺序或层级",
};
const tiers: Record<string, string> = {
  preferred: "优先推荐",
  alternative: "适合备选",
  exploratory: "进一步了解",
};
const outcomes: Record<ResearchSupplementResult["outcome"], string> = {
  updated: "已在原报告项目范围内更新依据与建议。",
  no_change: "本次没有取得足以改变建议的新依据，原报告建议保留。",
  no_pending_work:
    "已记录的补查任务均已执行，本次未再次检索。资料缺项仍以原文核验结果为准。",
  scope_unverified:
    "旧报告缺少明确的专业范围，本次未检索；请通过“重新调研并生成报告”建立项目范围。",
};

export function ResearchSupplementSummary({
  result,
}: {
  result: ResearchSupplementResult;
}) {
  const schools = new Set(result.scope.map((item) => item.institutionName))
    .size;
  return (
    <section
      className="research-supplement-summary"
      aria-label="最近一次补查结果"
    >
      <h3>最近一次补查结果</h3>
      <p>{outcomes[result.outcome]}</p>
      <p>
        复用已有来源 {result.reusedSourceCount} 份；本次检索{" "}
        {result.newSearchCount} 次、读取 {result.newReadCount}{" "}
        次；新增或更新官网原文 {result.newSourceCount} 份。
      </p>
      <p className="ws-muted">
        尚未执行完的补查任务 {result.remainingTaskCount}{" "}
        项。已查过但缺少原文的资料继续待补，不会据此估算或认定不存在。
      </p>
      {result.scope.length > 0 && (
        <details>
          <summary>
            查看本次范围与变化（{schools} 所学校，{result.changes.length}{" "}
            个项目变化）
          </summary>
          <p>
            范围固定为原报告的 {result.scope.length}{" "}
            个已展示项目，含已展示的同校对照。扩展其他学校需单独重新调研。
          </p>
          <ul>
            {result.scope.map((item, index) => (
              <li key={index}>
                {item.institutionName} · {item.programName}（{item.majorCode}）
                {item.collegeName ? ` · ${item.collegeName}` : ""}
              </li>
            ))}
          </ul>
          {!!result.changes.length && (
            <ul aria-label="本次项目变化">
              {result.changes.map((change) => (
                <li key={change.programKey}>
                  <strong>
                    {change.institutionName}
                    {change.programName ? ` · ${change.programName}` : ""}
                    {change.majorCode ? `（${change.majorCode}）` : ""}
                  </strong>
                  <p>
                    {change.afterRank === null
                      ? "已从本次建议中移除"
                      : change.beforeRank === change.afterRank
                        ? `位次不变（第 ${change.afterRank} 位）`
                        : change.beforeRank === null
                          ? `现位于第 ${change.afterRank} 位`
                          : `第 ${change.beforeRank} 位 → 第 ${change.afterRank} 位`}
                    {change.beforeTier &&
                    change.afterTier &&
                    change.beforeTier !== change.afterTier
                      ? `；${tiers[change.beforeTier] ?? "原层级"} → ${tiers[change.afterTier] ?? "当前层级"}`
                      : ""}
                    。 更新：
                    {[
                      ...new Set(
                        change.changedFields.map(
                          (field) => fields[field] ?? "相关依据",
                        ),
                      ),
                    ].join("、")}
                    。
                  </p>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}
