/**
 * Admin plans listing — shared query helpers.
 *
 * One source of truth for filtering, ordering and paging the lesson-plans
 * catalogue, imported by BOTH the server page (`/admin/plans`) and the
 * `loadMorePlans` server action so the two never drift. Filters are intentionally
 * narrow and map onto indexed columns (`grade`, `subject`, `status`) plus a
 * substring match over the denormalised, lowercased `search_text` blob.
 */
import { and, asc, count, eq, ilike, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { lessonPlans, type PlanStatus } from "@/lib/db/schema";
import { parseGradeParam, parseTermParam, type GradeTermItem } from "@/lib/admin/gradeTerm";
import type { Term } from "@/lib/naming/constants";
import { gradeToken } from "@/lib/naming/grade";

/** Rows loaded per page / per "Show more". */
export const PAGE_SIZE = 12;

/** Minimal plan shape the admin table needs. */
export interface PlanRow {
  id: string;
  slug: string;
  title: string;
  grade: string;
  subject: string;
  term: string;
  week: number;
  lesson: number;
  status: PlanStatus;
}

/** Active filters. All optional — an absent key means "no constraint". */
export interface PlanFilters {
  /** Grade token (`KG1`, `G4`) — normalised from any accepted spelling. */
  grade?: string;
  /** Term token (`1a` … `2b`). */
  term?: Term;
  subject?: string;
  status?: PlanStatus;
  q?: string;
}

/** The columns the listing selects, in one place. */
const PLAN_COLUMNS = {
  id: lessonPlans.id,
  slug: lessonPlans.slug,
  title: lessonPlans.title,
  grade: lessonPlans.grade,
  subject: lessonPlans.subject,
  term: lessonPlans.term,
  week: lessonPlans.week,
  lesson: lessonPlans.lesson,
  status: lessonPlans.status,
} as const;

/**
 * Normalise raw `searchParams` into a typed, trimmed {@link PlanFilters}.
 * Unknown / blank values are dropped; `status` is validated against the enum.
 */
export function parsePlanFilters(
  raw: Record<string, string | string[] | undefined>,
): PlanFilters {
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

  const status = one(raw.status);

  const gradeNum = parseGradeParam(raw.grade);

  return {
    grade: gradeNum != null ? gradeToken(gradeNum) : undefined,
    term: parseTermParam(raw.term) ?? undefined,
    subject: one(raw.subject),
    status: status === "draft" || status === "published" ? status : undefined,
    q: one(raw.q),
  };
}

/** Build the combined WHERE clause for a filter set (or undefined for none). */
function whereFor(filters: PlanFilters): SQL | undefined {
  const conds: SQL[] = [];
  // By number, not label: one grade, however its token was spelled.
  const gradeNum = parseGradeParam(filters.grade);
  if (gradeNum != null) conds.push(eq(lessonPlans.gradeNum, gradeNum));
  if (filters.term) conds.push(eq(lessonPlans.term, filters.term));
  if (filters.subject) conds.push(eq(lessonPlans.subject, filters.subject));
  if (filters.status) conds.push(eq(lessonPlans.status, filters.status));
  // `search_text` is already lowercased; ilike keeps it case-insensitive anyway.
  if (filters.q) conds.push(ilike(lessonPlans.searchText, `%${filters.q}%`));
  return conds.length > 0 ? and(...conds) : undefined;
}

/**
 * Fetch one page of plans matching `filters`, in the canonical naming order
 * (grade → subject → term → week → lesson).
 */
export async function fetchPlansPage(
  filters: PlanFilters,
  { offset, limit }: { offset: number; limit: number },
): Promise<PlanRow[]> {
  return db
    .select(PLAN_COLUMNS)
    .from(lessonPlans)
    .where(whereFor(filters))
    .orderBy(
      asc(lessonPlans.gradeNum),
      asc(lessonPlans.subject),
      asc(lessonPlans.termOrdinal),
      asc(lessonPlans.week),
      asc(lessonPlans.lesson),
    )
    .limit(limit)
    .offset(offset);
}

/**
 * Ids of EVERY plan matching `filters`, in the same canonical order — backs the
 * listing's "Select all", which must reach rows not yet loaded by "Show more".
 */
export async function fetchPlanIds(filters: PlanFilters): Promise<string[]> {
  const rows = await db
    .select({ id: lessonPlans.id })
    .from(lessonPlans)
    .where(whereFor(filters))
    .orderBy(
      asc(lessonPlans.gradeNum),
      asc(lessonPlans.subject),
      asc(lessonPlans.termOrdinal),
      asc(lessonPlans.week),
      asc(lessonPlans.lesson),
    );
  return rows.map((r) => r.id);
}

/** Total number of plans matching `filters` (for the header count). */
export async function countPlans(filters: PlanFilters): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(lessonPlans)
    .where(whereFor(filters));
  return Number(rows[0]?.value ?? 0);
}

/** Distinct grade/subject values for the filter dropdowns. */
export interface PlanFilterOptions {
  grades: string[];
  subjects: string[];
}

/**
 * Distinct grades (ordered by numeric grade) and subjects (alphabetical) for the
 * filter selects. Cheap — two small DISTINCT scans over indexed columns.
 */
export async function fetchPlanFilterOptions(gradeNum?: number | null): Promise<PlanFilterOptions> {
  const [grades, subjects] = await Promise.all([
    db
      .selectDistinct({ grade: lessonPlans.grade, gradeNum: lessonPlans.gradeNum })
      .from(lessonPlans)
      .orderBy(asc(lessonPlans.gradeNum)),
    db
      .selectDistinct({ subject: lessonPlans.subject })
      .from(lessonPlans)
      // With a grade chosen, offer only that grade's subjects.
      .where(gradeNum != null ? eq(lessonPlans.gradeNum, gradeNum) : undefined)
      .orderBy(asc(lessonPlans.subject)),
  ]);

  return {
    grades: grades.map((g) => g.grade),
    subjects: subjects.map((s) => s.subject),
  };
}

/**
 * Plan counts per (grade, term) for the grade bar and term tabs, honouring the
 * subject / status / search filters but NOT grade or term — so each tab says
 * how many plans picking it would show.
 */
export async function fetchGradeTermCounts(filters: PlanFilters): Promise<GradeTermItem[]> {
  const rows = await db
    .select({
      gradeNum: lessonPlans.gradeNum,
      termOrdinal: lessonPlans.termOrdinal,
      count: count(),
    })
    .from(lessonPlans)
    .where(whereFor({ ...filters, grade: undefined, term: undefined }))
    .groupBy(lessonPlans.gradeNum, lessonPlans.termOrdinal);
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}
