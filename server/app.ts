import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { Store } from "./store.ts";
import { environmentConfig } from "./config.ts";
import type { AppConfig } from "./config.ts";
import {
  canonical,
  clientIpAddress,
  digest,
  fields,
  HttpError,
  id,
  now,
  readBody,
} from "./http.ts";
import type { Reply } from "./http.ts";
import type { Context } from "./context.ts";
import { createSeedCatalog } from "./catalog/index.ts";
import type { CatalogState } from "./catalog/types.ts";
import { loadQuestionBank } from "./assessment/index.ts";
import type { AssessmentAttempt } from "./assessment/types.ts";
import { profileRoutes } from "./routes/profile.ts";
import { catalogRoutes } from "./routes/catalog.ts";
import { assessmentRoutes } from "./routes/assessment.ts";
import { workRoutes } from "./routes/work.ts";
import { adminRoutes } from "./routes/admin.ts";
import { createAssistantRoutes } from "./routes/assistant.ts";
import { createAuthRoutes } from "./routes/auth.ts";
import { SESSION_COOKIE, sessionCookie } from "./auth/index.ts";
import { guidanceRoutes } from "./routes/guidance.ts";
import { createResearchRoutes } from "./routes/research.ts";
import type { ResearchEngine } from "./routes/research.ts";
import { createResearchEvidenceLibrary } from "./explanation/research-library.ts";

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const publicPaths =
  /^\/(health|cities|programs(?:\/[^/]+)?|major-directions|disciplines)$/;
const cookieName = SESSION_COOKIE;

export async function createApplication(
  overrides: Partial<AppConfig> = {},
  dependencies: { research?: ResearchEngine } = {},
) {
  const config = { ...environmentConfig(), ...overrides };
  const store = new Store(config.databasePath);
  let auth: ReturnType<typeof createAuthRoutes>;
  try {
    auth = createAuthRoutes(store, config);
    await auth.bootstrap(config.bootstrapAdmins);
  } catch (error) {
    store.close();
    throw error;
  }
  config.bootstrapAdmins = [];
  if (!store.get("public", "catalog")) {
    const empty: CatalogState = {
      schemaVersion: 1,
      sources: [],
      revisions: [],
      releases: [
        {
          schemaVersion: 1,
          catalogVersion: "catalog-empty-v1",
          publishedAt: now(),
          mode: "verified",
          coverage: {
            years: [],
            description: "招生资料尚未发布",
            limitations: ["未覆盖不代表不存在"],
          },
          programs: [],
          sources: [],
          withdrawnRevisionIds: [],
        },
      ],
      activeCatalogVersion: "catalog-empty-v1",
      withdrawnRevisionIds: [],
      coverage: {
        years: [],
        description: "尚未覆盖",
        limitations: ["请通过资料后台导入并独立审核"],
      },
      audit: [],
    };
    store.put(
      "public",
      "catalog",
      "current",
      config.sampleData ? createSeedCatalog() : empty,
    );
  }
  if (config.sampleData && !store.get("public", "question-bank"))
    store.put("public", "question-bank", "current", await loadQuestionBank());
  const existingExampleBank = store.get<{
    mode: string;
    questionBankVersion: string;
  }>("public", "question-bank");
  if (
    config.sampleData &&
    existingExampleBank?.value.mode === "example" &&
    ["example-unreviewed-v1", "example-unreviewed-v2-presentation"].includes(
      existingExampleBank.value.questionBankVersion,
    )
  ) {
    store.put("public", "question-bank", "current", await loadQuestionBank());
  }
  if (!config.sampleData) {
    const state = store.get<CatalogState>("public", "catalog")!.value;
    if (
      state.releases.some(
        (r) =>
          r.catalogVersion === state.activeCatalogVersion &&
          r.mode === "example",
      ) ||
      store.get<{ mode: string }>("public", "question-bank")?.value.mode ===
        "example"
    )
      throw new Error(
        "正式实例不能使用含示例发布的数据文件，请指定独立的 YANTU_DATABASE_PATH。",
      );
  }
  const assistant = createAssistantRoutes({
    library: createResearchEvidenceLibrary(store, {
      allowedHosts: process.env.YANTU_OFFICIAL_HOSTS?.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }),
  });
  const research = createResearchRoutes(
    store,
    dependencies.research ?? assistant.research,
  );
  const limits = new Map<string, { count: number; until: number }>();
  const inFlight = new Map<string, { hash: string; promise: Promise<Reply> }>();
  const resolveSessionHash = (request: IncomingMessage): string | null => {
    const token = request.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return token ? digest(token) : null;
  };
  function throttle(key: string, limit: number) {
    const time = Date.now();
    const bucket = limits.get(key);
    if (!bucket || bucket.until < time)
      limits.set(key, { count: 1, until: time + 60_000 });
    else if (++bucket.count > limit)
      throw new HttpError(429, "rate_limited", "操作较频繁，请稍后再试。");
    if (limits.size > 5000)
      for (const [name, b] of limits) if (b.until < time) limits.delete(name);
  }
  function send(response: ServerResponse, reply: Reply, requestId: string) {
    response.statusCode = reply.status ?? 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (reply.etag) response.setHeader("ETag", reply.etag);
    for (const [key, value] of Object.entries(reply.headers ?? {}))
      response.setHeader(key, value);
    response.end(
      JSON.stringify({
        generatedAt: now(),
        ...(reply.body as object),
        schemaVersion: 1,
        requestId,
      }),
    );
  }
  async function api(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) {
    const requestId = id();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Cache-Control", "no-store");
    try {
      const method = request.method ?? "GET";
      let path: string;
      try {
        path = decodeURIComponent(url.pathname.slice("/api/v1".length) || "/");
      } catch {
        throw new HttpError(400, "invalid_path", "路径编码不正确。");
      }
      const write = !["GET", "HEAD"].includes(method);
      const clientAddress = clientIpAddress(request, config.trustedProxyIps);
      throttle(clientAddress, config.rateLimit);
      if (path === "/health" && method === "GET") {
        try {
          store.db.prepare("SELECT version FROM migrations LIMIT 1").get();
          return send(
            response,
            {
              body: {
                status: "ok",
                database: "ok",
                sampleData: config.sampleData,
              },
            },
            requestId,
          );
        } catch {
          return send(
            response,
            {
              status: 503,
              body: {
                status: "unavailable",
                database: "unavailable",
                code: "database_unavailable",
                message: "服务暂时不可用，请稍后重试。",
                sampleData: config.sampleData,
              },
            },
            requestId,
          );
        }
      }
      const origin = request.headers.origin;
      if (
        write &&
        ((origin && !config.origins.includes(origin)) ||
          request.headers["sec-fetch-site"] === "cross-site")
      )
        throw new HttpError(403, "origin_rejected", "请求来源不受信任。");
      const body = write ? await readBody(request) : {};
      const sessionHash = resolveSessionHash(request);
      let session = sessionHash ? store.session(sessionHash) : null;
      if (auth.matches(path)) {
        const reply = await auth.handle({
          path,
          method,
          body,
          request,
          session,
          sessionHash,
        });
        return send(response, reply, requestId);
      }
      if (path === "/guest-sessions" && method === "POST") {
        fields(body, []);
        let headers: Record<string, string> = {};
        if (!session) {
          throttle(`guest:${clientAddress}`, 30);
          const token = randomBytes(32).toString("base64url");
          session = store.transaction(() =>
            store.createSession(
              digest(token),
              randomBytes(32).toString("base64url"),
            ),
          );
          headers = {
            "Set-Cookie": sessionCookie(token, config.secureCookies),
          };
        }
        return send(
          response,
          {
            body: {
              ...auth.sessionView(session),
            },
            headers,
          },
          requestId,
        );
      }
      let admin: Context["admin"];
      if (path.startsWith("/admin/")) {
        const token =
          request.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const machineIdentity = token
          ? config.admins.find((a) => safeEqual(a.token, token))
          : undefined;
        if (machineIdentity)
          admin = {
            actorId: machineIdentity.actorId,
            roles: machineIdentity.roles,
            authentication: "bearer",
          };
        else if (session?.user?.role === "admin")
          admin = {
            actorId: session.user.accountId,
            roles: session.user.adminRoles,
            authentication: "session",
          };
        if (!admin)
          throw new HttpError(
            session?.user ? 403 : 401,
            "admin_required",
            "需要具有相应权限的管理账户。",
          );
      } else if (!session && !publicPaths.test(path))
        throw new HttpError(
          401,
          "session_required",
          "会话已失效，请刷新重新连接。",
        );
      if (
        write &&
        admin?.authentication !== "bearer" &&
        (!session ||
          !safeEqual(
            String(request.headers["x-csrf-token"] ?? ""),
            session.csrfToken,
          ))
      )
        throw new HttpError(403, "csrf_rejected", "会话校验失败，请刷新页面。");
      const context: Context = {
        request,
        path,
        method,
        query: url.searchParams,
        body,
        store,
        config,
        session: session ?? {
          subjectId: "public",
          generation: 0,
          csrfToken: "",
          expiresAt: 0,
        },
        sessionHash,
        admin,
      };
      const owner = admin
        ? `admin:${admin.actorId}`
        : context.session.subjectId;
      const operation = `${method} ${path}`;
      const needsKey = method === "POST" || method === "DELETE";
      const key = String(request.headers["idempotency-key"] ?? "");
      if (needsKey && (!key || key.length > 200))
        throw new HttpError(
          428,
          "idempotency_required",
          "此操作需要有效的幂等请求标识。",
        );
      const hash = digest(
        canonical(body) +
          String(request.headers["deletion-scope-version"] ?? ""),
      );
      const generation = context.session.generation;
      const replay = needsKey
        ? store.replay(owner, generation, operation, key)
        : null;
      if (replay) {
        if (replay.digest !== hash)
          throw new HttpError(
            409,
            "idempotency_conflict",
            "相同请求标识不能用于不同内容。",
          );
        const saved = JSON.parse(String(replay.response)) as Reply;
        const savedBody = saved.body as Record<string, unknown>;
        const refreshedResearch = research.replay(context, savedBody);
        if (refreshedResearch)
          return send(response, refreshedResearch, requestId);
        assistant.validateReplay(context, savedBody);
        if (
          path === "/guidance" &&
          typeof savedBody.guidanceRunId === "string"
        ) {
          const refreshed = store.transaction(() =>
            guidanceRoutes({
              ...context,
              method: "GET",
              path: `/guidance/${savedBody.guidanceRunId}`,
            }),
          );
          return send(
            response,
            { ...refreshed!, status: saved.status },
            requestId,
          );
        }
        // Replay the same resource, while reapplying current withdrawal barriers.
        if (
          path === "/recommendations" &&
          typeof savedBody.recommendationRunId === "string"
        ) {
          const refreshed = store.transaction(() =>
            workRoutes({
              ...context,
              method: "GET",
              path: `/recommendations/${savedBody.recommendationRunId}`,
            }),
          );
          return send(
            response,
            { ...refreshed!, status: saved.status },
            requestId,
          );
        }
        if (
          path === "/assessment-attempts" &&
          typeof savedBody.assessmentAttemptId === "string"
        ) {
          const refreshed = assessmentRoutes({
            ...context,
            method: "GET",
            path: `/assessment-attempts/${savedBody.assessmentAttemptId}`,
          });
          return send(
            response,
            { ...refreshed!, status: saved.status },
            requestId,
          );
        }
        if (/^\/assessment-attempts\/[^/]+\/explanations$/.test(path)) {
          const attempt = store.get<AssessmentAttempt>(
            owner,
            "attempt",
            path.split("/")[2],
          );
          if (
            attempt &&
            store.get(
              "public",
              "withdrawn-banks",
              attempt.value.questionBankVersion,
            )
          )
            throw new HttpError(
              409,
              "bank_withdrawn",
              "题库已撤回，不能回放旧辅助解释。",
            );
        }
        return send(response, saved, requestId);
      }
      const remember = (reply: Reply) => {
        if (
          sessionHash &&
          admin?.authentication !== "bearer" &&
          !store.session(sessionHash)
        )
          throw new HttpError(
            409,
            "session_changed",
            "会话已退出或切换，旧请求结果已丢弃。",
          );
        const current = admin ? generation : store.generation(owner);
        if (
          owner !== "public" &&
          !admin &&
          current !== generation &&
          path !== "/me/profile"
        )
          throw new HttpError(
            409,
            "data_deleted",
            "个人资料已删除，旧请求结果已丢弃。",
          );
        if (needsKey)
          store.remember(
            owner,
            current < 0 ? 0 : current,
            operation,
            key,
            hash,
            reply,
          );
        return reply;
      };
      const route = (): Reply => {
        const result = admin
          ? adminRoutes(context)
          : (research.handle(context) ??
            catalogRoutes(context) ??
            guidanceRoutes(context) ??
            profileRoutes(context) ??
            assessmentRoutes(context) ??
            workRoutes(context));
        if (!result)
          throw new HttpError(404, "route_not_found", "接口不存在。");
        return result;
      };
      let result: Reply;
      if (assistant.matches(context)) {
        const flightKey = `${owner}:${generation}:${operation}:${key}`;
        const existing = inFlight.get(flightKey);
        if (existing) {
          if (existing.hash !== hash)
            throw new HttpError(
              409,
              "idempotency_conflict",
              "相同请求标识内容不同。",
            );
          result = await existing.promise;
        } else {
          const promise = assistant
            .handle(context)
            .then((reply) => store.transaction(() => remember(reply)));
          inFlight.set(flightKey, { hash, promise });
          try {
            result = await promise;
          } finally {
            inFlight.delete(flightKey);
          }
        }
        if (store.generation(owner) !== generation)
          throw new HttpError(
            409,
            "data_deleted",
            "个人资料已删除，旧请求结果已丢弃。",
          );
        if (sessionHash && !store.session(sessionHash))
          throw new HttpError(
            409,
            "session_changed",
            "会话已退出或切换，旧请求结果已丢弃。",
          );
      } else {
        result = store.transaction(() => remember(route()));
        if (path === "/me/profile" && method === "DELETE")
          assistant.clearSubject(owner);
      }
      send(response, result, requestId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ModelError" &&
        "code" in error &&
        error.code === "DATA_DELETED"
      ) {
        send(
          response,
          {
            status: 409,
            body: {
              code: "data_deleted",
              message: "相关资料或对话已清空，旧回答已丢弃。请重新开始。",
            },
          },
          requestId,
        );
        return;
      }
      const known =
        error instanceof Error &&
        ("status" in error ||
          [
            "CatalogError",
            "RecommendationError",
            "PlanningError",
            "ReportError",
          ].includes(error.name));
      const e = error as {
        status?: number;
        code?: string;
        message?: string;
        details?: unknown;
      };
      send(
        response,
        {
          status: known ? (e.status ?? 422) : 500,
          body: {
            code: known ? e.code : "internal_error",
            message: known ? e.message : "服务暂时不可用，请稍后重试。",
            details: known ? (e.details ?? null) : null,
          },
        },
        requestId,
      );
    }
  }
  async function handler(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      response.statusCode = 400;
      response.end("Invalid URL");
      return;
    }
    if (url.pathname.startsWith("/api/v1/")) return api(request, response, url);
    if (!config.staticDirectory) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    try {
      const root = resolve(config.staticDirectory);
      const pathname = decodeURIComponent(url.pathname);
      const file = resolve(
        root,
        `.${pathname === "/" ? "/index.html" : pathname}`,
      );
      if (!file.startsWith(root + sep)) throw new Error();
      const extension = extname(file);
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".json": "application/json; charset=utf-8",
      };
      if (!mime[extension]) throw new Error();
      const content = await readFile(file);
      response.setHeader("Content-Type", mime[extension]);
      response.setHeader(
        "Cache-Control",
        extension === ".html" ? "no-cache" : "public, max-age=3600",
      );
      response.end(content);
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  }
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      response.end("Service unavailable");
    });
  });
  return {
    server,
    handler,
    store,
    config,
    close: async () => {
      await research.close();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          store.close();
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
