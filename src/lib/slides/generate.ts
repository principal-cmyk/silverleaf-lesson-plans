import "server-only";

/**
 * Build (and save) the slide deck for one lesson plan — shared by the signed-in
 * route (`POST /api/ai/slides`) and the share-link route, so both cost at most
 * one model call per plan and fail with the same machine codes.
 *
 * A deck that is already fresh is not rebuilt. The model slug comes from the
 * admin Settings tab (`resolveGenerationModelId`), never the request.
 */
import { generateObject, NoObjectGeneratedError } from "ai";

import {
  GENERATION_MAX_OUTPUT_TOKENS,
  getModel,
  hasApiKey,
  isInsufficientCreditsMessage,
  isRateLimitMessage,
} from "@/lib/ai/model";
import { resolveGenerationModelId } from "@/lib/ai/modelSetting";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";

import { buildSlidesPrompt } from "./buildPrompt";
import { slideDeckSchema } from "./deckSchema";
import { DEFAULT_LESSON_MINUTES } from "./fallbackDeck";
import { repairDeckText } from "./repair";
import { isFresh, loadDeck, saveDeck } from "./store";

/** A response that does not fit the deck is asked for once more. */
const MAX_ATTEMPTS = 2;

export type EnsureDeckResult = { ok: true } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): EnsureDeckResult => ({ ok: false, error, status });

export async function ensureDeck(input: {
  planId: string;
  contentJson: unknown;
  durationMinutes: number | null;
  /** Staff id of whoever asked; null for a share-link visitor. */
  generatedBy: string | null;
  regenerate?: boolean;
}): Promise<EnsureDeckResult> {
  const { planId, generatedBy, regenerate = false } = input;
  const plan = { contentJson: input.contentJson, durationMinutes: input.durationMinutes };
  const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
  if (!structured.success) return fail("not-structured", 400);

  if (!regenerate) {
    const existing = await loadDeck(planId);
    if (existing && isFresh(existing, plan.contentJson)) return { ok: true };
  }

  if (!hasApiKey()) return fail("no-api-key", 400);

  const modelId = await resolveGenerationModelId();
  const { system, prompt } = buildSlidesPrompt(
    structured.data,
    plan.durationMinutes ?? DEFAULT_LESSON_MINUTES,
  );

  // The deck is a large structured object: near-misses in its shape are
  // repaired before validation, and a response that still does not fit is
  // asked for once more before giving up (the teacher is waiting).
  let deck;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await generateObject({
        model: getModel(modelId),
        schema: slideDeckSchema,
        schemaName: "slide_deck",
        schemaDescription: "The pupil-facing slide deck a teacher drives one whole lesson with.",
        system,
        prompt,
        maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
        experimental_repairText: async ({ text }) => repairDeckText(text),
      });
      deck = result.object;
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ai/slides] generateObject error (attempt ${attempt}):`, message);
      if (isInsufficientCreditsMessage(message)) return fail("no-credits", 402);
      if (isRateLimitMessage(message)) return fail("rate-limit", 429);
      if (!NoObjectGeneratedError.isInstance(err) || attempt >= MAX_ATTEMPTS) {
        return fail("model-error", 502);
      }
    }
  }

  await saveDeck({
    planId,
    deck,
    contentJson: plan.contentJson,
    modelId,
    generatedBy,
  });
  return { ok: true };
}
