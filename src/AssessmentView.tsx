import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Info,
  RotateCcw,
  X,
} from "lucide-react";
import type { AssessmentResult, FlowProps } from "./types";
import {
  assessmentQuestions,
  publicSubjects,
  type AssessmentSubject,
} from "./assessmentQuestions";
import "./flows.css";
import "./assessment.css";

const attemptKey = "yantu-demo-assessment-attempt-v2";
const version = 2;
type Stage = "public" | "professional";
type Attempt = {
  answers: Record<string, number>;
  notes: Record<string, string>;
  modules: AssessmentSubject[];
  index: number;
  result: AssessmentResult | null;
};
type AttemptCache = {
  version: 2;
  public: Attempt;
  professional: Record<string, Attempt>;
};
const professionalModules: AssessmentSubject[] = ["计算机专业基础"];
const emptyAttempt = (modules: AssessmentSubject[]): Attempt => ({
  answers: {},
  notes: {},
  modules: [...modules],
  index: 0,
  result: null,
});

function sanitizeAttempt(value: unknown, stage: Stage): Attempt {
  const defaults = stage === "public" ? publicSubjects : professionalModules;
  if (!value || typeof value !== "object") return emptyAttempt(defaults);
  const raw = value as Partial<Attempt>;
  const modules = Array.isArray(raw.modules)
    ? defaults.filter((subject) => raw.modules?.includes(subject))
    : [...defaults];
  const validQuestions = assessmentQuestions.filter((question) =>
    defaults.includes(question.subject),
  );
  const answers: Record<string, number> = {};
  const notes: Record<string, string> = {};
  for (const question of validQuestions) {
    const answer = raw.answers?.[question.id];
    if (
      Number.isInteger(answer) &&
      answer! >= 0 &&
      answer! < question.options.length
    )
      answers[question.id] = answer!;
    if (typeof raw.notes?.[question.id] === "string")
      notes[question.id] = raw.notes[question.id];
  }
  const questions = validQuestions.filter((question) =>
    modules.includes(question.subject),
  );
  const answered = questions.filter(
    (question) => answers[question.id] !== undefined,
  ).length;
  const correct = questions.filter(
    (question) => answers[question.id] === question.correct,
  ).length;
  const result =
    raw.result?.version === version &&
    raw.result.stage === stage &&
    raw.result.total === questions.length &&
    raw.result.answered === answered &&
    raw.result.correct === correct &&
    !Number.isNaN(Date.parse(raw.result.date))
      ? raw.result
      : null;
  return {
    answers,
    notes,
    modules,
    result,
    index:
      typeof raw.index === "number" && Number.isInteger(raw.index)
        ? Math.max(0, Math.min(raw.index, questions.length - 1))
        : 0,
  };
}

function readAttempts(): AttemptCache {
  const empty: AttemptCache = {
    version,
    public: emptyAttempt(publicSubjects),
    professional: {},
  };
  try {
    const value = JSON.parse(localStorage.getItem(attemptKey) || "null");
    if (value?.version !== version) return empty;
    const professional: Record<string, Attempt> = {};
    if (value.professional && typeof value.professional === "object") {
      for (const [key, attempt] of Object.entries(value.professional))
        professional[key] = sanitizeAttempt(attempt, "professional");
    }
    return {
      version,
      public: sanitizeAttempt(value.public, "public"),
      professional,
    };
  } catch {
    return empty;
  }
}

function SubmitDialog({
  answered,
  total,
  onClose,
  onSubmit,
}: {
  answered: number;
  total: number;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.showModal();
    return () => {
      document.body.style.overflow = overflow;
      priorFocus?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="panel assessment-submit-dialog"
      aria-labelledby="assessment-submit-title"
      onCancel={onClose}
    >
      <button
        className="flow-icon-button assessment-submit-close"
        aria-label="关闭确认窗口"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="flow-symbol">
        <Info size={24} />
      </div>
      <h2 id="assessment-submit-title">还有未作答的题目</h2>
      <p className="muted">
        已完成 {answered} / {total}{" "}
        题。未作答部分将标记为依据不足，你也可以返回继续作答。
      </p>
      <div className="flow-dialog-actions">
        <button className="button secondary" onClick={onClose}>
          返回作答
        </button>
        <button className="button primary" onClick={onSubmit}>
          仍然提交
        </button>
      </div>
    </dialog>
  );
}

export function AssessmentView({
  profile,
  onAssessment,
  onNavigate,
  notify,
}: FlowProps) {
  const [cache, setCache] = useState<AttemptCache>(readAttempts);
  const [stage, setStage] = useState<Stage>("public");
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [feedback, setFeedback] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationRevision = useRef(0);
  const focusOnQuestion = useRef(false);
  const professionalKey = profile.targetMajor?.trim() || "";
  const hasConfirmedMajor = !!professionalKey && professionalKey !== "不确定";
  const hasProfessionalQuestions =
    hasConfirmedMajor && /计算机|软件工程/.test(professionalKey);
  const attempt =
    stage === "public"
      ? cache.public
      : (cache.professional[professionalKey] ??
        emptyAttempt(professionalModules));
  const modulesKey = attempt.modules.join("|");
  const questions = useMemo(
    () =>
      assessmentQuestions.filter((question) =>
        modulesKey.split("|").includes(question.subject),
      ),
    [modulesKey],
  );
  const index = Math.max(0, Math.min(attempt.index, questions.length - 1));
  const question = questions[index];
  const answered = questions.filter(
    (item) => attempt.answers[item.id] !== undefined,
  ).length;
  const correct = questions.filter(
    (item) => attempt.answers[item.id] === item.correct,
  ).length;
  const result = attempt.result;
  const selectedSubjects =
    stage === "public" ? publicSubjects : professionalModules;

  function clearPending() {
    navigationRevision.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setFeedback("");
  }
  function updateAttempt(updater: (current: Attempt) => Attempt) {
    setCache((current) =>
      stage === "public"
        ? { ...current, public: updater(current.public) }
        : {
            ...current,
            professional: {
              ...current.professional,
              [professionalKey]: updater(
                current.professional[professionalKey] ??
                  emptyAttempt(professionalModules),
              ),
            },
          },
    );
  }
  useEffect(() => {
    try {
      localStorage.setItem(attemptKey, JSON.stringify(cache));
    } catch {
      /* The current attempt remains usable without browser storage. */
    }
  }, [cache]);
  useEffect(
    () => () => {
      navigationRevision.current += 1;
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    navigationRevision.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setFeedback("");
    if (focusOnQuestion.current) {
      titleRef.current?.focus();
      focusOnQuestion.current = false;
    }
  }, [question?.id, stage, professionalKey, modulesKey, result?.completed]);
  useEffect(() => {
    if (!hasConfirmedMajor && stage === "professional") setStage("public");
  }, [hasConfirmedMajor, stage]);

  function goTo(nextIndex: number) {
    clearPending();
    focusOnQuestion.current = true;
    updateAttempt((current) => ({ ...current, index: nextIndex }));
  }
  function chooseAnswer(optionIndex: number) {
    if (!question) return;
    clearPending();
    updateAttempt((current) => ({
      ...current,
      answers: { ...current.answers, [question.id]: optionIndex },
      result: null,
    }));
    if (stage === "public") onAssessment(null);
    if (index === questions.length - 1) {
      setFeedback("已保存最后一题。确认后点击“提交并查看诊断”。");
      return;
    }
    setFeedback("答案已保存，即将进入下一题…");
    const revision = navigationRevision.current;
    timer.current = setTimeout(() => {
      if (revision !== navigationRevision.current) return;
      timer.current = null;
      focusOnQuestion.current = true;
      updateAttempt((current) => ({ ...current, index: index + 1 }));
    }, 250);
  }
  function switchStage(nextStage: Stage) {
    clearPending();
    setStage(nextStage);
    setConfirmSubmit(false);
    setShowReview(false);
  }
  function toggleModule(subject: AssessmentSubject) {
    clearPending();
    updateAttempt((current) => ({
      ...current,
      modules: publicSubjects.filter((item) =>
        item === subject
          ? !current.modules.includes(item)
          : current.modules.includes(item),
      ),
      index: 0,
      result: null,
    }));
    onAssessment(null);
  }
  function makeResult(completed: boolean): AssessmentResult {
    return {
      completed,
      answered,
      correct,
      total: questions.length,
      modules: [...attempt.modules],
      stage,
      version,
      date: new Date().toISOString(),
    };
  }
  function submit() {
    clearPending();
    const nextResult = makeResult(true);
    updateAttempt((current) => ({ ...current, result: nextResult }));
    if (stage === "public") onAssessment(nextResult);
    setConfirmSubmit(false);
    notify(
      `${stage === "public" ? "公共课" : "专业课"}诊断已生成，可查看答案与解析`,
    );
  }
  function restart() {
    clearPending();
    updateAttempt((current) => emptyAttempt(current.modules));
    if (stage === "public") onAssessment(null);
    setShowReview(false);
    notify(`已开始新的${stage === "public" ? "公共课" : "专业课"}测评`);
  }
  function revise(questionIndex = 0) {
    clearPending();
    focusOnQuestion.current = true;
    updateAttempt((current) => ({
      ...current,
      result: null,
      index: questionIndex,
    }));
    if (stage === "public") onAssessment(null);
    setShowReview(false);
  }
  function skip() {
    clearPending();
    if (stage === "public") onAssessment(makeResult(false));
    notify(
      stage === "public"
        ? "已跳过测评，推荐将标注能力评估依据不足"
        : "已跳过专业课测评，公共课诊断仍然保留",
    );
    onNavigate("explore");
  }
  const stageSelector = (
    <section className="panel assessment-selection" aria-label="测评范围">
      <div className="assessment-stage-tabs" aria-label="测评阶段">
        <button
          className={stage === "public" ? "active" : ""}
          aria-pressed={stage === "public"}
          onClick={() => switchStage("public")}
        >
          公共课测评
        </button>
        <button
          className={stage === "professional" ? "active" : ""}
          aria-pressed={stage === "professional"}
          disabled={!hasConfirmedMajor}
          onClick={() => switchStage("professional")}
        >
          专业课测评（可选）
        </button>
      </div>
      {stage === "public" ? (
        <>
          <div
            className="assessment-module-options"
            role="group"
            aria-label="选择公共课模块"
          >
            <span>本次参加</span>
            {publicSubjects.map((subject) => (
              <label
                key={subject}
                className={attempt.modules.includes(subject) ? "selected" : ""}
              >
                <input
                  type="checkbox"
                  aria-label={`参加${subject}测评`}
                  checked={attempt.modules.includes(subject)}
                  onChange={() => toggleModule(subject)}
                />
                {subject}
                <small>5 题</small>
              </label>
            ))}
            <strong>共 {questions.length} 题</strong>
          </div>
          <p className="muted assessment-range-hint">
            可按目标项目需要选择科目，数学可取消。政治用于了解备考基础，不作为专业适配的排除条件。
          </p>
          {!hasConfirmedMajor && (
            <p className="muted assessment-range-hint">
              专业尚未确定：先完成公共课或直接看联合推荐，确认专业后再按需补测专业课。
            </p>
          )}
        </>
      ) : (
        <p className="muted assessment-range-hint">
          已确认方向：<strong>{professionalKey}</strong>
          。专业课为可选补充，单独保存本方向的诊断；实际考试科目以目标项目为准。
        </p>
      )}
    </section>
  );

  if (stage === "professional" && !hasProfessionalQuestions)
    return (
      <div className="flow-page assessment-v2">
        <header className="page-heading">
          <div>
            <p className="eyebrow">A LITTLE MORE ABOUT YOUR MAJOR</p>
            <h1>按你的专业，补充了解基础</h1>
            <p className="muted">
              专业课测评是可选步骤，不影响继续比较专业与院校。
            </p>
          </div>
        </header>
        {stageSelector}
        <section className="panel assessment-unavailable">
          <BookOpen size={30} />
          <h2>当前方向暂无适用的演示题库</h2>
          <p className="muted">
            已确认“{professionalKey}”。本 Demo
            的专业课样本只覆盖计算机与软件方向，因此不会给你安排不适用的专业题。
          </p>
          <div className="flow-result-actions">
            <button
              className="button secondary"
              onClick={() => switchStage("public")}
            >
              返回公共课测评
            </button>
            <button
              className="button primary"
              onClick={() => onNavigate("explore")}
            >
              继续查看联合推荐
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
      </div>
    );

  if (result?.completed)
    return (
      <div className="flow-page assessment-v2">
        <header className="page-heading">
          <div>
            <p className="eyebrow">UNDERSTAND YOUR STARTING POINT</p>
            <h1>看见起点，才能走得更稳</h1>
            <p className="muted">
              {stage === "public" ? "公共课" : `${professionalKey} · 专业课`}
              测评已完成 · {new Date(result.date).toLocaleDateString("zh-CN")} ·{" "}
              {questions.length} 道基础示例题
            </p>
          </div>
          <button className="button secondary" onClick={restart}>
            <RotateCcw size={16} />
            重新测评
          </button>
        </header>
        {stageSelector}
        <section className="panel assessment-result-hero">
          <div className="flow-symbol">
            <CheckCircle2 size={28} />
          </div>
          <div>
            <span className="badge">
              {stage === "public" ? "公共课" : "专业课"}基础诊断已完成
            </span>
            <h2>每个薄弱点，都是下一步的路标。</h2>
            <p className="muted">
              完成 {answered} / {questions.length} 题，其中 {correct}{" "}
              题正确。这只反映本次样本表现，不能换算为考研成绩或录取概率。
            </p>
          </div>
          <div className="assessment-result-number">
            <strong>
              {answered}
              <small> / {questions.length}</small>
            </strong>
            <span className="muted">已作答题目</span>
          </div>
        </section>
        <div className="diagnosis-grid">
          {selectedSubjects.map((subject) => {
            const subset = questions.filter((item) => item.subject === subject);
            const attempted = subset.filter(
              (item) => attempt.answers[item.id] !== undefined,
            ).length;
            const count = subset.filter(
              (item) => attempt.answers[item.id] === item.correct,
            ).length;
            return (
              <section className="panel diagnosis-card" key={subject}>
                <BookOpen size={21} />
                <h3>{subject}</h3>
                <span className="badge">
                  {subset.length
                    ? `${count} / ${subset.length} 正确`
                    : "未参加"}
                </span>
                <p>
                  {!subset.length
                    ? "本次未选择，能力依据不足"
                    : attempted < subset.length
                      ? "样本不足，需要补测"
                      : count === subset.length
                        ? "本次基础样本表现稳定"
                        : "相关知识点值得再巩固"}
                </p>
                <p className="muted flow-small">
                  {subject === "数学"
                    ? "结合目标项目实际要求，继续巩固微积分、线性代数与概率基础。"
                    : subject === "英语"
                      ? "补充长难句与篇章阅读，观察不同语境下的理解。"
                      : subject === "政治"
                        ? "用来安排基础复习，不作为专业适配的硬性排除依据。"
                        : "结合已确认专业及候选项目科目，补充相应专项练习。"}
                </p>
              </section>
            );
          })}
        </div>
        <div className="notice assessment-notice">
          <Info size={20} />
          <span>
            这里只覆盖少量知识点。尚未结合用时、完整过程和补测，不能断言“粗心”或个人能力上限。
            {stage === "professional"
              ? "专业课结果独立保留，不覆盖公共课诊断。"
              : "无需参加专业课测评，也可以继续查看专业与院校联合推荐。"}
          </span>
        </div>
        <div className="flow-result-actions">
          <button className="button secondary" onClick={() => revise()}>
            返回修改答案
          </button>
          <button
            className="button secondary"
            onClick={() => setShowReview((value) => !value)}
            aria-expanded={showReview}
          >
            {showReview ? "收起答案解析" : "查看答案与依据"}
          </button>
          <button
            className="button primary"
            onClick={() => onNavigate("explore")}
          >
            带着诊断看推荐
            <ArrowRight size={17} />
          </button>
        </div>
        {showReview && (
          <section className="panel answer-review">
            <div className="section-heading">
              <h2>答案与依据</h2>
              <span className="muted">人工编写的本地示例解析</span>
            </div>
            {questions.map((item, questionIndex) => (
              <article className="answer-review-item" key={item.id}>
                <span className="badge">
                  {item.subject} · {item.point}
                </span>
                <h3>
                  {questionIndex + 1}. {item.text}
                </h3>
                <p>
                  你的答案：
                  {attempt.answers[item.id] !== undefined
                    ? `${String.fromCharCode(65 + attempt.answers[item.id])}. ${item.options[attempt.answers[item.id]]}`
                    : "未作答"}
                </p>
                <p className="answer-correct">
                  <CheckCircle2 size={17} />
                  正确答案：{String.fromCharCode(65 + item.correct)}.{" "}
                  {item.options[item.correct]}
                </p>
                <p className="muted">{item.explanation}</p>
                <p className="flow-small muted">
                  依据：{item.source} · 示例题库 v2
                </p>
                {attempt.notes[item.id] && (
                  <p className="answer-user-note">
                    你的思路：{attempt.notes[item.id]}
                  </p>
                )}
                <button
                  className="button secondary assessment-revise-button"
                  onClick={() => revise(questionIndex)}
                >
                  修改第 {questionIndex + 1} 题
                </button>
              </article>
            ))}
          </section>
        )}
      </div>
    );

  return (
    <div className="flow-page assessment-v2">
      <header className="page-heading">
        <div>
          <p className="eyebrow">A SMALL STEP TO CLARITY</p>
          <h1>用几道题，找到备考起点</h1>
          <p className="muted">
            {stage === "public"
              ? "数学、英语、政治各 5 题，可按需选择科目。"
              : "计算机专业基础 5 题，作为当前方向的补充诊断。"}
            选好答案后自动进入下一题，随时可以返回修改。
          </p>
        </div>
        <button className="button secondary" onClick={skip}>
          跳过测评
        </button>
      </header>
      {stageSelector}
      {!question ? (
        <section className="panel assessment-unavailable">
          <BookOpen size={30} />
          <h2>选择一个科目，就可以开始</h2>
          <p className="muted">
            每个科目 5 题，数学不是必选项。也可以跳过测评，先查看联合推荐。
          </p>
          <button className="button primary" onClick={skip}>
            先查看联合推荐
            <ArrowRight size={17} />
          </button>
        </section>
      ) : (
        <div className="assessment-layout">
          <aside className="panel assessment-overview">
            <p className="eyebrow">YOUR PROGRESS</p>
            <h2>一步一步来</h2>
            <p className="muted" aria-live="polite">
              已作答 {answered} / {questions.length} 题
            </p>
            <div
              className="flow-progress-track"
              role="progressbar"
              aria-label="作答进度"
              aria-valuenow={answered}
              aria-valuemin={0}
              aria-valuemax={questions.length}
            >
              <span
                style={{ width: `${(answered / questions.length) * 100}%` }}
              />
            </div>
            <div className="assessment-subjects">
              {attempt.modules.map((subject) => (
                <div
                  className={question.subject === subject ? "current" : ""}
                  key={subject}
                >
                  <span className="assessment-subject-icon">
                    <BookOpen size={17} />
                  </span>
                  <div>
                    <strong>{subject}</strong>
                    <small>
                      {subject === "数学"
                        ? "微积分 · 线代 · 概率"
                        : subject === "英语"
                          ? "阅读 · 词汇 · 语法"
                          : subject === "政治"
                            ? "哲学 · 认识论"
                            : "数据结构 · 算法"}
                    </small>
                  </div>
                  <span>
                    {
                      questions.filter(
                        (item) =>
                          item.subject === subject &&
                          attempt.answers[item.id] !== undefined,
                      ).length
                    }
                    /5
                  </span>
                </div>
              ))}
            </div>
            <p className="flow-small muted">
              本次为交互演示测评。答案仅用于知识点诊断，不预测考试分数。思路与答案会自动保存到当前浏览器。
            </p>
          </aside>
          <section className="panel assessment-question">
            <div className="section-heading">
              <span className="badge">
                {question.subject} · {question.point}
              </span>
              <span className="muted">
                {String(index + 1).padStart(2, "0")} /{" "}
                {String(questions.length).padStart(2, "0")}
              </span>
            </div>
            <div className="question-dots" aria-label="题目导航">
              {questions.map((item, questionIndex) => (
                <button
                  key={item.id}
                  className={`${questionIndex === index ? "active" : ""} ${attempt.answers[item.id] !== undefined ? "answered" : ""}`}
                  aria-label={`第${questionIndex + 1}题${attempt.answers[item.id] !== undefined ? "，已作答" : ""}`}
                  aria-current={index === questionIndex ? "step" : undefined}
                  onClick={() => goTo(questionIndex)}
                >
                  {questionIndex + 1}
                </button>
              ))}
            </div>
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="question-title"
              id="assessment-question-title"
            >
              {question.text}
            </h2>
            <div
              className="answer-options"
              role="radiogroup"
              aria-labelledby="assessment-question-title"
              key={question.id}
            >
              {question.options.map((option, optionIndex) => (
                <label
                  key={optionIndex}
                  className={`answer-option ${attempt.answers[question.id] === optionIndex ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={optionIndex}
                    checked={attempt.answers[question.id] === optionIndex}
                    onChange={() => chooseAnswer(optionIndex)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        chooseAnswer(optionIndex);
                      }
                    }}
                  />
                  <span className="answer-letter">
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span>{option}</span>
                  {attempt.answers[question.id] === optionIndex && (
                    <CheckCircle2 size={18} />
                  )}
                </label>
              ))}
            </div>
            <p className="assessment-auto-hint" role="status">
              {feedback ||
                (index === questions.length - 1
                  ? "这是最后一题，选好答案后请手动提交。"
                  : "选中答案后自动进入下一题；思路可先填写，也可以返回补充。")}
            </p>
            <label className="field question-notes">
              <span>
                简单记录你的思路 <small className="muted">（选填）</small>
              </span>
              <textarea
                rows={2}
                value={attempt.notes[question.id] ?? ""}
                placeholder="例如用了哪个公式，或者不确定的地方……"
                onFocus={clearPending}
                onChange={(event) =>
                  updateAttempt((current) => ({
                    ...current,
                    notes: {
                      ...current.notes,
                      [question.id]: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <div className="question-footer">
              <button
                className="button secondary"
                disabled={index === 0}
                onClick={() => goTo(index - 1)}
              >
                <ArrowLeft size={16} />
                上一题
              </button>
              {index < questions.length - 1 ? (
                <button
                  className="button primary"
                  onClick={() => goTo(index + 1)}
                >
                  下一题
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={() => {
                    clearPending();
                    if (answered < questions.length) setConfirmSubmit(true);
                    else submit();
                  }}
                >
                  <ClipboardCheck size={17} />
                  提交并查看诊断
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {confirmSubmit && (
        <SubmitDialog
          answered={answered}
          total={questions.length}
          onClose={() => setConfirmSubmit(false)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
