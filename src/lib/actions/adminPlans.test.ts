/**
 * Tests for the admin plans listing's bulk actions (select all → publish /
 * unpublish / delete) against the in-memory PGlite from test/setup.ts.
 *
 * `requireAdmin` and `revalidatePath` are mocked (no session or route cache in
 * the test process); plans are created through the real `savePlanStructured`.
 */
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { VALID_PLAN } from "../../../test/fixtures/structuredPlan";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonPlans, planFeedback, staff } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/contracts";
import { savePlanStructured } from "./aiStudio";
import { bulkDeletePlans, bulkSetPlanStatus, listPlanIds } from "./adminPlans";

let adminId = "";

beforeAll(async () => {
  const [admin] = await db
    .insert(staff)
    .values({ email: "bulk-test@silverleaf.test", fullName: "Bulk Tester" })
    .returning();
  adminId = admin!.id;
  const user: CurrentUser = {
    id: adminId,
    email: "bulk-test@silverleaf.test",
    fullName: "Bulk Tester",
    isAdmin: true,
    roles: [],
    campus: null,
    jobTitle: null,
  };
  vi.mocked(requireAdmin).mockResolvedValue(user);
});

/** Create `n` draft plans in a subject unique to the calling test. */
async function makePlans(subject: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let lesson = 1; lesson <= n; lesson++) {
    const res = await savePlanStructured(
      VALID_PLAN,
      { grade: "G3", subject, term: "1a", week: 1, lesson },
      { publish: false },
    );
    expect(res.ok).toBe(true);
    ids.push(res.planId!);
  }
  return ids;
}

async function statuses(ids: string[]) {
  const rows = await db
    .select({ id: lessonPlans.id, status: lessonPlans.status })
    .from(lessonPlans)
    .where(inArray(lessonPlans.id, ids));
  return new Map(rows.map((r) => [r.id, r.status]));
}

describe("listPlanIds", () => {
  it("returns every matching id in canonical order, beyond one page", async () => {
    // 14 > PAGE_SIZE (12): "Select all" must reach rows "Show more" hasn't loaded.
    const ids = await makePlans("Listing", 14);
    const res = await listPlanIds({ subject: "Listing" });
    expect(res.ok).toBe(true);
    expect(res.ids).toEqual(ids);
  });
});

describe("bulkSetPlanStatus", () => {
  it("publishes and unpublishes every selected plan in one call", async () => {
    const ids = await makePlans("BulkStatus", 3);

    const published = await bulkSetPlanStatus(ids, "published");
    expect(published).toMatchObject({ ok: true, updated: 3 });
    expect([...(await statuses(ids)).values()]).toEqual([
      "published",
      "published",
      "published",
    ]);

    const drafted = await bulkSetPlanStatus(ids.slice(0, 2), "draft");
    expect(drafted).toMatchObject({ ok: true, updated: 2 });
    const after = await statuses(ids);
    expect(after.get(ids[0]!)).toBe("draft");
    expect(after.get(ids[2]!)).toBe("published");
  });

  it("rejects an empty selection or an unknown status", async () => {
    expect(await bulkSetPlanStatus([], "published")).toMatchObject({
      ok: false,
      error: "invalid-input",
    });
    const [id] = await makePlans("BulkBadStatus", 1);
    expect(
      await bulkSetPlanStatus([id!], "archived" as unknown as "draft"),
    ).toMatchObject({ ok: false, error: "invalid-input" });
  });
});

describe("bulkDeletePlans", () => {
  it("deletes the free plans and keeps the ones teachers have rated", async () => {
    const ids = await makePlans("BulkDelete", 3);
    // Feedback FKs the plan without a cascade, so this one must survive.
    await db.insert(planFeedback).values({ staffId: adminId, planId: ids[1]!, rating: 5 });

    const res = await bulkDeletePlans(ids);
    expect(res.ok).toBe(true);
    expect(res.deleted).toEqual([ids[0], ids[2]]);
    expect(res.blocked).toEqual([ids[1]]);

    const left = await db
      .select({ id: lessonPlans.id })
      .from(lessonPlans)
      .where(eq(lessonPlans.subject, "BulkDelete"));
    expect(left.map((r) => r.id)).toEqual([ids[1]]);
  });
});
