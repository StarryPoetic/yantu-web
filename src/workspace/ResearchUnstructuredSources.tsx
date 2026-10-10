import type { ResearchReport } from "../../server/explanation/research.ts";
import { ResearchSourceLinks } from "./ResearchSourceLinks";

export function ResearchUnstructuredSources({
  report,
}: {
  report: ResearchReport;
}) {
  const schools = new Map<
    string,
    NonNullable<ResearchReport["unstructuredSources"]>
  >();
  for (const entry of report.unstructuredSources ?? []) {
    if (
      !report.sources.some(
        (source) =>
          source.id === entry.sourceId && source.kind === "official_page",
      )
    )
      continue;
    const entries = schools.get(entry.institutionName) ?? [];
    entries.push(entry);
    schools.set(entry.institutionName, entries);
  }
  if (!schools.size) return null;
  return (
    <section
      className="research-unstructured"
      aria-label="按学校查看已读未结构化原文"
    >
      <h3>已读原文，供你核对</h3>
      {[...schools].map(([school, entries]) => (
        <section key={school} aria-label={school + "已读未结构化原文"}>
          <h4>{school}</h4>
          <details>
            <summary>已读但未结构化的原文 · {entries.length} 条</summary>
            <p className="research-field-help">
              待确认：这些页面尚未抽取出已绑定字段，不能据此认定专业收费或校区。
            </p>
            {entries.map((entry) => {
              const source = report.sources.find(
                (source) => source.id === entry.sourceId,
              )!;
              const text = entry.excerpt.slice(0, 6000);
              return (
                <article key={entry.sourceId}>
                  <ResearchSourceLinks
                    ids={[entry.sourceId]}
                    sources={report.sources}
                    label="已读未结构化原文来源"
                  />
                  <small>
                    获取时间：
                    <time dateTime={source.retrievedAt}>
                      {new Date(source.retrievedAt).toLocaleString("zh-CN")}
                    </time>
                  </small>
                  <blockquote>{text.slice(0, 600)}</blockquote>
                  {text.length > 600 && (
                    <details>
                      <summary>展开更多原文（最多 6000 字）</summary>
                      <blockquote>{text.slice(600)}</blockquote>
                    </details>
                  )}
                  {(entry.truncated || entry.excerpt.length > 6000) && (
                    <p className="research-field-help">
                      已达到展示上限，请打开来源查看完整页面。
                    </p>
                  )}
                </article>
              );
            })}
          </details>
        </section>
      ))}
    </section>
  );
}
