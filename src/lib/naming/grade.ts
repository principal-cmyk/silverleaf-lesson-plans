/**
 * grade.ts — single source of truth for grade levels (KG1, KG2, Grade 1…12).
 *
 * Every grade has three forms:
 *
 *   gradeNum — the integer stored in `*.grade_num`, used for ordering and range
 *              queries. Kindergarten sorts BEFORE Grade 1, so KG1 = -2 and
 *              KG2 = -1; Grade N = N. Zero is deliberately unused: older code
 *              paths treated `gradeNum === 0` / a falsy gradeNum as "no grade".
 *   token    — the filename / `lesson_plans.grade` form: `KG1`, `KG2`, `G4`.
 *   label    — what people read: `KG1`, `KG2`, `Grade 4`.
 *
 * Before this module each caller did `parseInt(label.replace(/\D/g, ""))`,
 * which read "KG1" as Grade 1 and "KG2" as Grade 2 — KG schemes were filed
 * under, sorted with and named like primary grades.
 *
 * Plain module (no `server-only`, no I/O): imported by server actions, db
 * scripts, client components and tests alike.
 */

/** Highest kindergarten year the school runs (KG1, KG2). */
const KG_YEARS = 2;
/** Highest primary/secondary grade the naming convention accepts. */
const MAX_GRADE = 12;

/** The grades Silverleaf teaches, in order — the grade bar always shows these. */
export const SCHOOL_GRADE_NUMS: readonly number[] = [-2, -1, 1, 2, 3, 4, 5, 6];

/** Is `n` a grade number this app can store (KG1, KG2, Grade 1–12)? */
export function isValidGradeNum(n: number | null | undefined): n is number {
  if (typeof n !== "number" || !Number.isInteger(n)) return false;
  return (n >= 1 && n <= MAX_GRADE) || (n <= -1 && n >= -KG_YEARS);
}

/** KG year (1 or 2) for a kindergarten grade number, else null. */
function kgYear(n: number): number | null {
  return n < 0 ? KG_YEARS + 1 + n : null;
}

/** Filename / `lesson_plans.grade` token: `KG1`, `KG2`, `G4`. */
export function gradeToken(n: number): string {
  const kg = kgYear(n);
  return kg != null ? `KG${kg}` : `G${n}`;
}

/** Human label: `KG1`, `KG2`, `Grade 4`. */
export function gradeLabel(n: number): string {
  const kg = kgYear(n);
  return kg != null ? `KG${kg}` : `Grade ${n}`;
}

/** Short URL-friendly key, the lowercased token: `kg1`, `g4`. */
export function gradeKey(n: number): string {
  return gradeToken(n).toLowerCase();
}

/**
 * Read a grade written by a person, a scheme heading or a filename into its
 * grade number. Returns null when no valid grade can be read.
 *
 * Accepts kindergarten as `KG1`, `KG 2`, `K.G. 1`, `Kindergarten 1`,
 * `Chekechea 1`, `Awali 2`; primary grades as `Grade 4`, `G4`, `Class 4`,
 * `Std 4`, `Standard 4`, `Darasa la 4`, or bare `4`. The kindergarten check
 * runs first, so `KG1` can never fall through to "Grade 1".
 *
 * @example
 *   parseGradeNum("KG2")       // → -1
 *   parseGradeNum("Grade 4")   // → 4
 *   parseGradeNum("g7")        // → 7
 *   parseGradeNum("Year 2024") // → null (out of range)
 */
export function parseGradeNum(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return isValidGradeNum(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  const kg = s.match(
    /^(?:k\.?\s*g\.?|kindergarten|kinder|chekechea|(?:elimu\s+ya\s+)?awali)\s*[-_:]?\s*(\d)\b/i,
  );
  if (kg) {
    const year = Number(kg[1]);
    return year >= 1 && year <= KG_YEARS ? year - KG_YEARS - 1 : null;
  }

  const digits = s.match(/\d+/);
  if (!digits) return null;
  const n = Number(digits[0]);
  return isValidGradeNum(n) ? n : null;
}

/**
 * Canonical human label for whatever grade text was given ("kg 1" → "KG1",
 * "GRADE 4" → "Grade 4"), or the trimmed input unchanged when it names no
 * grade, so the admin can still see and correct it.
 */
export function normalizeGradeLabel(raw: string): string {
  const n = parseGradeNum(raw);
  return n != null ? gradeLabel(n) : raw.trim();
}

/**
 * "KG1" / "Kindergarten 2" inside running text. The negative lookbehind skips
 * the mass unit ("weigh 1 kg 2 times", "2.5 kg"), which maths schemes use a
 * lot. Built with `new RegExp` because the TS target (ES2017) rejects
 * lookbehind in a regex literal; V8 supports it at runtime.
 */
const KG_IN_TEXT = new RegExp(
  "(?<![\\d.,]\\s*)\\b(?:k\\.?\\s*g\\.?|kindergarten|chekechea)\\s*[-:]?\\s*([12])\\b",
  "i",
);

/**
 * Find a grade mentioned inside running text such as a scheme heading
 * ("SILVERLEAF ACADEMY — KG1 MATHEMATICS TERM 1A"). Kindergarten first.
 * Returns the match so callers can read what follows it (the subject).
 */
export function findGradeInText(
  text: string,
): { gradeNum: number; index: number; length: number } | null {
  const kg = KG_IN_TEXT.exec(text);
  if (kg) {
    return { gradeNum: Number(kg[1]) - KG_YEARS - 1, index: kg.index, length: kg[0].length };
  }
  const grade = /\bgrade\s*(\d{1,2})\b/i.exec(text);
  if (grade) {
    const n = Number(grade[1]);
    if (isValidGradeNum(n)) return { gradeNum: n, index: grade.index, length: grade[0].length };
  }
  return null;
}
