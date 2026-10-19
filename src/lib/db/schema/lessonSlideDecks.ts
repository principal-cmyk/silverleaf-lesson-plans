/**
 * Lesson slide decks — the interactive classroom deck AI Studio builds from a
 * structured lesson plan ("Teach this lesson").
 *
 * One row per plan (`plan_id` is unique): a deck is generated the first time
 * anyone opens a plan's slides, then shared by every teacher. `source_hash`
 * fingerprints the plan's `content_json` at generation time, so editing the
 * plan's content marks the deck stale (and it is rebuilt on next open) while
 * unrelated updates — publishing, a status flip — leave it alone.
 *
 * The deck is cascade-deleted with its plan: it is derived data, and it must
 * never be the reason a plan cannot be deleted.
 *
 * See docs/schema-conventions.md for naming rules.
 */
import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { SlideDeck } from "@/lib/slides/deckSchema";
import { lessonPlans } from "./lessonPlans";
import { staff } from "./staff";

export const lessonSlideDecks = pgTable("lesson_slide_decks", {
  /** Surrogate primary key. Defaults via `gen_random_uuid()`. */
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** The plan this deck presents. One deck per plan. */
  planId: uuid("plan_id")
    .notNull()
    .unique()
    .references(() => lessonPlans.id, { onDelete: "cascade" }),
  /** The deck itself, validated against `slideDeckSchema` before saving. */
  deck: jsonb("deck").$type<SlideDeck>().notNull(),
  /** Fingerprint of the plan's `content_json` the deck was built from. */
  sourceHash: text("source_hash").notNull(),
  /** OpenRouter model slug that generated the deck. */
  modelId: text("model_id").notNull(),
  /** Who triggered the generation (any teacher may; null if unknown). */
  generatedBy: uuid("generated_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type LessonSlideDeck = typeof lessonSlideDecks.$inferSelect;
export type NewLessonSlideDeck = typeof lessonSlideDecks.$inferInsert;
