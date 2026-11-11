import { useEffect, useState } from "react";
import type { Program, Subject } from "./contracts";
import type { PerformanceRecord } from "../../server/performance/index";
import { request } from "./api";
import { ErrorNotice } from "./ui";

export type PerformanceView = PerformanceRecord & {
  etag: string;
  applicable: boolean;
  limitation: string | null;
};
export const performanceStatuses = {
  pending: "待独立审核",
  approved: "审核通过",
  rejected: "未通过审核",
  withdrawn: "已撤回",
};

export function PerformancePanel({
  program,
  subjects,
  onChanged,
}: {
  program: Program;
  subjects: Subject[];
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<PerformanceView[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [score, setScore] = useState("");
  const [measuredAt, setMeasuredAt] = useState("");
  const [source, setSource] = useState("");
  const [evidence, setEvidence] = useState("");
  const [kind, setKind] = useState("standardized_mock");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState("");
  const options = subjects.filter(
    (item) =>
      item.availability === "verified_current" && item.maxScore !== null,
  );
  const subject = options.find((item) => item.subjectId === subjectId);
  const canSubmit =
    program.availability === "verified_current" &&
    Boolean(program.identity.examGroupId) &&
    options.length > 0;
  async function load(signal?: AbortSignal) {
    const response = await request<{ items: PerformanceView[] }>(
      "/me/performance",
      { signal },
    );
    if (!signal?.aborted) setItems(response.data.items);
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((failure) => {
      if (!controller.signal.aborted) setError(failure);
    });
    return () => controller.abort();
  }, []);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await action();
      await Promise.all([load(), onChanged()]);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ws-panel ws-stack" aria-label="可靠成绩与审核">
      <h2>可靠成绩与审核</h2>
      <p>
        提交实际考试或同口径模拟考试的成绩与证明定位，由独立复核人员核验。未审核、已撤回或范围不符的成绩不计入规划差距；五题小测、自报估分不能替代可靠成绩。
      </p>
      <p className="ws-muted">
        操作有效期为测量日起180天，属于保守的产品默认规则，不代表科学校准。成绩只用于此招生年度、项目修订、考试组和科目。审核通过后，请重新保存目标与计划。
      </p>
      <ErrorNotice error={error} />
      {canSubmit ? (
        <form
          className="ws-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!subject) return;
            void act(async () => {
              await request("/me/performance", {
                method: "POST",
                body: {
                  programId: program.programId,
                  programRevisionId: program.programRevisionId,
                  targetAdmissionYear: program.identity.targetAdmissionYear,
                  examGroupId: program.identity.examGroupId,
                  subjectId,
                  maxScore: subject.maxScore,
                  score: Number(score),
                  measuredAt,
                  kind,
                  source,
                  evidenceReference: evidence,
                },
              });
              setScore("");
              setSource("");
              setEvidence("");
              setMessage(
                "成绩已提交，等待独立审核；当前分数与差距不会提前更新。",
              );
            });
          }}
        >
          <div className="ws-form-grid">
            <label>
              成绩科目
              <select
                required
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                <option value="">选择已选科目</option>
                {options.map((item) => (
                  <option key={item.subjectId} value={item.subjectId}>
                    {item.name} · 满分{item.maxScore}
                  </option>
                ))}
              </select>
            </label>
            <label>
              核验成绩
              <input
                required
                type="number"
                min="0"
                step="0.5"
                max={subject?.maxScore ?? undefined}
                value={score}
                onChange={(event) => setScore(event.target.value)}
              />
            </label>
            <label>
              考试日期
              <input
                required
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={measuredAt}
                onChange={(event) => setMeasuredAt(event.target.value)}
              />
            </label>
            <label>
              成绩类型
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="standardized_mock">同口径模拟考试</option>
                <option value="validated_assessment">
                  有正式依据的实际考试
                </option>
              </select>
            </label>
          </div>
          <label>
            考试名称与来源
            <input
              required
              maxLength={300}
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="写明考试组织方、试卷版本与考试名称"
            />
          </label>
          <label>
            成绩证明定位
            <textarea
              required
              maxLength={2000}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="填写复核人员可核验的证明位置和口径说明；请勿填写密码、身份证号等无关信息"
            />
          </label>
          <button className="ws-secondary" disabled={busy || !subject}>
            提交成绩审核
          </button>
        </form>
      ) : (
        <p className="ws-notice">
          当前项目的年度、科目、满分或考试组尚未核验完整，暂不能提交可比成绩；请先补齐正式资料。
        </p>
      )}
      <button
        className="ws-link"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            setMessage("成绩审核状态已刷新。");
          })
        }
      >
        刷新成绩状态
      </button>
      {message && <p role="status">{message}</p>}
      {items
        .filter((item) => item.programId === program.programId)
        .map((item) => (
          <article
            key={item.performanceId}
            className="ws-stack"
            aria-label={`${item.subjectName}成绩记录`}
          >
            <h3>
              {item.subjectName} · {item.score}/{item.maxScore}
            </h3>
            <p>
              {performanceStatuses[item.status]} · 考试日期{" "}
              {item.measuredAt.slice(0, 10)} · 有效期至{" "}
              {item.expiresAt.slice(0, 10)}
            </p>
            <p>{item.source}</p>
            <p>{item.evidenceReference}</p>
            {item.limitation && <p className="ws-notice">{item.limitation}</p>}
            {item.reviewReason && <p>审核说明：{item.reviewReason}</p>}
            {item.withdrawalReason && <p>撤回原因：{item.withdrawalReason}</p>}
            {item.status !== "withdrawn" && (
              <>
                <label>
                  撤回成绩原因
                  <input
                    value={reason[item.performanceId] ?? ""}
                    maxLength={1000}
                    onChange={(event) =>
                      setReason((current) => ({
                        ...current,
                        [item.performanceId]: event.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  className="ws-secondary"
                  disabled={busy || !reason[item.performanceId]?.trim()}
                  onClick={() =>
                    void act(async () => {
                      await request(
                        `/me/performance/${item.performanceId}/withdraw`,
                        {
                          method: "POST",
                          etag: item.etag,
                          body: { reason: reason[item.performanceId] },
                        },
                      );
                      setMessage(
                        "成绩已撤回，相关当前分数与差距已清除，旧计划需要重新核验。",
                      );
                    })
                  }
                >
                  撤回这条成绩
                </button>
              </>
            )}
          </article>
        ))}
    </section>
  );
}
