/**
 * Stored government-form PDFs — the lesson-plan half of the term download.
 *
 * The form is drawn and rasterised in the admin's browser (see
 * `PrintButton`), so the server cannot make it on request. An admin prepares
 * a grade's forms once; each PDF's bytes go to file storage and this row
 * remembers where. The teacher download zips these with the slides.
 *
 * One row per plan. `source_hash` fingerprints the plan's `content_json` the
 * PDF was drawn from (same hash as slide decks), so a plan edited afterwards
 * is recognised as out of date and left out of the zip rather than served
 * stale. Cascade-deleted with its plan: it is derived data.
 *
 * See docs/schema-conventions.md for naming rules.
 */
import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { lessonPlans } from "./lessonPlans";
import { staff } from "./staff";

export const planFormPdfs = pgTable("plan_form_pdfs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** The plan this form was drawn from. One PDF per plan. */
  planId: uuid("plan_id")
    .notNull()
    .unique()
    .references(() => lessonPlans.id, { onDelete: "cascade" }),
  /** Storage key of the PDF (`getStorage().read(key)`). */
  fileKey: text("file_key").notNull(),
  /** Size in bytes, for the admin's summary. */
  sizeBytes: integer("size_bytes").notNull(),
  /** Fingerprint of the plan's `content_json` the PDF was drawn from. */
  sourceHash: text("source_hash").notNull(),
  /** The admin who prepared it. */
  createdBy: uuid("created_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PlanFormPdf = typeof planFormPdfs.$inferSelect;
