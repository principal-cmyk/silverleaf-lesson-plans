/**
 * Batch selections — the plans an admin ticked in the plans list, kept just
 * long enough to open a batch download page.
 *
 * Plan ids used to travel in the page address (`?ids=a,b,c`), which the
 * server refuses past ~430 plans (header too large). The list now saves its
 * selection here and opens the page with the row's short id (`?sel=`).
 * Rows are throwaway: a day later they are deleted on the next save.
 *
 * See docs/schema-conventions.md for naming rules.
 */
import { sql } from "drizzle-orm";
import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { staff } from "./staff";

export const batchSelections = pgTable("batch_selections", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Plan ids, in the order the admin's list showed them. */
  planIds: jsonb("plan_ids").$type<string[]>().notNull(),
  createdBy: uuid("created_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
