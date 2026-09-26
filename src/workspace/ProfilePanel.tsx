import { useState } from "react";
import type { Profile } from "../types";
import { CityPicker } from "../CityPicker";
import { request } from "./api";
import type { Resource } from "./api";
import type { ProfileResource } from "./contracts";
import { Dialog, DegreeInfo, ErrorNotice } from "./ui";

const fields: { key: keyof Profile; label: string; placeholder: string }[] = [
  { key: "name", label: "称呼（选填）", placeholder: "怎么称呼你" },
  { key: "university", label: "本科院校", placeholder: "可填写不确定" },
  { key: "major", label: "本科专业", placeholder: "不等于已确认报考专业" },
  { key: "graduation", label: "毕业年份", placeholder: "例如 2027" },
  { key: "year", label: "报考年份", placeholder: "例如 2027" },
  { key: "english", label: "英语经历", placeholder: "例如 CET-4，或不确定" },
  { key: "math", label: "数学基础", placeholder: "例如学过高等数学" },
  { key: "hours", label: "每天可投入时间", placeholder: "例如 4 小时" },
  { key: "budget", label: "年度预算", placeholder: "例如 1–2 万元，或不确定" },
  {
    key: "courses",
    label: "相关课程基础",
    placeholder: "例如数据结构、概率论",
  },
  { key: "preparation", label: "备考进度", placeholder: "例如刚开始收集信息" },
  {
    key: "studyGoal",
    label: "职业与学习目标",
    placeholder: "例如工程实践、研究或不确定",
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
    [degree, setDegree] = useState(false);
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
          <p>允许不确定。按需填写，保存后可随时修改。</p>
        </div>
        <span className="ws-pill">画像版本 {resource.data.profileVersion}</span>
      </div>
      <ErrorNotice error={error} onReload={onReload} />
      <form onSubmit={save} className="ws-stack">
        <section className="ws-panel">
          <h2>个人情况</h2>
          <div className="ws-form-grid">
            {fields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  value={String(form[field.key] ?? "")}
                  placeholder={field.placeholder}
                  maxLength={300}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              </label>
            ))}
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
          {saved && <span role="status">已保存到当前游客会话</span>}
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
