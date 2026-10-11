import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, Trash2, X } from "lucide-react";
import type { Conversation, ChatMessage } from "../../server/explanation/chat";
import { request, type Resource } from "./api";
import { ErrorNotice, safeUrl } from "./ui";
import { TutorText } from "./TutorContent";
import "./assistant.css";

const reasonMessages: Record<string, string> = {
  MODEL_DISABLED: "模型服务尚未启用，目前无法生成自由回答。",
  MODEL_NOT_CONFIGURED: "模型服务尚未配置，请联系维护人员。",
  SEARCH_DISABLED: "联网搜索尚未启用，本次未搜索网页。",
  SEARCH_NOT_CONFIGURED: "搜索服务尚未配置，本次未搜索网页。",
  SEARCH_BUDGET_EXHAUSTED: "今天的搜索额度已用完，请稍后再试。",
  SEARCH_UNAVAILABLE: "搜索服务暂时不可用。",
  NO_WEB_EVIDENCE: "本次未找到可引用的网页资料。",
  MODEL_TIMEOUT: "回答生成超时，请稍后重试。",
  MODEL_BUDGET_EXHAUSTED: "今天的辅助回答额度已用完，请稍后再试。",
  RATE_LIMITED: "当前咨询请求较多，请稍后重试。",
  PROVIDER_UNAVAILABLE: "模型服务暂时不可用，请稍后重试。",
  MODEL_UNAVAILABLE: "模型服务暂时不可用，请稍后重试。",
  PROVIDER_AUTH_FAILED: "模型服务的授权配置需要维护人员检查。",
  BUDGET_EXHAUSTED: "今天的辅助回答额度已用完，请稍后再试。",
  CONCURRENCY_LIMIT: "当前仍有回答正在生成，请稍后再试。",
  EVIDENCE_TOO_LARGE: "本次资料较长，请缩短问题或分步提问。",
  CITATION_VALIDATION_FAILED: "回答的来源引用未通过核对，请重新提问。",
  OUTPUT_VALIDATION_FAILED: "本次回答未通过检查，请稍后重试。",
};
function reasonMessage(code: string) {
  return reasonMessages[code] ?? "辅助服务暂时不可用，已有对话仍保留。";
}
function readableNotice(notice: string) {
  return notice.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, reasonMessage);
}
function Message({ message }: { message: ChatMessage }) {
  return (
    <article
      className={"assistant-message " + message.role}
      aria-label={message.role === "user" ? "我的消息" : "助手回答"}
    >
      <span className="assistant-message-author">
        {message.role === "user" ? "你" : "研途助手"}
      </span>
      <TutorText text={message.content} />
      {message.reason && (
        <p className="assistant-message-notice">
          {reasonMessage(message.reason)}
        </p>
      )}
      {!!message.notices?.length && (
        <ul className="assistant-message-notice">
          {message.notices.map((notice, i) => (
            <li key={i}>{readableNotice(notice)}</li>
          ))}
        </ul>
      )}
      {!!message.sources?.length && (
        <details className="assistant-sources">
          <summary>本次参考资料 · {message.sources.length} 条</summary>
          {message.sources.map((source) => (
            <div key={source.id}>
              {safeUrl(source.url) ? (
                <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                  [{source.id}] {source.title}
                </a>
              ) : (
                <span>{source.title}</span>
              )}
              <small>
                {source.kind === "search_snippet"
                  ? "搜索摘要，尚未读取全文"
                  : "官方网页正文摘录"}{" "}
                · {new Date(source.retrievedAt).toLocaleString("zh-CN")}
              </small>
              <blockquote>{source.excerpt}</blockquote>
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
function ConversationPanel({ onClose }: { onClose?: () => void }) {
  const [resource, setResource] = useState<Resource<Conversation> | null>(null);
  const [input, setInput] = useState(""),
    [urls, setUrls] = useState("");
  const [allowSearch, setAllowSearch] = useState(true),
    [showLinks, setShowLinks] = useState(false);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(),
    [confirmClear, setConfirmClear] = useState(false);
  const list = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    request<Conversation>("/assistant/conversation", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setResource(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    composer.current?.focus();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [resource?.data.version, busy]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!resource || !input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await request<Conversation>("/assistant/conversation", {
        method: "POST",
        etag: resource.etag,
        signal: lifecycle.current?.signal,
        body: {
          message: input,
          allowSearch,
          urls: urls.split(/\s+/).filter(Boolean),
        },
      });
      setResource(result);
      setInput("");
    } catch (error) {
      if (!lifecycle.current?.signal.aborted) setError(error);
    } finally {
      if (!lifecycle.current?.signal.aborted) setBusy(false);
    }
  }
  async function clear() {
    if (!resource) return;
    setBusy(true);
    setError(null);
    try {
      const result = await request<Conversation>("/assistant/conversation", {
        method: "DELETE",
        etag: resource.etag,
        signal: lifecycle.current?.signal,
        body: {},
      });
      setResource(result);
      setInput("");
      setConfirmClear(false);
    } catch (error) {
      if (!lifecycle.current?.signal.aborted) setError(error);
    } finally {
      if (!lifecycle.current?.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <header className="assistant-header">
        <Sparkles size={23} />
        <div>
          <h2>研途咨询</h2>
          <p>可以继续追问，也可以聊其他问题</p>
        </div>
        <button
          type="button"
          aria-label="清空当前对话"
          disabled={!resource || busy}
          onClick={() => setConfirmClear(true)}
        >
          <Trash2 size={19} />
        </button>
        {onClose && (
          <button type="button" aria-label="收起咨询助手" onClick={onClose}>
            <X size={21} />
          </button>
        )}
      </header>
      {confirmClear && (
        <div className="assistant-clear">
          <p>清空后无法恢复这段对话。</p>
          <button type="button" disabled={busy} onClick={() => void clear()}>
            确认清空当前对话
          </button>
          <button type="button" onClick={() => setConfirmClear(false)}>
            保留对话
          </button>
        </div>
      )}
      <div
        ref={list}
        className="assistant-messages"
        role="log"
        aria-live="polite"
        aria-label="咨询对话记录"
      >
        {loading ? (
          <p>正在读取对话…</p>
        ) : (
          !resource?.data.messages.length && (
            <div className="assistant-welcome">
              <MessageCircle size={32} />
              <h3>有什么想聊的？</h3>
              <p>
                学习中的疑问、资料理解，或任何你想讨论的话题。需要最新资料时，可以允许助手按需联网。
              </p>
              <small>回答用于理解与参考，招生事实仍需核对当年官方文件。</small>
            </div>
          )
        )}
        {resource?.data.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        {busy && <p role="status">正在思考与整理…</p>}
        <ErrorNotice
          error={error}
          onReload={() => {
            setError(null);
            setLoading(true);
            void request<Conversation>("/assistant/conversation", {
              signal: lifecycle.current?.signal,
            })
              .then(setResource)
              .catch((error) => {
                if (!lifecycle.current?.signal.aborted) setError(error);
              })
              .finally(() => {
                if (!lifecycle.current?.signal.aborted) setLoading(false);
              });
          }}
        />
      </div>
      <form className="assistant-composer" onSubmit={submit}>
        <div className="assistant-tools">
          <label>
            <input
              type="checkbox"
              checked={allowSearch}
              onChange={(event) => setAllowSearch(event.target.checked)}
            />
            允许按需联网
          </label>
          <button
            type="button"
            aria-expanded={showLinks}
            onClick={() => setShowLinks(!showLinks)}
          >
            参考链接
          </button>
        </div>
        {showLinks && (
          <label>
            官方资料链接（最多两个）
            <textarea
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              placeholder="用空格或换行分隔链接"
            />
          </label>
        )}
        <label className="assistant-input-label">
          <span>发送消息</span>
          <textarea
            ref={composer}
            required
            maxLength={3000}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入任意问题，或继续刚才的讨论…"
          />
        </label>
        <div className="assistant-send-row">
          <small>对话保存在当前账号，可随时清空</small>
          <button
            className="ws-primary"
            disabled={busy || !resource || !input.trim()}
          >
            <Send size={17} />
            发送
          </button>
        </div>
      </form>
    </>
  );
}
export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 600px)").matches,
  );
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const query = matchMedia("(max-width: 600px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  }
  useEffect(() => {
    if (!open) return;
    const element = panel.current!;
    const background = mobile
      ? ([
          ...Array.from(element.closest(".workspace")!.children).filter(
            (child) => !child.contains(element),
          ),
          button.current!,
        ] as HTMLElement[])
      : [];
    const previous = background.map((node) => node.inert);
    background.forEach((node) => {
      node.inert = true;
    });
    const focusable = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ).filter((node) => node.getClientRects().length > 0);
    if (mobile && !element.contains(document.activeElement))
      focusable()[0]?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (mobile && event.key === "Tab") {
        const controls = focusable();
        const first = controls[0],
          last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !element.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !element.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      background.forEach((node, index) => {
        node.inert = previous[index];
      });
    };
  }, [open, mobile]);
  return (
    <div className="floating-assistant">
      {open && (
        <aside
          ref={panel}
          role={mobile ? "dialog" : "complementary"}
          aria-modal={mobile ? true : undefined}
          className="assistant-panel"
          id="assistant-conversation-panel"
          aria-label="研途咨询助手"
        >
          <ConversationPanel onClose={close} />
        </aside>
      )}
      <button
        ref={button}
        type="button"
        className="assistant-orb"
        aria-label={open ? "收起咨询对话" : "打开咨询助手"}
        aria-expanded={open}
        aria-controls="assistant-conversation-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <X size={25} /> : <MessageCircle size={25} />}
        <span>咨询</span>
      </button>
    </div>
  );
}
export function AssistantPanel() {
  return (
    <div className="assistant-panel assistant-inline">
      <ConversationPanel />
    </div>
  );
}
