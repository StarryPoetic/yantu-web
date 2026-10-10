import type { ResearchStudyMode } from "../../shared/research-recommendation.ts";

/** Keep faculty and mode attached to their local coded row, not a neighbouring entry. */
export function programRowScope(body: string, start: number, end?: number) {
  const lineStart = body.lastIndexOf("\n", start);
  const prefix = body.slice(Math.max(0, lineStart + 1), start);
  const precedingLine =
    lineStart < 0
      ? ""
      : body.slice(body.lastIndexOf("\n", lineStart - 1) + 1, lineStart).trim();
  const collegePattern =
    /(?:^|[|\s:：。；])\d{0,3}([\p{Script=Han}]{1,24}(?:学院|研究院|研究所|学部|中心))\s*\|?\s*$/u;
  const collegeName =
    prefix.match(collegePattern)?.[1] ??
    (prefix.trim() ? undefined : precedingLine.match(collegePattern)?.[1]);
  const row = body
    .slice(start, end)
    .split(/\n|复试|参考课程|参考书目|培养内容|课程设置/)[0];
  const partTime = /非全日制/.test(row);
  const fullTime = /全日制/.test(row.replace(/非全日制/g, ""));
  const studyMode: ResearchStudyMode | undefined =
    partTime === fullTime ? undefined : partTime ? "part_time" : "full_time";
  return { collegeName, studyMode };
}
