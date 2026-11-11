import { useState } from "react";
import { request } from "./api";
import { ErrorNotice } from "./ui";
import { performanceStatuses } from "./PerformancePanel";
import type { PerformanceView } from "./PerformancePanel";

const checkLabels = [
  ["evidence_verified", "已查看真实成绩证明并核对来源"],
  ["scope_comparable", "年度、项目修订、考试组和科目口径可比"],
  ["score_checked", "成绩、满分及测量日期与原证明一致"],
] as const;
export function PerformanceReviewPanel({ actorId }: { actorId: string }) {
  const [items, setItems] = useState<PerformanceView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, string[]>>({});
  async function load() {
    const result = await request<{ items: PerformanceView[] }>(
      "/admin/performance",
    );
    setItems(result.data.items);
    setLoaded(true);
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    item: PerformanceView,
    decision: "approved" | "rejected" | "withdrawn",
  ) {
    await request(
      `/admin/performance/${item.performanceId}/${decision === "withdrawn" ? "withdraw" : "decision"}`,
      {
        method: "POST",
        etag: item.etag,
        body:
          decision === "withdrawn"
            ? { reason: reason[item.performanceId] }
            : {
                decision,
                reason: reason[item.performanceId],
                checks: checks[item.performanceId] ?? [],
              },
      },
    );
  }
  return (
    <section className="ws-panel ws-stack" aria-label="成绩独立复核">
      <h2>成绩独立复核</h2>
      <p>
        逐项查看实际证明后作出决定。提交人不得审核本人记录；系统不会代替人工确认成绩真实性或校准水平。
      </p>
      <button
        className="ws-secondary"
        disabled={busy}
        onClick={() => void act(async () => {})}
      >
        读取成绩审核队列
      </button>
      <ErrorNotice error={error} />
      {loaded && !items.length && <p>暂无成绩审核记录。</p>}
      {items.map((item) => (
        <article
          className="ws-stack"
          key={item.performanceId}
          aria-label={`${item.subjectName}审核记录`}
        >
          <h3>
            {item.programLabel} · {item.subjectName}
          </h3>
          <p>
            {performanceStatuses[item.status]} · {item.score}/{item.maxScore} ·{" "}
            {item.measuredAt.slice(0, 10)}
          </p>
          <p>
            招生年度：{item.targetAdmissionYear}；考试组：{item.examGroupId}
            ；项目修订：{item.programRevisionId}
          </p>
          <p>来源：{item.source}</p>
          <p>证明定位：{item.evidenceReference}</p>
          <p>
            有效期至 {item.expiresAt.slice(0, 10)}（180天操作默认，非校准结论）
          </p>
          {item.limitation && <p className="ws-muted">{item.limitation}</p>}
          {item.reviewReason && <p>审核说明：{item.reviewReason}</p>}
          {item.withdrawalReason && <p>撤回原因：{item.withdrawalReason}</p>}
          {item.status === "pending" && item.ownerId === actorId ? (
            <p>本人提交的成绩须由另一位复核人员审核。</p>
          ) : (
            (item.status === "pending" || item.status === "approved") && (
              <>
                {item.status === "pending" && (
                  <fieldset>
                    <legend>成绩核验检查项</legend>
                    {checkLabels.map(([check, label]) => (
                      <label className="ws-check" key={check}>
                        <input
                          type="checkbox"
                          checked={(checks[item.performanceId] ?? []).includes(
                            check,
                          )}
                          onChange={(event) =>
                            setChecks((current) => ({
                              ...current,
                              [item.performanceId]: event.target.checked
                                ? [
                                    ...(current[item.performanceId] ?? []),
                                    check,
                                  ]
                                : (current[item.performanceId] ?? []).filter(
                                    (value) => value !== check,
                                  ),
                            }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label>
                  成绩审核说明
                  <textarea
                    minLength={10}
                    maxLength={1000}
                    value={reason[item.performanceId] ?? ""}
                    onChange={(event) =>
                      setReason((current) => ({
                        ...current,
                        [item.performanceId]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="ws-actions">
                  {item.status === "pending" ? (
                    <>
                      <button
                        disabled={
                          busy ||
                          (reason[item.performanceId]?.trim().length ?? 0) <
                            10 ||
                          (checks[item.performanceId]?.length ?? 0) !== 3
                        }
                        onClick={() => void act(() => decide(item, "approved"))}
                      >
                        通过成绩审核
                      </button>
                      <button
                        className="ws-secondary"
                        disabled={
                          busy ||
                          (reason[item.performanceId]?.trim().length ?? 0) < 10
                        }
                        onClick={() => void act(() => decide(item, "rejected"))}
                      >
                        拒绝成绩审核
                      </button>
                    </>
                  ) : (
                    <button
                      className="ws-secondary"
                      disabled={
                        busy ||
                        (reason[item.performanceId]?.trim().length ?? 0) < 10
                      }
                      onClick={() => void act(() => decide(item, "withdrawn"))}
                    >
                      撤回审核通过的成绩
                    </button>
                  )}
                </div>
              </>
            )
          )}
        </article>
      ))}
    </section>
  );
}
