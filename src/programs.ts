import { schools as baseSchools } from "./data";
import type { School } from "./types";

export { baseSchools };

// Alternative project fixtures let students compare directions within one
// university. These are explicitly fabricated, not real admission catalogues.
export const schools: School[] = [
  ...baseSchools,
  {
    ...baseSchools[0],
    id: "njust-practice",
    major: "电子信息 · 计算机技术",
    code: "085404",
    degree: "专业学位",
    tags: ["工程实践", "专业学位", "数学一"],
    match: 87,
    seats: 78,
    score: 360,
    subjects: ["思想政治理论", "英语一", "数学一", "计算机专业综合"],
    reason:
      "同校另一方向的演示：偏向软件与系统的工程实践，可与学术研究方向比较培养侧重。",
    risk: "同一学校不同项目的考试科目、费用与培养安排可能不同；本组合为模拟，须核验招生目录。",
    cost: "中高 · 需系统复习数学一，并准备工程项目与实践表达。",
  },
  {
    ...baseSchools[1],
    id: "hdu-research",
    major: "计算机科学与技术",
    code: "081200",
    degree: "学术学位",
    tags: ["学术研究", "学术学位", "数学一"],
    match: 85,
    seats: 42,
    score: 355,
    subjects: ["思想政治理论", "英语一", "数学一", "计算机学科专业基础"],
    reason:
      "同校另一方向的演示：关注计算机理论、研究方法与论文阅读，便于在城市偏好下比较不同培养路径。",
    risk: "专业课与数学的准备范围需重新确认；不能直接复用另一学位类型的分数方案。",
    cost: "中高 · 需补充研究方法、论文阅读与数学一相关基础。",
  },
];

export const majorDirections = [
  {
    id: "research",
    name: "计算机科学与技术",
    code: "081200",
    degree: "学术学位",
    label: "学硕 · 研究探索",
    headline: "保持好奇，把问题研究得更深。",
    learning: "算法、计算机系统与研究方法，了解如何提出问题、验证假设。",
    jobs: "软件研发、数据工程、研究助理等方向；部分研究岗位需要更深入的研究经历。",
    cost: "关注数学与理论基础、论文阅读和研究表达；跨专业需补充核心课程。",
  },
  {
    id: "practice",
    name: "计算机技术",
    code: "085404",
    degree: "专业学位",
    label: "专硕 · 工程实践",
    headline: "用专业能力，解决真实的问题。",
    learning: "软件与系统工程、项目开发与应用实践，理解技术如何落地。",
    jobs: "软件开发、测试开发、云计算等方向；岗位仍看重基础、实践与技术沟通。",
    cost: "强化数据结构、系统知识与工程项目；科目、学制及学费均按具体项目核验。",
  },
] as const;

export function directionOf(school: School) {
  return school.degree === "学术学位" ? "research" : "practice";
}
