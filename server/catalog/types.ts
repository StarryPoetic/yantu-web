export type ReviewStatus = "draft" | "pending_review" | "approved" | "rejected";
export type PublicationStatus = "unpublished" | "published" | "withdrawn";
export type Availability =
  | "verified_current"
  | "verified_historical"
  | "missing"
  | "unverified"
  | "conflicting"
  | "expired"
  | "not_applicable";

export interface SourceRecord {
  sourceId: string;
  publisher: string;
  title: string;
  url: string | null;
  fileReference: string | null;
  contentHash: string | null;
  publishedAt: string | null;
  collectedAt: string;
  verifiedAt: string | null;
  type: "official" | "reviewed_material" | "example";
  usageRestrictions: string;
}

export interface ProjectIdentity {
  institutionId: string;
  collegeId: string;
  majorCode: string;
  codeSystem: string;
  directionId: string;
  degreeType: "academic" | "professional";
  studyMode: "full_time" | "part_time";
  targetAdmissionYear: number;
  campusId: string | null;
  admissionUnitId: string | null;
  examGroupId: string | null;
}

export interface FactClaim {
  claimId: string;
  field: string;
  value: string | number | boolean | null;
  unit: string | null;
  targetAdmissionYear: number;
  scope: string;
  sourceId: string;
  locator: string;
  availability: Availability;
  enteredBy: string;
  reviewedBy: string | null;
  supersedesClaimId: string | null;
}

export interface SubjectRequirement {
  subjectId: string;
  name: string;
  maxScore: number | null;
  minimumScore: number | null;
  availability: Availability;
  sourceIds: string[];
  /** Subjects in the same non-null group are official alternatives; the plan must select one. */
  optionGroupId: string | null;
}

export interface EligibilityCondition {
  conditionId: string;
  label: string;
  profileField: string;
  operator: "equals" | "one_of" | "at_least" | "at_most" | "present";
  expected: string | number | boolean | string[] | null;
  availability: Availability;
  sourceIds: string[];
}

export type EvidenceDimension =
  | "employment"
  | "prospects"
  | "policy"
  | "interest"
  | "schoolCity"
  | "transparency";
export interface DimensionEvidence {
  dimension: EvidenceDimension;
  availability: Availability;
  sourceIds: string[];
  summary: string;
  /** Normalized only by an explicitly reviewed rule; never derived from demo fit percentages. */
  value: number | null;
  ruleVersion: string | null;
}

export interface RiskCase {
  riskId: string;
  summary: string;
  severity: "notice" | "moderate" | "severe";
  reviewStatus: ReviewStatus;
  reviewers: string[];
  independentEvidenceClusters: string[];
  sourceIds: string[];
  applicableYears: number[];
  validUntil: string | null;
  status: "active" | "remediated" | "withdrawn";
}

export interface ScoreRecord {
  scoreRecordId: string;
  year: number;
  programId: string;
  studyMode: ProjectIdentity["studyMode"];
  admissionCategory: string;
  population: string;
  examGroupId: string;
  stage: "initial" | "interview";
  metric: "cutoff" | "minimum_admitted" | "mean" | "median";
  value: number;
  totalMaxScore: number;
  subjectMaxScores: Record<string, number>;
  sampleSize: number | null;
  statisticalScope: string;
  comparability: "comparable" | "limited" | "incomparable" | "pending";
  comparabilityReason: string;
  reviewedBy: string | null;
  availability: Availability;
  sourceIds: string[];
}

export interface ProgramRevision {
  programId: string;
  programRevisionId: string;
  supersedesRevisionId: string | null;
  identity: ProjectIdentity;
  display: {
    institutionName: string;
    shortName: string;
    collegeName: string;
    majorName: string;
    directionName: string;
    city: string;
    color: string;
  };
  majorDirectionIds: string[];
  reviewStatus: ReviewStatus;
  publicationStatus: PublicationStatus;
  availability: Availability;
  isExample: boolean;
  sourceIds: string[];
  claims: FactClaim[];
  eligibility: {
    availability: Availability;
    complete: boolean;
    reason: string | null;
    conditions: EligibilityCondition[];
  };
  subjects: SubjectRequirement[];
  scoreRequirements: {
    totalMaxScore: number | null;
    totalMinimumScore: number | null;
    interviewRequirement: string | null;
    availability: Availability;
  };
  tuitionPerYear: number | null;
  durationYears: number | null;
  historyScoreRecords: ScoreRecord[];
  evidence: DimensionEvidence[];
  risks: RiskCase[];
  preparationNotes: string[];
}

export interface CatalogCoverage {
  years: number[];
  description: string;
  limitations: string[];
}

export interface CatalogSnapshot {
  schemaVersion: 1;
  catalogVersion: string;
  publishedAt: string;
  mode: "example" | "verified";
  coverage: CatalogCoverage;
  programs: ProgramRevision[];
  sources: SourceRecord[];
  withdrawnRevisionIds: string[];
}

export interface CatalogImport {
  schemaVersion: 1;
  coverage: CatalogCoverage;
  sources: SourceRecord[];
  programs: ProgramRevision[];
}

export interface CatalogAudit {
  action: "import" | "review" | "publish" | "withdraw";
  targetId: string;
  actor: string;
  at: string;
  reason: string;
}

export interface CatalogState {
  schemaVersion: 1;
  sources: SourceRecord[];
  revisions: ProgramRevision[];
  releases: CatalogSnapshot[];
  activeCatalogVersion: string | null;
  withdrawnRevisionIds: string[];
  coverage: CatalogCoverage;
  audit: CatalogAudit[];
}
