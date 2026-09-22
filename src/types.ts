export type Page =
  | "explore"
  | "profile"
  | "assessment"
  | "favorites"
  | "plan"
  | "admin";
export type Tier = "冲刺" | "匹配" | "相对稳妥";
export interface Profile {
  name: string;
  university: string;
  major: string;
  graduation: string;
  year: string;
  english: string;
  math: string;
  hours: string;
  budget: string;
  cities: string[];
  crossMajor: string;
  priorities: Record<string, number>;
  preparation?: string;
  courses?: string;
  notes?: string;
}
export interface School {
  id: string;
  name: string;
  shortName: string;
  city: string;
  tier: Tier;
  tags: string[];
  college: string;
  major: string;
  code: string;
  degree: string;
  mode: string;
  year: string;
  match: number;
  score: number;
  seats: number;
  color: string;
  motto: string;
  reason: string;
  risk: string;
  subjects: string[];
  history: { year: string; cutoff: number; average: number }[];
  jobs: string[];
  cost: string;
}
export interface AssessmentResult {
  completed: boolean;
  answered: number;
  correct: number;
  date: string;
}
export interface FlowProps {
  profile: Profile;
  onSaveProfile: (profile: Profile) => void;
  onNavigate: (page: Page) => void;
  notify: (message: string) => void;
  assessment: AssessmentResult | null;
  onAssessment: (result: AssessmentResult | null) => void;
  onDeleteProfile: () => void;
}
export const initialProfile: Profile = {
  name: "同学",
  university: "浙江工业大学",
  major: "计算机科学与技术",
  graduation: "2027",
  year: "2027",
  english: "CET-6",
  math: "有一定基础",
  hours: "4–6 小时",
  budget: "1–2 万元 / 年",
  cities: ["杭州", "南京", "上海"],
  crossMajor: "接受相近专业",
  priorities: {
    专业兴趣: 85,
    就业机会: 90,
    发展前景: 80,
    政策支持: 55,
    学校与城市: 75,
    招生透明度: 90,
    风险接受度: 60,
  },
};
