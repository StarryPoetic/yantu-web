import type { ResearchJob } from "../../server/routes/research.ts";
import { request } from "./api";

export type ResearchRequestMode = "generate" | "supplement";

export function startResearchJob(
  guidanceRunId: string,
  mode: ResearchRequestMode,
  signal?: AbortSignal,
) {
  return request<ResearchJob>(
    "/guidance/" +
      guidanceRunId +
      "/research" +
      (mode === "supplement" ? "/supplement" : ""),
    { method: "POST", body: {}, signal },
  );
}
