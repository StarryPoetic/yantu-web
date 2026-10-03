import type { ResearchDecisionBasis } from "../../shared/research-decision.ts";

/** Synthetic display data only; these observations are not admissions facts. */
export function decisionDisplayFixture(): ResearchDecisionBasis {
  return {
    version: "assessment-route-v1",
    summary: "测评只说明目前练习范围，学位路线还需结合目标与具体项目比较。",
    assessments: [
      {
        module: "math",
        scope: "math-one",
        status: "example_practice",
        counts: { correct: 1, incorrect: 1, unanswered: 1, total: 3 },
        points: ["函数概念", "导数计算"],
        weakPoints: ["导数计算"],
        references: [
          {
            assessmentAttemptId: "display-math-1",
            diagnosisVersion: "diagnosis-display-v1",
            questionBankVersion: "example-bank-v1",
            submittedAt: "2026-10-04T00:00:00Z",
            example: true,
          },
        ],
        observations: ["示例练习中导数计算需要复习，尚未覆盖完整数学内容。"],
        nextSteps: ["先复习导数运算，再按真实目录安排练习。"],
        limitations: ["不能把小题量示例换算为数学一或数学二的胜任度。"],
      },
      {
        module: "english",
        scope: null,
        status: "unassessed",
        counts: { correct: 0, incorrect: 0, unanswered: 0, total: 0 },
        points: [],
        weakPoints: [],
        references: [],
        observations: ["英语尚未测评，不推定英语基础强弱。"],
        nextSteps: ["补充阅读练习后再整理复习任务。"],
        limitations: [],
      },
    ],
    degreeRoutes: [
      {
        degreeType: "academic",
        priority: "compare",
        reasons: ["学术路线可比较研究训练与培养内容。"],
        verificationNeeded: ["核对论文训练与导师安排。"],
      },
      {
        degreeType: "professional",
        priority: "goal_lead",
        reasons: ["实践职业目标可优先比较专业学位培养项目。"],
        verificationNeeded: ["专业学位不能据此认定必考数学二或英语二。"],
      },
    ],
    examPolicy: {
      summary: "实际考试科目来自具体学校专业的招生目录，测评不能替代目录要求。",
      comparisons: [
        {
          module: "math",
          options: ["数学一", "数学二"],
          assessmentUse: "练习结果仅用于安排复习，不能选择考试类型。",
          nextSteps: ["逐校核对数学科目代码与年份。"],
        },
        {
          module: "english",
          options: ["英语一", "英语二"],
          assessmentUse: "尚未测评英语，也不能从学位名称推定英语科目。",
          nextSteps: ["逐校核对英语科目。"],
        },
      ],
    },
    ignoredAssessments: [
      {
        assessmentAttemptId: "old-display-1",
        diagnosisVersion: "old-v1",
        reason: "这份旧记录与本次版本不一致，未用于判断。",
      },
    ],
    limitations: ["不换算考研分数、整体专业适合度或录取概率。"],
  };
}
