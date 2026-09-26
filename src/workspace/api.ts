export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Resource<T> {
  data: T;
  etag: string;
}
interface RequestOptions {
  method?: string;
  body?: unknown;
  etag?: string;
  signal?: AbortSignal;
  token?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}
let csrfToken = "";
let sessionPromise: Promise<Resource<Session>> | null = null;
export interface Session {
  authenticated: boolean;
  csrfToken: string | null;
  user: null | {
    accountId: string;
    username: string;
    role: "student" | "admin";
    adminRoles: string[];
  };
  guest: boolean;
  guestHasData: boolean;
  notice?: string;
  features: { sampleData: boolean; modelEnabled: boolean };
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Resource<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  if (["POST", "DELETE"].includes(method))
    headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();
  if (options.etag) headers["If-Match"] = options.etag;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      signal: options.signal,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      0,
      "network_unavailable",
      "暂时无法连接服务。当前输入仍保留，请检查网络后重试。",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      resetSession();
      window.dispatchEvent(new Event("yantu-session-expired"));
    }
    throw new ApiError(
      response.status,
      data?.code ?? "request_failed",
      data?.message ?? "请求未完成，请稍后重试。",
      data?.details,
    );
  }
  if (!data)
    throw new ApiError(
      503,
      "invalid_response",
      "服务返回格式异常，请确认应用服务已启动。",
    );
  return { data, etag: response.headers.get("ETag") ?? "" };
}

export function ensureSession() {
  if (!sessionPromise)
    sessionPromise = request<Session>("/auth/session")
      .then((result) => {
        csrfToken = result.data.csrfToken ?? "";
        return result;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
  return sessionPromise;
}

export function acceptSession(session: Session) {
  csrfToken = session.csrfToken ?? "";
  sessionPromise = Promise.resolve({ data: session, etag: "" });
}

export function resetSession() {
  csrfToken = "";
  sessionPromise = null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 412)
    return "此记录已在其他页面更新。请先重新读取并核对内容，再保存你的修改。";
  return error instanceof Error ? error.message : "操作未完成，请重试。";
}
