import { useState } from "react";
import { request } from "./api";
import { ErrorNotice } from "./ui";

interface Correction {
  correctionId: string;
  description: string;
  status: string;
  etag: string;
  resolution?: string;
  resolvedAt?: string;
}
const correctionStatuses: Record<string, string> = {
  pending: "待处理",
  reviewing: "核查中",
  resolved: "已解决",
  rejected: "未采纳",
};
function useQueue<T>(path: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function load() {
    const result = await request<{ items: T[] }>(path);
    setItems(result.data.items);
    setLoaded(true);
  }
  async function act(action = load) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return { items, loaded, busy, error, load, act };
}

function CorrectionEditor({
  item,
  busy,
  save,
}: {
  item: Correction;
  busy: boolean;
  save: (status: string, resolution: string) => void;
}) {
  const [status, setStatus] = useState(item.status);
  const [resolution, setResolution] = useState(item.resolution ?? "");
  return (
    <form
      className="ws-stack ws-correction"
      aria-label={`处理纠错 ${item.correctionId}`}
      onSubmit={(event) => {
        event.preventDefault();
        save(status, resolution);
      }}
    >
      <p>{item.description}</p>
      <label>
        处理状态
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(correctionStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        处理说明
        <textarea
          aria-label="处理说明"
          required
          maxLength={3000}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </label>
      <button className="ws-secondary" disabled={busy || !resolution.trim()}>
        保存处理结果
      </button>
    </form>
  );
}

function Corrections() {
  const queue = useQueue<Correction>("/admin/corrections");
  return (
    <section className="ws-panel ws-stack" aria-label="用户纠错处理">
      <div className="ws-between">
        <h2>用户纠错</h2>
        <button
          className="ws-secondary"
          disabled={queue.busy}
          onClick={() => void queue.act()}
        >
          读取纠错队列
        </button>
      </div>
      <ErrorNotice error={queue.error} onReload={() => void queue.act()} />
      {queue.loaded && !queue.items.length && <p>暂时没有待处理纠错。</p>}
      {queue.items.map((item) => (
        <CorrectionEditor
          key={`${item.correctionId}:${item.etag}`}
          item={item}
          busy={queue.busy}
          save={(status, resolution) =>
            void queue.act(async () => {
              await request(`/admin/corrections/${item.correctionId}`, {
                method: "PATCH",
                etag: item.etag,
                body: { status, resolution },
              });
              await queue.load();
            })
          }
        />
      ))}
    </section>
  );
}

export function MyCorrections() {
  const queue = useQueue<Correction>("/me/corrections");
  return (
    <details className="ws-panel">
      <summary>我的纠错处理记录</summary>
      <button
        className="ws-secondary"
        disabled={queue.busy}
        onClick={() => void queue.act()}
      >
        刷新我的纠错
      </button>
      <ErrorNotice error={queue.error} />
      {queue.loaded && !queue.items.length && <p>还没有提交过纠错。</p>}
      {queue.items.map((item) => (
        <div className="ws-correction" key={item.correctionId}>
          <p>{item.description}</p>
          <p>处理状态：{correctionStatuses[item.status] ?? item.status}</p>
          {item.resolution && <p>处理说明：{item.resolution}</p>}
          {item.resolvedAt && <small>最近处理：{item.resolvedAt}</small>}
        </div>
      ))}
    </details>
  );
}

interface Publication {
  publicationId: string;
  kind: string;
  version: string;
  status: string;
  summary: string;
  withdrawalReason?: string;
}
const publicationStatuses: Record<string, string> = {
  succeeded: "已发布",
  withdrawn: "已撤回",
  partially_withdrawn: "部分撤回",
};
function Publications({ canWithdraw }: { canWithdraw: boolean }) {
  const queue = useQueue<Publication>("/admin/publications");
  const [selected, setSelected] = useState<Publication | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="ws-panel ws-stack" aria-label="发布与撤回">
      <div className="ws-between">
        <h2>发布与撤回</h2>
        <button
          className="ws-secondary"
          disabled={queue.busy}
          onClick={() => void queue.act()}
        >
          刷新发布记录
        </button>
      </div>
      <ErrorNotice error={queue.error} onReload={() => void queue.act()} />
      {queue.loaded && !queue.items.length && <p>暂无发布记录。</p>}
      {queue.items.map((item) => (
        <div className="ws-correction" key={item.publicationId}>
          <strong>{item.version}</strong>
          <p>{item.summary}</p>
          <p>状态：{publicationStatuses[item.status] ?? item.status}</p>
          {item.withdrawalReason && <p>撤回原因：{item.withdrawalReason}</p>}
          {canWithdraw && item.status !== "withdrawn" && (
            <button
              className="ws-danger"
              disabled={queue.busy}
              onClick={() => {
                setSelected(item);
                setReason("");
                setConfirmed(false);
              }}
            >
              撤回此发布
            </button>
          )}
        </div>
      ))}
      {selected && (
        <form
          className="ws-stack"
          aria-label="确认发布撤回"
          onSubmit={(event) => {
            event.preventDefault();
            void queue.act(async () => {
              await request(
                `/admin/publications/${selected.publicationId}/withdraw`,
                { method: "POST", body: { reason } },
              );
              setSelected(null);
              setReason("");
              setConfirmed(false);
              await queue.load();
            });
          }}
        >
          <p>
            将撤回 {selected.version}{" "}
            的全部项目；旧报告保留历史并标记依据已撤回。
          </p>
          <label>
            撤回原因
            <textarea
              required
              maxLength={3000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="ws-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已核对撤回范围
          </label>
          <div className="ws-actions">
            <button
              className="ws-danger"
              disabled={queue.busy || !confirmed || !reason.trim()}
            >
              确认撤回发布
            </button>
            <button
              type="button"
              className="ws-link"
              disabled={queue.busy}
              onClick={() => setSelected(null)}
            >
              取消撤回
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function AuditLog() {
  const queue = useQueue<{
    id: string;
    actor: string;
    action: string;
    objectId: string;
    at: string;
  }>("/admin/audit-events");
  return (
    <section className="ws-panel ws-stack" aria-label="操作审计">
      <div className="ws-between">
        <h2>操作审计</h2>
        <button
          className="ws-secondary"
          disabled={queue.busy}
          onClick={() => void queue.act()}
        >
          读取审计记录
        </button>
      </div>
      <ErrorNotice error={queue.error} />
      <p className="ws-muted">
        显示最近 200 条操作，包含执行人、动作、对象和时间。
      </p>
      {queue.loaded && !queue.items.length && <p>暂无审计记录。</p>}
      <div className="ws-table-scroll">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>执行人</th>
              <th>动作</th>
              <th>对象</th>
            </tr>
          </thead>
          <tbody>
            {queue.items.map((item) => (
              <tr key={item.id}>
                <td>{item.at}</td>
                <td>{item.actor}</td>
                <td>{item.action}</td>
                <td>{item.objectId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function GovernancePanels({ roles }: { roles: string[] }) {
  return (
    <>
      {roles.includes("reviewer") && <Corrections />}
      {roles.some((r) => r === "publisher" || r === "auditor") && (
        <Publications canWithdraw={roles.includes("publisher")} />
      )}
      {roles.includes("auditor") && <AuditLog />}
    </>
  );
}
