import type { ResearchPrefilter } from "../../shared/research-prefilter";

const labels = {
  program: "专业实力与招生",
  score: "分数匹配",
  undergraduate: "本科优势",
  city: "城市偏好",
  constraints: "费用与学制",
  national: "全国调查偏好",
};
export function ResearchPrefilterView({
  value,
}: {
  value?: ResearchPrefilter;
}) {
  if (!value) return null;
  const reasons = [
    ...new Set(
      value.omitted.flatMap((s) =>
        s.excludedReasons.length ? s.excludedReasons : [s.reason],
      ),
    ),
  ];
  return (
    <details className="research-prefilter">
      <summary>
        筛选依据：从 {value.candidateCount} 所中选出 {value.selected.length}{" "}
        所精查
      </summary>
      <p>以下分数只决定调查顺序，不是录取概率。缺少证据的维度记 0。</p>
      {value.limitations.map((text) => (
        <p key={text}>{text}</p>
      ))}
      <ol>
        {value.selected.map((school) => (
          <li key={school.key}>
            <strong>
              {school.institutionName} · {school.score} 分
            </strong>
            <p>
              主要加分项：
              {school.scores
                .filter((s) => s.points > 0)
                .map((s) => `${labels[s.dimension]} +${s.points}`)
                .join("、") || "暂无有据加分，按固定标识排序"}
            </p>
            <details>
              <summary>{school.institutionName}的分项分与依据</summary>
              {school.scores.map((score) => (
                <div key={score.dimension}>
                  <strong>
                    {labels[score.dimension]}：{score.points} 分
                  </strong>
                  <ul>
                    {score.reasons.map((text, index) => (
                      <li key={index}>{text}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          </li>
        ))}
      </ol>
      <h4>未入选或剔除的典型原因</h4>
      <ul>
        {(reasons.length
          ? reasons.slice(0, 5)
          : ["没有明确剔除项；名单可能少于上限。"]
        ).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </details>
  );
}
