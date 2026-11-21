/**
 * The term download: GET /api/bundles/term zips a grade/term's published
 * plans (stored form PDFs + built slides), and PUT /api/admin/form-pdfs/[planId]
 * is how the PDFs get there.
 */
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_PLAN } from "../../../../../test/fixtures/structuredPlan";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => {
  const files = new Map<string, Buffer>();
  let n = 0;
  return {
    getStorage: () => ({
      upload: async ({ data }: { data: Uint8Array }) => {
        const key = `k${(n += 1)}`;
        files.set(key, Buffer.from(data));
        return { key, url: key };
      },
      read: async (key: string) => files.get(key) ?? null,
      delete: async (key: string) => void files.delete(key),
    }),
  };
});

import { requireAdmin, requireUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/contracts";
import { db } from "@/lib/db";
import { lessonPlans, staff } from "@/lib/db/schema";
import { savePlanStructured } from "@/lib/actions/aiStudio";
import { PUT } from "@/app/api/admin/form-pdfs/[planId]/route";

import { GET } from "./route";

let teacher: CurrentUser;
let admin: CurrentUser;
let lessonNo = 0;

beforeAll(async () => {
  const mk = async (email: string, isAdmin: boolean): Promise<CurrentUser> => {
    const [row] = await db.insert(staff).values({ email, fullName: email }).returning();
    return { id: row!.id, email, fullName: email, isAdmin, roles: [], campus: null, jobTitle: null };
  };
  teacher = await mk("bundle-teacher@silverleaf.test", false);
  admin = await mk("bundle-admin@silverleaf.test", true);
  vi.mocked(requireAdmin).mockResolvedValue(admin);
});

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue(teacher);
});

async function makePlan(subject: string, publish = true) {
  lessonNo += 1;
  const res = await savePlanStructured(
    VALID_PLAN,
    { grade: "G5", subject, term: "1a", week: 1, lesson: lessonNo },
    { publish },
  );
  expect(res.ok).toBe(true);
  const [row] = await db
    .select({ id: lessonPlans.id, filename: lessonPlans.filename })
    .from(lessonPlans)
    .where(eq(lessonPlans.id, res.planId!));
  return row!;
}

const pdf = () => new TextEncoder().encode("%PDF-1.4 test");
const put = (planId: string, body: BodyInit) =>
  PUT(new Request("http://test", { method: "PUT", body }), { params: Promise.resolve({ planId }) });
const get = (qs: string) => GET(new Request(`http://test/api/bundles/term?${qs}`));
const entries = async (res: Response) => unzipSync(new Uint8Array(await res.arrayBuffer()));

describe("term bundle", () => {
  it("zips a subject's plan PDFs and slides, and says which PDFs are missing", async () => {
    const a = await makePlan("Zipsubj");
    const b = await makePlan("Zipsubj");
    vi.mocked(requireUser).mockResolvedValue(admin);
    expect((await put(a.id, pdf())).status).toBe(200);
    vi.mocked(requireUser).mockResolvedValue(teacher);

    const res = await get("grade=G5&term=1a&subject=Zipsubj");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="G5_Term1A_Zipsubj.zip"');
    expect(res.headers.get("x-bundle-missing-forms")).toBe("1");

    const files = await entries(res);
    expect(Object.keys(files).sort()).toEqual(
      [
        `Lesson_Plans/${a.filename}_Lesson_Plan.pdf`,
        `Slides/${a.filename}_Slides.pptx`,
        `Slides/${b.filename}_Slides.pptx`,
        "README.txt",
      ].sort(),
    );
    expect(strFromU8(files["README.txt"]!)).toContain(b.filename);
  });

  it("groups by subject when no subject is given, and leaves drafts out", async () => {
    const pub = await makePlan("Whole");
    const draft = await makePlan("Whole", false);
    const files = await entries(await get("grade=G5&term=1a"));
    const names = Object.keys(files);
    expect(names).toContain(`Whole/Slides/${pub.filename}_Slides.pptx`);
    expect(names.some((n) => n.includes(draft.filename))).toBe(false);
  });

  it("drops a PDF once its plan's content changes", async () => {
    const plan = await makePlan("Stale");
    vi.mocked(requireUser).mockResolvedValue(admin);
    await put(plan.id, pdf());
    await db
      .update(lessonPlans)
      .set({ contentJson: { ...VALID_PLAN, success_criteria: ["Something new."] } })
      .where(eq(lessonPlans.id, plan.id));
    vi.mocked(requireUser).mockResolvedValue(teacher);
    const files = await entries(await get("grade=G5&term=1a&subject=Stale"));
    expect(Object.keys(files).some((n) => n.startsWith("Lesson_Plans/"))).toBe(false);
  });

  it("answers bad requests and empty terms with machine codes", async () => {
    expect((await get("grade=G5")).status).toBe(400);
    expect((await get("grade=G5&term=2b&subject=Nothing")).status).toBe(404);
  });

  it("only lets admins store PDFs, and only real PDFs", async () => {
    const plan = await makePlan("Guard");
    expect((await put(plan.id, pdf())).status).toBe(403);
    vi.mocked(requireUser).mockResolvedValue(admin);
    expect((await put(plan.id, "not a pdf at all")).status).toBe(400);
    expect((await put("nope", pdf())).status).toBe(400);
  });
});
