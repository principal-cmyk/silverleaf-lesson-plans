import "server-only";

/**
 * Batch selections (table `batch_selections`) — save the plan ids an admin
 * selected and read them back for a batch download page, which takes either
 * `?sel=<selection id>` (any size), the older `?ids=a,b,c` (short lists), or
 * the plans list's own filters (`?grade=G2&term=1a&subject=Math`), which is how
 * the "download by grade" run names a grade.
 */
import { eq, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { batchSelections } from "@/lib/db/schema";

import { parseGovernmentFormIds } from "./governmentForms";
import { fetchPlanIds, parsePlanFilters } from "./plansQuery";

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Save a selection; returns its id. Also sweeps selections older than a day. */
export async function saveSelection(planIds: string[], createdBy: string | null): Promise<string> {
  await db.delete(batchSelections).where(lt(batchSelections.createdAt, new Date(Date.now() - DAY_MS)));
  const [row] = await db
    .insert(batchSelections)
    .values({ planIds, createdBy })
    .returning();
  return row!.id;
}

type Params = Record<string, string | string[] | undefined>;

/** The plan ids a batch page was opened for. */
export async function resolveBatchIds(searchParams: Params): Promise<string[]> {
  const sel = Array.isArray(searchParams.sel) ? searchParams.sel[0] : searchParams.sel;
  if (sel && UUID.test(sel)) {
    const [row] = await db
      .select({ planIds: batchSelections.planIds })
      .from(batchSelections)
      .where(eq(batchSelections.id, sel))
      .limit(1);
    return row ? parseGovernmentFormIds(row.planIds.join(",")) : [];
  }
  const ids = parseGovernmentFormIds(searchParams.ids);
  if (ids.length > 0 || !(searchParams.grade || searchParams.term)) return ids;
  return fetchPlanIds(parsePlanFilters(searchParams));
}
