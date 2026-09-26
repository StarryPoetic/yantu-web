import exampleCatalog from "../../knowledge/catalog/example.json" with { type: "json" };
import type {
  Availability,
  CatalogImport,
  CatalogSnapshot,
  CatalogState,
  ProgramRevision,
} from "./types.ts";
export type * from "./types.ts";

const availabilityValues = [
  "verified_current",
  "verified_historical",
  "missing",
  "unverified",
  "conflicting",
  "expired",
  "not_applicable",
];
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const list = (value: unknown): value is unknown[] => Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const date = (value: unknown): boolean =>
  nonempty(value) && Number.isFinite(Date.parse(value));

export class CatalogError extends Error {
  code: string;
  details: string[];
  constructor(code: string, details: string[]) {
    super(details.join("；"));
    this.name = "CatalogError";
    this.code = code;
    this.details = details;
  }
}

export function createEmptyCatalog(): CatalogState {
  return {
    schemaVersion: 1,
    sources: [],
    revisions: [],
    releases: [],
    activeCatalogVersion: null,
    withdrawnRevisionIds: [],
    coverage: {
      years: [],
      description: "尚无已发布招生资料",
      limitations: ["目录尚未建立"],
    },
    audit: [],
  };
}

/** Names are deliberately absent: a renamed college does not create a new annual identity. */
export function projectIdentityKey(
  program: Pick<ProgramRevision, "identity">,
): string {
  const i = program.identity;
  return JSON.stringify([
    i.institutionId,
    i.collegeId,
    i.majorCode,
    i.codeSystem,
    i.directionId,
    i.degreeType,
    i.studyMode,
    i.targetAdmissionYear,
    i.campusId,
    i.admissionUnitId,
    i.examGroupId,
  ]);
}

function bindCollegeOwner(
  owners: Map<string, string>,
  collegeId: string,
  institutionId: string,
): boolean {
  const existing = owners.get(collegeId);
  if (existing !== undefined && existing !== institutionId) return false;
  owners.set(collegeId, institutionId);
  return true;
}

/** Validate untrusted JSON once at the import seam; no coercion turns unknown facts into truths. */
export function validateCatalogImport(input: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!record(input))
    return { valid: false, errors: ["导入文件必须是 JSON 对象"] };
  if (input.schemaVersion !== 1) errors.push("不支持的 schemaVersion");
  if (
    !record(input.coverage) ||
    !list(input.coverage.years) ||
    !input.coverage.years.every(
      (y) => Number.isInteger(y) && Number(y) >= 2000 && Number(y) <= 2200,
    ) ||
    !nonempty(input.coverage.description) ||
    !list(input.coverage.limitations) ||
    !input.coverage.limitations.every(nonempty)
  )
    errors.push("缺少有效的覆盖年份、说明和限制");
  if (!list(input.sources) || !list(input.programs))
    return {
      valid: false,
      errors: [...errors, "sources 和 programs 必须为数组"],
    };
  if (input.programs.length > 5000 || input.sources.length > 20000)
    errors.push("单批次最多 5000 个项目和 20000 个来源");
  const sourceIds = new Set<string>();
  const sourceRecords = new Map<string, Record<string, unknown>>();
  for (const [n, source] of input.sources.entries()) {
    const prefix = `sources[${n}]`;
    if (!record(source)) {
      errors.push(`${prefix} 必须为对象`);
      continue;
    }
    for (const field of ["sourceId", "publisher", "title", "usageRestrictions"])
      if (!nonempty(source[field])) errors.push(`${prefix}.${field} 不能为空`);
    if (
      !["official", "reviewed_material", "example"].includes(
        String(source.type),
      )
    )
      errors.push(`${prefix}.type 无效`);
    if (
      !date(source.collectedAt) ||
      (source.publishedAt !== null && !date(source.publishedAt)) ||
      (source.verifiedAt !== null && !date(source.verifiedAt))
    )
      errors.push(`${prefix} 来源日期无效`);
    if (!nonempty(source.url) && !nonempty(source.fileReference))
      errors.push(`${prefix} 需要 URL 或原始文件引用`);
    if (
      source.url !== null &&
      (!nonempty(source.url) || !/^https?:\/\//i.test(source.url))
    )
      errors.push(`${prefix}.url 只允许 http/https`);
    if (
      source.contentHash !== null &&
      (!nonempty(source.contentHash) ||
        !/^sha256:[a-f0-9]{64}$/i.test(source.contentHash))
    )
      errors.push(`${prefix}.contentHash 必须是 SHA-256`);
    if (nonempty(source.sourceId)) {
      if (sourceIds.has(source.sourceId))
        errors.push(`重复 sourceId: ${source.sourceId}`);
      sourceIds.add(source.sourceId);
      sourceRecords.set(source.sourceId, source);
    }
  }
  const checkSources = (
    ids: unknown,
    prefix: string,
    availability?: unknown,
  ) => {
    if (!list(ids) || !ids.every((id) => nonempty(id) && sourceIds.has(id))) {
      errors.push(`${prefix} 含缺失或无效来源`);
      return;
    }
    if (
      availability === "verified_current" ||
      availability === "verified_historical"
    ) {
      if (
        !ids.length ||
        ids.some(
          (id) =>
            !sourceRecords.get(String(id))?.verifiedAt ||
            sourceRecords.get(String(id))?.type === "example",
        )
      )
        errors.push(`${prefix} 已核验事实必须引用经过核验的非示例来源`);
    }
  };
  const checkAvailability = (value: unknown, prefix: string) => {
    if (!availabilityValues.includes(String(value)))
      errors.push(`${prefix} 可用性无效`);
  };
  const identities = new Map<string, string>();
  const programs = new Map<string, string>();
  const revisions = new Set<string>();
  const collegeOwners = new Map<string, string>();
  for (const [n, program] of input.programs.entries()) {
    const prefix = `programs[${n}]`;
    if (!record(program)) {
      errors.push(`${prefix} 必须为对象`);
      continue;
    }
    for (const field of ["programId", "programRevisionId"])
      if (!nonempty(program[field])) errors.push(`${prefix}.${field} 不能为空`);
    if (revisions.has(String(program.programRevisionId)))
      errors.push(`${prefix} 修订 ID 重复`);
    revisions.add(String(program.programRevisionId));
    if (!record(program.identity)) {
      errors.push(`${prefix} 缺少完整年度身份`);
      continue;
    }
    const identity = program.identity;
    for (const field of [
      "institutionId",
      "collegeId",
      "majorCode",
      "codeSystem",
      "directionId",
    ])
      if (!nonempty(identity[field]))
        errors.push(`${prefix}.identity.${field} 不能为空`);
    if (
      nonempty(identity.collegeId) &&
      nonempty(identity.institutionId) &&
      !bindCollegeOwner(
        collegeOwners,
        identity.collegeId,
        identity.institutionId,
      )
    )
      errors.push(
        `${prefix} 学院 ID ${identity.collegeId} 已绑定其他学校；同名学院必须使用不同稳定 ID`,
      );
    for (const field of ["campusId", "admissionUnitId", "examGroupId"])
      if (identity[field] !== null && !nonempty(identity[field]))
        errors.push(`${prefix}.identity.${field} 必须明确填写或为 null`);
    if (
      !Number.isInteger(identity.targetAdmissionYear) ||
      Number(identity.targetAdmissionYear) < 2000 ||
      Number(identity.targetAdmissionYear) > 2200
    )
      errors.push(`${prefix} 招生年份无效`);
    if (
      !["academic", "professional"].includes(String(identity.degreeType)) ||
      !["full_time", "part_time"].includes(String(identity.studyMode))
    )
      errors.push(`${prefix} 学位类型或学习方式无效`);
    const key = projectIdentityKey(program as unknown as ProgramRevision);
    if (identities.has(key)) errors.push(`${prefix} 同批次年度项目身份冲突`);
    identities.set(key, String(program.programId));
    if (
      programs.has(String(program.programId)) &&
      programs.get(String(program.programId)) !== key
    )
      errors.push(`${prefix} 项目 ID 不可复用到另一年度身份`);
    programs.set(String(program.programId), key);
    if (
      !record(program.display) ||
      [
        "institutionName",
        "shortName",
        "collegeName",
        "majorName",
        "directionName",
        "city",
        "color",
      ].some(
        (field) =>
          !nonempty((program.display as Record<string, unknown>)[field]),
      )
    )
      errors.push(`${prefix} 显示字段不完整`);
    if (
      !list(program.majorDirectionIds) ||
      !program.majorDirectionIds.every(nonempty)
    )
      errors.push(`${prefix} 专业方向数组无效`);
    if (
      !["draft", "pending_review", "approved", "rejected"].includes(
        String(program.reviewStatus),
      )
    )
      errors.push(`${prefix} 审核状态无效`);
    if (
      !["unpublished", "published", "withdrawn"].includes(
        String(program.publicationStatus),
      )
    )
      errors.push(`${prefix} 发布状态无效`);
    if (typeof program.isExample !== "boolean")
      errors.push(`${prefix} 必须明确 isExample`);
    if (
      program.supersedesRevisionId !== null &&
      !nonempty(program.supersedesRevisionId)
    )
      errors.push(`${prefix} supersedesRevisionId 无效`);
    checkAvailability(program.availability, prefix);
    if (program.isExample && program.availability !== "unverified")
      errors.push(`${prefix} 示例资料只能标记 unverified`);
    checkSources(
      program.sourceIds,
      `${prefix}.sourceIds`,
      program.availability,
    );
    const programSources = list(program.sourceIds) ? program.sourceIds : [];
    const checkProjectSources = (
      ids: unknown,
      path: string,
      availability?: unknown,
    ) => {
      checkSources(ids, path, availability);
      if (list(ids) && ids.some((id) => !programSources.includes(id)))
        errors.push(`${path} 的来源引用必须登记在当前项目 sourceIds 中`);
    };
    if (
      !record(program.eligibility) ||
      typeof program.eligibility.complete !== "boolean" ||
      !list(program.eligibility.conditions)
    )
      errors.push(`${prefix} 资格信息不完整`);
    else {
      checkAvailability(
        program.eligibility.availability,
        `${prefix}.eligibility`,
      );
      checkProjectSources(
        program.sourceIds,
        `${prefix}.eligibility`,
        program.eligibility.availability,
      );
      for (const condition of program.eligibility.conditions) {
        if (
          !record(condition) ||
          !nonempty(condition.conditionId) ||
          !nonempty(condition.label) ||
          !nonempty(condition.profileField) ||
          !["equals", "one_of", "at_least", "at_most", "present"].includes(
            String(condition.operator),
          )
        ) {
          errors.push(`${prefix} 资格条件无效`);
          continue;
        }
        if (
          condition.operator === "one_of" &&
          (!list(condition.expected) || !condition.expected.every(nonempty))
        )
          errors.push(`${prefix} one_of 条件需要字符串数组`);
        if (
          ["at_least", "at_most"].includes(String(condition.operator)) &&
          !finite(condition.expected)
        )
          errors.push(`${prefix} 数值资格条件需要有限数值`);
        if (
          condition.operator === "equals" &&
          !["string", "number", "boolean"].includes(typeof condition.expected)
        )
          errors.push(`${prefix} equals 条件缺少预期值`);
        checkAvailability(condition.availability, `${prefix}.eligibility`);
        checkProjectSources(
          condition.sourceIds,
          `${prefix}.eligibility`,
          condition.availability,
        );
      }
    }
    if (!list(program.subjects)) errors.push(`${prefix} 科目数组缺失`);
    else {
      const ids = new Set<string>();
      for (const subject of program.subjects) {
        if (
          !record(subject) ||
          !nonempty(subject.subjectId) ||
          !nonempty(subject.name)
        ) {
          errors.push(`${prefix} 科目信息无效`);
          continue;
        }
        if (ids.has(subject.subjectId)) errors.push(`${prefix} 科目 ID 重复`);
        ids.add(subject.subjectId);
        if (
          subject.maxScore !== null &&
          (!finite(subject.maxScore) || subject.maxScore <= 0)
        )
          errors.push(`${prefix} 科目满分无效`);
        if (
          subject.minimumScore !== null &&
          (!finite(subject.minimumScore) ||
            subject.minimumScore < 0 ||
            (finite(subject.maxScore) &&
              subject.minimumScore > subject.maxScore))
        )
          errors.push(`${prefix} 单科门槛无效`);
        if (subject.optionGroupId !== null && !nonempty(subject.optionGroupId))
          errors.push(`${prefix} 科目选项组无效`);
        checkAvailability(subject.availability, `${prefix}.subjects`);
        checkProjectSources(
          subject.sourceIds,
          `${prefix}.subjects`,
          subject.availability,
        );
      }
    }
    if (!record(program.scoreRequirements))
      errors.push(`${prefix} 分数要求缺失`);
    else {
      const requirement = program.scoreRequirements;
      checkAvailability(
        requirement.availability,
        `${prefix}.scoreRequirements`,
      );
      checkProjectSources(
        program.sourceIds,
        `${prefix}.scoreRequirements`,
        requirement.availability,
      );
      if (
        requirement.totalMaxScore !== null &&
        (!finite(requirement.totalMaxScore) || requirement.totalMaxScore <= 0)
      )
        errors.push(`${prefix} 总分满分无效`);
      if (
        requirement.totalMinimumScore !== null &&
        (!finite(requirement.totalMinimumScore) ||
          requirement.totalMinimumScore < 0 ||
          (finite(requirement.totalMaxScore) &&
            requirement.totalMinimumScore > requirement.totalMaxScore))
      )
        errors.push(`${prefix} 总分门槛无效`);
    }
    for (const field of ["tuitionPerYear", "durationYears"])
      if (
        program[field] !== null &&
        (!finite(program[field]) || Number(program[field]) < 0)
      )
        errors.push(`${prefix}.${field} 必须为非负值或 null`);
    for (const field of [
      "claims",
      "historyScoreRecords",
      "evidence",
      "risks",
      "preparationNotes",
    ])
      if (!list(program[field])) errors.push(`${prefix}.${field} 必须为数组`);
    if (
      list(program.preparationNotes) &&
      !program.preparationNotes.every(nonempty)
    )
      errors.push(`${prefix} 准备说明无效`);
    if (list(program.claims))
      for (const claim of program.claims) {
        if (
          !record(claim) ||
          !nonempty(claim.claimId) ||
          !nonempty(claim.field) ||
          !nonempty(claim.locator) ||
          !nonempty(claim.scope) ||
          !nonempty(claim.enteredBy) ||
          claim.targetAdmissionYear !== identity.targetAdmissionYear
        ) {
          errors.push(`${prefix} 字段断言身份、年份或定位不完整`);
          continue;
        }
        checkAvailability(claim.availability, `${prefix}.claims`);
        checkProjectSources(
          [claim.sourceId],
          `${prefix}.claims`,
          claim.availability,
        );
        if (
          claim.value !== null &&
          !["string", "number", "boolean"].includes(typeof claim.value)
        )
          errors.push(`${prefix} 字段断言值类型无效`);
        if (typeof claim.value === "number" && !Number.isFinite(claim.value))
          errors.push(`${prefix} 字段断言数值无效`);
        if (
          String(claim.availability).startsWith("verified_") &&
          !nonempty(claim.reviewedBy)
        )
          errors.push(`${prefix} 已核验断言缺少复核人`);
      }
    if (list(program.evidence)) {
      const dimensions = new Set<string>();
      for (const evidence of program.evidence) {
        if (
          !record(evidence) ||
          ![
            "employment",
            "prospects",
            "policy",
            "interest",
            "schoolCity",
            "transparency",
          ].includes(String(evidence.dimension)) ||
          !nonempty(evidence.summary)
        ) {
          errors.push(`${prefix} 维度证据无效`);
          continue;
        }
        if (dimensions.has(String(evidence.dimension)))
          errors.push(`${prefix} 同一维度不得重复加分`);
        dimensions.add(String(evidence.dimension));
        if (
          evidence.value !== null &&
          (!finite(evidence.value) ||
            evidence.value < 0 ||
            evidence.value > 1 ||
            !nonempty(evidence.ruleVersion))
        )
          errors.push(`${prefix} 维度量纲或规则版本无效`);
        checkAvailability(evidence.availability, `${prefix}.evidence`);
        checkProjectSources(
          evidence.sourceIds,
          `${prefix}.evidence`,
          evidence.availability,
        );
      }
    }
    if (list(program.historyScoreRecords))
      for (const history of program.historyScoreRecords) {
        if (
          !record(history) ||
          !nonempty(history.scoreRecordId) ||
          !nonempty(history.programId) ||
          !Number.isInteger(history.year) ||
          !finite(history.value) ||
          history.value < 0 ||
          !finite(history.totalMaxScore) ||
          history.value > history.totalMaxScore ||
          !record(history.subjectMaxScores) ||
          !["full_time", "part_time"].includes(String(history.studyMode)) ||
          !["initial", "interview"].includes(String(history.stage)) ||
          !["cutoff", "minimum_admitted", "mean", "median"].includes(
            String(history.metric),
          ) ||
          !["comparable", "limited", "incomparable", "pending"].includes(
            String(history.comparability),
          ) ||
          [
            "admissionCategory",
            "population",
            "examGroupId",
            "statisticalScope",
            "comparabilityReason",
          ].some((field) => !nonempty(history[field])) ||
          (history.sampleSize !== null &&
            (!Number.isInteger(history.sampleSize) ||
              Number(history.sampleSize) < 1))
        ) {
          errors.push(`${prefix} 历史分数口径不完整或数值无效`);
          continue;
        }
        if (
          Object.values(history.subjectMaxScores).some(
            (value) => !finite(value) || value <= 0,
          )
        )
          errors.push(`${prefix} 历史科目满分无效`);
        if (
          history.comparability === "comparable" &&
          !nonempty(history.reviewedBy)
        )
          errors.push(`${prefix} 可比性结论缺少复核人`);
        checkAvailability(
          history.availability,
          `${prefix}.historyScoreRecords`,
        );
        checkProjectSources(
          history.sourceIds,
          `${prefix}.historyScoreRecords`,
          history.availability,
        );
      }
    if (list(program.risks))
      for (const risk of program.risks) {
        if (
          !record(risk) ||
          !nonempty(risk.riskId) ||
          !nonempty(risk.summary) ||
          !["notice", "moderate", "severe"].includes(String(risk.severity)) ||
          !["draft", "pending_review", "approved", "rejected"].includes(
            String(risk.reviewStatus),
          ) ||
          !["active", "remediated", "withdrawn"].includes(
            String(risk.status),
          ) ||
          !list(risk.reviewers) ||
          !risk.reviewers.every(nonempty) ||
          !list(risk.independentEvidenceClusters) ||
          !risk.independentEvidenceClusters.every(nonempty) ||
          !list(risk.applicableYears) ||
          !risk.applicableYears.every(Number.isInteger) ||
          (risk.validUntil !== null && !date(risk.validUntil))
        ) {
          errors.push(`${prefix} 风险案例无效`);
          continue;
        }
        checkProjectSources(risk.sourceIds, `${prefix}.risks`);
        if (
          risk.reviewStatus === "approved" &&
          (new Set(risk.reviewers).size < 2 ||
            new Set(risk.independentEvidenceClusters).size < 2)
        )
          errors.push(`${prefix} 已审核风险至少需要两名复核人和两簇独立证据`);
        if (
          risk.reviewStatus === "approved" &&
          (!list(risk.sourceIds) || !risk.sourceIds.length)
        )
          errors.push(`${prefix} 已审核风险必须保留原始资料来源`);
      }
  }
  return { valid: errors.length === 0, errors };
}

export function createSeedCatalog(): CatalogState {
  const data = structuredClone(exampleCatalog) as CatalogImport;
  const validation = validateCatalogImport(data);
  if (!validation.valid)
    throw new CatalogError("INVALID_SEED", validation.errors);
  const release: CatalogSnapshot = {
    schemaVersion: 1,
    catalogVersion: "catalog-example-v1",
    publishedAt: "2026-09-27T00:00:00.000Z",
    mode: "example",
    coverage: data.coverage,
    programs: data.programs,
    sources: data.sources,
    withdrawnRevisionIds: [],
  };
  return structuredClone({
    schemaVersion: 1,
    sources: data.sources,
    revisions: data.programs,
    releases: [release],
    activeCatalogVersion: release.catalogVersion,
    withdrawnRevisionIds: [],
    coverage: data.coverage,
    audit: [],
  });
}

export function importCatalog(
  state: CatalogState,
  input: unknown,
  context: { actor: string; at: string },
): CatalogState {
  const validation = validateCatalogImport(input);
  if (!validation.valid)
    throw new CatalogError("INVALID_IMPORT", validation.errors);
  const bundle = input as CatalogImport;
  const next = structuredClone(state);
  const collegeOwners = new Map<string, string>();
  for (const revision of [...state.revisions, ...bundle.programs]) {
    if (
      !bindCollegeOwner(
        collegeOwners,
        revision.identity.collegeId,
        revision.identity.institutionId,
      )
    )
      throw new CatalogError("COLLEGE_INSTITUTION_CONFLICT", [
        `学院 ID ${revision.identity.collegeId} 已绑定其他学校，不能跨校复用；显示名称不是学院身份`,
      ]);
  }
  for (const source of bundle.sources) {
    const previous = next.sources.find(
      (item) => item.sourceId === source.sourceId,
    );
    if (previous && JSON.stringify(previous) !== JSON.stringify(source))
      throw new CatalogError("SOURCE_CONFLICT", [
        `来源 ${source.sourceId} 已存在，更新应使用新的 sourceId`,
      ]);
    if (!previous) next.sources.push(structuredClone(source));
  }
  for (const program of bundle.programs) {
    if (
      program.reviewStatus !== "draft" ||
      program.publicationStatus !== "unpublished"
    )
      throw new CatalogError("INVALID_IMPORT_STATE", [
        "导入只能创建未发布草稿；审核与发布必须单独操作",
      ]);
    if (
      next.revisions.some(
        (item) => item.programRevisionId === program.programRevisionId,
      )
    )
      throw new CatalogError("REVISION_CONFLICT", ["修订 ID 不可覆盖"]);
    const sameId = next.revisions.filter(
      (item) => item.programId === program.programId,
    );
    if (
      sameId.some(
        (item) => projectIdentityKey(item) !== projectIdentityKey(program),
      )
    )
      throw new CatalogError("IDENTITY_CONFLICT", [
        "项目 ID 不得复用到其他年度或身份",
      ]);
    if (
      next.revisions.some(
        (item) =>
          projectIdentityKey(item) === projectIdentityKey(program) &&
          item.programId !== program.programId,
      )
    )
      throw new CatalogError("IDENTITY_CONFLICT", [
        "同一完整年度身份必须沿用已有项目 ID",
      ]);
    if (
      sameId.length &&
      !sameId.some(
        (item) => item.programRevisionId === program.supersedesRevisionId,
      )
    )
      throw new CatalogError("REVISION_LINK_REQUIRED", [
        "资料更正需要引用同一项目的旧修订",
      ]);
    if (!sameId.length && program.supersedesRevisionId !== null)
      throw new CatalogError("REVISION_LINK_INVALID", [
        "新项目不能引用不存在的修订",
      ]);
    next.revisions.push(structuredClone(program));
    next.audit.push({
      action: "import",
      targetId: program.programRevisionId,
      actor: context.actor,
      at: context.at,
      reason: "导入规范化草稿",
    });
  }
  next.coverage = structuredClone(bundle.coverage);
  return next;
}

export function reviewRevision(
  state: CatalogState,
  revisionId: string,
  input: {
    reviewer: string;
    decision: "submit" | "approve" | "reject";
    reason: string;
    at: string;
  },
): CatalogState {
  const next = structuredClone(state);
  const revision = next.revisions.find(
    (item) => item.programRevisionId === revisionId,
  );
  if (!revision) throw new CatalogError("NOT_FOUND", ["项目修订不存在"]);
  if (!input.reviewer.trim() || !input.reason.trim() || !date(input.at))
    throw new CatalogError("REVIEW_REASON_REQUIRED", [
      "审核需要操作者、理由和有效时间",
    ]);
  if (
    revision.publicationStatus !== "unpublished" ||
    !(
      (input.decision === "submit" &&
        ["draft", "rejected"].includes(revision.reviewStatus)) ||
      (input.decision !== "submit" &&
        revision.reviewStatus === "pending_review")
    )
  )
    throw new CatalogError("INVALID_REVIEW_TRANSITION", [
      "审核状态转换无效；已批准内容须创建新修订",
    ]);
  revision.reviewStatus =
    input.decision === "submit"
      ? "pending_review"
      : input.decision === "approve"
        ? "approved"
        : "rejected";
  next.audit.push({
    action: "review",
    targetId: revisionId,
    actor: input.reviewer,
    at: input.at,
    reason: `${input.decision}: ${input.reason}`,
  });
  return next;
}

export function publishCatalog(
  state: CatalogState,
  input: {
    catalogVersion: string;
    revisionIds: string[];
    at: string;
    reviewer: string;
    summary: string;
  },
): CatalogState {
  if (
    !nonempty(input.catalogVersion) ||
    !nonempty(input.reviewer) ||
    !nonempty(input.summary) ||
    !date(input.at)
  )
    throw new CatalogError("INVALID_PUBLICATION", [
      "发布需要唯一版本、操作者、时间和变更摘要",
    ]);
  if (
    state.releases.some(
      (release) => release.catalogVersion === input.catalogVersion,
    )
  )
    throw new CatalogError("RELEASE_CONFLICT", ["目录发布版本不可覆盖"]);
  if (new Set(input.revisionIds).size !== input.revisionIds.length)
    throw new CatalogError("DUPLICATE_REVISION", ["发布清单中修订不能重复"]);
  const revisions = input.revisionIds.map((id) =>
    state.revisions.find((item) => item.programRevisionId === id),
  );
  if (
    revisions.some(
      (item) =>
        !item ||
        item.reviewStatus !== "approved" ||
        state.withdrawnRevisionIds.includes(item.programRevisionId),
    )
  )
    throw new CatalogError("NOT_PUBLISHABLE", ["只可发布已审核且未撤回的修订"]);
  const programs = revisions as ProgramRevision[];
  if (new Set(programs.map((item) => item.programId)).size !== programs.length)
    throw new CatalogError("DUPLICATE_PROJECT", [
      "一个目录快照只能包含每个年度项目的一条修订",
    ]);
  const next = structuredClone(state);
  for (const revision of next.revisions)
    if (input.revisionIds.includes(revision.programRevisionId))
      revision.publicationStatus = "published";
  const previousCoverage = state.releases.find(
    (item) => item.catalogVersion === state.activeCatalogVersion,
  )?.coverage;
  const coverage = {
    years: [
      ...new Set(
        programs.map((program) => program.identity.targetAdmissionYear),
      ),
    ].sort((a, b) => a - b),
    description: `${programs.length} 个年度项目；本次更新范围：${next.coverage.description}`,
    limitations: [
      ...new Set([
        ...(previousCoverage?.limitations ?? []),
        ...next.coverage.limitations,
      ]),
    ],
  };
  const release: CatalogSnapshot = {
    schemaVersion: 1,
    catalogVersion: input.catalogVersion,
    publishedAt: input.at,
    mode: programs.some((program) => program.isExample)
      ? "example"
      : "verified",
    coverage,
    programs: next.revisions.filter((item) =>
      input.revisionIds.includes(item.programRevisionId),
    ),
    sources: structuredClone(next.sources),
    withdrawnRevisionIds: [...next.withdrawnRevisionIds],
  };
  next.releases.push(structuredClone(release));
  next.activeCatalogVersion = release.catalogVersion;
  next.audit.push({
    action: "publish",
    targetId: release.catalogVersion,
    actor: input.reviewer,
    at: input.at,
    reason: input.summary,
  });
  return next;
}

export function withdrawRevision(
  state: CatalogState,
  revisionId: string,
  input: { reason: string; actor?: string; at: string },
): CatalogState {
  if (!input.reason.trim() || !date(input.at))
    throw new CatalogError("WITHDRAWAL_REASON_REQUIRED", [
      "撤回需要有效时间和原因",
    ]);
  const next = structuredClone(state);
  const revision = next.revisions.find(
    (item) => item.programRevisionId === revisionId,
  );
  if (!revision) throw new CatalogError("NOT_FOUND", ["项目修订不存在"]);
  if (next.withdrawnRevisionIds.includes(revisionId)) return next;
  revision.publicationStatus = "withdrawn";
  next.withdrawnRevisionIds.push(revisionId);
  next.audit.push({
    action: "withdraw",
    targetId: revisionId,
    actor: input.actor ?? "reviewer",
    at: input.at,
    reason: input.reason,
  });
  return next;
}

export function getCatalogSnapshot(
  state: CatalogState,
  version = state.activeCatalogVersion,
): CatalogSnapshot {
  const release = state.releases.find(
    (item) => item.catalogVersion === version,
  );
  if (!release)
    throw new CatalogError("CATALOG_VERSION_NOT_FOUND", [
      "指定目录版本不存在；请显式选择可用版本",
    ]);
  return {
    ...structuredClone(release),
    withdrawnRevisionIds: [...state.withdrawnRevisionIds],
  };
}

export function isCurrentFact(availability: Availability): boolean {
  return availability === "verified_current";
}
