/**
 * GET /api/slides/[planId]/pptx — serves the saved AI deck while it is fresh,
 * the basic deck otherwise, with the same visibility as the slides page.
 */
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_PLAN } from "../../../../../../test/fixtures/structuredPlan";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireAdmin, requireUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/contracts";
import { db } from "@/lib/db";
import { lessonPlans, staff } from "@/lib/db/schema";
import { savePlanStructured } from "@/lib/actions/aiStudio";
import { fallbackDeck } from "@/lib/slides/fallbackDeck";
import { saveDeck } from "@/lib/slides/store";

import { GET } from "./route";

let teacher: CurrentUser;
let admin: CurrentUser;
let lessonNo = 0;

beforeAll(async () => {
  const [t] = await db.insert(staff).values({ email: "pptx-teacher@silverleaf.test", fullName: "T" }).returning();
  const [a] = await db.insert(staff).values({ email: "pptx-admin@silverleaf.test", fullName: "A" }).returning();
  const mk = (id: string, email: string, isAdmin: boolean): CurrentUser => ({
    id,
    email,
    fullName: email,
    isAdmin,
    roles: [],
    campus: null,
    jobTitle: null,
  });
  teacher = mk(t!.id, "pptx-teacher@silverleaf.test", false);
  admin = mk(a!.id, "pptx-admin@silverleaf.test", true);
  vi.mocked(requireAdmin).mockResolvedValue(admin);
});

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue(teacher);
});

/** A fresh plan of our own, with the content_json as stored (identifier filled in). */
async function makePlan(
  publish = true,
): Promise<{ id: string; filename: string; contentJson: unknown }> {
  lessonNo += 1;
  const res = await savePlanStructured(
    VALID_PLAN,
    { grade: "G4", subject: "Pptx", term: "1a", week: 1, lesson: lessonNo },
    { publish },
  );
  expect(res.ok).toBe(true);
  const [row] = await db
    .select({ id: lessonPlans.id, filename: lessonPlans.filename, contentJson: lessonPlans.contentJson })
    .from(lessonPlans)
    .where(eq(lessonPlans.id, res.planId!));
  return row!;
}

const get = (planId: string) => GET(new Request("http://test"), { params: Promise.resolve({ planId }) });

/** The first slide's XML (the title slide). */
async function titleSlide(res: Response): Promise<string> {
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  return strFromU8(files["ppt/slides/slide1.xml"]!);
}

describe("GET /api/slides/[planId]/pptx", () => {
  it("serves the saved AI deck as a named PowerPoint attachment", async () => {
    const plan = await makePlan();
    const deck = { ...fallbackDeck(VALID_PLAN), title: { heading: "AI TITLE", subheading: "", script: [{ kind: "say" as const, text: "Hi." }] } };
    await saveDeck({ planId: plan.id, deck, contentJson: plan.contentJson, modelId: "m", generatedBy: null });

    const res = await get(plan.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/presentationml/);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${plan.filename}_Slides.pptx"`,
    );
    expect(res.headers.get("x-slides-basic")).toBe("0");
    expect(await titleSlide(res)).toContain("AI TITLE");
  });

  it("falls back to the basic deck when there is no deck, or it is out of date", async () => {
    const plan = await makePlan();
    const none = await get(plan.id);
    expect(none.headers.get("x-slides-basic")).toBe("1");
    expect(await titleSlide(none)).toContain(VALID_PLAN.identifier.title);

    const stale = { ...fallbackDeck(VALID_PLAN), title: { heading: "OLD", subheading: "", script: [{ kind: "say" as const, text: "Hi." }] } };
    await saveDeck({
      planId: plan.id,
      deck: stale,
      contentJson: { ...VALID_PLAN, success_criteria: ["Students can do an older thing."] },
      modelId: "m",
      generatedBy: null,
    });
    const res = await get(plan.id);
    expect(res.headers.get("x-slides-basic")).toBe("1");
    expect(await titleSlide(res)).not.toContain("OLD");
  });

  it("hides drafts from teachers but serves them to admins", async () => {
    const plan = await makePlan(false);
    expect((await get(plan.id)).status).toBe(404);
    vi.mocked(requireUser).mockResolvedValue(admin);
    expect((await get(plan.id)).status).toBe(200);
  });

  it("rejects a malformed id", async () => {
    expect((await get("nope")).status).toBe(400);
  });
});
