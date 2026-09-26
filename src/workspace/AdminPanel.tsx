import { useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { request } from "./api";
import { Empty, ErrorNotice } from "./ui";

interface Draft {
  draftId: string;
  kind: string;
  content: unknown;
  reviewStatus: string;
  reviewId?: string;
  authorId: string;
  etag: string;
}
interface Actor {
  actorId: string;
  roles: string[];
}
const statuses: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审核",
  approved: "已批准",
  rejected: "已拒绝",
};
const reviewChecks = [
  { id: "answer_unique", label: "答案唯一且正确" },
  { id: "conditions_complete", label: "题干条件完整" },
  { id: "options_distinct", label: "选项明确无重复" },
  { id: "explanation_consistent", label: "解析与评分一致" },
  { id: "scope_checked", label: "适用范围已核对" },
  { id: "rights_checked", label: "来源与使用权限已核对" },
];
export function AdminPanel() {
  const [checks, setChecks] = useState<string[]>([]);
  const [token, setToken] = useState(""),
    [actor, setActor] = useState<Actor | null>(null),
    [kind, setKind] = useState("program"),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [content, setContent] = useState(""),
    [editing, setEditing] = useState<Draft | null>(null),
    [reason, setReason] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [publicationKind, setPublicationKind] = useState("catalog"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [message, setMessage] = useState("");
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await run();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function load(nextKind = kind) {
    const result = await request<{ items: Draft[] }>(
      `/admin/drafts/${nextKind}`,
      { token },
    );
    setDrafts(result.data.items);
  }
  async function login(event: React.FormEvent) {
    event.preventDefault();
    await act(async () => {
      const result = await request<Actor>("/admin/me", { token });
      setActor(result.data);
      await load();
    });
  }
  async function write(event: React.FormEvent) {
    event.preventDefault();
    await act(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error("导入内容不是有效的 JSON，请先检查格式。");
      }
      await request(
        `/admin/drafts/${kind}${editing ? `/${editing.draftId}` : ""}`,
        {
          method: editing ? "PUT" : "POST",
          token,
          etag: editing?.etag,
          body: { content: parsed },
        },
      );
      setContent("");
      setEditing(null);
      await load();
      setMessage("草稿已保存。完成独立人工复核与发布后，才会成为可用资料。");
    });
  }
  async function transition(
    draft: Draft,
    operation: "submit-review" | "withdraw-review",
  ) {
    await act(async () => {
      await request(`/admin/drafts/${kind}/${draft.draftId}/${operation}`, {
        method: "POST",
        token,
        etag: draft.etag,
        body: {},
      });
      await load();
    });
  }
  async function decide(draft: Draft, decision: "approved" | "rejected") {
    await act(async () => {
      await request(`/admin/reviews/${draft.reviewId}/decision`, {
        method: "POST",
        token,
        etag: draft.etag,
        body: {
          decision,
          reason,
          ...(kind === "question" && decision === "approved" ? { checks } : {}),
        },
      });
      setChecks([]);
      await load();
    });
  }
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">资料治理工作台</span>
          <h1>每一项结论，都有来处。</h1>
          <p>登记来源、维护草稿、独立复核，再发布可追溯版本。</p>
        </div>
        <ShieldCheck size={34} />
      </div>
      <ErrorNotice
        error={error}
        onReload={actor ? () => void act(() => load()) : undefined}
      />
      <form className="ws-panel ws-stack" onSubmit={login}>
        <h2>
          <LockKeyhole size={19} /> 管理身份
        </h2>
        <p className="ws-muted">
          使用部署管理员分配的凭据。凭据只保留在此页面内存中，关闭页面后需要重新输入。
        </p>
        <label>
          管理访问凭据
          <input
            type="password"
            autoComplete="off"
            value={token}
            required
            onChange={(event) => {
              setToken(event.target.value);
              setActor(null);
              setDrafts([]);
            }}
          />
        </label>
        <div className="ws-actions">
          <button className="ws-primary" disabled={busy || !token}>
            验证管理身份
          </button>
          {actor && (
            <>
              <span role="status">
                {actor.actorId} · {actor.roles.join(" / ")}
              </span>
              <button
                type="button"
                className="ws-link"
                onClick={() => {
                  setToken("");
                  setActor(null);
                  setDrafts([]);
                }}
              >
                退出管理
              </button>
            </>
          )}
        </div>
      </form>
      {actor && (
        <>
          <section className="ws-panel ws-stack">
            <div className="ws-between">
              <h2>导入与编辑草稿</h2>
              <label>
                资料类型
                <select
                  value={kind}
                  onChange={(event) => {
                    const value = event.target.value;
                    setKind(value);
                    setChecks([]);
                    setEditing(null);
                    setContent("");
                    setSelected([]);
                    void act(() => load(value));
                  }}
                >
                  <option value="program">招生项目</option>
                  <option value="question">测评题目</option>
                  <option value="rule">推荐规则</option>
                  <option value="risk">风险证据</option>
                  <option value="claim">事实声明</option>
                </select>
              </label>
            </div>
            <p className="ws-muted">
              按资料契约导入完整批次：招生、风险与事实使用 CatalogImport（含
              sources、programs、coverage）；题目使用完整 QuestionBank；规则使用
              RecommendationRule。上传草稿不会直接进入学生推荐。
            </p>
            <form onSubmit={write} className="ws-stack">
              <label>
                导入 JSON 文件
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      if (file.size > 1_000_000) {
                        setError(new Error("请导入小于 1 MB 的单项草稿文件。"));
                        return;
                      }
                      void file.text().then(setContent);
                    }
                  }}
                />
              </label>
              <label>
                {editing ? `编辑草稿 ${editing.draftId}` : "草稿内容"}
                <textarea
                  className="ws-json"
                  required
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="粘贴单个资料对象的 JSON，保留来源及适用范围"
                />
              </label>
              <div className="ws-actions">
                <button
                  className="ws-primary"
                  disabled={busy || !content.trim()}
                >
                  {editing ? "保存草稿修改" : "创建资料草稿"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="ws-link"
                    onClick={() => {
                      setEditing(null);
                      setContent("");
                    }}
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </form>
          </section>
          <section className="ws-panel ws-stack">
            <h2>人工复核队列</h2>
            {kind === "question" && (
              <fieldset className="ws-review-checks">
                <legend>题库发布前逐项人工核验</legend>
                {reviewChecks.map((check) => (
                  <label className="ws-check" key={check.id}>
                    <input
                      type="checkbox"
                      checked={checks.includes(check.id)}
                      onChange={(event) =>
                        setChecks((current) =>
                          event.target.checked
                            ? [...current, check.id]
                            : current.filter((id) => id !== check.id),
                        )
                      }
                    />
                    {check.label}
                  </label>
                ))}
              </fieldset>
            )}
            <label>
              审核 / 发布说明
              <input
                value={reason}
                maxLength={2000}
                onChange={(event) => setReason(event.target.value)}
                placeholder="记录核验依据、适用范围与判断理由"
              />
            </label>
            {drafts.length ? (
              <div className="ws-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>选择</th>
                      <th>草稿</th>
                      <th>状态 / 作者</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((draft) => (
                      <tr key={draft.draftId}>
                        <td>
                          <input
                            aria-label={`选择草稿 ${draft.draftId}`}
                            type="checkbox"
                            disabled={draft.reviewStatus !== "approved"}
                            checked={selected.includes(draft.draftId)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, draft.draftId]
                                  : current.filter(
                                      (id) => id !== draft.draftId,
                                    ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <code>{draft.draftId}</code>
                        </td>
                        <td>
                          {statuses[draft.reviewStatus] ?? draft.reviewStatus}
                          <br />
                          <small>{draft.authorId}</small>
                        </td>
                        <td>
                          <div className="ws-actions">
                            {["draft", "rejected"].includes(
                              draft.reviewStatus,
                            ) && (
                              <button
                                className="ws-link"
                                onClick={() => {
                                  setEditing(draft);
                                  setContent(
                                    JSON.stringify(draft.content, null, 2),
                                  );
                                }}
                              >
                                编辑
                              </button>
                            )}
                            {draft.reviewStatus === "draft" && (
                              <button
                                className="ws-secondary"
                                disabled={busy}
                                onClick={() =>
                                  transition(draft, "submit-review")
                                }
                              >
                                提交复核
                              </button>
                            )}
                            {["pending_review", "rejected"].includes(
                              draft.reviewStatus,
                            ) && (
                              <button
                                className="ws-link"
                                disabled={busy}
                                onClick={() =>
                                  transition(draft, "withdraw-review")
                                }
                              >
                                撤回编辑
                              </button>
                            )}
                            {draft.reviewStatus === "pending_review" &&
                              draft.reviewId && (
                                <>
                                  <button
                                    className="ws-secondary"
                                    disabled={
                                      busy ||
                                      !reason.trim() ||
                                      (kind === "question" &&
                                        checks.length !== reviewChecks.length)
                                    }
                                    onClick={() => decide(draft, "approved")}
                                  >
                                    批准
                                  </button>
                                  <button
                                    className="ws-danger"
                                    disabled={busy || !reason.trim()}
                                    onClick={() => decide(draft, "rejected")}
                                  >
                                    拒绝
                                  </button>
                                </>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="此类型还没有草稿">导入资料后开始复核流程。</Empty>
            )}
            <div className="ws-actions">
              <label>
                发布类型
                <select
                  value={publicationKind}
                  onChange={(event) => setPublicationKind(event.target.value)}
                >
                  <option value="catalog">招生目录</option>
                  <option value="questionBank">测评题库</option>
                  <option value="rule">推荐规则</option>
                </select>
              </label>
              <button
                className="ws-primary"
                disabled={busy || !selected.length || !reason.trim()}
                onClick={() =>
                  act(async () => {
                    const result = await request<{
                      publicationId: string;
                      jobId?: string;
                      status?: string;
                    }>("/admin/publications", {
                      method: "POST",
                      token,
                      body: {
                        kind: publicationKind,
                        draftIds: selected,
                        summary: reason,
                      },
                    });
                    setMessage(
                      `发布作业已创建：${result.data.publicationId}。${result.data.status ?? "请核对发布状态"}`,
                    );
                    setSelected([]);
                    await load();
                  })
                }
              >
                发布已批准资料（{selected.length}）
              </button>
            </div>
            <p className="ws-muted">
              服务端检查角色、禁止自审，并保留审计记录；管理者不能通过页面跳过复核。
            </p>
          </section>
          <CorrectionQueue token={token} />
        </>
      )}
      {message && (
        <div className="ws-notice" role="status">
          {message}
        </div>
      )}
    </>
  );
}

function CorrectionQueue({ token }: { token: string }) {
  const [items, setItems] = useState<
      {
        correctionId: string;
        description: string;
        status: string;
        etag: string;
      }[]
    >([]),
    [error, setError] = useState<unknown>(),
    [loaded, setLoaded] = useState(false);
  async function load() {
    try {
      const result = await request<{ items: typeof items }>(
        "/admin/corrections",
        { token },
      );
      setItems(result.data.items);
      setLoaded(true);
      setError(null);
    } catch (error) {
      setError(error);
    }
  }
  return (
    <section className="ws-panel">
      <div className="ws-between">
        <h2>用户纠错</h2>
        <button className="ws-secondary" onClick={() => void load()}>
          读取纠错队列
        </button>
      </div>
      <ErrorNotice error={error} />
      {loaded && !items.length && (
        <p className="ws-muted">暂时没有待处理纠错。</p>
      )}
      {items.map((item) => (
        <div className="ws-correction" key={item.correctionId}>
          <p>{item.description}</p>
          <small>处理状态：{item.status}</small>
        </div>
      ))}
    </section>
  );
}
