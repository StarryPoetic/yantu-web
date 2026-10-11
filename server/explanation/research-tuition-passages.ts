import { researchTextCache } from "./research-cache.ts";
/** Keep exact continuous fee clauses; normalized text is only for recognition/deduplication. */
export const normalizedEvidence = researchTextCache((text: string) =>
  text.normalize("NFKC").replace(/\s+/g, ""),
);

export const tuitionMoney =
  /(?<![\d.,])(\d+(?:,\d{3})*(?:\.\d+)?)\s*(万)?\s*元/g;

const cachedTuitionPassages = researchTextCache(function tuitionPassages(
  body: string,
) {
  const parts = [...body.matchAll(/[^。；;\n]+/g)];
  return parts.flatMap((part, index) => {
    const previous = parts[index - 1];
    const heading =
      previous &&
      /[:：]\s*$/.test(previous[0]) &&
      /(?:学术|专业)学位/.test(previous[0]) &&
      /^\s*\n\s*$/.test(
        body.slice(previous.index! + previous[0].length, part.index),
      )
        ? previous
        : undefined;
    const text = normalizedEvidence(part[0]);
    if (!text.includes("学费")) return [];
    if (
      /^(?:[（(][一二三四五六七八九十\d]+[）)]|\d+[.、])?学费(?:[（(]元[^）)]*[）)])?$/.test(
        text,
      )
    )
      return [];
    let end = part.index! + part[0].length;
    if (![...part[0].matchAll(tuitionMoney)].length) {
      const next = parts[index + 1];
      if (
        !next ||
        !/^\s*\n\s*$/.test(body.slice(end, next.index)) ||
        /住宿费|教材费|体检费|杂费|奖学金|助学金/.test(next[0]) ||
        ![...next[0].matchAll(tuitionMoney)].length
      )
        return [];
      end = next.index! + next[0].length;
    }
    const raw = body.slice(heading?.index ?? part.index!, end).trim();
    // A mode change starts its own literal tariff; do not join the two amounts.
    return raw
      .split(/[，,](?=(?:我校|本校|全校|所有)?非?全日制(?:硕士)?研究生)/)
      .filter((quote) =>
        [...quote.matchAll(tuitionMoney)].some((amount) => {
          const labels = [
            ...normalizedEvidence(quote.slice(0, amount.index)).matchAll(
              /学费|住宿费|教材费|体检费|杂费|奖学金|助学金/g,
            ),
          ];
          return labels.at(-1)?.[0] === "学费";
        }),
      );
  });
});

export const tuitionPassages = (body: string) => [
  ...cachedTuitionPassages(body),
];
