import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { hasApiKey } from "@/lib/ai/model";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { teacherExtras } from "@/lib/slides/deckToSlides";
import { DEFAULT_LESSON_MINUTES, fallbackDeck } from "@/lib/slides/fallbackDeck";
import { isFresh, loadDeck } from "@/lib/slides/store";
import PrepareSlides from "./PrepareSlides";
import SlidePlayer from "./SlidePlayer";

/**
 * "Teach this lesson" — the classroom slide deck for one plan.
 *
 * Teachers reach it from a published plan's page; admins may open drafts too.
 * Three outcomes:
 *  - a saved deck built from the plan's current content → play it;
 *  - none yet (or the plan changed since) and AI is configured → generate it
 *    once on the client's request ({@link PrepareSlides}), then play it;
 *  - AI not configured → play the basic deck built straight from the plan.
 *
 * `?view=presenter` opens the teacher's notes view of the same deck.
 *
 * Dynamic: session read + per-plan data, never prerendered.
 */
export const dynamic = "force-dynamic";

export default async function TeachPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const view = (await searchParams).view === "presenter" ? "presenter" : "audience";
  const user = await requireUser();

  const [plan] = await db
    .select({
      id: lessonPlans.id,
      slug: lessonPlans.slug,
      contentJson: lessonPlans.contentJson,
      durationMinutes: lessonPlans.durationMinutes,
    })
    .from(lessonPlans)
    .where(
      user.isAdmin
        ? eq(lessonPlans.slug, slug)
        : and(eq(lessonPlans.slug, slug), eq(lessonPlans.status, "published")),
    )
    .limit(1);
  if (!plan) notFound();

  const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
  if (!structured.success) notFound();

  const planHref = `/plans/${plan.slug}`;
  const extras = teacherExtras(structured.data);
  const saved = await loadDeck(plan.id);

  if (saved && isFresh(saved, plan.contentJson)) {
    return (
      <SlidePlayer
        deck={saved.deck}
        extras={extras}
        planId={plan.id}
        planHref={planHref}
        view={view}
        basic={false}
        canRegenerate={user.isAdmin && hasApiKey()}
      />
    );
  }

  const fallback = fallbackDeck(structured.data, plan.durationMinutes ?? DEFAULT_LESSON_MINUTES);
  if (!hasApiKey()) {
    return (
      <SlidePlayer
        deck={fallback}
        extras={extras}
        planId={plan.id}
        planHref={planHref}
        view={view}
        basic
        canRegenerate={false}
      />
    );
  }

  return (
    <PrepareSlides
      planId={plan.id}
      planHref={planHref}
      fallback={fallback}
      extras={extras}
      view={view}
      canRegenerate={user.isAdmin}
    />
  );
}
