export const pdfWorkerStages = [
  "worker_started",
  "module_loading",
  "module_ready",
  "input_received",
  "parse_started",
  "parse_finished",
  "destroy_started",
  "destroy_finished",
] as const;

export type PdfWorkerStage = (typeof pdfWorkerStages)[number];
export interface PdfTextDiagnostic {
  requestId: string;
  stage:
    | "requested"
    | "spawned"
    | PdfWorkerStage
    | "result_received"
    | "deadline"
    | "termination_requested"
    | "worker_exited"
    | "failed";
  /** Parent elapsed time includes scheduling and IPC, not just parser CPU time. */
  elapsedMs: number;
  timeoutMs?: number;
  /** Relative to worker boot; compare worker timestamps only with each other. */
  workerElapsedMs?: number;
  code?: string;
}

/** Allowlisted numeric metadata only; the worker never sends document content here. */
export function isPdfWorkerStage(value: unknown): value is PdfWorkerStage {
  return (
    typeof value === "string" &&
    pdfWorkerStages.includes(value as PdfWorkerStage)
  );
}
