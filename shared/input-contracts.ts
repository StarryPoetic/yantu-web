export const REASONING_MAX_LENGTH = 1000;
export const profileTextFields = {
  name: ["称呼", 200],
  university: ["本科院校", 200],
  major: ["本科专业", 200],
  graduation: ["毕业年份", 200],
  year: ["报考年份", 200],
  english: ["英语经历", 200],
  math: ["数学基础", 200],
  hours: ["每天可投入时间", 200],
  budget: ["年度预算", 200],
  crossMajor: ["跨专业意愿", 200],
  preparation: ["备考进度", 200],
  courses: ["相关课程基础", 3000],
  notes: ["补充说明", 3000],
  targetMajor: ["感兴趣的专业或领域", 200],
  studyGoal: ["职业与学习目标", 200],
  degreePreference: ["学位偏好", 200],
} as const;
export function profileTextError(key: string, value: unknown): string | null {
  const rule = profileTextFields[key as keyof typeof profileTextFields];
  return rule && (typeof value !== "string" || value.length > rule[1])
    ? `${rule[0]}最多 ${rule[1]} 字，请精简后保存。`
    : null;
}
