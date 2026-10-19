import "server-only";

/**
 * Saved slide decks — load, save, and the freshness test.
 *
 * A deck is fresh while the plan's `content_json` still hashes to the deck's
 * `source_hash`; editing the plan's content makes it stale (it is rebuilt on
 * next open), while touching anything else about the plan does not.
 */
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { lessonSlideDecks, type LessonSlideDeck } from "@/lib/db/schema";

import { slideDeckSchema, type SlideDeck } from "./deckSchema";

/**
 * Fingerprint of a plan's content_json. Keys are sorted first: Postgres
 * `jsonb` does not keep key order, so the same content read back from the
 * database and held in memory must still hash alike.
 */
export function contentHash(contentJson: unknown): string {
  return createHash("sha256").update(canonicalJson(contentJson ?? null)).digest("hex");
}

/** JSON with object keys in sorted order, at every depth. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The saved deck for a plan, or null. A row that no longer parses counts as none. */
export async function loadDeck(planId: string): Promise<LessonSlideDeck | null> {
  const [row] = await db
    .select()
    .from(lessonSlideDecks)
    .where(eq(lessonSlideDecks.planId, planId))
    .limit(1);
  if (!row) return null;
  return slideDeckSchema.safeParse(row.deck).success ? row : null;
}

/** Was this saved deck built from the plan's current content? */
export function isFresh(row: Pick<LessonSlideDeck, "sourceHash">, contentJson: unknown): boolean {
  return row.sourceHash === contentHash(contentJson);
}

/** Save (or replace) a plan's deck. */
export async function saveDeck(input: {
  planId: string;
  deck: SlideDeck;
  contentJson: unknown;
  modelId: string;
  generatedBy: string | null;
}): Promise<void> {
  const values = {
    deck: input.deck,
    sourceHash: contentHash(input.contentJson),
    modelId: input.modelId,
    generatedBy: input.generatedBy,
  };
  await db
    .insert(lessonSlideDecks)
    .values({ planId: input.planId, ...values })
    .onConflictDoUpdate({ target: lessonSlideDecks.planId, set: values });
}
