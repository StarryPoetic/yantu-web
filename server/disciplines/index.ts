import catalogData from "../../knowledge/disciplines/catalog.json" with { type: "json" };
import signals from "../../knowledge/disciplines/signals.json" with { type: "json" };
import type { Profile } from "../../shared/profile.ts";
import type {
  Discipline,
  DisciplineCatalog,
  GuidanceAssessment,
  GuidanceDirection,
  GuidanceRun,
} from "./types.ts";

export type * from "./types.ts";
export { programMatchesDiscipline } from "../../shared/discipline-matching.ts";
export const guidanceRuleVersion = `${signals.ruleVersion}-notes-v1`;
const directory = catalogData as DisciplineCatalog;
const byCode = new Map(directory.items.map((item) => [item.code, item]));

export function isDisciplineId(value: string): boolean {
  return byCode.has(value);
}

export function getDisciplineCatalog(
  filters: {
    q?: string;
    groupCode?: string;
    degreeType?: Discipline["degreeType"];
  } = {},
): DisciplineCatalog & { matched: number } {
  const query = filters.q?.trim().toLocaleLowerCase() ?? "";
  const items = directory.items.filter(
    (item) =>
      (!filters.groupCode || item.groupCode === filters.groupCode) &&
      (!filters.degreeType || item.degreeType === filters.degreeType) &&
      (!query ||
        [item.code, item.name, item.groupName, ...item.aliases].some((value) =>
          value.toLocaleLowerCase().includes(query),
        )),
  );
  return structuredClone({ ...directory, items, matched: items.length });
}

export interface GuidanceInput {
  subjectId: string;
  guidanceRunId: string;
  generatedAt: string;
  profile: Profile;
  profileVersion: number;
  selectionVersion: number;
  confirmedMajorId: string | null;
  excludedMajorIds: string[];
  assessments: GuidanceAssessment[];
  ignoredAssessments?: GuidanceRun["assessmentSummary"]["ignored"];
}

/** Literal user language gives exploration clues, never authorization or ability scores. */
function clue(
  value: string | undefined,
  discipline: Discipline,
): string | null {
  if (!value) return null;
  const terms = [
    ...new Set([
      discipline.name,
      ...discipline.aliases,
      ...signals.connections
        .filter((connection) => connection.codes.includes(discipline.code))
        .flatMap((connection) => connection.terms),
    ]),
  ].sort((a, b) => b.length - a.length);
  const affirmativeClauses = value
    .split(/[，,。；;！？!?\n]|但是|不过|而是|但/)
    .filter(
      (part) =>
        !/(不想|不考虑|不喜欢|不愿|不接受|不要|拒绝|排除|不学|不懂|没学|不会|不感兴趣|没兴趣|没有兴趣|不打算|无意|不适合|非本专业)/.test(
          part,
        ),
    );
  return (
    terms.find((term) =>
      affirmativeClauses.some((part) =>
        part.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
      ),
    ) ?? null
  );
}

function normalizeLegacyId(id: string | null): string | null {
  // These two names belonged to the former demo only. They are never defaults.
  return id === "research" ? "0812" : id === "practice" ? "0854" : id;
}

export function generateGuidance(input: GuidanceInput): GuidanceRun {
  const profile = input.profile;
  const confirmedId = normalizeLegacyId(input.confirmedMajorId);
  const excluded = new Set(input.excludedMajorIds.map(normalizeLegacyId));
  const noCross = /不接受|不愿|不跨|只考虑本专业/.test(profile.crossMajor);
  const directions: GuidanceDirection[] = directory.items.map((discipline) => {
    const intent = clue(profile.targetMajor, discipline);
    const background = clue(profile.major, discipline);
    const course = clue(profile.courses, discipline);
    const goal = clue(profile.studyGoal, discipline);
    const note = clue(profile.notes, discipline);
    let status: GuidanceDirection["status"] = "open_exploration";
    const reasons: string[] = [];
    if (excluded.has(discipline.code)) {
      status = "user_excluded";
      reasons.push("你已主动屏蔽这个方向；仍可在完整目录中查看并解除屏蔽。");
    } else {
      if (confirmedId === discipline.code) {
        status = "explicit_interest";
        reasons.push(
          "你已明确确认这个专业方向；这是个人选择，不代表报考资格已经通过。",
        );
      } else if (intent) {
        status = "explicit_interest";
        reasons.push(
          `你填写的意向专业包含“${intent}”，可先了解此方向的培养内容。`,
        );
      }
      if (background || course) {
        if (status === "open_exploration") status = "background_connection";
        reasons.push(
          background
            ? `你自述的本科专业包含“${background}”，与此方向存在可进一步核对的学习内容联系。`
            : `你填写的已学课程包含“${course}”，可用课程大纲核对与此方向的衔接。`,
        );
      }
      if (goal) {
        if (status === "open_exploration") status = "goal_connection";
        reasons.push(
          `你的读研目标包含“${goal}”；可比较此方向培养方案是否服务于该目标。`,
        );
      }
      if (note) {
        if (status === "open_exploration") status = "goal_connection";
        reasons.push(
          `你的补充说明中出现“${note}”；这只是待你确认的兴趣或目标线索，不证明已有学习基础、官方招生要求或报考资格。`,
        );
      }
      if (!reasons.length)
        reasons.push(
          "现有自述没有形成直接关联线索；保持开放探索，不能据此判断不适合。",
        );
    }
    const preparation = [
      background || course
        ? "整理已学课程与实践成果，对照目标院校培养方案核实基础。"
        : "先阅读培养方案与代表课程，再评估是否愿意补修基础。",
    ];
    if (noCross && !background && !course)
      preparation.push(
        "你表示不希望跨专业；需先确认此方向与你本科专业的具体衔接，再决定是否纳入目标。",
      );
    return {
      discipline: structuredClone(discipline),
      status,
      reasons,
      preparation,
      verificationNeeded: [
        "年度招生专业、招生学院和招生状态",
        "本科专业及学历等报考条件",
        "实际初试科目、复试要求、学制和学费",
      ],
      rank: null,
      fitScore: null,
      eligible: "unknown",
    };
  });
  const highlightedIds = directions
    .filter((d) => d.status === "explicit_interest")
    .map((d) => d.discipline.id);
  for (const status of ["background_connection", "goal_connection"] as const) {
    for (const direction of directions) {
      if (highlightedIds.length >= 8) break;
      if (
        direction.status !== status ||
        (noCross && status === "goal_connection")
      )
        continue;
      highlightedIds.push(direction.discipline.id);
    }
  }
  // Catalogue order is stable and conveys no rank. Explicit selections may exceed eight.
  const focus = directions.filter((d) =>
    highlightedIds.includes(d.discipline.id),
  );
  const observations = input.assessments.flatMap((assessment) =>
    assessment.modules
      .filter((module) => module.module !== "major")
      .map((module) => {
        const label =
          (
            { math: "数学", english: "英语", politics: "政治" } as Record<
              string,
              string
            >
          )[module.module] ?? module.module;
        return `${label}本次${module.total}题：答对${module.correct}、答错${module.incorrect}、未答${module.unanswered}。${assessment.example ? "这是示例练习观察。" : "这是已提交测评的局部观察。"}不能换算考研分数、推断专业要求或淘汰专业。`;
      }),
  );
  const considerations: string[] = [];
  if (profile.crossMajor)
    considerations.push(
      `跨专业意愿：${profile.crossMajor}。这只影响探索顺序，具体允许条件必须查年度招生资料。`,
    );
  if (/相近专业/.test(profile.crossMajor))
    considerations.push(
      "你只考虑相近专业；名称或关键词相似不能证明专业相近，需对照已学课程、培养内容及招生条件后再确认。",
    );
  if (profile.degreePreference)
    considerations.push(
      `你填写的培养偏好是“${profile.degreePreference}”；学术/专业学位具体培养方式仍需比较各校方案。`,
    );
  if (profile.cities.length)
    considerations.push(
      `地域意向为${profile.cities.join("、")}；全国目录不包含这些地区实际招生覆盖，选择学校时再核对。`,
    );
  if (profile.hours)
    considerations.push(
      `你填写的学习时间为${profile.hours}；需结合考试科目和实际基础制定计划。`,
    );
  if (profile.budget)
    considerations.push(
      `你填写的预算为${profile.budget}；当前方向探索没有推算任何学校学费。`,
    );
  if (!input.assessments.length)
    considerations.push(
      "尚无可读取的公共课测评；可以先探索专业，再用练习了解具体知识点。",
    );
  const followUpQuestions: string[] = [];
  if (!profile.major.trim())
    followUpQuestions.push("本科或专科所学专业是什么？有哪些已学课程？");
  if (!profile.targetMajor?.trim())
    followUpQuestions.push("想深入哪些学科或做哪类工作？也可以保持尚未确定。");
  if (!profile.studyGoal?.trim())
    followUpQuestions.push(
      "读研最希望获得什么：研究训练、职业能力，还是其他具体目标？",
    );
  if (!profile.crossMajor.trim())
    followUpQuestions.push("是否愿意跨专业并补修基础？");
  if (!focus.length)
    followUpQuestions.push(
      "先选择感兴趣的门类，并查看课程内容；不必因为示例院校只有计算机而选择计算机。",
    );
  return {
    schemaVersion: 1,
    guidanceRunId: input.guidanceRunId,
    subjectId: input.subjectId,
    generatedAt: input.generatedAt,
    status: focus.length ? "evidence_based" : "exploration",
    versions: {
      catalogVersion: directory.catalogVersion,
      guidanceRuleVersion,
      profileVersion: input.profileVersion,
      selectionVersion: input.selectionVersion,
      assessmentRefs: input.assessments.map(
        ({ assessmentAttemptId, diagnosisVersion }) => ({
          assessmentAttemptId,
          diagnosisVersion,
        }),
      ),
    },
    conclusion: focus.length
      ? `根据你已填写的意向、本科背景或读研目标，可先探索${focus
          .slice(0, 5)
          .map((d) => d.discipline.name)
          .join(
            "、",
          )}${focus.length > 5 ? "等方向" : ""}。这些是自述关联线索，尚不足以形成适合度排名或报考结论。`
      : "当前信息不足以缩小专业范围。你可以从全国14个门类的完整基础目录开始探索，补充学习经历和目标后再比较方向；目前不默认任何专业。",
    considerations,
    followUpQuestions,
    highlightedIds,
    directions,
    assessmentSummary: {
      used: input.assessments.filter(
        (assessment) =>
          !assessment.example && assessment.usableForRecommendation,
      ).length,
      references: structuredClone(input.assessments),
      observations,
      ignored: [
        ...structuredClone(input.ignoredAssessments ?? []),
        ...input.assessments
          .filter(
            (assessment) =>
              assessment.example || !assessment.usableForRecommendation,
          )
          .map(({ assessmentAttemptId, diagnosisVersion, example }) => ({
            assessmentAttemptId,
            diagnosisVersion,
            reason: example
              ? "示例练习仅展示本次观察，不作为正式推荐依据"
              : "该诊断尚不具备正式推荐可用性，仅展示本次观察",
          })),
      ],
    },
    inputSnapshot: {
      profile: structuredClone(profile) as unknown as Record<string, unknown>,
      confirmedMajorId: input.confirmedMajorId,
      excludedMajorIds: [...input.excludedMajorIds],
    },
    limitations: [
      "这是基于用户自述与公开分类目录的专业探索结论，不是经过验证的适合度排序、录取概率或资格审查。",
      "公共课的小样本诊断仅说明本次覆盖知识点；不代表考研分数、完整能力或某专业的实际考试要求。",
      "专业关联词表是产品解释规则，不是官方本科与研究生专业对应关系；未出现关联线索的专业仍在完整候选中。",
      ...directory.warnings,
    ],
    coverage: structuredClone(directory.coverage),
    sources: structuredClone(directory.sources),
  };
}
