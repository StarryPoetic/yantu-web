import type { Context } from "../context.ts";
import type { ResearchJob } from "./research.ts";
import { HttpError } from "../http.ts";
import {
  RESEARCH_INPUT_LOCK_CODE,
  RESEARCH_INPUT_LOCK_MESSAGE,
} from "../../shared/research-status.ts";

// Synchronous check and writes share the single-instance SQLite request turn.
export function requireResearchInputsUnlocked(c: Context) {
  if (
    c.store
      .list<ResearchJob>(c.session.subjectId, "research-job")
      .some(({ value }) => ["queued", "running"].includes(value.status))
  )
    throw new HttpError(
      409,
      RESEARCH_INPUT_LOCK_CODE,
      RESEARCH_INPUT_LOCK_MESSAGE,
    );
}
