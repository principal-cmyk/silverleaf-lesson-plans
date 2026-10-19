/**
 * Batch government-form download — shared between the admin plans listing
 * (which builds the link) and the forms page (which reads it). Pure module so
 * the client component can import it.
 */

/**
 * Most plans one batch download (a ZIP of per-plan PDFs) may hold. Every page
 * is rasterised in the browser and the whole ZIP is built in memory, so a very
 * large selection would exhaust the tab; 100 plans (a full scheme batch) is a
 * few hundred pages.
 */
export const MAX_FORMS_PER_PDF = 100;

/** Admin route (locale-less) that renders the selected plans' forms. */
export const GOVERNMENT_FORMS_PATH = "/admin/plans/government-forms";

/**
 * Admin route (locale-less) that renders the selected plans' branded
 * Silverleaf documents (a ZIP of per-plan PDFs). Same `?ids=` contract and cap as
 * the forms page, so it reuses `parseGovernmentFormIds`.
 */
export const LESSON_PLANS_PDF_PATH = "/admin/plans/lesson-plans";

/**
 * Admin route (locale-less) that builds the selected plans' slide decks as
 * PowerPoint files (a ZIP of per-plan .pptx), generating any deck that does
 * not exist yet. Same `?ids=` contract and cap as the forms page.
 */
export const SLIDES_PATH = "/admin/plans/slides";

/** Build the forms-page href for a selection (ids travel in the query). */
export function governmentFormsHref(planIds: readonly string[]): string {
  return `${GOVERNMENT_FORMS_PATH}?ids=${planIds.join(",")}`;
}

/** Parse the `ids` query param back into a clean, capped id list. */
export function parseGovernmentFormIds(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const ids = value
    .split(",")
    .map((id) => id.trim())
    // Plan ids are UUIDs; anything else is dropped rather than sent to the DB.
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return [...new Set(ids)].slice(0, MAX_FORMS_PER_PDF);
}
