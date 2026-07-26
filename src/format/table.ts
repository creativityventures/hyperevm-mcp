import { lit, type Safe } from "./safe.js";

/**
 * Markdown tables, padded so they stay readable even in a client that shows
 * raw text.
 *
 * Cells are `Safe`: the type system, not a convention, is what stops an
 * unsanitised protocol name from reaching this function. Headers are plain
 * strings because they are written here, in the source.
 */

export type Align = "left" | "right";

export function table(headers: string[], rows: Safe[][], align: Align[] = []): Safe {
  if (rows.length === 0) return lit("");

  const widths = headers.map((h, i) => {
    const cellWidth = rows.reduce((max, row) => Math.max(max, (row[i] ?? "").length), 0);
    return Math.max(h.length, cellWidth);
  });

  const pad = (text: string, i: number): string => {
    const width = widths[i] ?? text.length;
    return (align[i] ?? "left") === "right" ? text.padStart(width) : text.padEnd(width);
  };

  const head = `| ${headers.map(pad).join(" | ")} |`;
  const rule = `| ${widths
    .map((w, i) => ((align[i] ?? "left") === "right" ? `${"-".repeat(Math.max(1, w - 1))}:` : "-".repeat(w)))
    .join(" | ")} |`;
  const body = rows.map((row) => `| ${headers.map((_, i) => pad(row[i] ?? "", i)).join(" | ")} |`);

  return lit([head, rule, ...body].join("\n"));
}

/** "Key: value" lines for a single-entity card. Keys are ours, values are not. */
export function facts(pairs: Array<[string, Safe]>): Safe {
  const width = pairs.reduce((max, [k]) => Math.max(max, k.length), 0);
  return lit(pairs.map(([k, v]) => `${`${k}:`.padEnd(width + 1)} ${v}`).join("\n"));
}

/** A titled block. The title is written here; the body is already safe. */
export function section(title: string, body: Safe): Safe {
  return lit(`## ${title}\n\n${body}`);
}

/** A subsection inside a card. */
export function subsection(title: string, body: Safe): Safe {
  return lit(`### ${title}\n\n${body}`);
}
