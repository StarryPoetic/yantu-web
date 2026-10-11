import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ResearchJob, ResearchEngine } from "../../server/routes/research";
import type { GuidanceRun } from "../../server/disciplines/types";
import type { ResearchReport } from "../../server/explanation/research";
import { request } from "./api";
import { startResearchJob, type ResearchRequestMode } from "./research-request";
import { researchOutcome } from "./research-report";

type Job = ResearchJob & { needsRefresh?: boolean; refreshReasons?: string[] };
type Readiness = ReturnType<ResearchEngine["getReadiness"]>;
const active = (job: Job | null) =>
  !!job && ["queued", "running"].includes(job.status);
const Context = createContext<ReturnType<typeof useResearchState> | null>(null);
function useResearchState() {
  const [job, setJob] = useState<Job | null>(null);
  const [run, setRun] = useState<GuidanceRun | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingMode, setStartingMode] = useState<ResearchRequestMode | null>(
    null,
  );
  const [savedReport, setSavedReport] = useState<{
    guidanceRunId: string;
    report: ResearchReport;
  } | null>(null);
  const [error, setError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  const startLock = useRef(false);
  const startController = useRef<AbortController | null>(null);
  const position = useRef({ jobId: "", value: 0 });
  const runRef = useRef(run);
  runRef.current = run;
  const acceptJob = useCallback((next: Job | null) => {
    setJob(next);
    if (!next || (next.mode !== "supplement" && !next.report))
      setSavedReport(null);
    else if (
      next.report &&
      !(
        next.mode === "supplement" &&
        (next.report.failureStage ||
          ["failed", "cancelled", "blocked"].includes(next.status))
      )
    )
      setSavedReport({
        guidanceRunId: next.guidanceRunId,
        report: next.report,
      });
  }, []);
  const selectRun = useCallback(
    (next: GuidanceRun) => {
      if (runRef.current?.guidanceRunId !== next.guidanceRunId) {
        runRef.current = next;
        setRun(next);
        acceptJob(null);
      }
    },
    [acceptJob],
  );
  const reset = () => {
    runRef.current = null;
    setRun(null);
    acceptJob(null);
    position.current = { jobId: "", value: 0 };
    setReload((value) => value + 1);
  };
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(
    () => () => {
      startController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      request<Readiness>("/research/status", { signal: controller.signal }),
      run
        ? request<{ job: Job | null }>(
            "/guidance/" + run.guidanceRunId + "/research/latest",
            { signal: controller.signal },
          )
        : request<{ job: Job | null; run: GuidanceRun | null }>(
            "/research/latest",
            { signal: controller.signal },
          ),
    ])
      .then(([configuration, latest]) => {
        if (controller.signal.aborted) return;
        setReadiness(configuration.data);
        acceptJob(latest.data.job);
        if ("run" in latest.data && latest.data.run) {
          runRef.current = latest.data.run as GuidanceRun;
          setRun(latest.data.run as GuidanceRun);
        }
        setError(null);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [run?.guidanceRunId, reload, acceptJob]);
  const running = active(job);
  useEffect(() => {
    if (!job || !running || loading) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let keepPolling = true;
      try {
        const result = await request<Job>("/research-jobs/" + job.jobId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        acceptJob(result.data);
        setError(null);
        keepPolling = active(result.data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure);
      }
      if (!controller.signal.aborted && keepPolling)
        timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job?.jobId, running, loading, reload, acceptJob]);
  async function generate(mode: ResearchRequestMode = "generate") {
    if (
      startLock.current ||
      loading ||
      running ||
      !readiness?.ready ||
      !run ||
      job?.needsRefresh
    )
      return;
    startLock.current = true;
    const controller = new AbortController();
    startController.current = controller;
    setStartingMode(mode);
    setError(null);
    try {
      const result = await startResearchJob(
        run.guidanceRunId,
        mode,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        position.current = { jobId: result.data.jobId, value: 0 };
        acceptJob({ ...result.data, mode: result.data.mode ?? mode });
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure);
      }
    } finally {
      if (!controller.signal.aborted) {
        startLock.current = false;
        setStartingMode(null);
      }
    }
  }
  const failed =
    !!job &&
    (["failed", "blocked", "cancelled"].includes(job.status) ||
      !!job.report?.failureStage ||
      researchOutcome(job) === "failure");
  const badge =
    startingMode || running
      ? "生成中"
      : job
        ? failed
          ? "未完成"
          : "已完成"
        : "";
  return {
    job,
    run,
    readiness,
    loading,
    startingMode,
    savedReport,
    error,
    refresh,
    reset,
    generate,
    selectRun,
    position,
    running,
    locked: loading || running || startingMode !== null,
    badge,
    failed,
  };
}
export function ResearchProvider({ children }: { children: ReactNode }) {
  const value = useResearchState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useResearch() {
  const value = useContext(Context);
  if (!value) throw new Error("ResearchProvider is required");
  return value;
}
