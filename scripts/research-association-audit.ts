import {
  chainDocumentYear,
  resolveNationalLineChain,
  type ChainPassage,
  type NationalLineChain,
} from "../server/explanation/research-national-line-chain.ts";
import { safeSourceYear } from "../server/explanation/research-years.ts";
import { schoolRegistry } from "../server/schools/index.ts";
import type { WebSource } from "../server/explanation/web.ts";

type Target = {
  institutionName: string;
  majorCode?: string;
  collegeName?: string;
};
export function nationalAssociationAudit(
  targets: Target[],
  sources: WebSource[],
) {
  return targets.flatMap((target) =>
    [2024, 2025, 2026].map((year) => {
      const schoolSources = sources.filter(
        (s) =>
          s.kind === "official_page" &&
          schoolRegistry.byHost(new URL(s.url).hostname)?.name ===
            target.institutionName &&
          (chainDocumentYear(s) ?? safeSourceYear(s)) === year,
      );
      const input: NationalLineChain = {
        schoolName: target.institutionName,
        collegeName: target.collegeName ?? "",
        majorCode: target.majorCode ?? "",
        year,
      };
      const candidates: ChainPassage[] = [];
      for (const source of schoolSources) {
        for (const quote of source.excerpt.match(
          /[^。\n]*(?:国家线|A类考生|A类地区|A类分数)[^。\n]*/g,
        ) ?? []) {
          if (/复试|分数线/.test(quote) && quote.length < 600)
            candidates.push({ source, quote });
          if (
            target.collegeName &&
            source.title.includes(target.collegeName) &&
            /复试分数线参照.*（A类考生国家线）执行/.test(quote)
          )
            input.applicability = { source, quote };
        }
        const quote = source.excerpt
          .split("\n")
          .find(
            (line) =>
              target.collegeName &&
              line.includes(target.collegeName) &&
              line.includes(target.majorCode ?? "missing") &&
              line.includes("|"),
          );
        if (!quote) continue;
        const prior = source.excerpt.slice(0, source.excerpt.indexOf(quote));
        const heading = [
          ...prior.matchAll(
            /（[一二三四五]）[^\n]*(?:学术学位|专业学位)[^\n]*/g,
          ),
        ].at(-1)?.[0];
        if (
          !heading ||
          !/全日制专业学位/.test(heading) ||
          /非全日制/.test(heading)
        )
          continue;
        input.identity = { source, quote };
        input.degree = { source, quote: heading };
      }
      const national = sources.find(
        (s) =>
          s.kind === "authority_page" &&
          new URL(s.url).hostname === "yz.chsi.com.cn" &&
          chainDocumentYear(s) === year,
      );
      if (national) {
        const lines = national.excerpt.split("\n");
        const put = (
          key:
            | "nationalHeader"
            | "nationalColumns"
            | "nationalRow"
            | "region"
            | "exceptions",
          quote?: string,
        ) => {
          if (quote) input[key] = { source: national, quote };
        };
        put(
          "nationalHeader",
          lines.find(
            (line) => line.startsWith("学科门类 |") && line.includes("A类考生"),
          ),
        );
        put(
          "nationalColumns",
          lines.find(
            (line) =>
              line.startsWith("学科门类 |") && line.includes("满分=100分"),
          ),
        );
        put(
          "nationalRow",
          lines
            .find((line) => /^工学\[08\].*其他学科专业/.test(line))
            ?.split("①")[0]
            .trimEnd(),
        );
        put("region", national.excerpt.match(/①A类考生：[^。]+。/)?.[0]);
        put(
          "exceptions",
          national.excerpt.match(/[③⑤]工学照顾专业[^。]+。/)?.[0],
        );
      }
      const result = resolveNationalLineChain(input);
      const passages = Object.entries(input).flatMap(([role, value]) =>
        value && typeof value === "object" ? [{ role, ...value }] : [],
      );
      return {
        schoolName: target.institutionName,
        collegeName: target.collegeName ?? null,
        majorCode: target.majorCode,
        year,
        ...result,
        passages,
        candidates,
      };
    }),
  );
}
