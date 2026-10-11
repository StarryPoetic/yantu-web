/** Expand only explicit HTML table spans. Never infer a missing cell from a nearby row. */
export function expandResearchTableSpans(html: string): string {
  return html.replace(
    /<table\b[^>]*>((?:(?!<table\b)[^])*?)<\/table\s*>/gi,
    (table, body: string) => {
      if (!/rowspan\s*=/i.test(body) || /<table\b/i.test(body)) return table;
      const spans = new Map<number, { html: string; left: number }>();
      let valid = true;
      const expanded = body.replace(
        /<tr\b[^>]*>([^]*?)<\/tr\s*>/gi,
        (_tr, row: string) => {
          let column = 0;
          const cells: string[] = [];
          const inherited = () => {
            while (spans.has(column)) {
              const span = spans.get(column)!;
              cells.push(`<td>${span.html}</td>`);
              if (--span.left === 0) spans.delete(column);
              column++;
            }
          };
          for (const cell of row.matchAll(
            /<(?:td|th)\b([^>]*)>([^]*?)<\/(?:td|th)\s*>/gi,
          )) {
            inherited();
            const down = Number(
              cell[1].match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1,
            );
            const across = Number(
              cell[1].match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1,
            );
            if (
              down < 1 ||
              down > 1000 ||
              across < 1 ||
              across > 64 ||
              column + across > 64
            ) {
              valid = false;
              return _tr;
            }
            for (let i = 0; i < across; i++) {
              const content = i === 0 ? cell[2] : "";
              cells.push(`<td>${content}</td>`);
              if (down > 1)
                spans.set(column, { html: content, left: down - 1 });
              column++;
            }
          }
          inherited();
          return `<tr>${cells.join("")}</tr>`;
        },
      );
      return valid && expanded.length <= 1000000
        ? `<table>${expanded}</table>`
        : table;
    },
  );
}

/** Older cached HTML extraction put each physical cell on its own line.
 * Recover only blank-delimited runs of pipe-terminated cells; quotes stay literal. */
export function researchTextRows(text: string) {
  const lines = text.split("\n");
  const rows: { line: string; cells?: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /^[^|\n]+\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^[^|\n]+\|\s*$/.test(lines[i + 1])
    ) {
      const block = [line];
      while (i + 1 < lines.length && /^[^|\n]+\|\s*$/.test(lines[i + 1]))
        block.push(lines[++i]);
      rows.push({
        line: block.join("\n"),
        cells: block.map((s) => s.replace(/\|\s*$/, "").trim()),
      });
    } else rows.push({ line });
  }
  return rows;
}
