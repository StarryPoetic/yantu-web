export interface AdminIdentity {
  actorId: string;
  token: string;
  roles: Array<"editor" | "reviewer" | "publisher" | "auditor">;
}
export interface AppConfig {
  databasePath: string;
  sampleData: boolean;
  secureCookies: boolean;
  origins: string[];
  admins: AdminIdentity[];
  bootstrapAdmins?: BootstrapAdmin[];
  staticDirectory?: string;
  rateLimit: number;
  authRegistrationIpLimit?: number;
  authLoginIpLimit?: number;
}
export function environmentConfig(): AppConfig {
  const production = process.env.NODE_ENV === "production";
  // Parallel browser tests share one loopback IP; this override never applies outside test mode.
  const testRateLimit =
    process.env.NODE_ENV === "test"
      ? process.env.YANTU_TEST_API_RATE_LIMIT
      : undefined;
  if (
    testRateLimit !== undefined &&
    (!/^\d+$/.test(testRateLimit) ||
      !Number.isSafeInteger(Number(testRateLimit)) ||
      Number(testRateLimit) < 1 ||
      Number(testRateLimit) > 100_000)
  )
    throw new Error("测试 API 频控配置必须为 1 至 100000 的整数。");
  let admins: AdminIdentity[] = [];
  let bootstrapAdmins: BootstrapAdmin[] = [];
  if (process.env.YANTU_BOOTSTRAP_ADMINS) {
    try {
      bootstrapAdmins = JSON.parse(process.env.YANTU_BOOTSTRAP_ADMINS);
    } catch {
      throw new Error("YANTU_BOOTSTRAP_ADMINS 必须是有效 JSON 数组。");
    }
    validateBootstrapAdmins(bootstrapAdmins);
  }
  if (process.env.YANTU_ADMIN_CREDENTIALS) {
    try {
      admins = JSON.parse(process.env.YANTU_ADMIN_CREDENTIALS);
    } catch {
      throw new Error("YANTU_ADMIN_CREDENTIALS 必须是有效 JSON 数组。");
    }
    if (
      !Array.isArray(admins) ||
      admins.some(
        (a) =>
          !a.actorId ||
          !a.token ||
          a.token.length < 24 ||
          !Array.isArray(a.roles) ||
          a.roles.some(
            (r) => !["editor", "reviewer", "publisher", "auditor"].includes(r),
          ),
      )
    )
      throw new Error(
        "后台身份必须有独立 actorId、至少 24 字符凭据及有效角色。",
      );
    if (new Set(admins.map((a) => a.token)).size !== admins.length)
      throw new Error("后台身份凭据不能重复。");
  }
  if (production && !process.env.YANTU_ORIGIN)
    throw new Error("生产环境必须设置 HTTPS YANTU_ORIGIN。");
  if (production && !process.env.YANTU_ORIGIN?.startsWith("https://"))
    throw new Error("生产环境需要 HTTPS 来源。");
  return {
    databasePath: process.env.YANTU_DATABASE_PATH || "./var/yantu.sqlite",
    sampleData: !production && process.env.YANTU_SAMPLE_DATA !== "false",
    secureCookies: production,
    origins: process.env.YANTU_ORIGIN
      ? [process.env.YANTU_ORIGIN]
      : [
          "http://127.0.0.1:4173",
          "http://localhost:4173",
          "http://127.0.0.1:5173",
          "http://localhost:5173",
          "http://127.0.0.1:8787",
        ],
    admins,
    bootstrapAdmins,
    staticDirectory: "./dist",
    rateLimit: testRateLimit === undefined ? 600 : Number(testRateLimit),
    authRegistrationIpLimit: authRateLimit(
      process.env.YANTU_AUTH_REGISTRATION_IP_LIMIT ?? 10,
    ),
    authLoginIpLimit: authRateLimit(
      process.env.YANTU_AUTH_LOGIN_IP_LIMIT ?? 40,
    ),
  };
}

export function authRateLimit(value: unknown): number {
  if (
    (typeof value !== "number" &&
      (typeof value !== "string" || !/^\d+$/.test(value))) ||
    !Number.isInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 1000
  )
    throw new Error("认证频控配置必须为 1 至 1000 的整数。");
  return Number(value);
}

export function validateBootstrapAdmins(value: BootstrapAdmin[]): void {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("管理账户配置必须是最多 20 项的数组。");
  const usernames = new Set<string>();
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Array.isArray(entry.roles) ||
      !entry.roles.length ||
      entry.roles.some(
        (role) =>
          !["editor", "reviewer", "publisher", "auditor"].includes(role),
      ) ||
      new Set(entry.roles).size !== entry.roles.length
    )
      throw new Error("管理账户须提供有效的独立职责。");
    let key: string;
    try {
      key = usernameInput(entry.username).usernameKey;
      passwordInput(entry.password);
    } catch {
      throw new Error("管理账户用户名或密码格式不正确。");
    }
    if (usernames.has(key)) throw new Error("管理账户用户名不能重复。");
    usernames.add(key);
  }
}
import type { BootstrapAdmin } from "./auth/types.ts";
import { passwordInput, usernameInput } from "./auth/password.ts";
