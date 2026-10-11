import { useResearch } from "./ResearchContext";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import type { DisciplineCatalog } from "../../server/disciplines/types";
import { request } from "./api";
import { ErrorNotice, safeUrl } from "./ui";

export function DisciplineExplorer({
  confirmedMajorId,
  onConfirm,
  onBrowse,
}: {
  confirmedMajorId: string | null;
  onConfirm: (id: string | null) => Promise<void>;
  onBrowse: (code: string) => void;
}) {
  const { locked } = useResearch();
  const [catalog, setCatalog] = useState<DisciplineCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [degree, setDegree] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<DisciplineCatalog>("/disciplines", {
      signal: controller.signal,
    })
      .then((result) => setCatalog(result.data))
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, []);
  const visible = useMemo(
    () =>
      (catalog?.items ?? []).filter(
        (item) =>
          (!group || item.groupCode === group) &&
          (!degree || item.degreeType === degree) &&
          (!query ||
            `${item.code} ${item.name} ${item.groupName} ${item.aliases.join(" ")}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ),
    [catalog, query, group, degree],
  );
  const selected = catalog?.items.find(
    (item) => item.code === confirmedMajorId,
  );
  async function confirm(id: string | null) {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(id);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="ws-panel ws-stack ws-disciplines"
      aria-label="全国专业目录"
    >
      <div className="ws-between">
        <div>
          <span className="ws-eyebrow">先看完整范围，再作个人选择</span>
          <h2>全国研究生学科专业目录</h2>
        </div>
        <BookOpen size={28} />
      </div>
      <ErrorNotice error={error} />
      {catalog ? (
        <>
          <div className="ws-catalog-statistics">
            <strong>
              {catalog.coverage.disciplineGroups}
              <small>学科门类</small>
            </strong>
            <strong>
              {catalog.coverage.academicDisciplines}
              <small>一级学科</small>
            </strong>
            <strong>
              {catalog.coverage.professionalCategories}
              <small>专业学位类别</small>
            </strong>
            <span>
              版本 {catalog.catalogVersion}
              <br />
              {catalog.coverage.description}
            </span>
          </div>
          <div className="ws-notice">
            {selected
              ? `你已确认：${selected.code} ${selected.name}`
              : confirmedMajorId
                ? "你保留了旧版专业方向，请在全国目录中重新确认具体专业。"
                : "你尚未确认报考专业。所有专业均可探索，不会按本科专业或示例项目自动替你选择。"}
            {confirmedMajorId && (
              <button
                className="ws-link"
                disabled={busy || locked}
                onClick={() => void confirm(null)}
              >
                恢复未确定专业
              </button>
            )}
          </div>
          <div className="ws-discipline-filters">
            <label>
              <Search size={16} />
              搜索全国专业
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="输入专业名称、门类或代码"
              />
            </label>
            <label>
              学位类别
              <select
                value={degree}
                onChange={(event) => {
                  setDegree(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">全部类别</option>
                <option value="academic">学术学位</option>
                <option value="professional">专业学位</option>
              </select>
            </label>
          </div>
          <div className="ws-group-list" role="group" aria-label="学科门类筛选">
            <button
              aria-pressed={!group}
              onClick={() => {
                setGroup("");
                setPage(0);
              }}
            >
              全部门类
            </button>
            {catalog.groups.map((item) => (
              <button
                key={item.code}
                aria-pressed={group === item.code}
                onClick={() => {
                  setGroup(item.code);
                  setPage(0);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
          <p className="ws-muted">
            符合条件 {visible.length} 项 · 仅点击“确认报考专业”才会保存选择。
          </p>
          <div className="ws-discipline-list">
            {visible.slice(page * 16, (page + 1) * 16).map((item) => (
              <article key={item.code} className="ws-discipline-card">
                <span className="ws-eyebrow">
                  {item.code} · {item.groupName}
                </span>
                <h3>{item.name}</h3>
                <p>
                  {item.degreeType === "academic"
                    ? "学术学位 · 一级学科"
                    : "专业学位类别"}
                  {item.mastersOnly ? " · 仅硕士" : ""}
                </p>
                {item.notes.map((note) => (
                  <small key={note}>{note}</small>
                ))}
                <div className="ws-actions">
                  <button
                    className="ws-link"
                    onClick={() => onBrowse(item.code)}
                  >
                    查看招生项目
                  </button>
                  <button
                    className="ws-secondary"
                    disabled={busy || locked}
                    aria-pressed={confirmedMajorId === item.code}
                    onClick={() =>
                      void confirm(
                        confirmedMajorId === item.code ? null : item.code,
                      )
                    }
                  >
                    {confirmedMajorId === item.code
                      ? "已确认 · 取消"
                      : "确认报考专业"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!visible.length && (
            <p>
              没有符合条件的目录条目，可修改搜索词或查看全部门类。学校自设专业需核对当年招生目录。
            </p>
          )}
          {visible.length > 16 && (
            <div className="ws-actions">
              <button
                className="ws-secondary"
                disabled={!page}
                onClick={() => setPage((value) => value - 1)}
              >
                上一页专业
              </button>
              <span>
                第 {page + 1} / {Math.ceil(visible.length / 16)} 页
              </span>
              <button
                className="ws-secondary"
                disabled={(page + 1) * 16 >= visible.length}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页专业
              </button>
            </div>
          )}
          <details>
            <summary>目录口径与官方来源</summary>
            <ul>
              {catalog.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {catalog.sources.map((source) => (
              <p key={source.sourceId}>
                <a href={safeUrl(source.url)} target="_blank" rel="noreferrer">
                  {source.publisher} · {source.title}
                </a>
              </p>
            ))}
          </details>
        </>
      ) : (
        !error && <p role="status">正在读取全国专业目录…</p>
      )}
    </section>
  );
}
