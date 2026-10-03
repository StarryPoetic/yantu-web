import type { ResearchReport } from "../../server/explanation/research";
import { safeUrl } from "./ui";

export function ResearchSourceLinks({
  ids,
  sources,
  label = "推荐依据来源",
}: {
  ids: string[];
  sources: ResearchReport["sources"];
  label?: string;
}) {
  const links = ids.flatMap((id) => {
    const source = sources.find((entry) => entry.id === id);
    const url = source && safeUrl(source.url);
    return source && url ? [{ ...source, url }] : [];
  });
  if (!links.length) return null;
  return (
    <ul className="research-reference-links" aria-label={label}>
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
