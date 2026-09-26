import type {
  CatalogSnapshot,
  DimensionEvidence,
  EvidenceDimension,
  ProgramRevision,
} from "../catalog/types.ts";

export class RecommendationError extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
    this.name = "RecommendationError";
  }
}

export interface AssessmentReference {
  assessmentAttemptId: string;
  diagnosisVersion: string;
}
export interface RecommendationSelection {
  confirmedMajorId?: string | null;
  targetProgramId?: string | null;
  favoriteProgramIds?: string[];
  blockedInstitutionIds?: string[];
  blockedMajorIds?: string[];
  blockedProgramIds?: string[];
}
export interface RecommendationFilters {
  institutionIds?: string[];
  majorDirectionIds?: string[];
  degreeTypes?: ("academic" | "professional")[];
  studyModes?: ("full_time" | "part_time")[];
  cities?: string[];
}
export interface RecommendationRule {
  ruleVersion: string;
  reviewStatus: "draft" | "approved";
  reviewedBy: string[];
  compatibleSchemaVersions: number[];
  requiredDimensions: EvidenceDimension[];
  /** Missing weighted evidence always prevents ranking; weights are never redistributed. */
  missingStrategy: "do_not_rank";
  defaultWeights: Record<EvidenceDimension, number>;
  riskPenalty: number;
  excludeSevereRisk: boolean;
}
export interface RecommendationInput {
  recommendationRunId: string;
  subjectId: string;
  profileVersion: number;
  selectionVersion: number;
  targetAdmissionYear: number;
  profile: Record<string, unknown>;
  selection: RecommendationSelection;
  filters?: RecommendationFilters;
  assessmentRefs?: AssessmentReference[];
  excludedAssessmentRefs?: (AssessmentReference & { reason: string })[];
  catalog: CatalogSnapshot;
  rule?: RecommendationRule;
  generatedAt: string;
}
export interface EligibilityResult {
  status: "eligible" | "ineligible" | "unknown";
  reasons: string[];
}
export interface CandidateDimension {
  dimension: EvidenceDimension;
  status: "known" | "unknown";
  weight: number;
  value: number | null;
  contribution: number | null;
  summary: string;
  sourceIds: string[];
}
export interface RecommendationCandidate {
  programId: string;
  programRevisionId: string;
  program: ProgramRevision;
  eligibility: EligibilityResult;
  dimensions: CandidateDimension[];
  score: number | null;
  evidenceCoverage: { known: number; required: number };
  explanations: string[];
}
export interface RecommendationRun {
  schemaVersion: 1;
  recommendationRunId: string;
  subjectId: string;
  generatedAt: string;
  status: "ready" | "facts_only";
  versions: {
    catalogVersion: string;
    ruleVersion: string;
    profileVersion: number;
    selectionVersion: number;
    assessmentRefs: AssessmentReference[];
  };
  inputSnapshot: {
    targetAdmissionYear: number;
    profile: Record<string, unknown>;
    selection: RecommendationSelection;
    filters: RecommendationFilters;
  };
  ranked: RecommendationCandidate[];
  eligibleUnranked: RecommendationCandidate[];
  pendingVerification: RecommendationCandidate[];
  historicalPreview: RecommendationCandidate[];
  excluded: { programId: string; stage: string; reasons: string[] }[];
  excludedAssessmentRefs: (AssessmentReference & { reason: string })[];
  candidateCount: number;
  warnings: string[];
  degreeAdvice: {
    inclination: "academic" | "professional" | "undetermined";
    reasons: string[];
  };
}

const dimensions: EvidenceDimension[] = [
  "employment",
  "prospects",
  "policy",
  "interest",
  "schoolCity",
  "transparency",
];
const labels: Record<EvidenceDimension, string[]> = {
  employment: ["employment", "就业", "就业机会"],
  prospects: ["prospects", "发展前景"],
  policy: ["policy", "政策支持"],
  interest: ["interest", "专业兴趣"],
  schoolCity: ["schoolCity", "学校与城市"],
  transparency: ["transparency", "招生透明度"],
};
/** Local example flow only. Draft status deliberately prevents production ranking. */
export const exampleRule: RecommendationRule = {
  ruleVersion: "rules-example-pending-review-v1",
  reviewStatus: "draft",
  reviewedBy: [],
  compatibleSchemaVersions: [1],
  requiredDimensions: dimensions,
  missingStrategy: "do_not_rank",
  defaultWeights: {
    employment: 0,
    prospects: 0,
    policy: 0,
    interest: 0,
    schoolCity: 0,
    transparency: 0,
  },
  riskPenalty: 0,
  excludeSevereRisk: true,
};
export function validateRule(input: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { valid: false, errors: ["规则必须为对象"] };
  const value = input as Record<string, unknown>;
  if (typeof value.ruleVersion !== "string" || !value.ruleVersion.trim())
    errors.push("缺少规则版本");
  if (!["draft", "approved"].includes(String(value.reviewStatus)))
    errors.push("审核状态无效");
  if (
    !Array.isArray(value.reviewedBy) ||
    value.reviewedBy.some((item) => typeof item !== "string" || !item.trim())
  )
    errors.push("复核人员无效");
  else if (
    value.reviewStatus === "approved" &&
    new Set(value.reviewedBy).size < 2
  )
    errors.push("批准规则需要两名独立复核人");
  if (
    !Array.isArray(value.compatibleSchemaVersions) ||
    !value.compatibleSchemaVersions.length ||
    !value.compatibleSchemaVersions.every(
      (item) => Number.isInteger(item) && item > 0,
    )
  )
    errors.push("兼容结构版本无效");
  if (
    !Array.isArray(value.requiredDimensions) ||
    !value.requiredDimensions.every((item) => dimensions.includes(item))
  )
    errors.push("所需维度无效");
  if (value.missingStrategy !== "do_not_rank")
    errors.push("缺失策略必须为 do_not_rank");
  if (
    !value.defaultWeights ||
    typeof value.defaultWeights !== "object" ||
    Array.isArray(value.defaultWeights)
  )
    errors.push("默认权重缺失");
  else
    for (const dimension of dimensions) {
      const weight = (value.defaultWeights as Record<string, unknown>)[
        dimension
      ];
      if (
        typeof weight !== "number" ||
        !Number.isFinite(weight) ||
        weight < 0 ||
        weight > 100
      )
        errors.push(`${dimension} 默认权重无效`);
    }
  if (
    typeof value.riskPenalty !== "number" ||
    !Number.isFinite(value.riskPenalty) ||
    value.riskPenalty < 0 ||
    value.riskPenalty > 1
  )
    errors.push("风险降权值无效");
  if (typeof value.excludeSevereRisk !== "boolean" || !value.excludeSevereRisk)
    errors.push("严重已确认风险必须退出前十");
  return { valid: !errors.length, errors };
}
const unknown = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === "" ||
  value === "不确定" ||
  value === "unknown";
const stableOrder = (a: { programId: string }, b: { programId: string }) =>
  a.programId < b.programId ? -1 : a.programId > b.programId ? 1 : 0;

export function evaluateEligibility(
  program: ProgramRevision,
  profile: Record<string, unknown>,
  targetAdmissionYear: number,
): EligibilityResult {
  if (program.identity.targetAdmissionYear !== targetAdmissionYear)
    return {
      status: "unknown",
      reasons: ["target_year_unpublished: 当前修订属于其他招生年度"],
    };
  if (program.isExample)
    return {
      status: "unknown",
      reasons: [program.eligibility.reason ?? "示例项目不能用于报考资格判断"],
    };
  const missing: string[] = program.eligibility.complete
    ? []
    : ["必要报考条件未完整核验"];
  if (
    program.availability !== "verified_current" ||
    program.eligibility.availability !== "verified_current"
  )
    missing.push(program.eligibility.reason ?? "招生资料或资格要求尚未核验");
  const failed: string[] = [];
  for (const condition of program.eligibility.conditions) {
    if (condition.availability !== "verified_current") {
      missing.push(`${condition.label}：条件待核验`);
      continue;
    }
    const value = profile[condition.profileField];
    if (unknown(value)) {
      missing.push(`${condition.label}：个人条件未填写或不确定`);
      continue;
    }
    let meets: boolean;
    switch (condition.operator) {
      case "present":
        meets = true;
        break;
      case "equals":
        meets = value === condition.expected;
        break;
      case "one_of":
        meets =
          Array.isArray(condition.expected) &&
          condition.expected.includes(String(value));
        break;
      case "at_least":
      case "at_most": {
        // HTML profile fields preserve strings. Only an explicit scalar number is normalized;
        // ranges, prose, blanks and uncertainty never acquire invented numeric defaults.
        const numeric =
          typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)
            ? Number(value)
            : value;
        if (
          typeof numeric !== "number" ||
          !Number.isFinite(numeric) ||
          typeof condition.expected !== "number"
        ) {
          missing.push(`${condition.label}：需要明确数值`);
          continue;
        }
        meets =
          condition.operator === "at_least"
            ? numeric >= condition.expected
            : numeric <= condition.expected;
        break;
      }
      default:
        missing.push(`${condition.label}：不支持的资格条件`);
        continue;
    }
    if (!meets) failed.push(`${condition.label}：已知个人条件不符合`);
  }
  if (failed.length)
    return { status: "ineligible", reasons: [...failed, ...missing] };
  return missing.length
    ? { status: "unknown", reasons: missing }
    : {
        status: "eligible",
        reasons: ["已核验当年全部必要条件且符合已提供的个人条件"],
      };
}

function normalizedWeights(
  profile: Record<string, unknown>,
  rule?: RecommendationRule,
): Record<EvidenceDimension, number> {
  if (
    profile.priorities !== undefined &&
    (!profile.priorities ||
      typeof profile.priorities !== "object" ||
      Array.isArray(profile.priorities))
  )
    throw new RecommendationError(
      "INVALID_WEIGHT",
      "INVALID_WEIGHT: 偏好权重必须为对象",
    );
  const supplied =
    profile.priorities &&
    typeof profile.priorities === "object" &&
    !Array.isArray(profile.priorities)
      ? (profile.priorities as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(supplied))
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    )
      throw new RecommendationError(
        "INVALID_WEIGHT",
        `INVALID_WEIGHT: ${key} 必须为 0–100 的有限数值`,
      );
  const weights = Object.fromEntries(
    dimensions.map((dimension) => {
      const key = labels[dimension].find(
        (label) => supplied[label] !== undefined,
      );
      return [
        dimension,
        key
          ? (supplied[key] as number)
          : (rule?.defaultWeights[dimension] ?? 0),
      ];
    }),
  ) as Record<EvidenceDimension, number>;
  if (
    Object.values(weights).some(
      (value) => !Number.isFinite(value) || value < 0 || value > 100,
    )
  )
    throw new RecommendationError("INVALID_RULE_WEIGHTS");
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum === 0) return weights;
  return Object.fromEntries(
    dimensions.map((d) => [d, weights[d] / sum]),
  ) as Record<EvidenceDimension, number>;
}

function filterReasons(
  program: ProgramRevision,
  selection: RecommendationSelection,
  filters: RecommendationFilters,
): string[] {
  const reasons: string[] = [];
  if (selection.blockedInstitutionIds?.includes(program.identity.institutionId))
    reasons.push("已屏蔽学校");
  if (
    program.majorDirectionIds.some((id) =>
      selection.blockedMajorIds?.includes(id),
    )
  )
    reasons.push("已屏蔽专业方向");
  if (selection.blockedProgramIds?.includes(program.programId))
    reasons.push("已屏蔽招生项目");
  if (
    selection.confirmedMajorId &&
    !program.majorDirectionIds.includes(selection.confirmedMajorId)
  )
    reasons.push("不在已确认专业范围");
  if (
    filters.institutionIds?.length &&
    !filters.institutionIds.includes(program.identity.institutionId)
  )
    reasons.push("不符合学校筛选");
  if (
    filters.majorDirectionIds?.length &&
    !program.majorDirectionIds.some((id) =>
      filters.majorDirectionIds!.includes(id),
    )
  )
    reasons.push("不符合专业筛选");
  if (
    filters.degreeTypes?.length &&
    !filters.degreeTypes.includes(program.identity.degreeType)
  )
    reasons.push("不符合学位类型筛选");
  if (
    filters.studyModes?.length &&
    !filters.studyModes.includes(program.identity.studyMode)
  )
    reasons.push("不符合学习方式筛选");
  if (filters.cities?.length && !filters.cities.includes(program.display.city))
    reasons.push("不符合显式城市筛选");
  return reasons;
}

export function recommend(input: RecommendationInput): RecommendationRun {
  if (input.catalog.schemaVersion !== 1)
    throw new RecommendationError("UNSUPPORTED_CATALOG_SCHEMA");
  if (
    !input.recommendationRunId?.trim() ||
    !input.subjectId?.trim() ||
    !input.catalog.catalogVersion?.trim()
  )
    throw new RecommendationError("INVALID_INPUT_ID");
  if (
    !Number.isInteger(input.profileVersion) ||
    input.profileVersion < 0 ||
    !Number.isInteger(input.selectionVersion) ||
    input.selectionVersion < 0 ||
    !Number.isInteger(input.targetAdmissionYear) ||
    input.targetAdmissionYear < 2000 ||
    input.targetAdmissionYear > 2200
  )
    throw new RecommendationError("INVALID_INPUT_VERSION");
  if (!Number.isFinite(Date.parse(input.generatedAt)))
    throw new RecommendationError("INVALID_GENERATED_AT");
  const rule = input.rule;
  if (rule) {
    const checked = validateRule(rule);
    if (!checked.valid)
      throw new RecommendationError(
        "INVALID_RULE",
        `INVALID_RULE: ${checked.errors.join("；")}`,
      );
  }
  const ruleApproved =
    rule?.reviewStatus === "approved" &&
    new Set(rule.reviewedBy).size >= 2 &&
    rule.compatibleSchemaVersions.includes(input.catalog.schemaVersion);
  const weights = normalizedWeights(input.profile, rule);
  const hasWeights = Object.values(weights).some((value) => value > 0);
  const filters = input.filters ?? {};
  if (
    filters.degreeTypes?.some(
      (value) => !["academic", "professional"].includes(value),
    ) ||
    filters.studyModes?.some(
      (value) => !["full_time", "part_time"].includes(value),
    )
  )
    throw new RecommendationError("INVALID_FILTER_ENUM");
  const run: RecommendationRun = {
    schemaVersion: 1,
    recommendationRunId: input.recommendationRunId,
    subjectId: input.subjectId,
    generatedAt: input.generatedAt,
    status: ruleApproved && hasWeights ? "ready" : "facts_only",
    versions: {
      catalogVersion: input.catalog.catalogVersion,
      ruleVersion: rule?.ruleVersion ?? "rules-pending-review",
      profileVersion: input.profileVersion,
      selectionVersion: input.selectionVersion,
      assessmentRefs: structuredClone(input.assessmentRefs ?? []),
    },
    inputSnapshot: structuredClone({
      targetAdmissionYear: input.targetAdmissionYear,
      profile: input.profile,
      selection: input.selection,
      filters,
    }),
    ranked: [],
    eligibleUnranked: [],
    pendingVerification: [],
    historicalPreview: [],
    excluded: [],
    excludedAssessmentRefs: structuredClone(input.excludedAssessmentRefs ?? []),
    candidateCount: input.catalog.programs.length,
    warnings: [
      "五题测评仅用于知识点诊断；当前实现不将诊断转换成分数或录取概率。",
    ],
    degreeAdvice: {
      inclination: "undetermined",
      reasons: [
        "培养倾向需结合科研或职业目标及具体项目培养资料；当前证据不足，可自主选择学硕或专硕。",
      ],
    },
  };
  if (!ruleApproved)
    run.warnings.push(
      "推荐规则尚未完成人工评审，当前提供事实检索与待核验候选，不生成正式排名。",
    );
  if (!hasWeights)
    run.warnings.push(
      "六项排序偏好权重合计为零，请调整偏好；风险接受程度单独用于风险策略。",
    );
  const seen = new Set<string>();
  const rankable: RecommendationCandidate[] = [];
  for (const program of [...input.catalog.programs].sort(stableOrder)) {
    if (seen.has(program.programId))
      throw new RecommendationError("DUPLICATE_CATALOG_PROJECT");
    seen.add(program.programId);
    if (
      program.publicationStatus !== "published" ||
      program.reviewStatus !== "approved" ||
      input.catalog.withdrawnRevisionIds.includes(program.programRevisionId)
    ) {
      run.excluded.push({
        programId: program.programId,
        stage: "publication",
        reasons: ["资料修订未发布、未审核或已撤回，不能用于新推荐"],
      });
      continue;
    }
    const constraints = filterReasons(program, input.selection, filters);
    if (constraints.length) {
      run.excluded.push({
        programId: program.programId,
        stage: "user_constraints",
        reasons: constraints,
      });
      continue;
    }
    const eligibility = evaluateEligibility(
      program,
      input.profile,
      input.targetAdmissionYear,
    );
    const evidenceMap = new Map<EvidenceDimension, DimensionEvidence>(
      program.evidence.map((e) => [e.dimension, e]),
    );
    const dimensionResults: CandidateDimension[] = dimensions.map(
      (dimension) => {
        const evidence = evidenceMap.get(dimension);
        const known =
          evidence?.availability === "verified_current" &&
          evidence.value !== null &&
          evidence.ruleVersion === rule?.ruleVersion &&
          Number.isFinite(evidence.value) &&
          evidence.value >= 0 &&
          evidence.value <= 1 &&
          evidence.sourceIds.length > 0;
        return {
          dimension,
          status: known ? "known" : "unknown",
          weight: weights[dimension],
          value: known ? evidence.value : null,
          contribution: known ? evidence.value! * weights[dimension] : null,
          summary: evidence?.summary ?? "缺少对应维度的已核验证据",
          sourceIds: evidence?.sourceIds ?? [],
        };
      },
    );
    const required = dimensionResults.filter(
      (d) => d.weight > 0 || rule?.requiredDimensions.includes(d.dimension),
    );
    const candidate: RecommendationCandidate = {
      programId: program.programId,
      programRevisionId: program.programRevisionId,
      program: structuredClone(program),
      eligibility,
      dimensions: dimensionResults,
      score: null,
      evidenceCoverage: {
        known: required.filter((d) => d.status === "known").length,
        required: required.length,
      },
      explanations: [...eligibility.reasons],
    };
    if (program.identity.targetAdmissionYear !== input.targetAdmissionYear) {
      candidate.explanations.push("仅为其他年度资料预览，不证明当年报考资格");
      run.historicalPreview.push(candidate);
      continue;
    }
    if (eligibility.status === "ineligible") {
      run.excluded.push({
        programId: program.programId,
        stage: "eligibility",
        reasons: eligibility.reasons,
      });
      continue;
    }
    if (eligibility.status === "unknown") {
      run.pendingVerification.push(candidate);
      continue;
    }
    const risks = program.risks.filter(
      (risk) =>
        risk.reviewStatus === "approved" &&
        new Set(risk.reviewers).size >= 2 &&
        new Set(risk.independentEvidenceClusters).size >= 2 &&
        risk.status === "active" &&
        risk.applicableYears.includes(input.targetAdmissionYear) &&
        (!risk.validUntil || risk.validUntil >= input.generatedAt),
    );
    if (
      ruleApproved &&
      rule.excludeSevereRisk &&
      risks.some((risk) => risk.severity === "severe")
    ) {
      run.excluded.push({
        programId: program.programId,
        stage: "risk",
        reasons: risks
          .filter((risk) => risk.severity === "severe")
          .map((risk) => risk.summary),
      });
      continue;
    }
    if (
      !ruleApproved ||
      !hasWeights ||
      required.some((d) => d.status === "unknown")
    ) {
      candidate.explanations.push(
        !ruleApproved
          ? "排序规则待审核"
          : !hasWeights
            ? "排序权重合计为零"
            : "所选偏好的证据不全，暂不能排序；缺失维度不自动重分配权重",
      );
      run.eligibleUnranked.push(candidate);
      continue;
    }
    const priorities = input.profile.priorities as
      | Record<string, unknown>
      | undefined;
    const acceptance = Number(
      priorities?.riskAcceptance ??
        priorities?.["风险接受程度"] ??
        priorities?.["风险接受度"] ??
        50,
    );
    const riskMultiplier = 1 - acceptance / 100;
    const penalty = risks.some((risk) => risk.severity === "moderate")
      ? rule.riskPenalty * riskMultiplier
      : 0;
    candidate.score = Number(
      (
        dimensionResults.reduce((sum, d) => sum + (d.contribution ?? 0), 0) -
        penalty
      ).toFixed(8),
    );
    candidate.explanations.push(
      "分值仅为已审核规则的证据贡献合计，不是匹配百分比或录取概率",
    );
    if (penalty > 0)
      candidate.explanations.push(
        `已复核中度风险按接受程度有限降权 ${penalty.toFixed(4)}`,
      );
    rankable.push(candidate);
  }
  rankable.sort((a, b) => b.score! - a.score! || stableOrder(a, b));
  run.ranked = rankable.slice(0, 10);
  for (const candidate of rankable.slice(10))
    run.excluded.push({
      programId: candidate.programId,
      stage: "ranking",
      reasons: ["本次排序位于前十之外"],
    });
  if (!run.ranked.length)
    run.warnings.push("尚无有效推荐结果；待核验候选不占正式前十名额。");
  return run;
}
