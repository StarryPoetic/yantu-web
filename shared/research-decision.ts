import type { SubjectAdvice } from "./assessment-advice.ts";
/** Reproducible preparation observations, kept separate from programme requirements. */
export type PreparationModule = "math" | "english";

export interface PreparationReference {
  assessmentAttemptId: string;
  diagnosisVersion: string;
  questionBankVersion?: string;
  submittedAt?: string;
  example: boolean;
}

export interface PreparationObservation {
  module: PreparationModule;
  scope: string | null;
  status:
    | "unassessed"
    | "example_practice"
    | "practice_observation"
    | "local_diagnosis";
  counts: {
    correct: number;
    incorrect: number;
    unanswered: number;
    total: number;
  };
  points: string[];
  weakPoints: string[];
  references: PreparationReference[];
  observations: string[];
  nextSteps: string[];
  limitations: string[];
}

export interface DegreeRouteBasis {
  degreeType: "academic" | "professional";
  priority: "compare" | "goal_lead" | "explicit_preference";
  reasons: string[];
  verificationNeeded: string[];
}

export interface ResearchDecisionBasis {
  version: "assessment-route-v1";
  subjectAdvice?: SubjectAdvice;
  summary: string;
  assessments: PreparationObservation[];
  degreeRoutes: DegreeRouteBasis[];
  examPolicy: {
    summary: string;
    comparisons: {
      module: PreparationModule;
      options: string[];
      assessmentUse: string;
      nextSteps: string[];
    }[];
  };
  ignoredAssessments: {
    assessmentAttemptId: string;
    diagnosisVersion: string;
    reason: string;
  }[];
  limitations: string[];
}
