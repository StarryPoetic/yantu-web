import { useState } from "react";
import { Sparkles } from "lucide-react";
import { request } from "./api";
import { ErrorNotice, safeUrl } from "./ui";

interface Answer {
  answer: string;
  points?: { text: string; citations: string[] }[];
  sources: {
    id: string;
    title: string;
    url: string;
    retrievedAt: string;
    excerpt?: string;
    kind?: "official_page" | "search_snippet";
  }[];
  notices?: string[];
  explanationStatus: "model" | "template";
  reason?: string;
}
const reasonMessages: Record<string, string> = {
  MODEL_DISABLED: "模型辅助回答尚未启用，当前展示基础说明与可获得的资料。",
  MODEL_NOT_CONFIGURED: "模型服务尚未配置，暂时无法整理完整回答。",
  SEARCH_DISABLED: "联网搜索尚未启用，可以提供官方资料链接作为参考。",
  SEARCH_NOT_CONFIGURED: "搜索服务尚未配置，可以提供官方资料链接作为参考。",
  SEARCH_BUDGET_EXHAUSTED: "本日搜索额度已用完，请稍后再试。",
  SEARCH_UNAVAILABLE: "搜索服务暂时不可用，请稍后重试或提供官方资料链接。",
  WEB_UNAVAILABLE: "参考网页暂时无法读取，请检查链接或换用其他官方页面。",
  WEB_TIMEOUT: "网页读取超时，请稍后重试或换用其他官方资料链接。",
  WEB_HOST_NOT_ALLOWED:
    "该链接不在已配置的官方资料范围内，请使用受支持的官方来源。",
  WEB_REDIRECT_BLOCKED: "参考链接发生跳转，请提供官方资料页面的直接链接。",
  WEB_FORMAT_UNSUPPORTED: "该网页格式暂不支持读取，请换用官方文本页面。",
  NO_WEB_EVIDENCE:
    "尚未找到足以支持回答的网页资料，请补充更具体的问题或官方链接。",
  OUTPUT_VALIDATION_FAILED: "回答未通过来源核对，当前仅展示已取得的参考资料。",
  CITATION_VALIDATION_FAILED:
    "回答的引用未通过核对，当前仅展示已取得的参考资料。",
  MODEL_TIMEOUT: "回答整理超时，请稍后重试。",
  MODEL_BUDGET_EXHAUSTED: "本日辅助回答额度已用完，仍可查看已有参考资料。",
  RATE_LIMITED: "辅助回答请求较多，请稍后重试。",
  PROVIDER_UNAVAILABLE: "辅助回答服务暂时不可用，请稍后重试。",
};
function reasonMessage(code: string) {
  return (
    reasonMessages[code] ??
    "辅助回答暂时不可用，当前仅展示基础说明与已有参考资料。"
  );
}
function readableNotice(notice: string) {
  return notice.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, reasonMessage);
}
export function AssistantPanel() {
  const [question, setQuestion] = useState(""),
    [allowSearch, setAllowSearch] = useState(false),
    [urls, setUrls] = useState(""),
    [result, setResult] = useState<Answer | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await request<Answer>("/assistant/questions", {
        method: "POST",
        body: {
          question,
          allowSearch,
          urls: urls.split(/\s+/).filter(Boolean),
        },
      });
      setResult(response.data);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">把问题问具体</span>
          <h1>带着来源，寻找答案。</h1>
          <p>按需搜索网页，帮你理解招生资料、培养方向与备考问题。</p>
        </div>
        <Sparkles size={34} />
      </div>
      <ErrorNotice error={error} />
      <form className="ws-panel ws-stack" onSubmit={submit}>
        <label>
          你的问题
          <textarea
            required
            minLength={2}
            maxLength={600}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：比较学硕和专硕时，我应该查看招生简章中的哪些内容？"
          />
        </label>
        <label>
          参考资料链接（选填，最多两个）
          <textarea
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder="粘贴官方招生或政策页面链接"
          />
        </label>
        <label className="ws-check">
          <input
            type="checkbox"
            checked={allowSearch}
            onChange={(event) => setAllowSearch(event.target.checked)}
          />
          允许按需联网搜索公开资料
        </label>
        <button
          className="ws-primary"
          disabled={busy || question.trim().length < 2}
        >
          {busy ? "正在查找与整理…" : "提问"}
        </button>
      </form>
      {result && (
        <section className="ws-panel ws-stack" aria-live="polite">
          <div className="ws-between">
            <h2>回答与依据</h2>
            <span className="ws-pill">
              {result.explanationStatus === "model"
                ? "模型辅助回答"
                : "基础说明"}
            </span>
          </div>
          <div className="ws-answer">{result.answer}</div>
          {!!result.points?.length && (
            <ol className="ws-answer-points">
              {result.points.map((point, index) => (
                <li key={index}>
                  <p>{point.text}</p>
                  <div className="ws-citations">
                    {point.citations.map((id) => {
                      const source = result.sources.find(
                        (source) => source.id === id,
                      );
                      return source && safeUrl(source.url) ? (
                        <a
                          key={id}
                          href={safeUrl(source.url)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          依据：{source.title}
                        </a>
                      ) : null;
                    })}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {result.reason && (
            <p className="ws-muted">{reasonMessage(result.reason)}</p>
          )}
          {!!result.notices?.length && (
            <div className="ws-notice">
              <ul>
                {result.notices.map((notice, index) => (
                  <li key={index}>{readableNotice(notice)}</li>
                ))}
              </ul>
            </div>
          )}
          {result.sources.length ? (
            <div>
              <h3>参考来源</h3>
              <ul>
                {result.sources.map((source) => (
                  <li key={source.id}>
                    {safeUrl(source.url) ? (
                      <a
                        href={safeUrl(source.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.title}
                      </a>
                    ) : (
                      source.title
                    )}
                    <small>
                      {source.kind === "search_snippet"
                        ? " · 搜索摘要，尚未读取网页全文"
                        : source.kind === "official_page"
                          ? " · 官方网页正文摘录"
                          : ""}{" "}
                      · 检索于{" "}
                      {new Date(source.retrievedAt).toLocaleString("zh-CN")}
                    </small>
                    {source.excerpt && (
                      <blockquote className="ws-source-excerpt">
                        {source.excerpt}
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ws-muted">本次未获得可引用的网页资料。</p>
          )}
          <div className="ws-notice">
            回答用于资料理解与核验参考。网页或模型内容不会自动成为已核验招生事实，报考要求以当年官方文件为准。
          </div>
        </section>
      )}
    </>
  );
}
