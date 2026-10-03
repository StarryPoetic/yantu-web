import type { ResearchReport } from "../../server/explanation/research.ts";
import {
  examDescription,
  factorStatusLabels,
  tierLabels,
  type SchoolRecommendation,
} from "./research-report";
import { ResearchSourceLinks } from "./ResearchSourceLinks";

export function ResearchExamEvidence({
  exams,
  sources,
}: {
  exams?: SchoolRecommendation["exams"];
  sources: ResearchReport["sources"];
}) {
  return (
    <section className="research-exam-evidence" aria-label="实际考试科目">
      <h5>实际考试科目</h5>
      <p className={"research-evidence-status " + (exams?.status ?? "unknown")}>
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
