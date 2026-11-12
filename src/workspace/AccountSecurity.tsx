import { useState } from "react";
import { acceptSession, request, type Session } from "./api";
import { Dialog, ErrorNotice } from "./ui";
import { PreviewNotice } from "./PreviewNotice";

export function AccountSecurity({
  session,
  onSession,
}: {
  session: Session;
  onSession: (session: Session) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [recovery, setRecovery] = useState<{
    recoveryCode: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  async function act(
    operation: "password" | "recovery-code" | "delete-account",
  ) {
    if (operation === "password" && nextPassword !== confirmPassword) {
      setError(new Error("两次新密码不一致。"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      if (operation === "recovery-code") {
        const result = await request<{
          recoveryCode: string;
          expiresAt: string;
        }>("/auth/recovery-code", {
          method: "POST",
          body: { currentPassword: password },
        });
        setRecovery(result.data);
        setNotice("恢复码仅显示一次，新码已替换旧码，请离线保存。");
      } else {
        const result = await request<Session>(`/auth/${operation}`, {
          method: "POST",
          body: {
            currentPassword: password,
            ...(operation === "password"
              ? { newPassword: nextPassword }
              : { confirmation: "DELETE_ACCOUNT" }),
          },
        });
        acceptSession(result.data);
        onSession(result.data);
        setRecovery(null);
        setNotice(result.data.notice ?? "操作已完成。");
      }
      setPassword("");
      setNextPassword("");
      setConfirmPassword("");
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (!busy) {
      setOpen(false);
      setPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setRecovery(null);
      setConfirmed(false);
      setError(null);
      setNotice("");
    }
  }
  return (
    <>
      <button className="ws-secondary" onClick={() => setOpen(true)}>
        账号安全
      </button>
      {open && (
        <Dialog title="账号安全" onClose={close}>
          <ErrorNotice error={error} />
          {notice && <p role="status">{notice}</p>}
          <label>
            当前密码
            <input
              type="password"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <form
            className="ws-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act("password");
            }}
          >
            <h3>修改密码</h3>
            <label>
              新密码
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                required
                value={nextPassword}
                onChange={(e) => setNextPassword(e.target.value)}
              />
            </label>
            <label>
              确认新密码
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            <p>改密后其他设备会话和旧恢复码失效。</p>
            <button className="ws-primary" disabled={busy || !password}>
              更新密码
            </button>
          </form>
          <section className="ws-stack">
            <h3>一次性恢复码</h3>
            <p>
              忘记密码时可凭用户名和预先保存的恢复码重置。恢复码有效期一年，只能使用一次；请勿与他人共享。
            </p>
            <button
              className="ws-secondary"
              disabled={busy || !password}
              onClick={() => void act("recovery-code")}
            >
              生成或替换恢复码
            </button>
            {recovery && (
              <>
                <output
                  aria-label="账号恢复码"
                  style={{ overflowWrap: "anywhere" }}
                >
                  {recovery.recoveryCode}
                </output>
                <p>有效至：{recovery.expiresAt}</p>
              </>
            )}
          </section>
          {session.user?.role === "student" && (
            <section className="ws-stack">
              <h3>注销账号</h3>
              <p>
                注销将删除登录账号与在线个人资料，并退出全部设备。此操作无法撤销；已下载文件不受影响。部署备份中的删除状态须在恢复时继续生效。
              </p>
              <label className="ws-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我确认注销账号及全部个人资料
              </label>
              <button
                className="ws-danger-button"
                disabled={busy || !password || !confirmed}
                onClick={() => void act("delete-account")}
              >
                确认注销账号
              </button>
            </section>
          )}
        </Dialog>
      )}
    </>
  );
}

export function RecoveryScreen({
  onBack,
  previewMode,
}: {
  onBack: () => void;
  previewMode?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState(false);
  return (
    <main className="workspace ws-auth">
      <section className="ws-auth-card">
        {previewMode && <PreviewNotice />}
        <h1>恢复账号</h1>
        <p>
          使用此前在“账号安全”中保存的一次性恢复码。未保存或遗失恢复码时，无法在此自动找回；当前没有邮件找回服务。
        </p>
        <ErrorNotice error={error} />
        {done ? (
          <p role="status">密码已重置，旧会话及恢复码已失效，请返回登录。</p>
        ) : (
          <form
            className="ws-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (password !== confirmation) {
                setError(new Error("两次新密码不一致。"));
                return;
              }
              setBusy(true);
              setError(null);
              void request<Session>("/auth/recover", {
                method: "POST",
                body: { username, recoveryCode: code, newPassword: password },
              })
                .then((result) => {
                  acceptSession(result.data);
                  setCode("");
                  setPassword("");
                  setConfirmation("");
                  setDone(true);
                })
                .catch(setError)
                .finally(() => setBusy(false));
            }}
          >
            <label>
              用户名
              <input
                required
                autoComplete="username"
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              一次性恢复码
              <input
                required
                type="password"
                autoComplete="off"
                maxLength={100}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label>
              新密码
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              确认新密码
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <button className="ws-primary" disabled={busy}>
              重置密码
            </button>
          </form>
        )}
        <button className="ws-secondary" disabled={busy} onClick={onBack}>
          返回登录
        </button>
      </section>
    </main>
  );
}
