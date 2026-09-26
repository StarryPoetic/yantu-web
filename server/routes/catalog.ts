import { catalog, program } from "../context.ts";
import type { Context } from "../context.ts";
import type { Reply } from "../http.ts";
import { HttpError, canonical, digest } from "../http.ts";
import { searchCities } from "../../src/cities.ts";

export function catalogRoutes(c: Context): Reply | undefined {
  if (c.method !== "GET") return;
  if (c.path === "/cities")
    return {
      body: {
        items: searchCities(c.query.get("q") ?? ""),
        sourceVersion: "china-division-2.7.0-offline",
        notice: "离线城市目录；未匹配城市可保存原文。",
        nextCursor: null,
      },
    };
  if (c.path === "/programs" || c.path === "/major-directions") {
    const snapshot = catalog(
      c.store,
      c.query.get("catalogVersion") ?? undefined,
    );
    let items = snapshot.programs;
    const q = (c.query.get("q") ?? "").toLocaleLowerCase();
    if (q)
      items = items.filter((p) =>
        `${p.display.institutionName} ${p.display.majorName} ${p.display.collegeName} ${p.display.city}`
          .toLocaleLowerCase()
          .includes(q),
      );
    const year = c.query.get("targetAdmissionYear");
    if (year)
      items = items.filter(
        (p) => String(p.identity.targetAdmissionYear) === year,
      );
    const city = c.query.get("city");
    if (city) items = items.filter((p) => p.display.city === city);
    const major = c.query.get("majorDirectionId");
    if (major) items = items.filter((p) => p.majorDirectionIds.includes(major));
    const institution = c.query.get("institutionId");
    if (institution)
      items = items.filter((p) => p.identity.institutionId === institution);
    const degree = c.query.get("degreeType");
    if (degree) items = items.filter((p) => p.identity.degreeType === degree);
    items = items.filter(
      (p) => !snapshot.withdrawnRevisionIds.includes(p.programRevisionId),
    );
    if (c.path === "/major-directions")
      return {
        body: {
          items: [...new Set(items.flatMap((p) => p.majorDirectionIds))].map(
            (majorDirectionId) => ({
              majorDirectionId,
              name: items.find((p) =>
                p.majorDirectionIds.includes(majorDirectionId),
              )!.display.majorName,
              programIds: items
                .filter((p) => p.majorDirectionIds.includes(majorDirectionId))
                .map((p) => p.programId),
            }),
          ),
          catalogVersion: snapshot.catalogVersion,
          coverage: snapshot.coverage,
          nextCursor: null,
        },
      };
    const filters = [...c.query.entries()].filter(
      ([key]) => !["cursor", "limit", "catalogVersion"].includes(key),
    );
    const fingerprint = digest(
      canonical({ filters, version: snapshot.catalogVersion }),
    );
    let offset = 0;
    if (c.query.has("cursor")) {
      try {
        const cursor = JSON.parse(
          Buffer.from(c.query.get("cursor")!, "base64url").toString(),
        );
        if (
          cursor.fingerprint !== fingerprint ||
          !Number.isSafeInteger(cursor.offset) ||
          cursor.offset < 0
        )
          throw new Error();
        offset = cursor.offset;
      } catch {
        throw new HttpError(
          400,
          "invalid_cursor",
          "分页条件或目录版本已变化，请从第一页重新查询。",
        );
      }
    }
    const limit = Math.min(
      100,
      Math.max(1, Number(c.query.get("limit") ?? 100)),
    );
    if (!Number.isSafeInteger(limit))
      throw new HttpError(422, "invalid_limit", "分页大小不正确。");
    return {
      body: {
        items: items.slice(offset, offset + limit),
        catalogVersion: snapshot.catalogVersion,
        coverage: snapshot.coverage,
        mode: snapshot.mode,
        total: items.length,
        nextCursor:
          offset + limit < items.length
            ? Buffer.from(
                JSON.stringify({ offset: offset + limit, fingerprint }),
              ).toString("base64url")
            : null,
      },
    };
  }
  const match = /^\/programs\/([^/]+)$/.exec(c.path);
  if (match) {
    const snapshot = catalog(
      c.store,
      c.query.get("catalogVersion") ?? undefined,
    );
    const value = program(c.store, match[1], snapshot.catalogVersion);
    return {
      body: {
        ...value,
        catalogVersion: snapshot.catalogVersion,
        sources: snapshot.sources.filter((s) =>
          value.sourceIds.includes(s.sourceId),
        ),
      },
    };
  }
}
