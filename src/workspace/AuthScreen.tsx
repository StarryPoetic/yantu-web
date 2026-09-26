import { useState } from "react";
import { GraduationCap, ArrowRight, ShieldCheck } from "lucide-react";
import { ApiError, acceptSession, request, type Session } from "./api";
import { ErrorNotice } from "./ui";

export function AuthScreen({
  session,
  onAuthenticated,
}: {
  session: Session;
  onAuthenticated: (session: Session) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [leaveGuest, setLeaveGuest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "register" && password !== confirmation) {
      setError(new Error("两次输入的密码不一致。"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await request<Session>(`/auth/${mode}`, {
        method: "POST",
        body: {
          username,
          password,
          ...(mode === "register"
            ? { migrateGuestData: migrate }
            : { leaveGuestData: leaveGuest }),
        },
      });
      acceptSession(result.data);
      setPassword("");
      setConfirmation("");
      onAuthenticated(result.data);
    } catch (failure) {
      setError(failure);
      if (
        failure instanceof ApiError &&
        failure.code === "guest_data_confirmation_required"
      )
        setLeaveGuest(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace ws-auth">
      <section className="ws-auth-story">
        <div className="ws-auth-brand">
          <GraduationCap size={36} /> 研途
        </div>
        <span className="ws-eyebrow">从认识自己，到找到方向</span>
        <h1>
          下一站，
          <br />
          从你的选择开始。
        </h1>
        <p>
          还没有确定专业，也没关系。用个人画像、基础测评和全国专业目录，一步步缩小适合自己的范围。
        </p>
        <ol>
          <li>建立个人画像</li>
          <li>了解公共课基础</li>
          <li>比较专业与院校</li>
        </ol>
      </section>
      <section className="ws-auth-card">
        <h2>{mode === "login" ? "欢迎回到研途" : "创建你的研途账号"}</h2>
        <p>登录后保存画像、测评和选择，换一台设备也能继续。</p>
        <div className="ws-auth-tabs" role="group" aria-label="登录或注册">
          {(["login", "register"] as const).map((value) => (
            <button
              key={value}
              className={mode === value ? "active" : ""}
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setError(null);
                setPassword("");
                setConfirmation("");
              }}
            >
              {value === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>
        <ErrorNotice error={error} />
        <form onSubmit={submit} className="ws-stack">
          <label>
            用户名
            <input
              required
              autoComplete="username"
              minLength={3}
              maxLength={32}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3–32 位中文、字母、数字或 _ . -"
            />
          </label>
          <label>
            密码
            <input
              required
              type="password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              minLength={mode === "register" ? 10 : 1}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === "register" ? "至少 10 位，请使用独立密码" : "输入密码"
              }
            />
          </label>
          {mode === "register" && (
            <label>
              确认密码
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          )}
          {session.guestHasData &&
            (mode === "register" ? (
              <label className="ws-check">
                <input
                  type="checkbox"
                  checked={migrate}
                  onChange={(event) => setMigrate(event.target.checked)}
                />
                将当前浏览器的游客资料保存到新账号
              </label>
            ) : (
              <label className="ws-check">
                <input
                  type="checkbox"
                  checked={leaveGuest}
                  onChange={(event) => setLeaveGuest(event.target.checked)}
                />
                登录已有账号并使用其记录；当前游客资料不会合并。若需保留，请先注册迁移。
              </label>
            ))}
          <button
            className="ws-primary"
            disabled={
              busy || (mode === "login" && session.guestHasData && !leaveGuest)
            }
          >
            {busy
              ? "正在处理…"
              : mode === "login"
                ? "登录并继续"
                : "注册并开始"}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="ws-muted ws-auth-role">
          <ShieldCheck size={17} />
          管理员使用同一入口登录，身份由系统确认。
        </p>
      </section>
    </main>
  );
}
