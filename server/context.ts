import type { IncomingMessage } from "node:http";
import type { Store, Session } from "./store.ts";
import type { AppConfig, AdminIdentity } from "./config.ts";
import type { CatalogState, CatalogSnapshot } from "./catalog/types.ts";
import { getCatalogSnapshot } from "./catalog/index.ts";
import { HttpError } from "./http.ts";

export interface Context {
  request: IncomingMessage;
  path: string;
  method: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  store: Store;
  config: AppConfig;
  session: Session;
  admin?: AdminIdentity;
}
export const publicOwner = "public";
export function catalogState(store: Store): CatalogState {
  return store.get<CatalogState>(publicOwner, "catalog")!.value;
}
export function catalog(store: Store, version?: string): CatalogSnapshot {
  return getCatalogSnapshot(catalogState(store), version);
}
export function program(store: Store, programId: string, version?: string) {
  const snapshot = catalog(store, version);
  const value = snapshot.programs.find((p) => p.programId === programId);
  if (!value)
    throw new HttpError(404, "program_not_found", "招生项目不存在或尚未发布。");
  if (snapshot.withdrawnRevisionIds.includes(value.programRevisionId))
    throw new HttpError(409, "program_withdrawn", "该项目资料已撤回，请刷新。");
  return value;
}
export function required<T>(
  value: T | null,
  message = "记录不存在或无权访问。",
): T {
  if (!value) throw new HttpError(404, "not_found", message);
  return value;
}
