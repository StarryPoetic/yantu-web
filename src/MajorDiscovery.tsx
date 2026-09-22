import {
  ArrowRight,
  BookOpen,
  Check,
  GraduationCap,
  MapPin,
} from "lucide-react";
import type { Profile, School } from "./types";
import { directionOf, majorDirections } from "./programs";

interface Props {
  candidates: School[];
  profile: Profile;
  campus: string;
  onExplore: (id: string) => void;
  onConfirm: (name: string) => void;
  onCampus: (name: string) => void;
  onExplainDegree: () => void;
}

export function MajorDiscovery({
  candidates,
  profile,
  campus,
  onExplore,
  onConfirm,
  onCampus,
  onExplainDegree,
}: Props) {
  const options = majorDirections
    .map((direction) => ({
      ...direction,
      projects: candidates.filter((s) => directionOf(s) === direction.id),
    }))
    .filter((direction) => direction.projects.length);
  return (
    <div className="major-discovery">
      <div className="joint-context" role="status">
        <BookOpen size={19} />
        <p>
          {campus === "全部院校"
            ? "从专业开始，也可以从院校开始。"
            : `正在比较${campus}的专业方向。`}{" "}
          当前条件下有 {options.length} 个方向、{candidates.length}{" "}
          个演示项目。专业课测评不是选择前提。
        </p>
      </div>
      {options.length ? (
        <div className="major-grid">
          {options.map((direction) => {
            const confirmed = profile.targetMajor === direction.name;
            const campusNames = [
              ...new Set(direction.projects.map((s) => s.name)),
            ];
            return (
              <article
                className={`panel major-card ${direction.id === "research" ? "green" : "orange"}`}
                key={direction.id}
              >
                <div className="major-title-row">
                  <span className="major-icon">
                    <GraduationCap size={26} />
                  </span>
                  <span className="badge">{direction.label}</span>
                </div>
                <h2>{direction.name}</h2>
                <p className="major-subtitle">{direction.headline}</p>
                <div className="major-info">
                  <strong>主要学什么</strong>
                  <p>{direction.learning}</p>
                  <strong>适配思路</strong>
                  <p>
                    {direction.id === "research"
                      ? "希望深入研究或继续深造时，可以重点比较这一培养方向。"
                      : "希望通过项目实践积累职业能力时，可以重点比较这一培养方向。"}{" "}
                    当前填写目标：{profile.studyGoal || "尚不确定"}
                    ，具体适配仍待真实评估。
                  </p>
                  <strong>未来方向与准备成本</strong>
                  <p>{direction.jobs}</p>
                  <p>{direction.cost}</p>
                </div>
                <div className="related-campuses">
                  <strong>
                    <MapPin size={15} />
                    关联院校 · {campusNames.length} 所
                  </strong>
                  <div>
                    {campusNames.map((name) => (
                      <button
                        key={name}
                        onClick={() => onCampus(name)}
                        aria-label={`比较${name}的专业`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="major-actions">
                  <button
                    className="button secondary"
                    onClick={() => onExplore(direction.id)}
                    aria-label={`查看${direction.name}相关院校`}
                  >
                    查看相关院校
                    <ArrowRight size={16} />
                  </button>
                  <button
                    className={`button ${confirmed ? "secondary" : "primary"}`}
                    aria-pressed={confirmed}
                    onClick={() => onConfirm(direction.name)}
                    aria-label={`确认专业方向${direction.name}`}
                  >
                    {confirmed ? (
                      <>
                        <Check size={16} />
                        已确认方向
                      </>
                    ) : (
                      "确认这个方向"
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state panel">
          <BookOpen size={32} />
          <h3>当前条件下暂无专业方向</h3>
          <p>试试更换院校或清空筛选条件。</p>
        </div>
      )}
      <div className="notice">
        当前覆盖计算机科学与技术、计算机技术两个方向的演示项目。此处展示培养差异与比较流程，尚未接入真实就业、政策、报考资格或推荐算法。
        <button className="text-button" onClick={onExplainDegree}>
          学硕和专硕有什么区别？
        </button>
      </div>
    </div>
  );
}

export function DegreeExplanation() {
  return (
    <div className="degree-explanation">
      <p>
        两者都可以就业，也都可以继续深造。先看你的学习目标，再比较具体项目的培养安排。
      </p>
      <div className="degree-columns">
        <section>
          <h3>学硕 · 学术学位</h3>
          <p>
            通常更侧重学科理论、研究训练与方法，适合希望深入探索研究问题的学生重点了解。
          </p>
          <strong>比较时关注</strong>
          <ul>
            <li>研究方向、导师资源与科研训练</li>
            <li>课程结构、论文与毕业要求</li>
            <li>研究经历与未来岗位的关联</li>
          </ul>
        </section>
        <section>
          <h3>专硕 · 专业学位</h3>
          <p>
            通常更侧重专业能力、实践应用与行业问题，适合希望强化工程或职业实践的学生重点了解。
          </p>
          <strong>比较时关注</strong>
          <ul>
            <li>实践课程、项目与实习安排</li>
            <li>培养方式、毕业要求与资源</li>
            <li>真实岗位要求与实践积累</li>
          </ul>
        </section>
      </div>
      <div className="notice">
        学制、学费、考试科目、报考条件与读博路径都以具体项目为准。学硕不固定等于“数一英一”，专硕也不固定等于“数二英二”；政策支持不等于就业保证。
      </div>
    </div>
  );
}
