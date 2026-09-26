import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCheck } from "lucide-react";
import type {
  Answer,
  AssessmentModule,
  Diagnosis,
  Foundation,
  PublicAttempt,
} from "../../server/assessment/types";
import { request } from "./api";
import type { Resource } from "./api";
import { Empty, ErrorNotice } from "./ui";
import { QuestionVisuals, QuestionTutor, TutorText } from "./TutorContent";

const moduleNames: Record<AssessmentModule, string> = {
  math: "数学",
  english: "英语",
  politics: "政治",
  major: "专业课",
};
type AttemptSummary = Pick<
  PublicAttempt,
  "assessmentAttemptId" | "status" | "modules" | "createdAt"
>;
export function AssessmentPanel({
  confirmedMajorId,
  onCompleted,
}: {
  confirmedMajorId: string | null;
  onCompleted?: (diagnosis: Diagnosis) => void;
}) {
  const [modules, setModules] = useState<AssessmentModule[]>([
      "math",
      "english",
      "politics",
    ]),
    [foundation, setFoundation] = useState<Foundation>("unknown"),
    [resource, setResource] = useState<Resource<PublicAttempt> | null>(null),
    [history, setHistory] = useState<AttemptSummary[]>([]),
    [answers, setAnswers] = useState<Answer[]>([]),
    [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState<unknown>(),
    [confirm, setConfirm] = useState(false),
    [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null),
    [explanation, setExplanation] = useState<string>("");
  const startedAt = useRef(Date.now());
  const attempt = resource?.data;
  async function loadHistory(signal?: AbortSignal) {
    const result = await request<{ items: AttemptSummary[] }>(
      "/assessment-attempts",
      { signal },
    );
    setHistory(result.data.items);
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setError(error);
    });
    return () => controller.abort();
  }, []);
  function accept(result: Resource<PublicAttempt>) {
    setResource(result);
    setAnswers(result.data.answers);
    setIndex(result.data.currentIndex);
    setDirty(false);
    setDiagnosis(result.data.diagnosis ?? null);
    if (result.data.diagnosis) onCompleted?.(result.data.diagnosis);
    startedAt.current = Date.now();
  }
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function resume(id: string) {
    await action(async () => {
      const result = await request<PublicAttempt>(`/assessment-attempts/${id}`);
      accept(result);
      if (result.data.status === "submitted" && !result.data.diagnosis) {
        const resultData = await request<Diagnosis | { diagnosis: Diagnosis }>(
          `/assessment-attempts/${id}/result`,
        );
        setDiagnosis(
          "diagnosis" in resultData.data
            ? resultData.data.diagnosis
            : resultData.data,
        );
      }
    });
  }
  async function create(major = false) {
    await action(async () => {
      const result = await request<PublicAttempt>("/assessment-attempts", {
        method: "POST",
        body: {
          stage: major ? "major" : "initial",
          modules: major ? ["major"] : modules,
          mathFoundation: foundation,
          scope: { math: "common-foundation" },
        },
      });
      accept(result);
      setConfirm(false);
      await loadHistory();
    });
  }
  async function saveDraft(nextAnswers = answers, nextIndex = index) {
    if (!resource) return;
    const result = await request<PublicAttempt>(
      `/assessment-attempts/${resource.data.assessmentAttemptId}`,
      {
        method: "PATCH",
        etag: resource.etag,
        body: { answers: nextAnswers, currentIndex: nextIndex },
      },
    );
    accept(result);
  }
  function updateAnswer(patch: Partial<Answer>) {
    if (!attempt) return answers;
    const id = attempt.questions[index].id,
      previous = answers.find((answer) => answer.questionId === id) ?? {
        questionId: id,
        selectedOption: null,
      };
    const next = [
      ...answers.filter((answer) => answer.questionId !== id),
      { ...previous, ...patch },
    ];
    setAnswers(next);
    setDirty(true);
    return next;
  }
  async function select(option: number) {
    const next = updateAnswer({
      selectedOption: option,
      durationSeconds: Math.max(
        0,
        Math.floor((Date.now() - startedAt.current) / 1000),
      ),
    });
    await action(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      await saveDraft(
        next,
        Math.min(index + 1, (attempt?.questions.length ?? 1) - 1),
      );
    });
  }
  async function submit() {
    await action(async () => {
      if (!resource || dirty) return;
      const result = await request<PublicAttempt | Diagnosis>(
        `/assessment-attempts/${resource.data.assessmentAttemptId}/submit`,
        {
          method: "POST",
          etag: resource.etag,
          body: { confirmUnanswered: confirm },
        },
      );
      if ("counts" in result.data) setDiagnosis(result.data);
      const updated = await request<PublicAttempt>(
        `/assessment-attempts/${resource.data.assessmentAttemptId}`,
      );
      accept(updated);
      if (!updated.data.diagnosis && "counts" in result.data)
        setDiagnosis(result.data);
      await loadHistory();
    });
  }
  const question = attempt?.questions[index],
    current = question
      ? answers.find((answer) => answer.questionId === question.id)
      : undefined;
  const answered = answers.filter(
    (answer) => answer.selectedOption !== null,
  ).length;
  return (
    <>
      <div className="ws-heading">
        <div>
          <span className="ws-eyebrow">02 / 了解基础</span>
          <h1>看见薄弱点，再往前一步。</h1>
          <p>每科五题的小范围诊断，帮助找到下一步练习方向。</p>
        </div>
        <ClipboardCheck size={36} />
      </div>
      <ErrorNotice
        error={error}
        onReload={
          attempt ? () => void resume(attempt.assessmentAttemptId) : undefined
        }
      />
      <div className="ws-notice">
        测评不推断考研总分、科目成绩或录取概率。政治基础不作为专业适配的硬性排除条件；你可以跳过测评直接探索。
      </div>
      {!attempt || attempt.status !== "in_progress" ? (
        <section className="ws-panel">
          <h2>选择本次测评模块</h2>
          <div className="ws-actions">
            {(["math", "english", "politics"] as AssessmentModule[]).map(
              (module) => (
                <label className="ws-choice" key={module}>
                  <input
                    type="checkbox"
                    checked={modules.includes(module)}
                    onChange={(event) =>
                      setModules((current) =>
                        event.target.checked
                          ? [...current, module]
                          : current.filter((item) => item !== module),
                      )
                    }
                  />
                  {moduleNames[module]} · 5 题
                </label>
              ),
            )}
          </div>
          <label className="ws-short-field">
            数学基础自评
            <select
              value={foundation}
              onChange={(event) =>
                setFoundation(event.target.value as Foundation)
              }
            >
              <option value="unknown">不确定</option>
              <option value="weak">需要从基础开始</option>
              <option value="average">有一定基础</option>
              <option value="strong">基础较扎实</option>
            </select>
          </label>
          <div className="ws-actions">
            <button
              className="ws-primary"
              disabled={busy || !modules.length}
              onClick={() => create(false)}
            >
              {busy ? "正在加载…" : `开始公共课测评 · ${modules.length * 5} 题`}
            </button>
            <button
              className="ws-secondary"
              disabled={busy || !confirmedMajorId}
              onClick={() => create(true)}
            >
              开始专业课测评
            </button>
          </div>
          <p className="ws-muted">
            {confirmedMajorId
              ? "已确认专业方向；专业课仅在对应题库与功能可用时开放。"
              : "专业课测评需要先确认报考专业；本科专业不代表已确认。"}
          </p>
        </section>
      ) : null}
      {attempt?.status === "in_progress" && question && (
        <section className="ws-panel ws-assessment">
          <div className="ws-between">
            <h2>
              {moduleNames[question.module]} · 第 {index + 1} /{" "}
              {attempt.questions.length} 题
            </h2>
            <span className="ws-pill">
              {dirty ? "有未保存修改" : busy ? "保存中…" : "草稿已保存"}
            </span>
          </div>
          {attempt.notice && <p className="ws-muted">{attempt.notice}</p>}
          <progress
            aria-label="测评完成进度"
            value={answered}
            max={attempt.questions.length}
          />
          <nav className="ws-question-nav" aria-label="题号导航">
            {attempt.questions.map((item, i) => (
              <button
                disabled={busy || dirty}
                key={item.id}
                className={
                  answers.some(
                    (answer) =>
                      answer.questionId === item.id &&
                      answer.selectedOption !== null,
                  )
                    ? "answered"
                    : ""
                }
                aria-current={i === index ? "step" : undefined}
                aria-label={`第${i + 1}题${answers.some((answer) => answer.questionId === item.id && answer.selectedOption !== null) ? "，已作答" : ""}`}
                onClick={() => {
                  setIndex(i);
                  startedAt.current = Date.now();
                }}
              >
                {i + 1}
              </button>
            ))}
          </nav>
          <fieldset className="ws-options" disabled={busy}>
            <legend>{question.text}</legend>
            <QuestionVisuals presentation={question.presentation} />
            {question.options.map((option, i) => (
              <label
                className={current?.selectedOption === i ? "selected" : ""}
                key={i}
              >
                <input
                  type="radio"
                  name={question.id}
                  checked={current?.selectedOption === i}
                  onChange={() => void select(i)}
                />
                <span>
                  {String.fromCharCode(65 + i)}. {option}
                </span>
                {current?.selectedOption === i && <Check size={18} />}
              </label>
            ))}
          </fieldset>
          <QuestionTutor
            key={attempt.assessmentAttemptId + ":" + question.id}
            attemptId={attempt.assessmentAttemptId}
            question={question}
            submitted={false}
          />
          <label>
            简要思路（选填）
            <textarea
              disabled={busy}
              value={current?.reasoning ?? ""}
              maxLength={2000}
              onChange={(event) =>
                updateAnswer({ reasoning: event.target.value })
              }
            />
          </label>
          <label className="ws-check">
            <input
              disabled={busy}
              type="checkbox"
              checked={current?.confidence === "sure"}
              onChange={(event) =>
                updateAnswer({
                  confidence: event.target.checked ? "sure" : "unsure",
                })
              }
            />
            我对这道题的答案有把握
          </label>
          <div className="ws-actions">
            <button
              className="ws-secondary"
              disabled={busy || !dirty}
              onClick={() => action(() => saveDraft())}
            >
              保存思路与草稿
            </button>
            <button
              className="ws-secondary"
              disabled={busy || dirty || index === 0}
              onClick={() => setIndex(index - 1)}
            >
              上一题
            </button>
            <button
              className="ws-secondary"
              disabled={busy || dirty || index === attempt.questions.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              下一题
            </button>
          </div>
          <div className="ws-submit">
            <p>
              已答 {answered} / {attempt.questions.length}{" "}
              题。最后一题会保留在此，提交后才能查看解析。
            </p>
            {answered < attempt.questions.length && (
              <label className="ws-check">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                />
                确认有未答题，仍提交本次测评
              </label>
            )}
            <div className="ws-actions">
              <button
                className="ws-primary"
                disabled={
                  busy ||
                  dirty ||
                  (answered < attempt.questions.length && !confirm)
                }
                onClick={submit}
              >
                主动提交测评
              </button>
              <button
                className="ws-danger"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const result = await request<PublicAttempt>(
                      `/assessment-attempts/${attempt.assessmentAttemptId}/abandon`,
                      {
                        method: "POST",
                        etag: resource!.etag,
                        body: {
                          expectedAttemptVersion: attempt.attemptVersion,
                        },
                      },
                    );
                    accept(result);
                    await loadHistory();
                  })
                }
              >
                放弃本次草稿
              </button>
            </div>
          </div>
        </section>
      )}
      {diagnosis && (
        <section className="ws-panel">
          <span className="ws-eyebrow">
            基础诊断 · {diagnosis.example ? "示例题" : "审核题库"}
          </span>
          <h2>你的下一步练习方向</h2>
          <div className="ws-stat-grid">
            <div>
              <strong>{diagnosis.counts.correct}</strong>
              <span>答对</span>
            </div>
            <div>
              <strong>{diagnosis.counts.incorrect}</strong>
              <span>答错</span>
            </div>
            <div>
              <strong>{diagnosis.counts.unanswered}</strong>
              <span>未答</span>
            </div>
          </div>
          <div className="ws-notice">{diagnosis.limitations.join("；")}</div>
          {diagnosis.modules.map((module) => (
            <p key={module.module}>
              {moduleNames[module.module]}：{module.correct} / {module.total}{" "}
              题答对
            </p>
          ))}
          {diagnosis.items.map((item, i) => {
            const reviewedQuestion = attempt?.questions.find(
              (question) => question.id === item.questionId,
            );
            return (
              <article
                className="tutor-completed-question"
                key={diagnosis.assessmentAttemptId + ":" + item.questionId}
              >
                <details className="ws-diagnosis">
                  <summary>
                    第 {i + 1} 题 · {item.point} ·{" "}
                    {item.outcome === "correct"
                      ? "答对"
                      : item.outcome === "incorrect"
                        ? "需巩固"
                        : "未答"}
                  </summary>
                  {reviewedQuestion && (
                    <>
                      <p>{reviewedQuestion.text}</p>
                      <QuestionVisuals
                        presentation={reviewedQuestion.presentation}
                      />
                      <ol type="A" className="tutor-options">
                        {reviewedQuestion.options.map((option, index) => (
                          <li
                            className={
                              index === item.correctOption
                                ? "tutor-correct"
                                : ""
                            }
                            key={index}
                          >
                            {option}
                            {index === item.selectedOption ? " · 你的选择" : ""}
                            {index === item.correctOption ? " · 标准答案" : ""}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <p>
                    标准答案：{String.fromCharCode(65 + item.correctOption)}
                  </p>
                  <div className="tutor-reference">
                    <TutorText text={item.explanation} />
                    <QuestionVisuals presentation={item.presentation} />
                  </div>
                  <p>{item.observation}</p>
                  {item.possibleCause && <p>可能原因：{item.possibleCause}</p>}
                  <p>{item.uncertainty}</p>
                  <p>下一步：{item.nextStep}</p>
                  <small>{item.source}</small>
                </details>
                {reviewedQuestion && (
                  <QuestionTutor
                    attemptId={diagnosis.assessmentAttemptId}
                    question={reviewedQuestion}
                    submitted
                  />
                )}
              </article>
            );
          })}
          {diagnosis.uncoveredPoints.length > 0 && (
            <p>本次未覆盖：{diagnosis.uncoveredPoints.join("、")}</p>
          )}
          <button
            className="ws-secondary"
            disabled={busy}
            onClick={() =>
              action(async () => {
                const result = await request<{
                  text?: string;
                  explanation?: string;
                  answer?: string;
                  explanationStatus: string;
                  reason?: string;
                  items?: {
                    explanation: string;
                    observation: string;
                    uncertainty: string;
                  }[];
                }>(
                  `/assessment-attempts/${diagnosis.assessmentAttemptId}/explanations`,
                  { method: "POST", body: {} },
                );
                setExplanation(
                  result.data.text ??
                    result.data.explanation ??
                    result.data.answer ??
                    result.data.items
                      ?.map(
                        (item) =>
                          `${item.explanation} ${item.observation} ${item.uncertainty}`,
                      )
                      .join("\n\n") ??
                    result.data.reason ??
                    "请参考上述审核解析。",
                );
              })
            }
          >
            查看辅助讲解
          </button>
          {explanation && (
            <div className="ws-notice" role="status">
              {explanation}
            </div>
          )}
        </section>
      )}
      <section className="ws-panel">
        <h2>我的测评记录</h2>
        {history.length ? (
          <div className="ws-records">
            {history.map((item) => (
              <div key={item.assessmentAttemptId}>
                <div>
                  <strong>
                    {item.modules
                      .map((module) => moduleNames[module])
                      .join(" / ")}
                  </strong>
                  <p className="ws-muted">
                    {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {
                      {
                        in_progress: "作答中",
                        submitted: "已提交",
                        abandoned: "已放弃",
                        invalidated: "已失效",
                      }[item.status]
                    }
                  </p>
                </div>
                <button
                  className="ws-secondary"
                  disabled={busy}
                  onClick={() => void resume(item.assessmentAttemptId)}
                >
                  {item.status === "in_progress" ? "恢复草稿" : "查看记录"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="还没有测评记录">
            选择需要的模块开始，或先去探索项目。
          </Empty>
        )}
      </section>
    </>
  );
}
