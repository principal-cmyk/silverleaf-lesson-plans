import "server-only";

/**
 * Model-backed scheme extraction (AI Studio v2) — the fallback ingest.
 *
 * The rule-based parser (`./parse.ts`) handles every Silverleaf template we
 * have seen: the revised UbD docx, the STANDARD docx and PDF, headed CSVs.
 * A scheme in any other shape — a scheme typed as headed paragraphs, a
 * partner school's template, an export with the table structure flattened —
 * yields no rows there. This module is what "any format" means in practice:
 * the document's plain text goes to the generation model in chunks, with a
 * strict schema mirroring the 11 SOW columns, and the model does the column
 * mapping the rules could not.
 *
 * Guard-rails, because this costs money per call:
 *  - only ever invoked when the rules found NO rows (see `parseUpload` in
 *    `src/lib/actions/schemes.ts`), never as a first resort;
 *  - gated on `hasApiKey()`; without a key the upload simply reports no rows;
 *  - the text is capped at {@link MAX_TEXT_CHARS}, so a pathological upload
 *    cannot fan out into hundreds of requests;
 *  - the model is the admin-chosen generation model (`resolveGenerationModelId`),
 *    so cost and quality follow the same setting as generation itself.
 *
 * The prompt asks for VERBATIM copying: the model must not summarise,
 * translate or "improve" a cell, because the rows become the grounding for
 * every lesson plan generated from the scheme.
 *
 * @see ./chunk.ts — how the text is cut into requests.
 * @see ./parse.ts — the {@link ParsedSow} shape this produces.
 */
import { normalizeGradeLabel } from "@/lib/naming/grade";
import { generateObject } from "ai";
import { z } from "zod";

import { GENERATION_MAX_OUTPUT_TOKENS, getModel } from "@/lib/ai/model";
import { resolveGenerationModelId } from "@/lib/ai/modelSetting";

import { chunkSchemeText } from "./chunk";
import type { ParsedSow, ParsedSowMeta, ParsedSowRow } from "./parse";
import { emptySchemeHeaderContext } from "./types";

/** Hard cap on the text handed to the model (≈ 25 chunks). */
export const MAX_TEXT_CHARS = 350_000;

/** Thrown when the upload's text exceeds {@link MAX_TEXT_CHARS}. */
export class SchemeTooLargeError extends Error {
  /** The text length that was refused, for an authored user message. */
  readonly chars: number;
  constructor(chars: number) {
    super(`Scheme text is ${chars} characters; the AI extractor accepts at most ${MAX_TEXT_CHARS}.`);
    this.name = "SchemeTooLargeError";
    this.chars = chars;
  }
}

/** A nullable trimmed string — the model returns null for an absent cell. */
const cell = z.string().nullable();

/** One extracted lesson row: the 11 SOW columns, all optional. */
const rowSchema = z.object({
  week: z.number().int().nullable(),
  lessonNumber: cell,
  specificCompetence: cell,
  mainActivity: cell,
  lessonObjective: cell,
  knowledgeAndSkills: cell,
  assessmentEvidence: cell,
  learningActivities: cell,
  misconceptions: cell,
  differentiationSupport: cell,
  resources: cell,
  reflection: cell,
});

/** Scheme-level fields, asked for on the first chunk only. */
const metaSchema = z.object({
  title: cell,
  grade: cell,
  subject: cell,
  term: cell,
  year: cell,
  mainCompetence: cell,
});

const chunkSchema = z.object({
  scheme: metaSchema.nullable(),
  rows: z.array(rowSchema),
});

const SYSTEM =
  "You are a meticulous data-entry clerk for a Tanzanian primary school. " +
  "You are given part of a scheme of work — a term plan listing lessons — " +
  "in whatever layout the school used. Extract every lesson as one row with " +
  "the columns of the Silverleaf scheme-of-work template. Copy each cell's " +
  "text VERBATIM from the document: never summarise, translate, reorder or " +
  "invent. When the document has no cell for a column, return null. When a " +
  "cell in the document clearly maps to a column under a different heading " +
  "(e.g. 'Sample assessment questions' → assessmentEvidence, 'Remarks' → " +
  "reflection, 'Teaching and learning resources' → resources), map it. " +
  "Lesson labels such as 'BL1', '1 (L001)' or 'MT2' are the lessonNumber; a " +
  "week named beside the lesson or in a section heading is the week.";

const FIRST_CHUNK_NOTE =
  "This is the FIRST part of the document. Also fill `scheme` with the " +
  "scheme-level facts if the text names them: title, grade (as 'Grade N', or 'KG1' / 'KG2' for kindergarten), " +
  "subject, term (one of 1A, 1B, 2A, 2B), year, main competence. Use null " +
  "for anything not stated.";

const LATER_CHUNK_NOTE =
  "This is a LATER part of the same document; return `scheme` as null and " +
  "extract only the lesson rows in this part. If the part opens mid-lesson, " +
  "still return that partial lesson as a row.";

/** Strip nulls/blank strings from an extracted row into a {@link ParsedSowRow}. */
function toParsedRow(r: z.infer<typeof rowSchema>): ParsedSowRow {
  const clean = (v: string | null): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  const row: ParsedSowRow = { rawCells: {} };
  if (r.week != null && Number.isFinite(r.week)) row.week = r.week;
  const fields: Array<Exclude<keyof ParsedSowRow, "week" | "rawCells">> = [
    "lessonNumber",
    "specificCompetence",
    "mainActivity",
    "lessonObjective",
    "knowledgeAndSkills",
    "assessmentEvidence",
    "learningActivities",
    "misconceptions",
    "differentiationSupport",
    "resources",
    "reflection",
  ];
  for (const key of fields) {
    const v = clean(r[key]);
    if (v !== undefined) {
      row[key] = v;
      row.rawCells[key] = v;
    }
  }
  return row;
}

/** Normalise the model's scheme facts into {@link ParsedSowMeta}. */
function toParsedMeta(m: z.infer<typeof metaSchema> | null): ParsedSowMeta {
  const meta: ParsedSowMeta = {};
  if (!m) return meta;
  const clean = (v: string | null): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  meta.title = clean(m.title);
  const grade = clean(m.grade);
  if (grade) {
    // "Grade 4" / "4" / "KG1" → canonical label; KG must not become "Grade 1".
    meta.grade = normalizeGradeLabel(grade);
  }
  meta.subject = clean(m.subject);
  const term = clean(m.term);
  if (term) meta.term = term.replace(/^term\s+/i, "").replace(/\s+/g, "").toUpperCase();
  meta.year = clean(m.year);
  meta.mainCompetence = clean(m.mainCompetence);
  return meta;
}

/**
 * Extract a scheme from plain text with the generation model. Chunks are
 * sent one after another (the model has no memory between them, so each
 * carries the instruction in full); rows are concatenated in document order.
 * A row that carries no week inherits the last week seen, which keeps a
 * lesson that opened in the previous chunk in its week.
 *
 * Gate on `hasApiKey()` before calling. Model/network errors propagate.
 *
 * @param text The scheme's plain text (docx raw text, PDF text, CSV, .txt).
 * @throws {SchemeTooLargeError} when the text exceeds {@link MAX_TEXT_CHARS}.
 */
export async function extractSowWithModel(text: string): Promise<ParsedSow> {
  if (text.length > MAX_TEXT_CHARS) throw new SchemeTooLargeError(text.length);

  const chunks = chunkSchemeText(text);
  const modelId = await resolveGenerationModelId();
  const model = getModel(modelId);

  let meta: ParsedSowMeta = {};
  const rows: ParsedSowRow[] = [];
  let lastWeek: number | undefined;

  for (let i = 0; i < chunks.length; i += 1) {
    const { object } = await generateObject({
      model,
      schema: chunkSchema,
      schemaName: "scheme_of_work_part",
      schemaDescription:
        "Lesson rows (and, for the first part, scheme facts) extracted verbatim from part of a scheme of work.",
      system: SYSTEM,
      prompt:
        `${i === 0 ? FIRST_CHUNK_NOTE : LATER_CHUNK_NOTE}\n\n` +
        `=== DOCUMENT PART ${i + 1} OF ${chunks.length} ===\n${chunks[i]}`,
      maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
    });

    if (i === 0) meta = toParsedMeta(object.scheme);
    for (const r of object.rows) {
      const row = toParsedRow(r);
      if (row.week === undefined && lastWeek !== undefined) row.week = lastWeek;
      if (row.week !== undefined) lastWeek = row.week;
      // Skip rows the model returned entirely empty.
      if (Object.keys(row.rawCells).length === 0) continue;
      rows.push(row);
    }
  }

  const weeks = new Set(rows.map((r) => r.week).filter((w): w is number => w != null));
  if (meta.weeksCount === undefined && weeks.size > 0) meta.weeksCount = weeks.size;

  return {
    scheme: meta,
    headerContext: emptySchemeHeaderContext(),
    rows,
    stats: { weekTablesKept: weeks.size, weekTablesDropped: 0, parser: "ai" },
  };
}
