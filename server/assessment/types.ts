export type AssessmentModule = "math" | "english" | "politics" | "major";
export type AssessmentStage = "initial" | "major" | "retest";
export type Difficulty = "basic" | "intermediate" | "advanced";
export type Foundation = "weak" | "average" | "strong" | "unknown";
export type AttemptStatus =
  | "in_progress"
  | "submitted"
  | "abandoned"
  | "invalidated";
export type Scope = Partial<Record<AssessmentModule, string>>;
export type MathExpression =
  | { kind: "text"; value: string }
  | { kind: "row"; items: MathExpression[] }
  | { kind: "fraction"; numerator: MathExpression; denominator: MathExpression }
  | { kind: "power"; base: MathExpression; exponent: MathExpression }
  | { kind: "matrix" | "determinant"; cells: string[][] };
export type QuestionDiagram =
  | {
      kind: "matrix";
      cells: string[][];
      alt: string;
      highlightDiagonal?: boolean;
    }
  | { kind: "image"; src: string; alt: string };
export interface QuestionPresentation {
  formulas?: { label: string; expression: MathExpression }[];
  diagram?: QuestionDiagram;
}

export interface QuestionRevision {
  id: string;
  revisionId: string;
  module: AssessmentModule;
  subject: string;
  point: string;
  text: string;
  options: string[];
  correct: number;
  explanation: string;
  studyHint?: string;
  presentation?: QuestionPresentation;
  solutionPresentation?: QuestionPresentation;
  source: {
    title: string;
    origin: string;
    rights: string;
    applicableYears: number[];
  };
  scopes: string[];
  majorIds: string[];
  difficulty: Difficulty;
  calibration: "manual_initial" | "calibrated";
  errorHypotheses: Record<string, string>;
  reviewStatus: "draft" | "pending_review" | "approved" | "rejected";
  publicationStatus: "unpublished" | "published" | "withdrawn";
  review?: {
    reviewerId: string;
    reviewedAt: string;
    checks: string[];
    rationale: string;
  };
}

export interface QuestionBank {
  schemaVersion: 1;
  questionBankVersion: string;
  mode: "example" | "reviewed";
  notice: string;
  questions: QuestionRevision[];
  knowledgePoints: Partial<Record<AssessmentModule, string[]>>;
}

export interface PublicQuestion {
  id: string;
  revisionId: string;
  module: AssessmentModule;
  subject: string;
  point: string;
  text: string;
  options: string[];
  difficulty: Difficulty;
  presentation?: QuestionPresentation;
}

export interface Answer {
  questionId: string;
  selectedOption: number | null;
  reasoning?: string;
  confidence?: "sure" | "unsure";
  durationSeconds?: number;
}

export interface AssessmentApplicability {
  applicability: "applicable" | "not_applicable" | "pending";
  reason: string;
  confirmedMajorId?: string;
  programRevisionId?: string;
  scope: Scope;
  ruleVersion: string;
  evaluatedAt: string;
}

export interface DiagnosisItem {
  questionId: string;
  questionRevisionId: string;
  module: AssessmentModule;
  point: string;
  outcome: "correct" | "incorrect" | "unanswered";
  selectedOption: number | null;
  correctOption: number;
  explanation: string;
  presentation?: QuestionPresentation;
  source: string;
  observation: string;
  possibleCause: string | null;
  uncertainty: string;
  nextStep: string;
}

export interface Diagnosis {
  assessmentAttemptId: string;
  diagnosisVersion: string;
  questionBankVersion: string;
  scoringVersion: string;
  diagnosisRuleVersion: string;
  createdAt: string;
  counts: {
    correct: number;
    incorrect: number;
    unanswered: number;
    total: number;
  };
  modules: Array<{
    module: AssessmentModule;
    correct: number;
    incorrect: number;
    unanswered: number;
    total: number;
  }>;
  items: DiagnosisItem[];
  uncoveredPoints: string[];
  limitations: string[];
  example: boolean;
  usableForRecommendation: boolean;
  correction?: {
    previousDiagnosisVersion: string;
    reason: string;
    correctedRevisionIds: string[];
  };
}

export interface AssessmentAttempt {
  schemaVersion: 1;
  assessmentAttemptId: string;
  subjectId: string;
  stage: AssessmentStage;
  modules: AssessmentModule[];
  scope: Scope;
  mathFoundation: Foundation;
  confirmedMajorId?: string;
  questionBankVersion: string;
  assemblyRuleVersion: string;
  scoringVersion: string;
  attemptVersion: number;
  status: AttemptStatus;
  createdAt: string;
  submittedAt?: string;
  derivedFrom?: string;
  seed: string;
  questions: QuestionRevision[];
  knowledgePoints: string[];
  assemblyNotes: string[];
  answers: Answer[];
  currentIndex: number;
  applicability: AssessmentApplicability;
  example: boolean;
  notice: string;
  diagnosis?: Diagnosis;
  previousDiagnoses?: Diagnosis[];
  closedReason?: string;
}

export interface PublicAttempt {
  schemaVersion: 1;
  assessmentAttemptId: string;
  stage: AssessmentStage;
  modules: AssessmentModule[];
  scope: Scope;
  mathFoundation: Foundation;
  confirmedMajorId?: string;
  questionBankVersion: string;
  assemblyRuleVersion: string;
  scoringVersion: string;
  attemptVersion: number;
  status: AttemptStatus;
  createdAt: string;
  submittedAt?: string;
  derivedFrom?: string;
  questions: PublicQuestion[];
  answers: Answer[];
  currentIndex: number;
  applicability: AssessmentApplicability;
  example: boolean;
  notice: string;
  assemblyNotes: string[];
  diagnosis?: Diagnosis;
  closedReason?: string;
}

export interface CreateAttemptInput {
  subjectId: string;
  assessmentAttemptId?: string;
  stage?: AssessmentStage;
  modules?: AssessmentModule[];
  scope?: Scope;
  mathFoundation?: Foundation;
  confirmedMajorId?: string;
  programRevisionId?: string;
  derivedFrom?: string;
  seed?: string;
  /** Server configuration only. Never forward this flag from a client request. */
  allowExampleBank?: boolean;
  now?: string;
}

export interface SaveDraftInput {
  expectedAttemptVersion: number;
  answers: Answer[];
  currentIndex?: number;
}

export interface SubmitAttemptInput {
  expectedAttemptVersion: number;
  confirmUnanswered?: boolean;
  now?: string;
}

export interface ApplicabilityTarget {
  confirmedMajorId?: string;
  programRevisionId?: string;
  scope?: Scope;
  now?: string;
}
