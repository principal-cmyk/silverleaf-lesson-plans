/**
 * Scheme-of-Work parsing (AI Studio v2) — PURE: no DB, no network, no `ai`.
 *
 * Turns an uploaded scheme (docx, PDF or CSV) into a {@link ParsedSow}: the
 * scheme header (metadata + the structured UbD {@link SchemeHeaderContext})
 * plus one {@link ParsedSowRow} per lesson, with cells mapped to the 11
 * Silverleaf SOW columns by tolerant header-keyword matching (column names
 * drift across templates, so we match on regex, not exact strings).
 *
 * Every source funnels into one core, {@link parseSowTables}: a list of 2-D
 * cell tables. The docx path gets its tables from mammoth's HTML; the PDF
 * path rebuilds them from text coordinates (`./pdfTables.ts`); CSV is a single
 * headed table. Tables are classified by STRUCTURE, not by position, because
 * the school's templates disagree about layout:
 *
 *   revised UbD docx — a metadata grid, DESIRED RESULTS, ACCEPTABLE EVIDENCE
 *                      and an assessment plan, then one table per week whose
 *                      row 0 reads "Week N: title" and row 1 is the headers;
 *   STANDARD docx/PDF — one table per week whose row 0 is a title line like
 *                      "SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A |
 *                      WEEK 1: …" (the only place grade/subject/term appear),
 *                      row 1 the headers, and a lesson cell reading
 *                      "1 (L001) Week 1" — there is no metadata grid at all.
 *
 * A table is a week table whenever one of its first rows is a recognisable
 * column-header row; that test runs BEFORE the metadata rule, since a STANDARD
 * title line mentions "grade" and "term" and would otherwise be mistaken for a
 * metadata grid (which is exactly how those files used to parse to 0 rows).
 * Real files are also messy (duplicate week sets, empty `Week:` templates), so
 * week tables are de-duplicated: empties dropped, the richest variant kept per
 * week number.
 *
 * Only `parseSowDocx` touches a third-party lib (`mammoth`, to get HTML); table
 * extraction and all field mapping are dependency-free string/regex work exposed
 * via {@link parseSowHtml} / {@link parseSowTables} so the logic is
 * unit-testable without any I/O.
 *
 * @see ../db/schema/sowLessons.ts — the columns the rows map onto.
 * @see ./types.ts — the {@link SchemeHeaderContext} shape.
 * @see ./pdfTables.ts — coordinate → table reconstruction for PDFs.
 * @see ./aiExtract.ts — the model-backed fallback when no rule matches.
 */
import mammoth from "mammoth";
import Papa from "papaparse";

import {
  emptySchemeHeaderContext,
  type SchemeHeaderContext,
} from "./types";

/** One parsed scheme row, mapped to the 11 SOW columns (all optional). */
export interface ParsedSowRow {
  week?: number;
  lessonNumber?: string;
  specificCompetence?: string;
  mainActivity?: string;
  lessonObjective?: string;
  knowledgeAndSkills?: string;
  assessmentEvidence?: string;
  learningActivities?: string;
  misconceptions?: string;
  differentiationSupport?: string;
  resources?: string;
  reflection?: string;
  /** Every detected cell keyed by its header label, for provenance. */
  rawCells: Record<string, string>;
}

/** Scheme-level metadata parsed from the docx metadata grid. */
export interface ParsedSowMeta {
  title?: string;
  grade?: string;
  subject?: string;
  term?: string;
  year?: string;
  mainCompetence?: string;
  weeksCount?: number;
  lessonsPerWeek?: number;
  lessonDurationMins?: number;
  totalLessons?: string;
}

/**
 * Which stage produced the rows. `rules` is the deterministic keyword mapper
 * (free, offline); `ai` is the model-backed fallback in `./aiExtract.ts`, used
 * only when the rules found no rows. Surfaced in the upload preview so an
 * admin knows whether to double-check the mapping before saving.
 */
export type SowParser = "rules" | "ai";

/** Provenance stats for the upload preview. */
export interface ParsedSowStats {
  weekTablesKept: number;
  weekTablesDropped: number;
  /** Which stage produced `rows` (see {@link SowParser}). */
  parser: SowParser;
}

/** A parsed scheme: metadata + structured UbD header + the lesson rows. */
export interface ParsedSow {
  scheme: ParsedSowMeta;
  headerContext: SchemeHeaderContext;
  rows: ParsedSowRow[];
  stats: ParsedSowStats;
}

/** The mappable target fields (everything on a row except week/raw). */
type MappableField = Exclude<
  keyof ParsedSowRow,
  "week" | "lessonNumber" | "rawCells"
>;

/**
 * Ordered header → field rules. Order matters: more specific patterns first so,
 * e.g., "learning activities" / "sample lesson activities" is not stolen by the
 * generic main-activity rule, and "Lesson Objective" is not stolen by the bare
 * "lesson" rule.
 */
const FIELD_RULES: ReadonlyArray<{
  field: MappableField | "lessonNumber" | "week";
  re: RegExp;
}> = [
  { field: "specificCompetence", re: /specific competence/i },
  { field: "lessonObjective", re: /objective/i },
  { field: "knowledgeAndSkills", re: /knowledge|skills?/i },
  { field: "assessmentEvidence", re: /assessment|evidence/i },
  { field: "learningActivities", re: /learning activit|sample.*activit/i },
  { field: "mainActivity", re: /main activit/i },
  { field: "misconceptions", re: /misconception/i },
  { field: "differentiationSupport", re: /differen/i },
  { field: "resources", re: /resource/i },
  { field: "reflection", re: /reflection|remark/i },
  { field: "lessonNumber", re: /lesson/i },
  { field: "week", re: /week|^wk\b/i },
];

/** Collapse whitespace, decode the few entities mammoth/CSV emit, trim. */
function cleanCell(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map a header label to a SOW field. Returns the first matching rule's field,
 * or null if nothing matches (the cell still survives in `rawCells`).
 */
function fieldForHeader(
  header: string,
): (typeof FIELD_RULES)[number]["field"] | null {
  for (const rule of FIELD_RULES) {
    if (rule.re.test(header)) return rule.field;
  }
  return null;
}

/**
 * A header row is one whose short cells carry at least one CORE lesson-column
 * label (competence / objective / activities) plus one more SOW label.
 *
 * Two guards keep other rows out. Short cells: a lesson's prose easily
 * mentions "objective" or "activity", but it runs to hundreds of characters.
 * A core label: the assessment-plan table's title row reads "Formative
 * Assessments … | Summative Assessments …" — two assessment-ish cells and
 * not a lesson header, so "assessment" alone must never be enough.
 */
export function looksLikeHeaderRow(cells: string[]): boolean {
  const CORE = /specific competence|lesson objective|main activit|learning activit|sample.*activit/i;
  const OTHER = /knowledge|assessment|misconception|differen|resource|reflection|remark|^lesson$|^week$/i;
  const short = cells.map((c) => c.trim()).filter((c) => c && c.length <= 120);
  const core = short.filter((c) => CORE.test(c)).length;
  const other = short.filter((c) => !CORE.test(c) && OTHER.test(c)).length;
  return core >= 1 && core + other >= 2;
}

/** Parse "Week 3", "wk 3", "3" → 3; non-numeric → undefined. */
function parseWeek(value: string): number | undefined {
  const m = value.match(/(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Pull the week number out of a section title that names it, e.g.
 * "Week 3: Roman numerals", "WEEK 1 — Baseline". Unlike {@link parseWeek} it
 * needs the word "week", so a title like "SILVERLEAF ACADEMY — GRADE 4 …"
 * cannot yield 4 as the week.
 */
function parseWeekFromTitle(value: string): number | undefined {
  const m = value.match(/\bweek\s*[:\-–—]?\s*(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

/** What a STANDARD-template title line can tell us about the scheme. */
export interface TitleLineMeta {
  grade?: string;
  subject?: string;
  term?: string;
  week?: number;
}

/**
 * Read scheme metadata from a STANDARD-template title line such as
 * `SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A | WEEK 1: BASELINE …`.
 * Every field is optional; a line naming only the week still yields the week.
 *
 * The subject is whatever sits between "GRADE n" and "TERM", title-cased so
 * "MATHEMATICS" becomes "Mathematics" (the naming layer TitleCases it again
 * into one token; the display label just needs to look human).
 */
export function parseTitleLine(text: string): TitleLineMeta {
  const meta: TitleLineMeta = {};
  const clean = cleanCell(text);

  // "GRADE 4 MATHEMATICS TERM 1A …" — the STANDARD week title.
  const gradeSubjectTerm = clean.match(
    /\bgrade\s*(\d+)\s*[:\-–—]?\s*(.*?)\s*\bterm\s*([12]\s*[ab])\b/i,
  );
  // "Grade 4 Science Schemes of Work 2026" — a document heading.
  const gradeSubjectScheme = clean.match(
    /\bgrade\s*(\d+)\s*[:\-–—]?\s*(.+?)\s*\bschemes?\s+of\s+work\b/i,
  );
  const hit = gradeSubjectTerm ?? gradeSubjectScheme;
  if (hit) {
    meta.grade = `Grade ${hit[1]}`;
    const subject = (hit[2] ?? "").replace(/[|:\-–—]+$/g, "").trim();
    if (subject) meta.subject = titleCaseWords(subject);
  } else {
    const grade = clean.match(/\bgrade\s*(\d+)\b/i);
    if (grade) meta.grade = `Grade ${grade[1]}`;
  }
  const term = clean.match(/\bterm\s*([12]\s*[ab])\b/i);
  if (term) meta.term = (term[1] ?? "").replace(/\s+/g, "").toUpperCase();

  const week = parseWeekFromTitle(clean);
  if (week !== undefined) meta.week = week;
  return meta;
}

/** "HEALTH AND ENVIRONMENT" → "Health and Environment" (small words stay lower). */
function titleCaseWords(s: string): string {
  const SMALL = new Set(["and", "of", "the", "in", "for", "&"]);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Split a STANDARD lesson cell such as `1 (L001) Week 1`, `BL1 (BL1) Week 1`
 * or `MT2 (MT2) Week 7` into the lesson label and the week it names. The
 * label keeps the code in parentheses (teachers refer to "L009"); only the
 * trailing "Week N" is stripped, because the week has its own column.
 */
export function splitLessonCell(value: string): { lessonNumber: string; week?: number } {
  const clean = cleanCell(value);
  const week = parseWeekFromTitle(clean);
  const lessonNumber = clean.replace(/\bweek\s*[:\-–—]?\s*\d+\b/i, "").trim();
  return { lessonNumber: lessonNumber || clean, week };
}

/** First run of digits in a string → int, else undefined. */
function firstInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}

/**
 * Build a {@link ParsedSowRow} from a header→cell pairing. Shared by the docx
 * and CSV paths so both map identically.
 */
function rowFromPairs(pairs: Array<{ header: string; value: string }>): ParsedSowRow {
  const row: ParsedSowRow = { rawCells: {} };

  for (const { header, value } of pairs) {
    const cleanHeader = cleanCell(header);
    const cleanValue = cleanCell(value);
    if (!cleanHeader && !cleanValue) continue;
    if (cleanHeader) row.rawCells[cleanHeader] = cleanValue;

    const field = fieldForHeader(cleanHeader);
    if (!field || !cleanValue) continue;

    if (field === "week") {
      if (row.week === undefined) row.week = parseWeek(cleanValue);
    } else if (field === "lessonNumber") {
      if (row.lessonNumber === undefined) {
        // A STANDARD lesson cell carries the week too ("1 (L001) Week 1").
        const { lessonNumber, week } = splitLessonCell(cleanValue);
        row.lessonNumber = lessonNumber;
        if (row.week === undefined && week !== undefined) row.week = week;
      }
    } else if (row[field] === undefined) {
      row[field] = cleanValue;
    }
  }

  return row;
}

/** Count the mapped (non-raw) fields a row carries — used to rank duplicates. */
function mappedFieldCount(row: ParsedSowRow): number {
  const { rawCells, week, ...mapped } = row;
  void rawCells;
  void week;
  return Object.values(mapped).filter((v) => v !== undefined && v !== "").length;
}

/** True when a row carries no mapped data (only empties) — skip it. */
function isEmptyRow(row: ParsedSowRow): boolean {
  const { rawCells, ...mapped } = row;
  const hasMapped = Object.values(mapped).some((v) => v !== undefined);
  if (hasMapped) return false;
  // Or any non-empty raw cell value.
  return !Object.values(rawCells).some((v) => v.length > 0);
}

/**
 * True for a row that is not a lesson at all: a template leftover carrying a
 * single stray cell (e.g. the "Baseline Assessments" placeholder rows in the
 * revised Arithmetic scheme, where every other cell is blank). A real lesson
 * either names itself (lesson number) or fills at least two content columns.
 */
function isPlaceholderRow(row: ParsedSowRow): boolean {
  if (row.lessonNumber) return false;
  const { rawCells, week, lessonNumber, ...content } = row;
  void rawCells;
  void week;
  void lessonNumber;
  const filled = Object.values(content).filter((v) => v !== undefined && v !== "").length;
  return filled < 2;
}

/* ── docx table extraction ─────────────────────────────────────────────── */

/**
 * Extract EVERY `<table>` in an HTML fragment as a list of 2-D row×cell arrays.
 * Dependency-free: a forgiving regex/string scan that strips tags inside each
 * cell. Good enough for mammoth's flat table HTML.
 */
function extractAllTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const table = tableMatch[0];
    const rows: string[][] = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(table)) !== null) {
      const rowHtml = rowMatch[0];
      const cells: string[] = [];
      const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        const inner = cellMatch[2] ?? "";
        const text = inner
          .replace(/<\/(p|div|li|br)\s*>/gi, " ")
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<[^>]+>/g, "");
        cells.push(text);
      }
      if (cells.length > 0) rows.push(cells.map(cleanCell));
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

/* ── table classification ──────────────────────────────────────────────── */

type TableKind = "meta" | "desired" | "evidence" | "assessment" | "week" | "other";

/**
 * Index of the column-header row among a table's first rows, or -1. Week
 * tables put it at row 0 (a headed CSV, or a table with no title) or row 1
 * (after a "Week N:" / STANDARD title line); we allow one more for safety.
 */
function findHeaderRow(table: string[][]): number {
  const limit = Math.min(table.length, 3);
  for (let i = 0; i < limit; i += 1) {
    if (looksLikeHeaderRow(table[i] ?? [])) return i;
  }
  return -1;
}

function classifyTable(table: string[][]): TableKind {
  const row0first = table[0]?.[0] ?? "";
  if (/^\s*week\b/i.test(row0first)) return "week";
  // Structure beats wording: any table headed by the SOW columns is a week
  // table, whatever its title line says. This must run before the metadata
  // rule — a STANDARD title ("… GRADE 4 MATHEMATICS TERM 1A | WEEK 1 …")
  // mentions grade and term and would otherwise be read as a metadata grid.
  if (findHeaderRow(table) >= 0) return "week";

  const joined = table.flat().join("  ").toLowerCase();
  if (/desired results/.test(joined) || /enduring understanding/.test(joined)) {
    return "desired";
  }
  // Assessment BEFORE evidence: a table carrying BOTH a formative and a
  // summative section is unambiguously the assessment plan, even when its prose
  // mentions a "performance task" in passing (which would otherwise let the
  // evidence rule steal it).
  if (/formative assessment/.test(joined) && /summative/.test(joined)) {
    return "assessment";
  }
  if (/acceptable evidence/.test(joined) || /performance task/.test(joined)) {
    return "evidence";
  }
  if (/\bgrade\b/.test(joined) && /main competence|subject|\bterm\b/.test(joined)) {
    return "meta";
  }
  return "other";
}

/* ── metadata block ────────────────────────────────────────────────────── */

/** Metadata label → key. Order: more specific first. */
const META_RULES: ReadonlyArray<{ key: keyof ParsedSowMeta | "specificCompetences" | "relatedSkills"; re: RegExp }> = [
  { key: "weeksCount", re: /number of weeks/i },
  { key: "mainCompetence", re: /main competenc/i },
  { key: "lessonsPerWeek", re: /lessons?\s*\/?\s*periods?\s*per week|lessons? per week|periods? per week/i },
  { key: "lessonDurationMins", re: /duration/i },
  { key: "totalLessons", re: /total lessons/i },
  { key: "specificCompetences", re: /specific competenc/i },
  { key: "relatedSkills", re: /21st century|21st-century/i },
  { key: "subject", re: /subject/i },
  { key: "term", re: /\bterm\b/i },
  { key: "year", re: /\byear\b/i },
  { key: "grade", re: /\bgrade\b/i },
];

/** True when a cell reads as a metadata LABEL (short, and matches a rule). */
function isMetaLabel(cell: string): boolean {
  return cell.length <= 40 && META_RULES.some((r) => r.re.test(cell));
}

/**
 * Flatten a metadata grid into label/value pairs. Two layouts occur in the
 * school's files:
 *   pairs across columns — `Grade | 2 | Subject | Arithmetic | …` (revised UbD);
 *   a label row over a value row — `Grade | Subject | Term` then
 *   `4 | Science | 1A` (the Science scheme), where zipping the two rows is the
 *   only reading that does not pair "Grade" with the word "Subject".
 * A row is treated as a label row when most of its non-empty cells are labels
 * and the row beneath it is not.
 */
function metaPairs(table: string[][]): Array<{ label: string; value: string }> {
  const pairs: Array<{ label: string; value: string }> = [];
  let skipNext = false;

  for (let r = 0; r < table.length; r += 1) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const row = table[r] ?? [];
    const next = table[r + 1];
    const nonEmpty = row.filter((c) => c.trim());
    const labelCount = nonEmpty.filter(isMetaLabel).length;
    const rowIsLabels = nonEmpty.length >= 2 && labelCount >= Math.ceil(nonEmpty.length * 0.6);
    const nextIsValues =
      next != null && next.filter((c) => c.trim()).length > 0 && !next.some(isMetaLabel);

    if (rowIsLabels && nextIsValues) {
      row.forEach((label, i) => {
        const value = next[i] ?? "";
        if (label && value) pairs.push({ label, value });
      });
      skipNext = true;
      continue;
    }

    for (let i = 0; i + 1 < row.length; i += 2) {
      const label = row[i] ?? "";
      const value = row[i + 1] ?? "";
      if (label && value) pairs.push({ label, value });
    }
  }
  return pairs;
}

/** Parse the metadata grid into meta + UbD bits (see {@link metaPairs} for layouts). */
function parseMetaTable(
  table: string[][],
): { meta: ParsedSowMeta; specificCompetences?: string; relatedSkills?: string } {
  const meta: ParsedSowMeta = {};
  let specificCompetences: string | undefined;
  let relatedSkills: string | undefined;

  for (const { label, value } of metaPairs(table)) {
      const rule = META_RULES.find((r) => r.re.test(label));
      if (!rule) continue;
      switch (rule.key) {
        case "weeksCount":
          meta.weeksCount ??= firstInt(value);
          break;
        case "lessonsPerWeek":
          meta.lessonsPerWeek ??= firstInt(value);
          break;
        case "lessonDurationMins":
          meta.lessonDurationMins ??= firstInt(value);
          break;
        case "mainCompetence":
          meta.mainCompetence ??= value;
          break;
        case "totalLessons":
          meta.totalLessons ??= value;
          break;
        case "subject":
          meta.subject ??= value;
          break;
        case "term":
          meta.term ??= value.replace(/^term\s+/i, "").trim();
          break;
        case "year":
          meta.year ??= value;
          break;
        case "grade": {
          if (meta.grade === undefined) {
            const n = firstInt(value);
            meta.grade = n != null ? `Grade ${n}` : value;
          }
          break;
        }
        case "specificCompetences":
          specificCompetences ??= value;
          break;
        case "relatedSkills":
          relatedSkills ??= value;
          break;
      }
  }

  return { meta, specificCompetences, relatedSkills };
}

/* ── desired results ───────────────────────────────────────────────────── */

/** Split a blob into items each starting at a label like K1, EU2, S7a, EQ3. */
function splitByLabel(text: string, labelRe: RegExp): string[] {
  const global = new RegExp(labelRe, "g");
  const markers = [...text.matchAll(global)];
  if (markers.length === 0) {
    const t = text.trim();
    return t ? [t] : [];
  }
  const items: string[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i]!.index ?? 0;
    const end = i + 1 < markers.length ? (markers[i + 1]!.index ?? text.length) : text.length;
    const item = text.slice(start, end).trim();
    if (item) items.push(item);
  }
  return items;
}

const DESIRED_COL_RULES: ReadonlyArray<{
  key: "transferGoal" | "enduringUnderstandings" | "essentialQuestions" | "knowledge" | "skills";
  re: RegExp;
}> = [
  { key: "transferGoal", re: /transfer goal/i },
  { key: "enduringUnderstandings", re: /enduring understanding/i },
  { key: "essentialQuestions", re: /essential question/i },
  { key: "knowledge", re: /knowledge/i },
  { key: "skills", re: /\bskills?\b/i },
];

/** Parse the DESIRED RESULTS table into the UbD header fields. */
function parseDesiredResults(table: string[][], ctx: SchemeHeaderContext): void {
  // Find the column-header row (the one naming the five columns).
  const headerIdx = table.findIndex((row) =>
    row.some((c) => /transfer goal|enduring understanding|essential question/i.test(c)),
  );
  if (headerIdx < 0) return;
  const headers = table[headerIdx]!;

  // Map each header column index → target key.
  const colKey: Array<(typeof DESIRED_COL_RULES)[number]["key"] | null> = headers.map((h) => {
    const rule = DESIRED_COL_RULES.find((r) => r.re.test(h));
    return rule ? rule.key : null;
  });

  // Concatenate every data row below the header, per column.
  const colText: Record<string, string> = {};
  for (let r = headerIdx + 1; r < table.length; r += 1) {
    const row = table[r]!;
    row.forEach((cell, c) => {
      const key = colKey[c];
      if (!key || !cell) return;
      colText[key] = colText[key] ? `${colText[key]} ${cell}` : cell;
    });
  }

  if (colText.transferGoal) ctx.transferGoal = colText.transferGoal.trim();
  if (colText.enduringUnderstandings) {
    ctx.enduringUnderstandings = splitByLabel(
      colText.enduringUnderstandings,
      /\b(?:EU|U)\d+\s*[.\-)]/,
    );
  }
  if (colText.essentialQuestions) {
    ctx.essentialQuestions = splitByLabel(colText.essentialQuestions, /\bEQ\d+\s*[.\-)]/);
  }
  if (colText.knowledge) {
    ctx.knowledge = splitByLabel(colText.knowledge, /\bK\d+\s*[.\-)]/);
  }
  if (colText.skills) {
    ctx.skills = splitByLabel(colText.skills, /\bS\d+[a-z]?\s*[.\-)]/);
  }
}

/* ── acceptable evidence ───────────────────────────────────────────────── */

/** Parse the ACCEPTABLE EVIDENCE (performance tasks) table. */
function parseEvidence(table: string[][], ctx: SchemeHeaderContext): void {
  // Header row names the task columns (Task | Details | Success Criteria | …).
  const headerIdx = table.findIndex((row) =>
    row.some((c) => /success criteria|rubric|details/i.test(c)),
  );
  const start = headerIdx >= 0 ? headerIdx + 1 : 1; // skip section-title row otherwise
  const tasks: string[] = [];
  for (let r = start; r < table.length; r += 1) {
    const row = table[r]!;
    const parts = row.map((c) => c.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    // Drop a repeated header row.
    if (parts.some((p) => /success criteria/i.test(p))) continue;
    tasks.push(parts.join(" — "));
  }
  if (tasks.length > 0) ctx.performanceTasks.push(...tasks);
}

/** Parse the formative/summative assessment-plan table. */
function parseAssessmentPlan(table: string[][], ctx: SchemeHeaderContext): void {
  const formative: string[] = [];
  const summative: string[] = [];

  // Find the sub-header row carrying two "Type" columns to locate the split.
  let mid = -1;
  const subHeaderIdx = table.findIndex((row) => {
    const typeCols = row
      .map((c, i) => (/^type$/i.test(c.trim()) ? i : -1))
      .filter((i) => i >= 0);
    if (typeCols.length >= 2) {
      mid = typeCols[1]!;
      return true;
    }
    return false;
  });

  const start = subHeaderIdx >= 0 ? subHeaderIdx + 1 : 2;
  for (let r = start; r < table.length; r += 1) {
    const row = table[r]!;
    const split = mid > 0 ? mid : Math.ceil(row.length / 2);
    const left = row.slice(0, split).map((c) => c.trim()).filter(Boolean).join(" — ");
    const right = row.slice(split).map((c) => c.trim()).filter(Boolean).join(" — ");
    if (left) formative.push(left);
    if (right) summative.push(right);
  }

  if (formative.length > 0 || summative.length > 0) {
    const existing = ctx.assessment ?? { formative: [], summative: [] };
    existing.formative.push(...formative);
    existing.summative.push(...summative);
    ctx.assessment = existing;
  }
}

/* ── week tables ───────────────────────────────────────────────────────── */

/** One parsed week table: its rows, the week it names, and any title meta. */
interface ParsedWeekTable {
  week?: number;
  rows: ParsedSowRow[];
  /** Grade/subject/term read off a STANDARD title line, if it carried them. */
  titleMeta: TitleLineMeta;
}

/** Parse one week table → { week, rows, titleMeta }. */
function parseWeekTable(table: string[][]): ParsedWeekTable {
  // The column-header row is the first header-looking row; everything above
  // it is title text ("Week 3: …", or a STANDARD "… GRADE 4 … | WEEK 3 …").
  let headerIdx = findHeaderRow(table);
  if (headerIdx < 0) headerIdx = 1;
  const titleText = table
    .slice(0, headerIdx)
    .map((r) => r.join(" "))
    .join(" ");
  const titleMeta = parseTitleLine(titleText);
  // A bare "Week 3:" title has no "grade"; parseWeek's any-number fallback
  // covers legacy "3" / "wk 3" titles that parseTitleLine cannot read.
  const week =
    titleMeta.week ??
    (/\bgrade\b/i.test(titleText) ? undefined : parseWeek(titleText));

  const headers = (table[headerIdx] ?? []).map(cleanCell);
  /** Signature of the header row, used to spot verbatim repeats in the body. */
  const headerKey = headers.join("|").toLowerCase();

  const rows: ParsedSowRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const cells = table[i];
    if (!cells) continue;
    // A header repeated inside the body is a verbatim copy of the header row.
    // Keyword-matching here instead (as `looksLikeHeaderRow` does) silently
    // drops real lessons whose prose mentions "objective" or "activity" — e.g.
    // a Resources cell reading "…with the habitat activity on page 3".
    if (cells.map(cleanCell).join("|").toLowerCase() === headerKey) continue;
    const pairs = cells.map((value, idx) => ({
      header: headers[idx] ?? `col_${idx + 1}`,
      value,
    }));
    const row = rowFromPairs(pairs);
    if (row.week === undefined && week !== undefined) row.week = week;
    if (!isEmptyRow(row) && !isPlaceholderRow(row)) rows.push(row);
  }
  return { week, rows, titleMeta };
}

/**
 * De-duplicate the parsed week tables: drop empties, and when a week number
 * appears more than once keep the variant with the most populated cells.
 *
 * Real revised-template docs always title their weeks ("Week N: …"); leftover
 * *unnumbered* "Week:" draft/template tables therefore duplicate numbered weeks
 * and are dropped whenever any numbered week is present. They are kept (in
 * document order) ONLY as a fallback when no week could be numbered at all.
 * Returns the ordered rows and kept/dropped stats.
 */
function dedupeWeekTables(
  parsed: Array<{ week?: number; rows: ParsedSowRow[] }>,
): { rows: ParsedSowRow[]; kept: number; dropped: number } {
  const nonEmpty = parsed.filter((p) => p.rows.length > 0);
  let dropped = parsed.length - nonEmpty.length;

  // Best variant per numbered week.
  const byWeek = new Map<number, { rows: ParsedSowRow[]; score: number }>();
  const unnumbered: Array<{ rows: ParsedSowRow[] }> = [];

  for (const p of nonEmpty) {
    if (p.week === undefined) {
      unnumbered.push(p);
      continue;
    }
    const score = p.rows.reduce((s, r) => s + mappedFieldCount(r), 0);
    const cur = byWeek.get(p.week);
    if (!cur) {
      byWeek.set(p.week, { rows: p.rows, score });
    } else {
      if (score > cur.score) byWeek.set(p.week, { rows: p.rows, score });
      dropped += 1; // a duplicate of an already-seen week
    }
  }

  const numbered = [...byWeek.keys()].sort((a, b) => a - b);
  const rows: ParsedSowRow[] = [];
  for (const w of numbered) rows.push(...byWeek.get(w)!.rows);

  // Unnumbered tables are drafts when numbered weeks exist → drop them.
  if (numbered.length === 0) {
    for (const u of unnumbered) rows.push(...u.rows);
    return { rows, kept: unnumbered.length, dropped };
  }
  return { rows, kept: numbered.length, dropped: dropped + unnumbered.length };
}

/* ── public: tables (the shared core) ──────────────────────────────────── */

/**
 * Parse a scheme from its tables — the core every source funnels into. Each
 * table is classified by structure ({@link classifyTable}) and routed to the
 * matching section parser; week tables are then de-duplicated and their rows
 * concatenated in week order.
 *
 * Scheme metadata comes from a metadata grid when the document has one, and
 * otherwise from the week tables' title lines (the STANDARD template names
 * grade, subject and term on every week's title and nowhere else). Grid
 * values win; title values only fill gaps.
 *
 * @param tables Each table as rows of cell strings, in document order.
 * @param opts.titleHints Lines of text from OUTSIDE the tables (document
 *   headings, page headers) that may name the grade/subject/term — the last
 *   resort for metadata, tried after the grid and the week titles.
 */
export function parseSowTables(
  tables: string[][][],
  opts: { titleHints?: string[] } = {},
): ParsedSow {
  const ctx = emptySchemeHeaderContext();
  let meta: ParsedSowMeta = {};
  const weekTables: ParsedWeekTable[] = [];

  for (const table of tables) {
    switch (classifyTable(table)) {
      case "meta": {
        const parsed = parseMetaTable(table);
        meta = { ...parsed.meta, ...meta };
        if (parsed.specificCompetences) ctx.specificCompetences = parsed.specificCompetences;
        if (parsed.relatedSkills) ctx.relatedSkills = parsed.relatedSkills;
        break;
      }
      case "desired":
        parseDesiredResults(table, ctx);
        break;
      case "evidence":
        parseEvidence(table, ctx);
        break;
      case "assessment":
        parseAssessmentPlan(table, ctx);
        break;
      case "week":
        weekTables.push(parseWeekTable(table));
        break;
      case "other":
        break;
    }
  }

  const { rows, kept, dropped } = dedupeWeekTables(weekTables);

  // Fill metadata gaps from the week titles (STANDARD template). The first
  // title that names each field wins, so a stray later title cannot override.
  for (const wt of weekTables) {
    meta.grade ??= wt.titleMeta.grade;
    meta.subject ??= wt.titleMeta.subject;
    meta.term ??= wt.titleMeta.term;
  }
  for (const hint of opts.titleHints ?? []) {
    const t = parseTitleLine(hint);
    meta.grade ??= t.grade;
    meta.subject ??= t.subject;
    meta.term ??= t.term;
  }
  if (meta.weeksCount === undefined && kept > 0) meta.weeksCount = kept;

  return {
    scheme: meta,
    headerContext: ctx,
    rows,
    stats: { weekTablesKept: kept, weekTablesDropped: dropped, parser: "rules" },
  };
}

/* ── public: HTML / docx ───────────────────────────────────────────────── */

/**
 * Parse a SOW from an HTML fragment (mammoth output): extract every table and
 * hand them to {@link parseSowTables}. Exposed for unit tests;
 * {@link parseSowDocx} is the docx wrapper.
 */
export function parseSowHtml(html: string): ParsedSow {
  return parseSowTables(extractAllTables(html), {
    titleHints: extractHeadingLines(html),
  });
}

/**
 * Text of the headings and paragraphs that sit OUTSIDE any table — where a
 * docx names itself ("Grade 4 Science Schemes of Work 2026"). Capped at the
 * first few lines: a title is at the top or nowhere.
 */
function extractHeadingLines(html: string): string[] {
  const outside = html.replace(/<table[\s\S]*?<\/table>/gi, " ");
  const lines: string[] = [];
  const blockRe = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(outside)) !== null && lines.length < 12) {
    const text = cleanCell((m[2] ?? "").replace(/<[^>]+>/g, " "));
    if (text) lines.push(text);
  }
  return lines;
}

/**
 * Parse a `.docx` scheme into a {@link ParsedSow}. Converts to HTML with
 * mammoth, then delegates to {@link parseSowHtml}.
 *
 * @param buf The raw docx bytes.
 */
export async function parseSowDocx(buf: Buffer): Promise<ParsedSow> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  return parseSowHtml(html);
}

/**
 * The plain text of a `.docx`, for the model-backed fallback when no table
 * could be mapped (a scheme written as headed paragraphs, say).
 */
export async function docxPlainText(buf: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

/**
 * Parse a CSV scheme into a {@link ParsedSow}. Uses papaparse with `header:true`
 * (first row → keys), then maps each record via the same keyword rules as the
 * docx path. A CSV carries only lesson rows — no UbD header — so `scheme` and
 * `headerContext` come back empty.
 *
 * @param text The raw CSV text.
 */
export function parseSowCsv(text: string): ParsedSow {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const rows: ParsedSowRow[] = [];
  for (const record of parsed.data) {
    if (!record || typeof record !== "object") continue;
    const pairs = Object.entries(record).map(([header, value]) => ({
      header,
      value: value == null ? "" : String(value),
    }));
    const row = rowFromPairs(pairs);
    if (!isEmptyRow(row)) rows.push(row);
  }

  return {
    scheme: {},
    headerContext: emptySchemeHeaderContext(),
    rows,
    stats: { weekTablesKept: 0, weekTablesDropped: 0, parser: "rules" },
  };
}
