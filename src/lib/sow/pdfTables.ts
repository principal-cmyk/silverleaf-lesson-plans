/**
 * PDF → SOW tables (AI Studio v2) — PURE: no pdfjs, no DB, no `ai`.
 *
 * A scheme exported to PDF loses its table structure: pdfjs hands back a flat
 * list of positioned text fragments per page. This module rebuilds the
 * Silverleaf week tables from those coordinates so the PDF path can feed the
 * same {@link import("./parse").parseSowTables} core as docx and CSV.
 *
 * The STANDARD template is a fixed-column landscape table, which makes the
 * geometry reliable:
 *
 *   title line   — one wide fragment per week section, e.g.
 *                  "SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A | WEEK 1: …"
 *   header band  — a line whose fragments start with the column labels
 *                  ("Lesson", "Specific", "Main Activity", …); their x
 *                  positions define the column boundaries for every page
 *                  that follows, and the wrapped label lines beneath belong
 *                  to the band until the first lesson code appears
 *   lesson rows  — each starts with a lesson code in column 0 ("BL1", "1",
 *                  "MT2", "ET1"); everything below it, on this page and any
 *                  continuation page, belongs to that row until the next code
 *
 * Two rendering artefacts are repaired here rather than upstream:
 *  - fragments on one visual line are re-joined by x order, and lines by
 *    reading order, per column;
 *  - a word too long for its column is wrapped mid-word with no hyphen
 *    ("understandin" / "g of the"). {@link repairSplitWords} re-joins such
 *    pairs using the document's own vocabulary as the dictionary.
 *
 * @see ./pdf.ts — the pdfjs wrapper that produces {@link PdfPageText}.
 * @see ./parse.ts — consumes the tables this module returns.
 */

/** One positioned text fragment, in PDF user units (origin bottom-left). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** The text of one page. */
export interface PdfPageText {
  width: number;
  height: number;
  items: PdfTextItem[];
}

/** What the reconstruction hands to the table parser. */
export interface ReconstructedSow {
  /** One table per week section: [titleRow, headerRow, ...lessonRows]. */
  tables: string[][][];
  /** Title lines, for metadata hints (grade / subject / term). */
  titleHints: string[];
}

/** A visual line: fragments sharing a baseline, in x order. */
interface Line {
  y: number;
  frags: PdfTextItem[];
}

/** Fragments on the same baseline may differ by this many units. */
const LINE_TOLERANCE = 2.5;

/**
 * Opening words of the SOW column labels — the header-band anchors. Prefix
 * matches on purpose: "Main Activity" must match "main activit" (a `\b`
 * there would fail before the "y"), and "Misconception" / "Misconceptions"
 * both anchor the same column.
 *
 * The second group is the Kiswahili template's labels (Kipindi, Umahiri
 * Mahususi, Shughuli ya/za Ujifunzaji, Lengo la Somo, Maarifa na Stadi,
 * Tathmini / Ushahidi, Dhana Potofu, Utofautishaji / Msaada, Zana, Tafakari).
 * "Kipind" has no "i": the narrow first column wraps it as "Kipind" / "i".
 */
const HEADER_START =
  /^(lesson|specific|main activit|knowledge|assessment|learning activit|sample|misconception|differentiation|resources?|reflection|remarks?|week|kipind|umahiri|shughuli|lengo|maarifa|tathmini|dhana|utofautishaji|zana|tafakari|wiki)/i;

/** A lesson code opening a row: "1", "BL1", "MT2", "ET1", "L009", "ER1". */
const LESSON_CODE = /^(?:[A-Z]{1,3}\s?\d{1,3}|\d{1,3})$/;

/** Group a page's fragments into baseline-sorted lines (top of page first). */
export function groupLines(items: PdfTextItem[]): Line[] {
  const sorted = items
    .filter((it) => it.str.trim().length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= LINE_TOLERANCE) {
      last.frags.push(it);
    } else {
      lines.push({ y: it.y, frags: [it] });
    }
  }
  for (const line of lines) line.frags.sort((a, b) => a.x - b.x);
  return lines;
}

/** Joined text of a line. */
function lineText(line: Line): string {
  return line.frags.map((f) => f.str.trim()).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A week-section title: names a week, mentions the scheme/grade, and is set
 * as ONE wide fragment — in English ("… GRADE 4 … TERM 1A | WEEK 1: …") or
 * Kiswahili ("… DARASA LA 5 MUHULA WA 1A | WIKI 1: …"). The width test is on a single fragment, not the
 * line's total: a lesson row's baseline can hold eleven narrow cell
 * fragments that together span the page and happen to mention "Week 3".
 */
function isTitleLine(line: Line, pageWidth: number): boolean {
  const widest = line.frags.reduce((w, f) => Math.max(w, f.width), 0);
  if (widest < pageWidth * 0.3) return false;
  const text = lineText(line);
  return (
    /\b(week|wiki)\s*[:\-–—]?\s*\d+/i.test(text) &&
    /\b(grade|term|academy|scheme|darasa|muhula)\b/i.test(text)
  );
}

/**
 * The header-band anchor line: at least four fragments that start a column
 * label. Returns the anchor fragments (one per column) or null.
 */
function headerAnchors(line: Line): PdfTextItem[] | null {
  const anchors = line.frags.filter((f) => HEADER_START.test(f.str.trim()));
  return anchors.length >= 4 ? anchors : null;
}

/**
 * Column boundaries from the header anchors, refined against the data.
 *
 * Header labels are centred, so an anchor sits a few units right of where
 * the column's text actually begins; the data is left-aligned, so the most
 * common fragment x just left of each anchor IS the column's left edge. Each
 * boundary is set a hair left of that edge. Anchoring boundaries on the left
 * edge (rather than midway between columns) matters for wide columns: a bold
 * run inside a Learning Activities line starts mid-column, and a midpoint
 * boundary would hand it to Misconceptions.
 */
function columnEdges(anchors: PdfTextItem[], items: PdfTextItem[]): number[] {
  const xs = anchors.map((a) => a.x).sort((a, b) => a - b);
  const starts = items.map((it) => Math.round(it.x));

  const edges = xs.map((anchorX) => {
    const counts = new Map<number, number>();
    for (const x of starts) {
      if (x >= anchorX - 25 && x <= anchorX + 6) counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    let best = Math.round(anchorX);
    let bestCount = 0;
    for (const [x, n] of counts) {
      if (n > bestCount || (n === bestCount && x < best)) {
        best = x;
        bestCount = n;
      }
    }
    return best;
  });

  return edges.map((edge, i) => (i === 0 ? 0 : edge - 3));
}

/** Index of the column a fragment belongs to. */
function columnOf(edges: number[], x: number): number {
  let col = 0;
  for (let i = 1; i < edges.length; i += 1) {
    if (x >= edges[i]!) col = i;
  }
  return col;
}

/* ── split-word repair ─────────────────────────────────────────────────── */

/** Lower-case a token with its punctuation stripped, or "" if nothing is left. */
function bareToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * The document's vocabulary: every token that appeared on a CELL line with
 * at least two tokens — such lines wrapped at a word boundary, so their
 * tokens are whole words. Used as the dictionary for {@link repairSplitWords}.
 *
 * The lines must be per-column cell lines, never whole page lines: a page
 * baseline carries fragments from every column, so "Competenc" would count
 * as a word merely because "(By the end of" sits beside it.
 */
export function buildVocabulary(lines: string[]): Set<string> {
  const vocab = new Set<string>();
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    for (const t of tokens) {
      const bare = bareToken(t);
      if (bare.length >= 2) vocab.add(bare);
    }
  }
  return vocab;
}

/**
 * Join a column's wrapped lines into one cell, re-attaching words the
 * renderer split across lines. A split shows as a line holding a single
 * unknown token ("understandin") followed by a line opening with a lower-case
 * fragment ("g of the"); we merge when the pieces make a known word, or when
 * the fragment is a lone letter other than "a" (the one lower-case letter
 * that is a word). Two-letter openers ("an", "of", "on") are real words far
 * more often than fragments, so they merge only on a vocabulary hit.
 * Everything else is joined with a space, as any other wrapped line.
 */
export function repairSplitWords(lines: string[], vocab: Set<string>): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i]!.trim();
    const next = lines[i + 1]?.trim();
    const nextFirst = next?.split(/\s+/)[0] ?? "";
    const curBare = bareToken(cur);
    const nextBare = bareToken(nextFirst);
    const isSplit =
      next !== undefined &&
      /^[A-Za-z]+$/.test(cur) &&
      curBare.length >= 3 &&
      !vocab.has(curBare) &&
      /^[a-z]/.test(nextFirst) &&
      nextBare.length > 0 &&
      (vocab.has(curBare + nextBare) || (nextBare.length === 1 && nextBare !== "a"));

    if (isSplit) {
      // Glue the fragment back on and carry the rest of the next line along.
      const rest = next.slice(nextFirst.length).trim();
      out.push(`${cur}${nextFirst}${rest ? ` ${rest}` : ""}`);
      i += 2;
    } else {
      out.push(cur);
      i += 1;
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/* ── reconstruction ────────────────────────────────────────────────────── */

/** A lesson row under construction: wrapped lines per column. */
interface RowBuilder {
  cells: string[][];
}

/** A week section before split-word repair: cells still hold wrapped lines. */
interface SectionBuilder {
  title: string;
  header: string[][];
  rows: RowBuilder[];
}

/**
 * Rebuild the week tables of a STANDARD-template scheme PDF from its
 * positioned text. See the module comment for the geometry it relies on.
 *
 * Two passes: first every fragment is placed into its section, row and
 * column (pages that carry no header band continue the last known column
 * layout, which is how a lesson row that runs over several pages stays
 * whole); then the per-column lines seed the vocabulary and each cell is
 * joined with split-word repair.
 */
export function reconstructSowTables(pages: PdfPageText[]): ReconstructedSow {
  const sections: SectionBuilder[] = [];
  const titleHints: string[] = [];
  const allItems = pages.flatMap((p) => p.items);

  let edges: number[] | null = null;
  let columnCount = 0;
  let title = "";
  let headerCells: string[][] | null = null; // wrapped lines per column
  /** The most recent header, reused when a title is not followed by one. */
  let lastHeader: string[][] | null = null;
  let inHeaderBand = false;
  let rows: RowBuilder[] = [];
  let current: RowBuilder | null = null;

  const finishRow = () => {
    if (current) rows.push(current);
    current = null;
  };
  const finishSection = () => {
    finishRow();
    if (headerCells && rows.length > 0) sections.push({ title, header: headerCells, rows });
    rows = [];
    headerCells = null;
    inHeaderBand = false;
  };
  const newRow = (): RowBuilder => ({
    cells: Array.from({ length: columnCount }, () => []),
  });

  pages.forEach((page) => {
    for (const line of groupLines(page.items)) {
      // A new week section: close the previous one, remember the title.
      if (isTitleLine(line, page.width)) {
        finishSection();
        title = lineText(line);
        titleHints.push(title);
        continue;
      }

      // A header band opens: recompute the column layout from its anchors.
      const anchors = headerAnchors(line);
      if (anchors) {
        finishRow();
        edges = columnEdges(anchors, allItems);
        columnCount = edges.length;
        headerCells = Array.from({ length: columnCount }, () => []);
        lastHeader = headerCells;
        inHeaderBand = true;
        rows = [];
        placeLine(line, edges, headerCells);
        continue;
      }

      // Nothing to place against until a header has been seen.
      if (!edges) continue;

      const colZero = line.frags
        .filter((f) => columnOf(edges!, f.x) === 0)
        .map((f) => f.str.trim());
      // A lesson code opens a row — unless it is the number of a "Week" (or
      // Kiswahili "Wiki") label that wrapped onto its own line ("57 (L001)" /
      // "Week" / "10").
      const pendingWeek = /^(week|wiki)$/i.test(current?.cells[0]?.at(-1) ?? "");
      const opensRow = !pendingWeek && colZero.some((c) => LESSON_CODE.test(c));

      if (inHeaderBand) {
        if (!opensRow) {
          placeLine(line, edges, headerCells!);
          continue;
        }
        inHeaderBand = false;
      }

      // A title with no header of its own (a page header repeating the week
      // title, say) keeps the previous column labels.
      if (!headerCells) {
        if (!lastHeader) continue;
        headerCells = lastHeader.map((lines) => [...lines]);
      }

      if (opensRow) {
        finishRow();
        current = newRow();
      }
      if (!current) current = newRow();
      placeLine(line, edges, current.cells);
    }
  });
  finishSection();

  // Second pass: vocabulary from the per-column cell lines, then repair.
  const cellLines = sections.flatMap((s) => [
    ...s.header.flat(),
    ...s.rows.flatMap((r) => r.cells.flat()),
  ]);
  const vocab = buildVocabulary(cellLines);
  const tables = sections.map((s) => [
    [s.title],
    s.header.map((lines) => repairSplitWords(lines, vocab)),
    ...s.rows.map((r) => r.cells.map((lines) => repairSplitWords(lines, vocab))),
  ]);

  return { tables, titleHints };
}

/**
 * Drop a line's fragments into their columns. Fragments that share a column
 * on one baseline are one wrapped line of that cell, joined by x order.
 */
function placeLine(line: Line, edges: number[], cells: string[][]): void {
  const byCol = new Map<number, string[]>();
  for (const f of line.frags) {
    const col = columnOf(edges, f.x);
    const bucket = byCol.get(col) ?? [];
    bucket.push(f.str.trim());
    byCol.set(col, bucket);
  }
  for (const [col, parts] of byCol) {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (text && cells[col]) cells[col]!.push(text);
  }
}
