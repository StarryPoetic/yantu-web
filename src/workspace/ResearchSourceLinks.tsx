import type { ResearchReport } from "../../server/explanation/research";
import { safeUrl } from "./ui";
import { sourceBadges } from "./research-report";

export function ResearchSourceMetadata({
  source,
  full = false,
}: {
  source: ResearchReport["sources"][number];
  full?: boolean;
}) {
  const badges = sourceBadges(source);
  const plaintextNote =
    source.retrievalNote ||
    "明文传输（HTTP）读取，内容可能被网络中间环节篡改，仅作待核验线索。";
  return (
    <>
      {source.kind === "authority_page" && (
        <span className="research-source-badge">权威官方</span>
      )}
      {source.kind === "reference_page" && (
        <span className="research-source-badge">非官方，仅供参考</span>
      )}
      {badges.plaintext &&
        (full ? (
          <p>{plaintextNote}</p>
        ) : (
          <span className="research-source-badge" title={plaintextNote}>
            明文传输
          </span>
        ))}
      {badges.platform && (
        <span className="research-source-badge">研招网平台</span>
      )}
      {source.library && (
        <small className="research-source-time">
          资料库复用 · 原获取时间：
          <time dateTime={source.retrievedAt}>
            {new Date(source.retrievedAt).toLocaleString("zh-CN")}
          </time>
        </small>
      )}
      {full && !badges.plaintext && source.retrievalNote && (
        <p>{source.retrievalNote}</p>
      )}
    </>
  );
}

export function ResearchSourceLinks({
  ids,
  sources,
  label = "推荐依据来源",
}: {
  ids: string[];
  sources: ResearchReport["sources"];
  label?: string;
}) {
  const links = [...new Set(ids)].flatMap((id) => {
    const source = sources.find((entry) => entry.id === id);
    const url = source && safeUrl(source.url);
    return source && url ? [{ ...source, url }] : [];
  });
  if (!links.length) return null;
  return (
    <ul className="research-reference-links" aria-label={label}>
      {links.map((source) => (
        <li key={source.id}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title}
          </a>
          <ResearchSourceMetadata source={source} />
        </li>
      ))}
    </ul>
  );
}
