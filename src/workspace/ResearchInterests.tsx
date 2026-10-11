import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ResearchInterest } from "../../shared/research-interest";
import { request } from "./api";
import { useResearch } from "./ResearchContext";
import { ErrorNotice, safeUrl } from "./ui";

type Item = ResearchInterest & { etag: string };
function useInterestsState() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function reload(signal?: AbortSignal) {
    const result = await request<{ items: Item[] }>("/me/research-interests", {
      signal,
    });
    if (!signal?.aborted) setItems(result.data.items);
  }
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, []);
  async function act(action: () => Promise<unknown>, optimistic?: Item[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const previous = items;
    if (optimistic) setItems(optimistic);
    try {
      await action();
      await reload();
    } catch (error) {
      if (optimistic) setItems(previous);
      setError(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    items,
    error,
    busy,
    clear: () => setItems([]),
    add: (jobId: string, recommendationIndex: number, target = false) =>
      act(() =>
        request("/me/research-interests", {
          method: "POST",
          body: { jobId, recommendationIndex, target },
        }),
      ),
    update: (
      item: Item,
      change: {
        favorite?: boolean;
        target?: boolean;
        completedTasks?: boolean[];
      },
    ) =>
      act(
        () =>
          request(
            `/me/research-interests/${encodeURIComponent(item.interestId)}`,
            { method: "PATCH", etag: item.etag, body: change },
          ),
        items.map((entry) =>
          entry.interestId === item.interestId
            ? {
                ...entry,
                favorite: change.favorite ?? entry.favorite,
                target: change.target ?? entry.target,
                tasks: entry.tasks.map((task, i) => ({
                  ...task,
                  completed: change.completedTasks?.[i] ?? task.completed,
                })),
              }
            : entry,
        ),
      ),
  };
}
const Context = createContext<ReturnType<typeof useInterestsState> | null>(
  null,
);
export function ResearchInterestsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const state = useInterestsState();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function useResearchInterests() {
  const state = useContext(Context);
  if (!state) throw new Error("ResearchInterestsProvider is required");
  return state;
}
export function ResearchInterestActions({
  jobId,
  index,
}: {
  jobId: string;
  index: number;
}) {
  const state = useResearchInterests();
  const { locked } = useResearch();
  const item = state.items.find(
    (item) => item.jobId === jobId && item.recommendationIndex === index,
  );
  return (
    <div className="ws-stack">
      <p>可保存为研究关注项：未经人工审核 · 待核验，不属于正式招生目录。</p>
      <div className="ws-actions">
        <button
          disabled={locked || state.busy}
          className="ws-secondary"
          onClick={() =>
            item
              ? void state.update(item, { favorite: !item.favorite })
              : void state.add(jobId, index)
          }
        >
          {item?.favorite ? "取消收藏研究关注项" : "收藏研究关注项"}
        </button>
        <button
          disabled={locked || state.busy || item?.target}
          className="ws-secondary"
          onClick={() =>
            item
              ? void state.update(item, { target: true })
              : void state.add(jobId, index, true)
          }
        >
          {item?.target ? "已加入待核验准备计划" : "加入目标与规划"}
        </button>
        {item?.target && <a href="#plan">前往待核验准备计划</a>}
      </div>
      <ErrorNotice error={state.error} />
    </div>
  );
}
export function ResearchInterestsPanel({
  mode,
  onLinkedTarget,
}: {
  mode: "catalog" | "favorites" | "plan";
  onLinkedTarget?: (programId: string) => Promise<void>;
}) {
  const state = useResearchInterests();
  const { locked } = useResearch();
  const items = state.items.filter((item) =>
    mode === "plan"
      ? item.target
      : mode === "favorites"
        ? item.favorite
        : item.favorite || item.target,
  );
  return (
    <section
      className="ws-panel ws-stack"
      aria-label={mode === "plan" ? "研究关注目标与准备计划" : "研究关注项"}
    >
      <h2>
        {mode === "plan" ? "待核验准备计划" : `研究关注项 · ${items.length}`}
      </h2>
      <p>
        研究报告中的关注意向与正式招生项目分别保存；未经人工审核，招生资格、年度和科目均须核验。准备任务不代表已确认报考资格。
      </p>
      <ErrorNotice error={state.error} />
      {!items.length && <p>从推荐结论的研究报告中收藏建议或加入目标与规划。</p>}
      {items.map((item) => (
        <article
          key={item.interestId}
          className="ws-stack"
          aria-label={`研究关注：${item.recommendation.institutionName}`}
        >
          <h3>
            {item.recommendation.institutionName} ·{" "}
            {item.recommendation.programName ??
              item.recommendation.disciplineCode}
          </h3>
          <p>
            未经人工审核 · 待核验 · 目标年份 {item.targetYear} · 参考年份{" "}
            {item.referenceYear ?? "未记录"}
          </p>
          <small>来源报告 jobId：{item.jobId}</small>
          <p>
            {item.linkedProgram
              ? "已关联正式项目；研究关注项仍待核验。"
              : "未能明确匹配正式项目，始终保留待核验状态。"}
          </p>
          <details>
            <summary>保留的报告来源 · {item.sources.length} 条</summary>
            {item.sources.map((source) => (
              <p key={source.id}>
                <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                  {source.title}
                </a>{" "}
                · {source.retrievedAt} · 未经人工审核
              </p>
            ))}
          </details>
          <div className="ws-actions">
            <button
              disabled={locked || state.busy}
              onClick={() =>
                void state.update(item, { favorite: !item.favorite })
              }
            >
              {item.favorite ? "取消收藏研究关注项" : "收藏研究关注项"}
            </button>
            <button
              disabled={locked || state.busy}
              onClick={() => void state.update(item, { target: !item.target })}
            >
              {item.target ? "取消研究关注目标" : "加入目标与规划"}
            </button>
            {mode === "plan" && item.linkedProgram && onLinkedTarget && (
              <button
                disabled={locked || state.busy}
                onClick={() =>
                  void onLinkedTarget(item.linkedProgram!.programId)
                }
              >
                选择关联正式项目为招生目标
              </button>
            )}
          </div>
          {mode === "plan" &&
            item.tasks.map((task, index) => (
              <label key={index} className="ws-check">
                <input
                  type="checkbox"
                  disabled={locked || state.busy}
                  checked={task.completed}
                  onChange={(event) =>
                    void state.update(item, {
                      completedTasks: item.tasks.map((entry, i) =>
                        i === index ? event.target.checked : entry.completed,
                      ),
                    })
                  }
                />
                {task.title}
              </label>
            ))}
        </article>
      ))}
    </section>
  );
}
