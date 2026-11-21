/**
 * PUT /api/admin/form-pdfs/[planId] — store the government-form PDF an admin's
 * browser just drew for a plan (raw `application/pdf` body). Admin only. It
 * feeds the teachers' term download; see `src/lib/bundles`.
 */
import { eq } from "drizzle-orm";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { looksLikePdf, MAX_FORM_PDF_BYTES, saveFormPdf } from "@/lib/bundles/formPdfs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ planId: string }> },
): Promise<Response> {
  const user = await requireUser();
  if (!user.isAdmin) return Response.json({ error: "forbidden" }, { status: 403 });
  const { planId } = await params;
  if (!UUID.test(planId)) return Response.json({ error: "bad-request" }, { status: 400 });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_FORM_PDF_BYTES) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  if (!looksLikePdf(bytes)) return Response.json({ error: "bad-request" }, { status: 400 });

  const [plan] = await db
    .select({ filename: lessonPlans.filename, contentJson: lessonPlans.contentJson })
    .from(lessonPlans)
    .where(eq(lessonPlans.id, planId))
    .limit(1);
  if (!plan) return Response.json({ error: "not-found" }, { status: 404 });

  await saveFormPdf({
    planId,
    filename: plan.filename,
    bytes,
    contentJson: plan.contentJson,
    createdBy: user.id,
  });
  return Response.json({ ok: true });
}
