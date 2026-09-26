import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X, CircleAlert } from "lucide-react";
import { ApiError, errorMessage } from "./api";

export function ErrorNotice({
  error,
  onReload,
}: {
  error: unknown;
  onReload?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="ws-notice ws-error" role="alert">
      <CircleAlert size={20} />
      <div>
        <p>{errorMessage(error)}</p>
        {error instanceof ApiError && <small>错误代码：{error.code}</small>}
        {onReload && (
          <button className="ws-link" onClick={onReload}>
            重新读取最新记录
          </button>
        )}
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="ws-empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const id = useId(),
    ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const list = ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]',
      );
      if (!list?.length) return;
      const first = list[0],
        last = list[list.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, []);
  return (
    <div
      className="ws-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ws-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button aria-label="关闭弹窗" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        <div className="ws-dialog-body">{children}</div>
      </div>
    </div>
  );
}
export function DegreeInfo() {
  return (
    <>
      <p>
        先看学习目标，再比较具体项目的培养安排。两种学位都可以就业或继续深造。
      </p>
      <div className="ws-two">
        <section className="ws-panel">
          <h3>学硕 · 学术学位</h3>
          <p>
            关注理论、研究方法、导师方向与科研训练。比较课程、论文要求及研究经历与未来岗位的关联。
          </p>
        </section>
        <section className="ws-panel">
          <h3>专硕 · 专业学位</h3>
          <p>
            关注专业能力、行业问题与实践项目。比较实习资源、毕业要求和真实岗位需要的能力。
          </p>
        </section>
      </div>
      <div className="ws-notice">
        具体学制、学费、考试科目与报考条件以项目当年官方资料为准。学硕不固定等于数一英一，专硕也不固定等于数二英二；政策支持不等于就业保证。
      </div>
    </>
  );
}
export function safeUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function explain(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return String(
      v.message ??
        v.reason ??
        v.description ??
        v.label ??
        v.code ??
        "请核验官方资料",
    );
  }
  return "待核验";
}
