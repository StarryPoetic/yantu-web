export interface DisciplineSource {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  retrievedFrom: string;
  publishedAt: string;
  checkedAt: string;
  sha256?: string;
  note: string;
}
export interface Discipline {
  id: string;
  code: string;
  name: string;
  groupCode: string;
  groupName: string;
  degreeType: "academic" | "professional";
  level: "first_level_discipline" | "professional_category";
  mastersOnly: boolean;
  notes: string[];
  aliases: string[];
  sourceIds: string[];
  sourcePage: number;
}
export interface DisciplineCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  title: string;
  asOf: string;
  effectiveFrom: string;
  coverage: {
    disciplineGroups: number;
    academicDisciplines: number;
    professionalCategories: number;
    total: number;
    description: string;
  };
  groups: { code: string; name: string }[];
  items: Discipline[];
  sources: DisciplineSource[];
  warnings: string[];
}
export interface GuidanceAssessment {
  assessmentAttemptId: string;
  diagnosisVersion: string;
  questionBankVersion?: string;
  submittedAt?: string;
  scope?: Partial<Record<"math" | "english" | "politics" | "major", string>>;
  items?: {
    questionId: string;
    questionRevisionId: string;
    module: string;
    point: string;
    outcome: "correct" | "incorrect" | "unanswered";
    scopes: string[];
    calibration?: "manual_initial" | "calibrated";
  }[];
  example: boolean;
  usableForRecommendation: boolean;
  modules: {
    module: string;
    correct: number;
    incorrect: number;
    unanswered: number;
    total: number;
  }[];
  weakPoints: string[];
  limitations: string[];
}
export interface GuidanceDirection {
  discipline: Discipline;
  status:
    | "explicit_interest"
    | "background_connection"
    | "goal_connection"
    | "open_exploration"
    | "user_excluded";
  reasons: string[];
  preparation: string[];
  verificationNeeded: string[];
  rank: null;
  fitScore: null;
  eligible: "unknown";
}
export interface GuidanceRun {
  schemaVersion: 1;
  guidanceRunId: string;
  subjectId: string;
  generatedAt: string;
  status: "exploration" | "evidence_based";
  versions: {
    catalogVersion: string;
    guidanceRuleVersion: string;
    profileVersion: number;
    selectionVersion: number;
    assessmentRefs: { assessmentAttemptId: string; diagnosisVersion: string }[];
  };
  conclusion: string;
  considerations: string[];
  followUpQuestions: string[];
  highlightedIds: string[];
  directions: GuidanceDirection[];
  assessmentSummary: {
    used: number;
    references: GuidanceAssessment[];
    observations: string[];
    ignored: {
      assessmentAttemptId: string;
      diagnosisVersion: string;
      reason: string;
    }[];
  };
  inputSnapshot: {
    profile: Record<string, unknown>;
    confirmedMajorId: string | null;
    excludedMajorIds: string[];
  };
  limitations: string[];
  coverage: DisciplineCatalog["coverage"];
  sources: DisciplineSource[];
}
