/**
 * gradeTerm.ts — Grade → Term navigation helpers shared by the AI Studio
 * Schemes of Work page and the admin Plans list.
 *
 * URL contract (both pages): `?grade=<token>&term=<term>`, e.g.
 * `?grade=KG1&term=1a`, `?grade=G4&term=2b`. The grade param is the same token
 * stored in `lesson_plans.grade`, so old `/admin/plans?grade=G2` links keep
 * working.
 *
 * Pure module — no I/O — so server pages, client components and tests share it.
 */
import { ORDINAL_TERM, TERM_VALUES, type Term } from "@/lib/naming/constants";
import { isValidGradeNum, parseGradeNum, SCHOOL_GRADE_NUMS } from "@/lib/naming/grade";

/** One grade in the grade bar, with how many items it holds. */
export interface GradeCount {
  gradeNum: number;
  count: number;
}

/** One term tab, with how many items it holds for the selected grade. */
export interface TermCount {
  term: Term;
  count: number;
}

/**
 * Something that sits in a grade and a term: one scheme, or a pre-counted
 * group of plans (`count`, default 1).
 */
export interface GradeTermItem {
  gradeNum: number;
  termOrdinal: number;
  count?: number;
}

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** `?grade=` → grade number, or null when absent/unreadable. */
export function parseGradeParam(raw: string | string[] | undefined): number | null {
  const v = one(raw);
  return v ? parseGradeNum(v) : null;
}

/** `?term=` → term token (`1a`…`2b`), or null when absent/unknown. */
export function parseTermParam(raw: string | string[] | undefined): Term | null {
  const v = one(raw)?.toLowerCase().replace(/^t(?:erm)?\s*/, "");
  return v && (TERM_VALUES as readonly string[]).includes(v) ? (v as Term) : null;
}

/** Term token for a stored ordinal (1–4), or null for 0/unknown. */
export function termOfOrdinal(ordinal: number): Term | null {
  return (ORDINAL_TERM as Record<number, Term | undefined>)[ordinal] ?? null;
}

/** Does the item have a grade and term the navigation can file it under? */
export function isFiled(item: GradeTermItem): boolean {
  return isValidGradeNum(item.gradeNum) && termOfOrdinal(item.termOrdinal) != null;
}

/**
 * Grade bar entries: the school's grades (KG1 … Grade 6) always, plus any
 * other grade that has items (e.g. a Grade 7 pilot), in grade order, each with
 * its item count.
 */
export function gradeCounts(items: readonly GradeTermItem[]): GradeCount[] {
  const counts = new Map<number, number>(SCHOOL_GRADE_NUMS.map((g) => [g, 0]));
  for (const it of items) {
    if (!isValidGradeNum(it.gradeNum)) continue;
    counts.set(it.gradeNum, (counts.get(it.gradeNum) ?? 0) + (it.count ?? 1));
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([gradeNum, count]) => ({ gradeNum, count }));
}

/** The four term tabs, in order, counting items in `gradeNum` (all grades when null). */
export function termCounts(
  items: readonly GradeTermItem[],
  gradeNum: number | null,
): TermCount[] {
  return TERM_VALUES.map((term, i) => ({
    term,
    count: items
      .filter((it) => it.termOrdinal === i + 1 && (gradeNum == null || it.gradeNum === gradeNum))
      .reduce((sum, it) => sum + (it.count ?? 1), 0),
  }));
}

/**
 * The grade and term to show when the URL names none (or names an unknown
 * one): the requested value when valid, else the first grade that has items
 * (else KG1), and within it the first term that has items (else Term 1A).
 */
export function resolveGradeTerm(
  items: readonly GradeTermItem[],
  requested: { grade: number | null; term: Term | null },
): { grade: number; term: Term } {
  const grades = gradeCounts(items);
  const grade =
    requested.grade != null && isValidGradeNum(requested.grade)
      ? requested.grade
      : (grades.find((g) => g.count > 0) ?? grades[0]!).gradeNum;
  const term =
    requested.term ??
    termCounts(items, grade).find((t) => t.count > 0)?.term ??
    TERM_VALUES[0];
  return { grade, term };
}
