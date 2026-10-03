import type { ResearchReport } from "../../server/explanation/research.ts";
import {
  examDescription,
  factorStatusLabels,
  tierLabels,
  type SchoolRecommendation,
} from "./research-report";
import { ResearchSourceLinks } from "./ResearchSourceLinks";
import type { ResearchHistoricalExamEvidence } from "../../shared/research-matching";

function HistoricalExamReference({
  reference,
  sources,
}: {
  reference: ResearchHistoricalExamEvidence;
  sources: ResearchReport["sources"];
}) {
  return (
    <section aria-label="历年备考参考科目">
      <h5>{reference.year}年备考参考科目</h5>
      <p>{reference.reason}</p>
      {!!reference.subjects.length && (
        <ul>
          {reference.subjects.map((subject) => (
            <li key={subject.code}>
              {subject.code} {subject.name}
            </li>
          ))}
        </ul>
      )}
      {reference.quote && (
        <details>
          <summary>查看历年科目原文</summary>
          <blockquote>{reference.quote}</blockquote>
        </details>
      )}
      {reference.sourceId && (
        <ResearchSourceLinks
          ids={[reference.sourceId]}
          sources={sources}
          label="历年科目依据来源"
        />
      )}
    </section>
  );
}

export function ResearchExamEvidence({
  exams,
  sources,
}: {
  exams?: SchoolRecommendation["exams"];
  sources: ResearchReport["sources"];
}) {
  return (
    <section className="research-exam-evidence" aria-label="实际考试科目">
      {exams?.historicalReference && (
        <HistoricalExamReference
          reference={exams.historicalReference}
          sources={sources}
        />
      )}
      {exams?.history && exams.history.length > 1 && (
        <details>
          <summary>近年考试科目对照</summary>
          <table>
            <thead>
              <tr>
                <th>年度</th>
                <th>初试科目</th>
                <th>核验说明</th>
              </tr>
            </thead>
            <tbody>
              {exams.history.map((item) => (
                <tr key={item.year}>
                  <th>{item.year}年</th>
                  <td>
                    {item.subjects.length
                      ? item.subjects
                          .map((subject) => `${subject.code} ${subject.name}`)
                          .join("、")
                      : "同年科目有冲突，需核对方向或考试组"}
                  </td>
                  <td>
                    {item.reason}
                    {item.sourceId && (
                      <ResearchSourceLinks
                        ids={[item.sourceId]}
                        sources={sources}
                        label={`${item.year}年科目来源`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {!!exams?.historicalChanges?.length && (
        <section aria-label="考试科目年度变化">
          <h5>已读到的年度科目变化</h5>
          <ul>
            {exams.historicalChanges.map((change, index) => (
              <li key={index}>
                {change.summary}
                <ResearchSourceLinks
                  ids={change.sourceIds}
                  sources={sources}
                  label="科目变化依据来源"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {exams?.historicalReference &&
      exams.status === "historical" &&
      exams.year === exams.historicalReference.year ? (
        <p className="ws-muted">
          目标年度科目尚待补充核验，可先按上述历年科目安排准备，再核对年度变化。
        </p>
      ) : (
        <>
          <h5>
            {exams?.historicalReference
              ? `${exams.status === "verified_current" && exams.year ? `${exams.year}年` : "目标年度"}科目补充核验`
              : "实际考试科目"}
          </h5>
          <p
            className={
              "research-evidence-status " + (exams?.status ?? "unknown")
            }
          >
            {examDescription(exams)}
          </p>
          {exams?.subjects.length ? (
            <ul>
              {exams.subjects.map((subject, index) => (
                <li key={subject.code + ":" + index}>
                  {subject.code} {subject.name}
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            {exams?.reason ??
              "尚未取得可核验的招生目录考试科目，准备建议不能替代报考要求。"}
          </p>
          {exams?.quote && (
            <details>
              <summary>查看考试科目原文</summary>
              <blockquote>{exams.quote}</blockquote>
            </details>
          )}
          {exams?.sourceId && (
            <ResearchSourceLinks
              ids={[exams.sourceId]}
              sources={sources}
              label="考试科目依据来源"
            />
          )}
        </>
      )}
    </section>
  );
}

export function ResearchMatchEvidence({
  match,
  sources,
}: {
  match?: SchoolRecommendation["match"];
  sources: ResearchReport["sources"];
}) {
  if (!match) return null;
  return (
    <section className="research-match-evidence" aria-label="需求匹配依据">
      <h5>需求匹配依据</h5>
      <p>{match.summary}</p>
      <dl className="research-factor-list">
        {match.factors.map((factor, index) => (
          <div key={factor.field + ":" + index} className={factor.status}>
            <dt>
              {factor.label}
              <span>{factorStatusLabels[factor.status]}</span>
            </dt>
            <dd>
              {factor.reason}
              <ResearchSourceLinks
                ids={factor.sourceIds}
                sources={sources}
                label={factor.label + "匹配来源"}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ResearchProgramAlternatives({
  items,
  sources,
}: {
  items: SchoolRecommendation["programAlternatives"];
  sources: ResearchReport["sources"];
}) {
  if (!items?.length) return null;
  return (
    <details className="research-program-alternatives">
      <summary>同校其他专业比较 · {items.length} 项</summary>
      {items.map((item, index) => (
        <section
          key={item.disciplineCode + ":" + index}
          className="research-program-alternative"
          aria-label={"同校专业：" + item.programName}
        >
          <h5>
            {item.programName} · {item.disciplineCode}
          </h5>
          <p>
            {item.degreeType === "academic" ? "学术学位" : "专业学位"} ·{" "}
            {tierLabels[item.tier]}
          </p>
          <ResearchMatchEvidence match={item.match} sources={sources} />
          {item.referenceBasis && (
            <p>
              比较基准：{item.referenceBasis.year}年。
              {item.referenceBasis.reason}
            </p>
          )}
          {(item.collegeName || item.majorCode) && (
            <p className="research-program-identity">
              {item.collegeName && <span>招生院系：{item.collegeName}</span>}
              {item.majorCode && <span>专业代码：{item.majorCode}</span>}
            </p>
          )}
          {item.rationale && <p>{item.rationale}</p>}
          <ResearchExamEvidence exams={item.exams} sources={sources} />
          {!!item.preparation?.length && (
            <section aria-label="同校专业准备建议">
              <h5>该专业的准备建议</h5>
              <ul>
                {item.preparation.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </section>
          )}
          {!!item.tradeoffs?.length && (
            <section aria-label="同校专业需要权衡">
              <h5>该专业需要权衡</h5>
              <ul>
                {item.tradeoffs.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </section>
          )}
          {!!item.uncertainties?.length && (
            <section aria-label="同校专业待确认事项">
              <h5>该专业仍需确认</h5>
              <ul>
                {item.uncertainties.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </section>
          )}
          <ResearchSourceLinks
            ids={item.citations}
            sources={sources}
            label={item.programName + "依据来源"}
          />
        </section>
      ))}
    </details>
  );
}
