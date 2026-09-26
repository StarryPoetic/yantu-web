import { useEffect, useState } from "react";
import type { Profile } from "../types";
import { CityPicker } from "../CityPicker";
import { request } from "./api";
import type { Resource } from "./api";
import type { ProfileResource } from "./contracts";
import { Dialog, DegreeInfo, ErrorNotice } from "./ui";
import type { DisciplineCatalog } from "../../server/disciplines/types";
import { InterestPicker } from "./InterestPicker";

const currentYear = new Date().getFullYear();
const fields: {
  key: keyof Profile;
  label: string;
  placeholder: string;
  options?: string[];
}[] = [
  { key: "name", label: "称呼（选填）", placeholder: "怎么称呼你" },
  { key: "university", label: "本科院校", placeholder: "可填写不确定" },
  { key: "major", label: "本科专业", placeholder: "不等于已确认报考专业" },
  {
    key: "targetMajor",
    label: "感兴趣的专业或领域（选填）",
    placeholder: "可搜索专业名称，也可填写多个兴趣；尚未确定可留空",
  },
  {
    key: "graduation",
    label: "毕业年份",
    placeholder: "请选择",
    options: [
      "不确定",
      ...Array.from({ length: 36 }, (_, index) =>
        String(currentYear + 5 - index),
      ),
    ],
  },
  {
    key: "year",
    label: "报考年份",
    placeholder: "请选择",
    options: Array.from({ length: 6 }, (_, index) =>
      String(currentYear + index),
    ),
  },
  {
    key: "english",
    label: "英语经历",
    placeholder: "请选择",
    options: [
      "不确定",
      "尚未参加等级考试",
      "大学英语四级",
      "大学英语六级",
      "英语专业四级",
      "英语专业八级",
      "雅思或托福经历",
    ],
  },
  {
    key: "math",
    label: "数学基础",
    placeholder: "请选择",
    options: [
      "不确定",
      "未系统学习高等数学",
      "学过高等数学",
      "学过高等数学与线性代数",
      "学过高等数学、线性代数与概率论",
      "已开始考研数学复习",
    ],
  },
  {
    key: "hours",
    label: "每天可投入时间",
    placeholder: "请选择",
    options: [
      "不确定",
      "不足 2 小时",
      "2–4 小时",
      "4–6 小时",
      "6–8 小时",
      "8 小时以上",
    ],
  },
  {
    key: "budget",
    label: "年度预算",
    placeholder: "请选择",
    options: [
      "不确定",
      "1 万元以内",
      "1–2 万元",
      "2–5 万元",
      "5–10 万元",
      "10 万元以上",
    ],
  },
  {
    key: "courses",
    label: "相关课程基础",
    placeholder: "例如数据结构、概率论",
  },
  {
    key: "preparation",
    label: "备考进度",
    placeholder: "请选择",
    options: [
      "不确定",
      "刚开始了解",
      "已制定计划，尚未复习",
      "基础复习阶段",
      "强化练习阶段",
      "真题与冲刺阶段",
      "准备再次报考",
    ],
  },
  {
    key: "studyGoal",
    label: "职业与学习目标",
    placeholder: "请选择主要目标，可在补充说明中细化",
    options: [
      "不确定，希望先探索",
      "学术研究与继续读博",
      "专业实践与行业就业",
      "转向新的专业领域",
      "提升现有专业能力",
      "公共服务与社会发展",
      "文化、创意与艺术实践",
    ],
  },
];
export function ProfilePanel({
  resource,
  onSaved,
  onReload,
  onDelete,
}: {
  resource: Resource<ProfileResource>;
  onSaved: (value: Resource<ProfileResource>) => void;
  onReload: () => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState(resource.data.profile),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false),
    [degree, setDegree] = useState(false),
    [disciplineNames, setDisciplineNames] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void request<DisciplineCatalog>("/disciplines", {
      signal: controller.signal,
    })
      .then((result) =>
        setDisciplineNames([
          ...new Set(result.data.items.map((item) => item.name)),
        ]),
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);
  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await request<ProfileResource>("/me/profile", {
        method: "PUT",
        etag: resource.etag,
        body: form,
      });
      onSaved(result);
      setForm(result.data.profile);
      setSaved(true);
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
          <span className="ws-eyebrow">01 / 认识自己</span>
          <h1>为你的下一站，建立起点。</h1>
          <p>
            允许不确定。本科专业不会自动成为报考专业，保存后进入公共课测评。
          </p>
        </div>
        <span className="ws-pill">
          {resource.data.profileCompleted ||
          Number(resource.data.profileVersion) > 0
            ? "个人画像已保存"
            : "个人画像尚未保存"}{" "}
          · 版本 {resource.data.profileVersion}
        </span>
      </div>
      <ErrorNotice error={error} onReload={onReload} />
      <form onSubmit={save} className="ws-stack">
        <section className="ws-panel">
          <h2>个人情况</h2>
          <div className="ws-form-grid">
            {fields.map((field) =>
              field.key === "targetMajor" ? (
                <InterestPicker
                  key={field.key}
                  label={field.label}
                  placeholder={field.placeholder}
                  value={form.targetMajor ?? ""}
                  options={disciplineNames}
                  onChange={(value) => set("targetMajor", value)}
                />
              ) : (
                <label key={field.key}>
                  {field.label}
                  {field.options ? (
                    <select
                      value={String(form[field.key] ?? "")}
                      onChange={(event) => set(field.key, event.target.value)}
                    >
                      <option value="">{field.placeholder}</option>
                      {String(form[field.key] ?? "") &&
                        !field.options.includes(String(form[field.key])) && (
                          <option>{String(form[field.key])}</option>
                        )}
                      {field.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={String(form[field.key] ?? "")}
                      placeholder={field.placeholder}
                      maxLength={300}
                      onChange={(event) => set(field.key, event.target.value)}
                    />
                  )}
                </label>
              ),
            )}
            <label>
              跨专业意愿
              <select
                value={form.crossMajor}
                onChange={(event) => set("crossMajor", event.target.value)}
              >
                <option value="">不确定</option>
                <option>接受相近专业</option>
                <option>接受跨专业</option>
                <option>不接受跨专业</option>
              </select>
            </label>
            <label>
              学位偏好
              <select
                value={form.degreePreference ?? "不确定"}
                onChange={(event) =>
                  set("degreePreference", event.target.value)
                }
              >
                <option>不确定</option>
                <option>学术学位</option>
                <option>专业学位</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="ws-link"
            onClick={() => setDegree(true)}
          >
            学硕和专硕有什么区别？
          </button>
        </section>
        <section className="ws-panel">
          <h2>意向城市</h2>
          <p className="ws-muted">
            支持中文、拼音、首字母搜索与自定义城市。“不确定”与具体城市互斥。
          </p>
          <CityPicker
            value={form.cities}
            onChange={(cities) => set("cities", cities)}
          />
        </section>
        <section className="ws-panel">
          <h2>你更看重什么</h2>
          <p className="ws-muted">七项偏好影响比较顺序，不替代真实报考条件。</p>
          <div className="ws-form-grid">
            {Object.entries(form.priorities).map(([label, value]) => (
              <label key={label}>
                {label}
                <div className="ws-range">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={value}
                    aria-label={label}
                    onChange={(event) =>
                      set("priorities", {
                        ...form.priorities,
                        [label]: Number(event.target.value),
                      })
                    }
                  />
                  <output>{value}</output>
                </div>
              </label>
            ))}
          </div>
          <label>
            补充说明
            <textarea
              value={form.notes ?? ""}
              maxLength={1000}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="想了解什么、有哪些约束（选填）"
            />
          </label>
        </section>
        <div className="ws-actions">
          <button className="ws-primary" disabled={busy} type="submit">
            {busy ? "正在保存…" : "保存个人画像"}
          </button>
          {saved && <span role="status">个人画像已保存到账号</span>}
          <button type="button" className="ws-danger" onClick={onDelete}>
            删除我的个人资料
          </button>
        </div>
      </form>
      {degree && (
        <Dialog title="学硕与专硕，怎样选择" onClose={() => setDegree(false)}>
          <DegreeInfo />
        </Dialog>
      )}
    </>
  );
}
