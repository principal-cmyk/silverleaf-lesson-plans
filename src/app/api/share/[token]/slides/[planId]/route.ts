/**
 * POST /api/share/[token]/slides/[planId] — create the slide deck for a plan
 * from a share link (no sign-in). Same generation as the signed-in route, but
 * rate limited because anyone holding the link can call it: per caller and per
 * link. `regenerate` does not exist here — an existing fresh deck is kept.
 */
import { ensureDeck } from "@/lib/slides/generate";
import { loadSharedPlan } from "@/lib/share/access";
import { hasShareAccess } from "@/lib/share/viewer";
import { callerId, perCallerLimit, perLinkLimit } from "@/lib/share/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string; planId: string }> },
): Promise<Response> {
  const { token, planId } = await params;
  if (!(await hasShareAccess())) return fail("sign-in-required", 401);
  const plan = await loadSharedPlan(token, planId);
  if (!plan) return fail("not-found", 404);

  // Counted before the model is called; a deck that already exists costs nothing,
  // but the check is cheap and keeps the limit simple to reason about.
  if (!perCallerLimit.take(callerId(req)) || !perLinkLimit.take(token)) {
    return fail("too-many", 429);
  }

  const made = await ensureDeck({
    planId,
    contentJson: plan.contentJson,
    durationMinutes: plan.durationMinutes,
    generatedBy: null,
  });
  if (!made.ok) return fail(made.error, made.status);
  return Response.json({ ok: true });
}
