/**
 * POST /api/ai/slides — build (and save) the slide deck for one lesson plan.
 *
 * Body: `{ planId, regenerate? }`. Any signed-in teacher may trigger the FIRST
 * generation (or the rebuild of a stale deck) — the deck is then saved and
 * shared, so each plan costs one model call. `regenerate: true` (rebuild a
 * fresh deck on demand) is admin-only.
 *
 * Same model wiring as plan generation: the slug comes from the admin Settings
 * tab (`resolveGenerationModelId`), never the request. A deck that is already
 * fresh is not rebuilt — two teachers opening a new plan at once cost at most
 * one extra call, not one per page view.
 *
 * Errors are machine codes (the slides page maps them to i18n text):
 *   400 bad-request | no-api-key | not-structured   — do not retry
 *   403 forbidden                                    — regenerate by a teacher
 *   404 not-found                                    — no such (visible) plan
 *   402 no-credits · 429 rate-limit · 502 model-error — provider trouble
 *
 * Node runtime (NOT edge): auth, DB driver, and provider are server-only.
 */
import { and, eq } from "drizzle-orm";
import { generateObject, NoObjectGeneratedError } from "ai";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import {
  GENERATION_MAX_OUTPUT_TOKENS,
  getModel,
  hasApiKey,
  isInsufficientCreditsMessage,
  isRateLimitMessage,
} from "@/lib/ai/model";
import { resolveGenerationModelId } from "@/lib/ai/modelSetting";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { slideDeckSchema } from "@/lib/slides/deckSchema";
import { repairDeckText } from "@/lib/slides/repair";
import { buildSlidesPrompt } from "@/lib/slides/buildPrompt";
import { DEFAULT_LESSON_MINUTES } from "@/lib/slides/fallbackDeck";
import { isFresh, loadDeck, saveDeck } from "@/lib/slides/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A deck is smaller than a plan, but allow the same headroom. */
export const maxDuration = 60;

/** A response that does not fit the deck is asked for once more. */
const MAX_ATTEMPTS = 2;

const bodySchema = z.object({
  planId: z.string().uuid(),
  regenerate: z.boolean().optional(),
});

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("bad-request", 400);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return fail("bad-request", 400);
  const { planId, regenerate = false } = body.data;
  if (regenerate && !user.isAdmin) return fail("forbidden", 403);

  // Teachers see published plans only; admins may build slides for drafts too.
  const [plan] = await db
    .select({
      id: lessonPlans.id,
      contentJson: lessonPlans.contentJson,
      durationMinutes: lessonPlans.durationMinutes,
    })
    .from(lessonPlans)
    .where(
      user.isAdmin
        ? eq(lessonPlans.id, planId)
        : and(eq(lessonPlans.id, planId), eq(lessonPlans.status, "published")),
    )
    .limit(1);
  if (!plan) return fail("not-found", 404);

  const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
  if (!structured.success) return fail("not-structured", 400);

  if (!regenerate) {
    const existing = await loadDeck(planId);
    if (existing && isFresh(existing, plan.contentJson)) return Response.json({ ok: true });
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
    generatedBy: user.id,
  });
  return Response.json({ ok: true });
}
