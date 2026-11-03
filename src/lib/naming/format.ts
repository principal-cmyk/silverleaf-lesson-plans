/**
 * format.ts — build a canonical lesson-plan filename from structured parts.
 *
 * Pure module (no `server-only`, no I/O). The inverse of `parse`: the output
 * of {@link buildFilename} round-trips back through `parse` unchanged.
 *
 * @see ./constants.ts for the convention itself.
 * @see ./parse.ts for the inverse.
 */
import { NAMING } from "./constants";
import { gradeToken, parseGradeNum } from "./grade";

/**
 * Fields needed to assemble a filename. `grade` accepts a grade number (`7`,
 * `-2` for KG1), a token (`"G7"`, `"KG1"`) or a label (`"Grade 7"`).
 */
export interface FilenameParts {
  grade: string | number;
  subject: string;
  term: string;
  week: number;
  lesson: number;
}

/** Coerce any accepted grade form into its grade token (`G7`, `KG1`). */
function gradeTokenOf(grade: string | number): string {
  const n = parseGradeNum(grade);
  if (n == null) throw new Error(`buildFilename: "${grade}" is not a valid grade`);
  return gradeToken(n);
}

/**
 * Collapse a free-text subject into the single letters-only TitleCase token the
 * filename convention requires. "&" reads as "and"; every other non-letter
 * (commas, hyphens, digits) is a word break. Title-casing each word keeps
 * multi-word subjects readable ("HealthAndEnvironment", not
 * "Healthandenvironment").
 *
 * @example
 *   subjectToken("Numeracy, Science & ICT") // → "NumeracyScienceAndICT"
 */
export function subjectToken(subject: string): string {
  return subject
    .replace(/&/g, " and ")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Assemble a canonical filename (no extension) from its parts.
 *
 * @example
 *   buildFilename({ grade: 7, subject: "Math", term: "1a", week: 1, lesson: 1 })
 *   // → "G7_Math_T1a_W1_L1"
 */
export function buildFilename(input: FilenameParts): string {
  const grade = gradeTokenOf(input.grade);
  const term = input.term.replace(/^[Tt]/, "");
  const sep = NAMING.separator;
  return [
    grade,
    input.subject,
    `T${term}`,
    `W${input.week}`,
    `L${input.lesson}`,
  ].join(sep);
}
