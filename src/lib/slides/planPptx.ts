import "server-only";

/**
 * A plan's slide deck as a .pptx — the one place that decides which deck to
 * use, shared by the single download route and the term ZIP.
 *
 * The saved AI deck is used while it still matches the plan's content;
 * otherwise the basic deck built straight from the plan, so a download never
 * fails just because AI is unavailable. Never generates.
 */
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";

import { teacherExtras } from "./deckToSlides";
import { DEFAULT_LESSON_MINUTES, fallbackDeck } from "./fallbackDeck";
import { deckToPptx } from "./pptx";
import { isFresh, loadDeck } from "./store";

export interface PptxSource {
  id: string;
  title: string;
  contentJson: unknown;
  durationMinutes: number | null;
}

/** The .pptx bytes, and whether it is the basic deck. Null: plan not structured. */
export async function planPptx(
  plan: PptxSource,
): Promise<{ file: Buffer; basic: boolean } | null> {
  const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
  if (!structured.success) return null;

  const saved = await loadDeck(plan.id);
  const basic = !(saved && isFresh(saved, plan.contentJson));
  const deck = basic
    ? fallbackDeck(structured.data, plan.durationMinutes ?? DEFAULT_LESSON_MINUTES)
    : saved!.deck;
  const file = await deckToPptx(deck, teacherExtras(structured.data), { title: plan.title });
  return { file: Buffer.from(file), basic };
}
