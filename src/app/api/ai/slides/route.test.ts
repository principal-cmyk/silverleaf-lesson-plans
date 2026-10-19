/**
 * POST /api/ai/slides — generation, sharing and freshness of saved decks,
 * against the in-memory PGlite. Only the signed-in user and the model call are
 * mocked.
 */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_PLAN } from "../../../../../test/fixtures/structuredPlan";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: vi.fn(),
}));
vi.mock("@/lib/ai/model", () => ({
  GENERATION_MAX_OUTPUT_TOKENS: 1000,
  getModel: vi.fn(() => ({})),
  hasApiKey: vi.fn(() => true),
  isInsufficientCreditsMessage: (m: string) => /credit/i.test(m),
  isRateLimitMessage: (m: string) => /rate limit/i.test(m),
}));
vi.mock("@/lib/ai/modelSetting", () => ({
  resolveGenerationModelId: vi.fn(async () => "test/model"),
}));

import { generateObject, NoObjectGeneratedError } from "ai";
import { requireAdmin, requireUser } from "@/lib/auth";
import { hasApiKey } from "@/lib/ai/model";
import type { CurrentUser } from "@/lib/contracts";
import { db } from "@/lib/db";
import { lessonPlans, lessonSlideDecks, staff } from "@/lib/db/schema";
import { savePlanStructured } from "@/lib/actions/aiStudio";
import { fallbackDeck } from "@/lib/slides/fallbackDeck";
import { isFresh, loadDeck } from "@/lib/slides/store";

import { POST } from "./route";

const DECK = fallbackDeck(VALID_PLAN);
let teacher: CurrentUser;
let admin: CurrentUser;
let lessonNo = 0;

function user(id: string, email: string, isAdmin: boolean): CurrentUser {
  return { id, email, fullName: email, isAdmin, roles: [], campus: null, jobTitle: null };
}

beforeAll(async () => {
  const [t] = await db.insert(staff).values({ email: "slides-teacher@silverleaf.test", fullName: "T" }).returning();
  const [a] = await db.insert(staff).values({ email: "slides-admin@silverleaf.test", fullName: "A" }).returning();
  teacher = user(t!.id, "slides-teacher@silverleaf.test", false);
  admin = user(a!.id, "slides-admin@silverleaf.test", true);
  vi.mocked(requireAdmin).mockResolvedValue(admin);
});

beforeEach(() => {
  vi.mocked(generateObject).mockReset();
  vi.mocked(generateObject).mockResolvedValue({ object: DECK } as never);
  vi.mocked(hasApiKey).mockReturnValue(true);
  vi.mocked(requireUser).mockResolvedValue(teacher);
});

/** A fresh plan of our own (published unless told otherwise). */
async function makePlan(publish = true): Promise<string> {
  lessonNo += 1;
  const res = await savePlanStructured(
    VALID_PLAN,
    { grade: "G3", subject: "Slides", term: "1a", week: 1, lesson: lessonNo },
    { publish },
  );
  expect(res.ok).toBe(true);
  return res.planId!;
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://test/api/ai/slides", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/ai/slides", () => {
  it("generates a deck once and shares it: a second open costs no model call", async () => {
    const planId = await makePlan();
    expect((await post({ planId })).status).toBe(200);
    expect(generateObject).toHaveBeenCalledTimes(1);

    const saved = await loadDeck(planId);
    expect(saved?.deck.title.heading).toBe(DECK.title.heading);
    expect(saved?.modelId).toBe("test/model");
    expect(saved?.generatedBy).toBe(teacher.id);

    expect((await post({ planId })).status).toBe(200);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("rebuilds a deck whose plan content has changed, but not after a status change", async () => {
    const planId = await makePlan();
    await post({ planId });

    await db.update(lessonPlans).set({ status: "draft" }).where(eq(lessonPlans.id, planId));
    await db.update(lessonPlans).set({ status: "published" }).where(eq(lessonPlans.id, planId));
    const [row] = await db.select().from(lessonPlans).where(eq(lessonPlans.id, planId));
    expect(isFresh((await loadDeck(planId))!, row!.contentJson)).toBe(true);

    const edited = { ...VALID_PLAN, success_criteria: ["Students can do something new."] };
    await db.update(lessonPlans).set({ contentJson: edited }).where(eq(lessonPlans.id, planId));
    expect(isFresh((await loadDeck(planId))!, edited)).toBe(false);

    expect((await post({ planId })).status).toBe(200);
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(isFresh((await loadDeck(planId))!, edited)).toBe(true);
  });

  it("lets only an admin force a rebuild", async () => {
    const planId = await makePlan();
    await post({ planId });

    const denied = await post({ planId, regenerate: true });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "forbidden" });

    vi.mocked(requireUser).mockResolvedValue(admin);
    expect((await post({ planId, regenerate: true })).status).toBe(200);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("hides draft plans from teachers but not from admins", async () => {
    const planId = await makePlan(false);
    expect((await post({ planId })).status).toBe(404);
    vi.mocked(requireUser).mockResolvedValue(admin);
    expect((await post({ planId })).status).toBe(200);
  });

  it("reports a missing API key without calling the model", async () => {
    vi.mocked(hasApiKey).mockReturnValue(false);
    const res = await post({ planId: await makePlan() });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no-api-key" });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("maps provider trouble to retryable codes and saves nothing", async () => {
    const planId = await makePlan();
    vi.mocked(generateObject).mockRejectedValueOnce(new Error("429 rate limit exceeded"));
    const busy = await post({ planId });
    expect(busy.status).toBe(429);
    expect(await busy.json()).toEqual({ error: "rate-limit" });
    expect(await loadDeck(planId)).toBeNull();

    vi.mocked(generateObject).mockRejectedValueOnce(new Error("socket hang up"));
    expect((await post({ planId })).status).toBe(502);
  });

  it("asks once more when a response does not fit the deck, then saves the good one", async () => {
    const planId = await makePlan();
    const misfit = new NoObjectGeneratedError({
      message: "No object generated: response did not match schema.",
      text: "{}",
      response: { id: "r", timestamp: new Date(), modelId: "test/model" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never,
      finishReason: "stop",
    });
    vi.mocked(generateObject).mockRejectedValueOnce(misfit);
    expect((await post({ planId })).status).toBe(200);
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(await loadDeck(planId)).not.toBeNull();

    // Two misfits in a row give up, as a retryable model error.
    const other = await makePlan();
    vi.mocked(generateObject).mockRejectedValueOnce(misfit).mockRejectedValueOnce(misfit);
    expect((await post({ planId: other })).status).toBe(502);
  });

  it("rejects a malformed body", async () => {
    expect((await post({ planId: "not-a-uuid" })).status).toBe(400);
  });

  it("deletes a plan's deck with the plan", async () => {
    const planId = await makePlan();
    await post({ planId });
    await db.delete(lessonPlans).where(eq(lessonPlans.id, planId));
    const left = await db.select().from(lessonSlideDecks).where(eq(lessonSlideDecks.planId, planId));
    expect(left).toHaveLength(0);
  });
});
