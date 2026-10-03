import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.ts";
import type { Store, Session } from "../store.ts";
import type { Reply } from "../http.ts";
import { clientIpAddress, fields, HttpError } from "../http.ts";
import { createAuthModule } from "../auth/index.ts";
import { timingSafeEqual } from "node:crypto";

export function createAuthRoutes(store: Store, config: AppConfig) {
  const auth = createAuthModule(store, config);
  return {
    bootstrap: auth.bootstrap,
    sessionView: auth.view,
    matches: (path: string) => path.startsWith("/auth/"),
    async handle(input: {
      path: string;
      method: string;
      body: Record<string, unknown>;
      request: IncomingMessage;
      session: Session | null;
      sessionHash: string | null;
    }): Promise<Reply> {
      const { path, method, body, request, session, sessionHash } = input;
      if (path === "/auth/session" && method === "GET")
        return { body: auth.view(session) };
      if (
        method !== "POST" ||
        !["/auth/register", "/auth/login", "/auth/logout"].includes(path)
      )
        throw new HttpError(404, "route_not_found", "接口不存在。");
      if (session) {
        const supplied = Buffer.from(
          String(request.headers["x-csrf-token"] ?? ""),
        );
        const expected = Buffer.from(session.csrfToken);
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          throw new HttpError(
            403,
            "csrf_rejected",
            "会话校验失败，请刷新后重试。",
          );
      }
      const context = {
        session,
        sessionHash,
        remoteAddress: clientIpAddress(request, config.trustedProxyIps),
      };
      let result: { body: unknown; cookie: string };
      if (path === "/auth/register") {
        fields(body, ["username", "password", "migrateGuestData"]);
        result = await auth.register(context, {
          username: body.username,
          password: body.password,
          migrateGuestData: body.migrateGuestData,
        });
      } else if (path === "/auth/login") {
        fields(body, ["username", "password", "leaveGuestData"]);
        result = await auth.login(context, {
          username: body.username,
          password: body.password,
          leaveGuestData: body.leaveGuestData,
        });
      } else {
        fields(body, []);
        result = auth.logout(context);
      }
      return {
        status: path === "/auth/register" ? 201 : 200,
        body: result.body,
        headers: { "Set-Cookie": result.cookie },
      };
    },
  };
}
