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
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { ensureDeck } from "@/lib/slides/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A deck is smaller than a plan, but allow the same headroom. */
export const maxDuration = 60;

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

  const made = await ensureDeck({
    planId,
    contentJson: plan.contentJson,
    durationMinutes: plan.durationMinutes,
    generatedBy: user.id,
    regenerate,
  });
  if (!made.ok) return fail(made.error, made.status);
  return Response.json({ ok: true });
}
