import "server-only";

/**
 * What a share link may reach: published plans only, and only while the link
 * has not been revoked. Both share routes go through here so the rule lives in
 * one place.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";

import { findActiveShareLink } from "./links";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SharedPlan = {
  id: string;
  title: string;
  filename: string;
  contentJson: unknown;
  durationMinutes: number | null;
};

/** The published plan, or null when the link is off or the plan is not visible. */
export async function loadSharedPlan(token: string, planId: string): Promise<SharedPlan | null> {
  if (!UUID.test(planId)) return null;
  const link = await findActiveShareLink(token);
  if (!link) return null;
  const [plan] = await db
    .select({
      id: lessonPlans.id,
      title: lessonPlans.title,
      filename: lessonPlans.filename,
      contentJson: lessonPlans.contentJson,
      durationMinutes: lessonPlans.durationMinutes,
    })
    .from(lessonPlans)
    .where(and(eq(lessonPlans.id, planId), eq(lessonPlans.status, "published")))
    .limit(1);
  return plan ?? null;
}
