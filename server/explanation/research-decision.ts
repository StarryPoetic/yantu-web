import type {
  DegreeRouteBasis,
  PreparationModule,
  PreparationObservation,
  ResearchDecisionBasis,
} from "../../shared/research-decision.ts";
import type { GuidanceAssessment, GuidanceRun } from "../disciplines/types.ts";
import { researchSubjectAdvice } from "./research-subject-advice.ts";
import {
  affirmativePreference,
  explicitDegreeConstraint,
} from "../../shared/profile-preferences.ts";

const modules: PreparationModule[] = ["math", "english"];
const labels = { math: "数学", english: "英语" };
const scopeLabels: Record<string, string> = {
  "common-foundation": "公共基础",
  "math-one": "数学一",
  "math-two": "数学二",
  "math-three": "数学三",
  "english-one": "英语一",
  "english-two": "英语二",
};
const emptyCounts = () => ({
  correct: 0,
  incorrect: 0,
  unanswered: 0,
  total: 0,
});
const unique = (items: string[]) => [...new Set(items.filter(Boolean))].sort();

/** Missing dates do not masquerade as latest evidence; ties have a stable identity order. */
function latestFirst(a: GuidanceAssessment, b: GuidanceAssessment) {
  const aTime = Date.parse(a.submittedAt ?? "");
  const bTime = Date.parse(b.submittedAt ?? "");
  const difference =
    (Number.isFinite(bTime) ? bTime : -1) -
    (Number.isFinite(aTime) ? aTime : -1);
  return (
    difference ||
    a.assessmentAttemptId.localeCompare(b.assessmentAttemptId, "en") ||
    a.diagnosisVersion.localeCompare(b.diagnosisVersion, "en")
  );
}

function validCounts(counts: PreparationObservation["counts"]) {
  return (
    [counts.correct, counts.incorrect, counts.unanswered, counts.total].every(
      (value) => Number.isInteger(value) && value >= 0,
    ) &&
    counts.correct + counts.incorrect + counts.unanswered === counts.total &&
    counts.total > 0
  );
}

function describe(
  module: PreparationModule,
  assessment?: GuidanceAssessment,
): PreparationObservation {
  const label = labels[module];
  if (!assessment)
    return {
      module,
      scope: null,
      status: "unassessed",
      counts: emptyCounts(),
      points: [],
      weakPoints: [],
      references: [],
      observations: [`没有可读取的${label}测评；不推断你的${label}水平。`],
      nextSteps: [
        `先核对候选项目实际${label}科目，再完成相应范围的专项与限时诊断。`,
      ],
      limitations: ["未测评不等于基础薄弱，也不影响保留符合个人目标的学校。"],
    };
  const counts = assessment.modules.find((item) => item.module === module)!;
  const items =
    assessment.items?.filter((item) => item.module === module) ?? [];
  const points = unique(items.map((item) => item.point));
  const weakPoints = unique(
    items
      .filter((item) => item.outcome !== "correct")
      .map((item) => item.point),
  );
  const scope = assessment.scope?.[module] ?? null;
  const formal = !assessment.example && assessment.usableForRecommendation;
  const limitations = [
    "本次结果只适用于已测知识点；不换算考研分数、录取概率或完整学科能力。",
    "同一科目与范围只保留一份最近可用诊断，复测不累加成更大的独立样本。",
    ...assessment.limitations,
  ];
  if (!formal)
    limitations.push(
      assessment.example
        ? "题库为示例练习，未经正式审校；结果只用于回顾练习，不作为考试路线或学位选择的正式依据。"
        : "本次诊断尚不具备正式推荐可用性；结果只用于回顾，不作为考试路线或学位选择的正式依据。",
    );
  if (!scope)
    limitations.push(
      "记录缺少实际测评范围，不能归入数学一、数学二或英语一、英语二的专项证据。",
    );
  else if (scope === "common-foundation")
    limitations.push(
      "这是公共基础范围，不是数学一、数学二或英语一、英语二的完整专项诊断。",
    );
  if (!items.length)
    limitations.push(
      "旧记录缺少逐题知识点与范围快照，不能把汇总错题归属到某一科目或考试范围。",
    );
  else if (items.some((item) => item.calibration !== "calibrated"))
    limitations.push(
      "题目难度未全部完成校准；答对率不用于估计某考试路线的难易或个人胜任度。",
    );
  const comparisonScopes =
    module === "math"
      ? ["math-one", "math-two"]
      : ["english-one", "english-two"];
  if (
    items.length &&
    items.every((item) =>
      comparisonScopes.every((scope) => item.scopes.includes(scope)),
    )
  )
    limitations.push(
      "所测题目共同适用于多个科目范围，没有检测范围差异；不能用同一批基础题证明数学一与数学二或英语一与英语二哪条路线更适合。",
    );
  limitations.push(
    "本次记录没有完整目标科目覆盖与完整限时卷成绩，考试路线的准备成本仍需补充诊断。",
  );
  if (
    !assessment.submittedAt ||
    !Number.isFinite(Date.parse(assessment.submittedAt))
  )
    limitations.push(
      "记录缺少有效提交时间；使用固定身份顺序选择诊断，不声称它是最新能力状态。",
    );
  const nextSteps = weakPoints.length
    ? [
        `先复习本次答错或未答的${weakPoints.join("、")}，再做不同题目的变式与限时练习。`,
      ]
    : counts.incorrect || counts.unanswered
      ? [`回顾本次${label}错题和未答题；补充逐题知识点记录后再制定专项计划。`]
      : [`用${label}变式题和完整限时练习检查稳定性，继续覆盖本次未测内容。`];
  nextSteps.push(
    `对候选项目要求的${label}科目分别核对范围与未测内容，记录可投入时间，再比较补习任务。`,
  );
  return {
    module,
    scope,
    status: formal
      ? "local_diagnosis"
      : assessment.example
        ? "example_practice"
        : "practice_observation",
    counts: {
      correct: counts.correct,
      incorrect: counts.incorrect,
      unanswered: counts.unanswered,
      total: counts.total,
    },
    points,
    weakPoints,
    references: [
      {
        assessmentAttemptId: assessment.assessmentAttemptId,
        diagnosisVersion: assessment.diagnosisVersion,
        ...(assessment.questionBankVersion
          ? { questionBankVersion: assessment.questionBankVersion }
          : {}),
        ...(assessment.submittedAt
          ? { submittedAt: assessment.submittedAt }
          : {}),
        example: assessment.example,
      },
    ],
    observations: [
      `${label}${scope ? `（${scopeLabels[scope] ?? "已记录的测评"}范围）` : ""}本次${counts.total}题：答对${counts.correct}、答错${counts.incorrect}、未答${counts.unanswered}。${formal ? "可用作这些知识点的准备线索。" : "保留为练习观察。"}`,
      ...(points.length ? [`实际覆盖：${points.join("、")}。`] : []),
    ],
    nextSteps,
    limitations: unique(limitations),
  };
}

function degreeRoutes(run: GuidanceRun): DegreeRouteBasis[] {
  const profile = run.inputSnapshot.profile;
  const constraint = explicitDegreeConstraint(
    profile.degreePreference,
    profile.notes,
  );
  const preference = affirmativePreference(profile.degreePreference);
  const goal = affirmativePreference(profile.studyGoal);
  const preferred = {
    academic: /学硕|学术(?:学位|型)/.test(preference),
    professional: /专硕|专业(?:学位|型)/.test(preference),
  };
  const goals = {
    academic: /科研|研究训练|学术|读博|博士/.test(goal),
    professional: /就业|职业|工程实践|应用实践|产业|项目实践|工作能力/.test(
      goal,
    ),
  };
  return (["academic", "professional"] as const).map((degreeType) => {
    const label = degreeType === "academic" ? "学术学位" : "专业学位";
    const excluded = constraint !== null && constraint !== degreeType;
    const explicit = constraint
      ? constraint === degreeType
      : preferred[degreeType] &&
        !(preferred.academic && preferred.professional);
    const goalLead = !excluded && goals[degreeType];
    const reasons = [
      ...(excluded
        ? [
            "你明确限定了另一种学位路线，本次候选范围排除这一类；如要重新比较，需要调整当前限制。",
          ]
        : []),
      ...(explicit
        ? [
            constraint
              ? `你的明确学位限制提供了优先比较${label}项目的依据。`
              : `你明确填写了“${String(profile.degreePreference)}”，优先比较${label}项目。`,
          ]
        : []),
      ...(goalLead
        ? [
            `你的目标“${String(profile.studyGoal)}”提供了比较${label}项目培养内容的线索。`,
          ]
        : []),
      "测评错题用于安排补习任务，不把公共课短测成绩转换为学硕或专硕的适合度。",
    ];
    if (!explicit && !goalLead && !excluded)
      reasons.unshift(
        `现有目标没有形成单独优先${label}的依据，保留两类项目比较。`,
      );
    return {
      degreeType,
      priority: explicit
        ? "explicit_preference"
        : goalLead
          ? "goal_lead"
          : "compare",
      reasons,
      verificationNeeded: [
        "具体项目的培养方案、课程、论文与实践要求，以及与个人读研目标的联系。",
        "目标年度的初试科目、报考条件、学习形式、学制和费用。",
        "以项目实际要求比较补习内容和时间；学位类型不能代替考试科目核验。",
      ],
    };
  });
}

/** All decisions are derived from a fixed snapshot; no provider call or stochastic scoring. */
export function deriveResearchDecision(
  run: GuidanceRun,
): ResearchDecisionBasis {
  const references = [...run.assessmentSummary.references].sort(latestFirst);
  const ignored = [...run.assessmentSummary.ignored];
  const assessments = modules.flatMap((module) => {
    const byScope = new Map<string, GuidanceAssessment>();
    for (const assessment of references) {
      const counts = assessment.modules.find((item) => item.module === module);
      if (!counts) continue;
      if (!validCounts(counts)) {
        ignored.push({
          assessmentAttemptId: assessment.assessmentAttemptId,
          diagnosisVersion: assessment.diagnosisVersion,
          reason: `${labels[module]}计数无效或不一致，不用于准备比较。`,
        });
        continue;
      }
      const scope = assessment.scope?.[module] ?? "";
      // Formal observations take precedence over an unreviewed later practice.
      const previous = byScope.get(scope);
      if (
        !previous ||
        (!assessment.example &&
          assessment.usableForRecommendation &&
          (previous.example || !previous.usableForRecommendation))
      ) {
        byScope.set(scope, assessment);
        if (previous)
          ignored.push({
            assessmentAttemptId: previous.assessmentAttemptId,
            diagnosisVersion: previous.diagnosisVersion,
            reason: `${labels[module]}同范围已有可用正式诊断，本次练习不累计进正式准备依据。`,
          });
      } else
        ignored.push({
          assessmentAttemptId: assessment.assessmentAttemptId,
          diagnosisVersion: assessment.diagnosisVersion,
          reason: `${labels[module]}同范围保留最近可用诊断，不重复累加复测题量。`,
        });
    }
    return byScope.size
      ? [...byScope.entries()]
          .sort(([a], [b]) => a.localeCompare(b, "en"))
          .map(([, assessment]) => describe(module, assessment))
      : [describe(module)];
  });
  return {
    version: "assessment-route-v1",
    ...(researchSubjectAdvice(run)
      ? { subjectAdvice: researchSubjectAdvice(run) }
      : {}),
    summary:
      "依据个人目标比较培养路线；依据已测知识点安排准备任务；考试科目以目标年度具体学校专业目录为准。",
    assessments,
    degreeRoutes: degreeRoutes(run),
    examPolicy: {
      summary:
        "数学与英语是不同科目；数学一、数学二在数学内比较，英语一、英语二在英语内比较。不能选择数学一来代替英语一，实际组合由具体项目规定。",
      comparisons: modules.map((module) => ({
        module,
        options:
          module === "math"
            ? ["数学一", "数学二", "数学三", "其他或不考数学"]
            : ["英语一", "英语二", "其他外语"],
        assessmentUse:
          "测评提供已测知识点的准备线索；范围未覆盖、题量有限或示例库不能证明某考试路线更适合。",
        nextSteps: [
          "先核验同校同专业同学习形式的目标年度科目与代码，再比较实际考试组合。",
          "完成各候选科目范围的专项及完整限时诊断，记录未测内容、错题原因与复习时间。",
          "按补习任务与可投入时间比较准备成本；不根据短测分数强制选科或淘汰学校。",
        ],
      })),
    },
    ignoredAssessments: [
      ...new Map(
        ignored.map((item) => [
          `${item.assessmentAttemptId}:${item.diagnosisVersion}:${item.reason}`,
          item,
        ]),
      ).values(),
    ],
    limitations: [
      "这是可追溯的准备与目标比较规则，不是经过心理测量校准的能力预测模型。",
      "学术学位和专业学位都需核对实际培养方案；不能简单理解为读博专属或就业专属。",
      "基础自评与短测不足以确定考试胜任度；不足的证据明确保留为待评估，不补写能力分数。",
    ],
  };
}
