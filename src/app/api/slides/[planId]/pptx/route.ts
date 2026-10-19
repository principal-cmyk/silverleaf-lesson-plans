/**
 * GET /api/slides/[planId]/pptx — the plan's slide deck as a PowerPoint file.
 *
 * Serves the saved AI deck while it matches the plan's current content, and
 * otherwise the basic deck built straight from the plan — a download never
 * fails just because AI is unavailable. It never generates: the slides page
 * and the bulk download ask `POST /api/ai/slides` for that first, so this
 * route stays fast and costs nothing. `X-Slides-Basic: 1` tells the caller
 * the file is the basic deck.
 *
 * Same visibility as the slides page: teachers get published plans only,
 * admins drafts too. Errors are machine codes, as in `/api/ai/slides`.
 */
import { and, eq } from "drizzle-orm";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { teacherExtras } from "@/lib/slides/deckToSlides";
import { DEFAULT_LESSON_MINUTES, fallbackDeck } from "@/lib/slides/fallbackDeck";
import { deckToPptx } from "@/lib/slides/pptx";
import { slidesFileName } from "@/lib/slides/fileName";
import { isFresh, loadDeck } from "@/lib/slides/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { planId } = await params;
  if (!UUID.test(planId)) return Response.json({ error: "bad-request" }, { status: 400 });

  const [plan] = await db
    .select({
      id: lessonPlans.id,
      title: lessonPlans.title,
      filename: lessonPlans.filename,
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
  if (!plan) return Response.json({ error: "not-found" }, { status: 404 });

  const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
  if (!structured.success) return Response.json({ error: "not-structured" }, { status: 400 });

  const saved = await loadDeck(plan.id);
  const basic = !(saved && isFresh(saved, plan.contentJson));
  const deck = basic
    ? fallbackDeck(structured.data, plan.durationMinutes ?? DEFAULT_LESSON_MINUTES)
    : saved!.deck;

  const file = await deckToPptx(deck, teacherExtras(structured.data), { title: plan.title });
  const name = slidesFileName(plan.filename);
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
      "x-slides-basic": basic ? "1" : "0",
    },
  });
}
