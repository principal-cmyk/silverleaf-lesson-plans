import "server-only";

/**
 * facets — faceted counts for the search UI.
 *
 * Each facet (subject / grade / term / week) is a GROUP BY aggregate over the
 * SAME published-plan predicate that `searchLessonPlans` uses (via the shared
 * `buildPlanWhere`), narrowed by the text query AND by every OTHER facet's
 * selection — but not by its own. So with Grade 3 selected the subject counts
 * are Grade 3's subjects (no option leads to an empty page), while the grade
 * counts still show every grade, so the teacher can switch or add one.
 *
 * Sorting: subjects alphabetically, grades by numeric grade, terms by their
 * chronological ordinal, weeks numerically.
 */
import { asc, count, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { buildPlanWhere, type PlanFilterParams } from "./lessonSearch";

/** One facet bucket: the value and how many published plans carry it. */
export interface FacetCount {
  value: string;
  count: number;
}

/** The facet dimensions surfaced in the search UI. */
export interface FacetCounts {
  subjects: FacetCount[];
  grades: FacetCount[];
  terms: FacetCount[];
  weeks: FacetCount[];
}

/** Count facet buckets for the current query and selections. */
export async function getFacetCounts(
  params: PlanFilterParams,
): Promise<FacetCounts> {
  /** The filter with one facet's own selection left out. */
  const without = (key: "subject" | "grade" | "term" | "week") =>
    buildPlanWhere({ ...params, [key]: undefined });

  const [subjects, grades, terms, weeks] = await Promise.all([
    db
      .select({ value: lessonPlans.subject, count: count() })
      .from(lessonPlans)
      .where(without("subject"))
      .groupBy(lessonPlans.subject)
      .orderBy(asc(lessonPlans.subject)),
    db
      .select({ value: lessonPlans.grade, count: count() })
      .from(lessonPlans)
      .where(without("grade"))
      .groupBy(lessonPlans.grade)
      // ordered by numeric grade
      .orderBy(asc(sql`min(${lessonPlans.gradeNum})`)),
    db
      .select({ value: lessonPlans.term, count: count() })
      .from(lessonPlans)
      .where(without("term"))
      .groupBy(lessonPlans.term)
      .orderBy(asc(sql`min(${lessonPlans.termOrdinal})`)),
    db
      .select({ value: lessonPlans.week, count: count() })
      .from(lessonPlans)
      .where(without("week"))
      .groupBy(lessonPlans.week)
      .orderBy(asc(lessonPlans.week)),
  ]);

  const buckets = (rows: Array<{ value: string | number; count: number }>) =>
    rows.map((r) => ({ value: String(r.value), count: Number(r.count) }));
  return {
    subjects: buckets(subjects),
    grades: buckets(grades),
    terms: buckets(terms),
    weeks: buckets(weeks),
  };
}
