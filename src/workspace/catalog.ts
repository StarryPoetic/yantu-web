import { ApiError, request } from "./api";
import type { Catalog, Program } from "./contracts";

// Every page uses the first response's snapshot. A changed or broken cursor
// never produces a mixed catalog, and unmounted loads cannot keep fetching.
export async function loadCatalog(signal: AbortSignal) {
  const first = await request<Catalog>("/programs", { signal });
  const programs = new Map<string, Program>();
  for (const program of first.data.items ?? first.data.programs ?? [])
    programs.set(program.programId, program);
  const cursors = new Set<string>();
  let cursor = first.data.nextCursor;
  while (cursor) {
    signal.throwIfAborted();
    if (cursors.has(cursor))
      throw new ApiError(
        503,
        "invalid_catalog_cursor",
        "目录分页暂时异常，请重新读取资料。",
      );
    cursors.add(cursor);
    const query = new URLSearchParams({
      catalogVersion: first.data.catalogVersion,
      cursor,
    });
    const next = await request<Catalog>(`/programs?${query}`, { signal });
    signal.throwIfAborted();
    if (next.data.catalogVersion !== first.data.catalogVersion)
      throw new ApiError(
        409,
        "catalog_changed",
        "目录版本在读取过程中变化，请重新读取完整资料。",
      );
    for (const program of next.data.items ?? next.data.programs ?? [])
      programs.set(program.programId, program);
    cursor = next.data.nextCursor;
  }
  signal.throwIfAborted();
  return {
    ...first,
    data: { ...first.data, items: [...programs.values()], nextCursor: null },
  };
}
