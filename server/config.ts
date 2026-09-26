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
  staticDirectory?: string;
  rateLimit: number;
}
export function environmentConfig(): AppConfig {
  const production = process.env.NODE_ENV === "production";
  let admins: AdminIdentity[] = [];
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
    staticDirectory: "./dist",
    rateLimit: 600,
  };
}
