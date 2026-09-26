import type { Profile } from "../types";
import type {
  ProgramRevision,
  SourceRecord,
  SubjectRequirement,
} from "../../server/catalog/types";
import type { PlanSnapshot } from "../../server/planning/index";
import type { RecommendationCandidate } from "../../server/recommendation/index";
export interface ProfileResource {
  profile: Profile;
  profileVersion: string | number;
}
export interface Selections {
  selectionVersion: string | number;
  confirmedMajorId: string | null;
  savedProgramIds: string[];
  exclusions: {
    scope: "institution" | "majorDirection" | "program";
    objectId: string;
    reason?: string;
  }[];
  targetProgramId: string | null;
}
export type SelectionInput = Omit<Selections, "selectionVersion">;
export type Subject = SubjectRequirement;
export type Program = ProgramRevision;
export type Source = SourceRecord;
export interface Coverage {
  description?: string;
  limitations?: string[];
  years?: number[];
}
export interface Catalog {
  catalogVersion: string;
  programs?: Program[];
  items?: Program[];
  coverage: Coverage;
  sources?: Source[];
  nextCursor?: string | null;
}
export type RecommendationItem = RecommendationCandidate;
export interface Recommendation {
  recommendationRunId: string;
  catalogVersion: string;
  ruleVersion: string;
  items: RecommendationItem[];
  pendingVerification: RecommendationItem[];
  eligibleUnranked?: RecommendationItem[];
  needsRefresh?: boolean;
  degreeAdvice?: {
    inclination: "academic" | "professional" | "undetermined";
    reasons: string[];
  };
  exclusionReasons: unknown[];
  coverage?: Coverage;
  ignoredAssessmentRefs?: unknown[];
}
export type Plan = PlanSnapshot;
export interface PlanResource {
  plan: Plan | null;
  planVersion: number;
}
export interface Task {
  taskId: string;
  title: string;
  description?: string;
  completed: boolean;
  status?: string;
  etag?: string;
  ETag?: string;
}
export interface Report {
  reportId: string;
  status: string;
  markdown?: string;
  createdAt?: string;
  recommendationRunId?: string;
  withdrawn?: boolean;
  needsRefresh?: boolean;
  warning?: string | null;
}
