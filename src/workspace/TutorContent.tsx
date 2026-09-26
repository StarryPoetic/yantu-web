import { createElement as element, useState } from "react";
import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type {
  MathExpression,
  QuestionPresentation,
  PublicQuestion,
} from "../../server/assessment/types";
import type { ChatMessage } from "../../server/explanation/chat";
import { request } from "./api";
import { ErrorNotice } from "./ui";
import "./assessment.css";

function mathNode(value: MathExpression, key?: number): ReactNode {
  if (value.kind === "text") return element("mtext", { key }, value.value);
  if (value.kind === "row")
    return element(
      "mrow",
      { key },
      ...value.items.map((item, index) => mathNode(item, index)),
    );
  if (value.kind === "fraction")
    return element(
      "mfrac",
      { key },
      mathNode(value.numerator),
      mathNode(value.denominator),
    );
  if (value.kind === "power")
    return element(
      "msup",
      { key },
      mathNode(value.base),
      mathNode(value.exponent),
    );
  const border = value.kind === "determinant" ? "|" : "[",
    end = value.kind === "determinant" ? "|" : "]";
  return element(
    "mrow",
    { key },
    element("mo", { stretchy: "true" }, border),
    element(
      "mtable",
      { rowspacing: "0.5em", columnspacing: "1.1em" },
      ...value.cells.map((row, i) =>
        element(
          "mtr",
          { key: i },
          ...row.map((cell, j) =>
            element(
              "mtd",
              { key: j },
              element(
                /^[-−]?\d+(\.\d+)?$/.test(cell) ? "mn" : "mi",
                null,
                cell,
              ),
            ),
          ),
        ),
      ),
    ),
    element("mo", { stretchy: "true" }, end),
  );
}
export function QuestionStem({ question }: { question: PublicQuestion }) {
  const parts = question.stem ?? [
    { kind: "text" as const, text: question.text },
    ...(question.presentation?.formulas ?? []).map((formula) => ({
      kind: "math" as const,
      ...formula,
    })),
  ];
  return (
    <span className="question-stem">
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <span className="question-stem-math" key={index}>
            {element(
              "math",
              { display: "inline", role: "math", "aria-label": part.label },
              mathNode(part.expression),
            )}
          </span>
        ),
      )}
    </span>
  );
}
export function QuestionVisuals({
  presentation,
}: {
  presentation?: QuestionPresentation;
}) {
  if (!presentation) return null;
  const diagram = presentation.diagram;
  return (
    <div className="tutor-visuals">
      {presentation.formulas?.map((formula, index) => (
        <div className="tutor-formula" key={index}>
          {element(
            "math",
            { display: "block", "aria-label": formula.label, role: "math" },
            mathNode(formula.expression),
          )}
        </div>
      ))}
      {diagram?.kind === "matrix" && (
        <figure className="tutor-figure">
          <svg
            viewBox={
              "0 0 " +
              (diagram.cells[0].length * 75 + 40) +
              " " +
              (diagram.cells.length * 58 + 20)
            }
            role="img"
            aria-label={diagram.alt}
          >
            {diagram.cells.map((row, i) =>
              row.map((cell, j) => (
                <g key={i + "-" + j}>
                  <rect
                    x={20 + j * 75}
                    y={10 + i * 58}
                    width="65"
                    height="48"
                    rx="6"
                    fill={
                      diagram.highlightDiagonal && i === j
                        ? "#dcebcf"
                        : "#f2f5ee"
                    }
                    stroke="#bbccaf"
                  />
                  <text
                    x={52 + j * 75}
                    y={42 + i * 58}
                    textAnchor="middle"
                    fill="#314d39"
                    fontSize="25"
                    fontFamily="Cambria Math,serif"
                  >
                    {cell}
                  </text>
                </g>
              )),
            )}
          </svg>
          <figcaption>{diagram.alt}</figcaption>
        </figure>
      )}
      {diagram?.kind === "image" &&
        /^\/question-media\/[\w-]+\.(png|webp|jpg)$/.test(diagram.src) && (
          <figure className="tutor-figure">
            <img src={diagram.src} alt={diagram.alt} loading="lazy" />
            <figcaption>{diagram.alt}</figcaption>
          </figure>
        )}
    </div>
  );
}

function Formula({ source, display }: { source: string; display: boolean }) {
  // KaTeX is the only HTML producer. Model/user text is never inserted as HTML.
  let html: string;
  try {
    html = katex.renderToString(source.slice(0, 4000), {
      displayMode: display,
      trust: false,
      throwOnError: false,
      strict: "ignore",
      maxSize: 20,
      maxExpand: 100,
      macros: {},
      output: "htmlAndMathml",
    });
  } catch {
    return <span className="tutor-inline-math">{source}</span>;
  }
  return (
    <span
      className={display ? "tutor-display-math" : "tutor-inline-math"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
export function TutorText({ text }: { text: string }) {
  const parts = text.split(
    /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([^]*?\\\))/g,
  );
  return (
    <div className="tutor-prose">
      {parts.map((part, index) => {
        if (part.startsWith("$$") && part.endsWith("$$"))
          return <Formula key={index} source={part.slice(2, -2)} display />;
        if (part.startsWith("$") && part.endsWith("$"))
          return (
            <Formula key={index} source={part.slice(1, -1)} display={false} />
          );
        if (
          (part.startsWith("\\[") && part.endsWith("\\]")) ||
          (part.startsWith("\\(") && part.endsWith("\\)"))
        )
          return (
            <Formula
              key={index}
              source={part.slice(2, -2)}
              display={part.startsWith("\\[")}
            />
          );
        return <span key={index}>{part}</span>;
      })}
    </div>
  );
}
interface TutorResult {
  kind: "hint" | "explanation";
  questionId: string;
  answer: string;
  status: "reference" | "model";
  reason?: string;
  messages?: ChatMessage[];
  presentation?: QuestionPresentation;
  notices: string[];
}
export function QuestionTutor({
  attemptId,
  question,
  submitted,
}: {
  attemptId: string;
  question: PublicQuestion;
  submitted: boolean;
}) {
  const [result, setResult] = useState<TutorResult | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [includeReasoning, setIncludeReasoning] = useState(false),
    [open, setOpen] = useState(false);
  async function ask(followup?: string) {
    setBusy(true);
    setError(null);
    setOpen(true);
    try {
      const response = await request<TutorResult>(
        "/assessment-attempts/" + encodeURIComponent(attemptId) + "/tutor",
        {
          method: "POST",
          body: {
            questionId: question.id,
            ...(followup ? { message: followup } : {}),
            includeReasoning,
          },
        },
      );
      setResult(response.data);
      setMessage("");
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="question-tutor"
      aria-label={question.point + "辅助讲解"}
    >
      <div className="ws-between">
        <button
          type="button"
          className="ws-secondary"
          disabled={busy}
          onClick={() => {
            if (result) setOpen(!open);
            else void ask();
          }}
        >
          {busy
            ? "正在整理讲解…"
            : submitted
              ? "本题辅助讲解与追问"
              : "本题知识点提示"}
        </button>
        <small>
          {submitted ? "评分依据保持不变" : "答前提示不显示标准答案"}
        </small>
      </div>
      {open && (
        <div className="tutor-expanded">
          <ErrorNotice error={error} />
          {result && (
            <>
              <span className="ws-pill">
                {result.kind === "hint"
                  ? "知识点提示"
                  : result.status === "model"
                    ? "逐题模型讲解"
                    : "本题固定解析"}
              </span>
              <QuestionVisuals presentation={result.presentation} />
              {result.messages?.length ? (
                result.messages.map((item) => (
                  <div className={"tutor-message " + item.role} key={item.id}>
                    <strong>
                      {item.role === "user" ? "我的追问" : "讲解"}
                    </strong>
                    <TutorText text={item.content} />
                  </div>
                ))
              ) : (
                <TutorText text={result.answer} />
              )}
              {result.notices.map((notice) => (
                <p className="ws-muted" key={notice}>
                  {notice}
                </p>
              ))}
            </>
          )}
          {submitted && (
            <form
              className="tutor-followup"
              onSubmit={(event) => {
                event.preventDefault();
                void ask(message);
              }}
            >
              <label>
                针对这道题继续追问
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={3000}
                  required
                  placeholder="例如：为什么要减去另一条对角线的乘积？能换一种方法解释吗？"
                />
              </label>
              <label className="ws-check">
                <input
                  type="checkbox"
                  checked={includeReasoning}
                  onChange={(event) =>
                    setIncludeReasoning(event.target.checked)
                  }
                />
                讲解时参考我提交的简要思路
              </label>
              <button className="ws-primary" disabled={busy || !message.trim()}>
                发送本题追问
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
