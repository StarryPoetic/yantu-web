/** Stable diagnostic domains; point labels remain the auditable knowledge tags. */
export const SCREENING_AREAS = {
  math: ["calculus", "linear", "probability", "math-one", "economics"],
  english: ["reading", "sentence", "translation", "writing"],
} as const;

export function knowledgeArea(module: string, point: string): string {
  if (module === "math") {
    if (/^数一拓展：/.test(point)) return "math-one";
    if (/^经济应用：/.test(point)) return "economics";
    if (/概率|统计/.test(point)) return "probability";
    if (/线性代数|线代/.test(point)) return "linear";
    if (/^高数：|导数|定积分|函数极限/.test(point)) return "calculus";
  }
  if (module === "english") {
    if (/阅读/.test(point)) return "reading";
    if (/长难句/.test(point)) return "sentence";
    if (/翻译/.test(point)) return "translation";
    if (/写作/.test(point)) return "writing";
  }
  return "other";
}
