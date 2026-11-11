import { randomBytes } from "node:crypto";
import { HttpError, digest, id, now } from "../http.ts";
import type { Store, Session } from "../store.ts";
import type { AppConfig } from "../config.ts";
import { authRateLimit, validateBootstrapAdmins } from "../config.ts";
import {
  hashPassword,
  passwordInput,
  usernameInput,
  verifyPassword,
} from "./password.ts";
import type { AccountRecord, BootstrapAdmin, SessionView } from "./types.ts";
export type * from "./types.ts";

export const SESSION_COOKIE = "yantu_session";
export interface AuthContext {
  session: Session | null;
  sessionHash: string | null;
  remoteAddress: string;
}

export function sessionCookie(
  token: string,
  secure: boolean,
  expired = false,
): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${expired ? 0 : 2592000}${secure ? "; Secure" : ""}`;
}

/** Credentials and identity changes are kept behind one small module; business records keep their stable subject ID. */
export function createAuthModule(store: Store, config: AppConfig) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS auth_recovery_codes (
    account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
  ) STRICT`);
  const registrationIpLimit = authRateLimit(
    config.authRegistrationIpLimit ?? 10,
  );
  const loginIpLimit = authRateLimit(config.authLoginIpLimit ?? 40);
  let activeHashes = 0;
  async function hashWork<T>(work: () => Promise<T>): Promise<T> {
    if (activeHashes >= 4)
      throw new HttpError(429, "auth_busy", "登录请求较多，请稍后重试。");
    activeHashes += 1;
    try {
      return await work();
    } finally {
      activeHashes -= 1;
    }
  }
  function freshSession(context: AuthContext) {
    if (!context.session) return;
    const live = context.sessionHash
      ? store.session(context.sessionHash)
      : null;
    if (
      !live ||
      live.subjectId !== context.session.subjectId ||
      live.generation !== context.session.generation
    )
      throw new HttpError(409, "session_changed", "会话已改变，请刷新后重试。");
  }
  function limit(action: string, usernameKey: string, remoteAddress: string) {
    const accepted = store.transaction(() => {
      const ipAllowed = store.consumeAuthLimit(
        `${action}:ip:${digest(remoteAddress)}`,
        action === "register" ? registrationIpLimit : loginIpLimit,
        15 * 60000,
      );
      const nameAllowed = store.consumeAuthLimit(
        `${action}:name:${digest(usernameKey)}`,
        action === "register" ? 5 : 10,
        15 * 60000,
      );
      return ipAllowed && nameAllowed;
    });
    if (!accepted)
      throw new HttpError(
        429,
        "auth_rate_limited",
        "登录或注册尝试过于频繁，请 15 分钟后再试。",
      );
  }
  function rotate(subjectId: string, previousHash: string | null) {
    if (previousHash) store.revokeSession(previousHash);
    const token = randomBytes(32).toString("base64url");
    const session = store.createSession(
      digest(token),
      randomBytes(32).toString("base64url"),
      subjectId,
    );
    return { session, cookie: sessionCookie(token, config.secureCookies) };
  }
  function view(session: Session | null): SessionView {
    const user = session ? store.accountUser(session.subjectId) : null;
    return {
      authenticated: Boolean(user),
      user,
      csrfToken: session?.csrfToken ?? null,
      guest: Boolean(session && !user),
      guestHasData: Boolean(
        session && !user && store.hasPersonalData(session.subjectId),
      ),
      features: {
        sampleData: config.sampleData,
        modelEnabled: process.env.YANTU_MODEL_ENABLED === "true",
      },
    };
  }
  async function reauthenticate(context: AuthContext, password: unknown) {
    if (!context.session?.user)
      throw new HttpError(401, "authentication_required", "请先登录账号。");
    const name = usernameInput(context.session.user.username);
    limit("security", name.usernameKey, context.remoteAddress);
    const account = store.account(name.usernameKey);
    const valid = await hashWork(() =>
      verifyPassword(passwordInput(password), account?.passwordHash),
    );
    if (!account || !valid)
      throw new HttpError(401, "invalid_credentials", "当前密码不正确。");
    return account;
  }
  function unchanged(context: AuthContext, account: AccountRecord) {
    freshSession(context);
    if (
      store.account(account.usernameKey)?.passwordHash !== account.passwordHash
    )
      throw new HttpError(
        409,
        "account_changed",
        "账号状态已变化，请重新登录。",
      );
  }
  function clearRecovery(accountId: string) {
    store.db
      .prepare("DELETE FROM auth_recovery_codes WHERE account_id=?")
      .run(accountId);
  }
  return {
    view,
    async changePassword(
      context: AuthContext,
      input: { currentPassword: unknown; newPassword: unknown },
    ) {
      const account = await reauthenticate(context, input.currentPassword);
      const passwordHash = await hashWork(() =>
        hashPassword(passwordInput(input.newPassword)),
      );
      return store.transaction(() => {
        unchanged(context, account);
        store.db
          .prepare("UPDATE accounts SET password_hash=? WHERE account_id=?")
          .run(passwordHash, account.accountId);
        store.revokeSubjectSessions(account.subjectId);
        clearRecovery(account.accountId);
        const next = rotate(account.subjectId, null);
        store.audit(
          account.accountId,
          "auth.password_changed",
          account.accountId,
        );
        return {
          body: {
            ...view(next.session),
            notice: "密码已更新，其他会话与旧恢复码已失效。",
          },
          cookie: next.cookie,
        };
      });
    },
    async issueRecovery(context: AuthContext, currentPassword: unknown) {
      const account = await reauthenticate(context, currentPassword);
      const recoveryCode = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
      return store.transaction(() => {
        unchanged(context, account);
        store.db
          .prepare(
            "INSERT INTO auth_recovery_codes VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at",
          )
          .run(account.accountId, digest(recoveryCode), expiresAt);
        store.audit(
          account.accountId,
          "auth.recovery_issued",
          account.accountId,
        );
        return {
          body: {
            recoveryCode,
            expiresAt: new Date(expiresAt).toISOString(),
            notice: "恢复码只显示一次，新码会替换旧码。请离线妥善保存。",
          },
        };
      });
    },
    async recover(
      context: AuthContext,
      input: { username: unknown; recoveryCode: unknown; newPassword: unknown },
    ) {
      if (context.session?.user)
        throw new HttpError(
          409,
          "already_authenticated",
          "已登录，请使用修改密码。",
        );
      const name = usernameInput(input.username);
      limit("recover", name.usernameKey, context.remoteAddress);
      const account = store.account(name.usernameKey);
      const tokenHash = digest(
        typeof input.recoveryCode === "string" ? input.recoveryCode : "",
      );
      const saved = account
        ? store.db
            .prepare(
              "SELECT token_hash,expires_at FROM auth_recovery_codes WHERE account_id=?",
            )
            .get(account.accountId)
        : null;
      if (
        !account ||
        !saved ||
        saved.token_hash !== tokenHash ||
        Number(saved.expires_at) <= Date.now()
      )
        throw new HttpError(
          401,
          "invalid_recovery",
          "用户名或恢复码无效、已过期或已使用。",
        );
      const passwordHash = await hashWork(() =>
        hashPassword(passwordInput(input.newPassword)),
      );
      return store.transaction(() => {
        freshSession(context);
        if (
          store.account(account.usernameKey)?.passwordHash !==
          account.passwordHash
        )
          throw new HttpError(
            409,
            "account_changed",
            "账号状态已变化，请重新操作。",
          );
        const consumed = store.db
          .prepare(
            "DELETE FROM auth_recovery_codes WHERE account_id=? AND token_hash=? AND expires_at>?",
          )
          .run(account.accountId, tokenHash, Date.now());
        if (consumed.changes !== 1)
          throw new HttpError(
            401,
            "invalid_recovery",
            "用户名或恢复码无效、已过期或已使用。",
          );
        store.db
          .prepare("UPDATE accounts SET password_hash=? WHERE account_id=?")
          .run(passwordHash, account.accountId);
        store.revokeSubjectSessions(account.subjectId);
        store.audit(account.accountId, "auth.recovered", account.accountId);
        return {
          body: {
            ...view(context.session),
            notice: "密码已重置，恢复码已使用，请用新密码登录。",
          },
          cookie: context.session
            ? undefined
            : sessionCookie("", config.secureCookies, true),
        };
      });
    },
    async deleteAccount(
      context: AuthContext,
      input: { currentPassword: unknown; confirmation: unknown },
    ) {
      if (input.confirmation !== "DELETE_ACCOUNT")
        throw new HttpError(
          422,
          "confirmation_required",
          "请明确确认注销账号及全部个人资料。",
        );
      const account = await reauthenticate(context, input.currentPassword);
      if (account.role === "admin")
        throw new HttpError(
          403,
          "admin_deletion_requires_handoff",
          "管理员账号需先完成权限交接，不能在此自行注销。",
        );
      return store.transaction(() => {
        unchanged(context, account);
        store.erase(account.subjectId);
        store.revokeSubjectSessions(account.subjectId);
        store.db
          .prepare("DELETE FROM accounts WHERE account_id=?")
          .run(account.accountId);
        store.audit(
          account.accountId,
          "auth.account_deleted",
          account.accountId,
        );
        return {
          body: {
            ...view(null),
            notice: "账号与在线个人资料已注销。已下载文件不受影响。",
          },
          cookie: sessionCookie("", config.secureCookies, true),
        };
      });
    },
    async bootstrap(entries: BootstrapAdmin[] = []) {
      validateBootstrapAdmins(entries);
      for (const entry of entries) {
        const name = usernameInput(entry.username);
        const existing = store.account(name.usernameKey);
        if (existing) {
          if (existing.role !== "admin")
            throw new Error(
              "管理账户初始化与已有普通账户冲突，不能自动提升权限。",
            );
          continue;
        }
        const passwordHash = await hashWork(() => hashPassword(entry.password));
        store.transaction(() => {
          const accountId = id();
          const record: AccountRecord = {
            ...name,
            accountId,
            subjectId: accountId,
            passwordHash,
            role: "admin",
            adminRoles: [...entry.roles],
            createdAt: now(),
          };
          store.insertAccount(record);
          store.audit(accountId, "auth.bootstrap", accountId);
        });
      }
    },
    async register(
      context: AuthContext,
      input: {
        username: unknown;
        password: unknown;
        migrateGuestData?: unknown;
      },
    ) {
      if (context.session?.user)
        throw new HttpError(
          409,
          "already_authenticated",
          "请先退出当前账户后再注册。",
        );
      const name = usernameInput(input.username);
      const password = passwordInput(input.password);
      if (
        input.migrateGuestData !== undefined &&
        typeof input.migrateGuestData !== "boolean"
      )
        throw new HttpError(
          422,
          "invalid_migration_choice",
          "请明确是否保存当前游客记录。",
        );
      const guestHasData = Boolean(
        context.session && store.hasPersonalData(context.session.subjectId),
      );
      if (guestHasData && input.migrateGuestData === undefined)
        throw new HttpError(
          409,
          "guest_migration_confirmation_required",
          "当前浏览器有游客记录，请明确选择是否迁移到新账户。",
        );
      limit("register", name.usernameKey, context.remoteAddress);
      if (store.account(name.usernameKey))
        throw new HttpError(409, "username_unavailable", "该用户名不可用。");
      const passwordHash = await hashWork(() => hashPassword(password));
      return store.transaction(() => {
        freshSession(context);
        if (store.account(name.usernameKey))
          throw new HttpError(409, "username_unavailable", "该用户名不可用。");
        const migrate = Boolean(
          context.session && input.migrateGuestData === true,
        );
        const accountId = migrate ? context.session!.subjectId : id();
        const record: AccountRecord = {
          ...name,
          accountId,
          subjectId: accountId,
          passwordHash,
          role: "student",
          adminRoles: [],
          createdAt: now(),
        };
        store.insertAccount(record, migrate);
        const next = rotate(accountId, context.sessionHash);
        store.audit(accountId, "auth.register", accountId);
        return {
          body: {
            ...view(next.session),
            guestDataMigrated: migrate,
            notice: migrate
              ? "当前游客记录已保存到新账户，可在其他设备登录继续使用。"
              : "账户已创建；未将当前游客记录导入新账户。",
          },
          cookie: next.cookie,
        };
      });
    },
    async login(
      context: AuthContext,
      input: { username: unknown; password: unknown; leaveGuestData?: unknown },
    ) {
      const name = usernameInput(input.username);
      const password = passwordInput(input.password);
      if (
        input.leaveGuestData !== undefined &&
        typeof input.leaveGuestData !== "boolean"
      )
        throw new HttpError(
          422,
          "invalid_guest_choice",
          "请明确是否在不导入游客记录的情况下登录。",
        );
      const guestHasData = Boolean(
        context.session &&
          !context.session.user &&
          store.hasPersonalData(context.session.subjectId),
      );
      if (guestHasData && input.leaveGuestData !== true)
        throw new HttpError(
          409,
          "guest_data_confirmation_required",
          "当前浏览器有游客记录。登录已有账户不会导入这些记录；确认继续，或通过注册明确迁移。",
        );
      limit("login", name.usernameKey, context.remoteAddress);
      const account = store.account(name.usernameKey);
      const verified = await hashWork(() =>
        verifyPassword(password, account?.passwordHash),
      );
      if (!account || !verified)
        throw new HttpError(401, "invalid_credentials", "用户名或密码不正确。");
      return store.transaction(() => {
        freshSession(context);
        if (
          store.account(account.usernameKey)?.passwordHash !==
          account.passwordHash
        )
          throw new HttpError(
            409,
            "account_changed",
            "账号状态已变化，请重新登录。",
          );
        const next = rotate(account.subjectId, context.sessionHash);
        store.audit(account.accountId, "auth.login", account.accountId);
        return {
          body: {
            ...view(next.session),
            notice: guestHasData
              ? "已进入账户；游客记录未导入，也未覆盖账户原有记录。"
              : "登录成功。",
          },
          cookie: next.cookie,
        };
      });
    },
    logout(context: AuthContext) {
      return store.transaction(() => {
        if (context.sessionHash) store.revokeSession(context.sessionHash);
        if (context.session?.user)
          store.audit(
            context.session.user.accountId,
            "auth.logout",
            context.session.user.accountId,
          );
        return {
          body: view(null),
          cookie: sessionCookie("", config.secureCookies, true),
        };
      });
    },
  };
}
