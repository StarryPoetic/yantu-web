import type { ResearchJob } from "../../server/routes/research.ts";
import { request } from "./api";

export type ResearchRequestMode = "generate" | "supplement" | "retry";

export function startResearchJob(
  guidanceRunId: string,
  mode: ResearchRequestMode,
  signal?: AbortSignal,
) {
  return request<ResearchJob>(
    "/guidance/" +
      guidanceRunId +
      "/research" +
      (mode === "generate" ? "" : "/" + mode),
    { method: "POST", body: {}, signal },
  );
}
