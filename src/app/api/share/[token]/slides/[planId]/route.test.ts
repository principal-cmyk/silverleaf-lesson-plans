/**
 * Share-link slide routes: a working link reaches published plans only, a dead
 * or made-up link reaches nothing, and creating slides is rate limited.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { VALID_PLAN } from "../../../../../../../test/fixtures/structuredPlan";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const access = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/share/viewer", () => ({ hasShareAccess: async () => access.ok }));

import { savePlanStructured } from "@/lib/actions/aiStudio";
import { db } from "@/lib/db";
import { lessonPlans, staff } from "@/lib/db/schema";
import { createShareLink, newShareToken, revokeShareLink } from "@/lib/share/links";
import { requireAdmin } from "@/lib/auth";

import { GET as getPptx } from "./pptx/route";
import { POST } from "./route";

let token: string;
let linkId: string;
let published: string;
let draft: string;
let n = 0;

async function plan(publish: boolean): Promise<string> {
  n += 1;
  const res = await savePlanStructured(
    VALID_PLAN,
    { grade: "G4", subject: "Share", term: "1a", week: 1, lesson: n },
    { publish },
  );
  expect(res.ok).toBe(true);
  const [row] = await db.select({ id: lessonPlans.id }).from(lessonPlans).where(eq(lessonPlans.id, res.planId!));
  return row!.id;
}

beforeAll(async () => {
  const [a] = await db.insert(staff).values({ email: "share-admin@silverleaf.test", fullName: "A" }).returning();
  vi.mocked(requireAdmin).mockResolvedValue({
    id: a!.id,
    email: "share-admin@silverleaf.test",
    fullName: "A",
    isAdmin: true,
    roles: [],
    campus: null,
    jobTitle: null,
  });
  const link = await createShareLink("test", a!.id);
  token = link.token;
  linkId = link.id;
  published = await plan(true);
  draft = await plan(false);
});

const params = (t: string, planId: string) => ({ params: Promise.resolve({ token: t, planId }) });
const pptx = (t: string, id: string) => getPptx(new Request("http://test"), params(t, id));
const create = (t: string, id: string, ip = "1.1.1.1") =>
  POST(new Request("http://test", { method: "POST", headers: { "x-forwarded-for": ip } }), params(t, id));

describe("share link slides", () => {
  it("downloads a published plan's slides with no app sign-in", async () => {
    const res = await pptx(token, published);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/presentationml/);
  });

  it("needs a Silverleaf email: without one, both routes answer 401", async () => {
    access.ok = false;
    try {
      expect((await pptx(token, published)).status).toBe(401);
      expect((await create(token, published)).status).toBe(401);
    } finally {
      access.ok = true;
    }
  });

  it("refuses an unknown, malformed or draft target", async () => {
    expect((await pptx(newShareToken(), published)).status).toBe(404);
    expect((await pptx("short", published)).status).toBe(404);
    expect((await pptx(token, draft)).status).toBe(404);
    expect((await pptx(token, "not-a-uuid")).status).toBe(404);
    expect((await create(newShareToken(), published)).status).toBe(404);
    expect((await create(token, draft)).status).toBe(404);
  });

  it("rate limits creating slides per caller", async () => {
    const ip = "9.9.9.9";
    let last = 0;
    // The model key is unset in tests, so each allowed call answers 400 no-api-key.
    for (let i = 0; i < 11; i += 1) last = (await create(token, published, ip)).status;
    expect(last).toBe(429);
  });

  it("stops working once the link is turned off", async () => {
    expect(await revokeShareLink(linkId)).toBe(true);
    expect((await pptx(token, published)).status).toBe(404);
    expect((await create(token, published, "2.2.2.2")).status).toBe(404);
    expect(await revokeShareLink(linkId)).toBe(false);
  });
});
