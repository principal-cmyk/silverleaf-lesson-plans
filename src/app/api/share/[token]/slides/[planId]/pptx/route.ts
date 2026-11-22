/**
 * GET /api/share/[token]/slides/[planId]/pptx — a plan's slides as a
 * PowerPoint file, from a share link (no sign-in). Never generates: it serves
 * the saved deck, or the basic deck built from the plan, exactly like the
 * signed-in route.
 */
import { planPptx } from "@/lib/slides/planPptx";
import { slidesFileName } from "@/lib/slides/fileName";
import { loadSharedPlan } from "@/lib/share/access";
import { hasShareAccess } from "@/lib/share/viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; planId: string }> },
): Promise<Response> {
  const { token, planId } = await params;
  if (!(await hasShareAccess())) return Response.json({ error: "sign-in-required" }, { status: 401 });
  const plan = await loadSharedPlan(token, planId);
  if (!plan) return Response.json({ error: "not-found" }, { status: 404 });

  const made = await planPptx(plan);
  if (!made) return Response.json({ error: "not-structured" }, { status: 400 });
  return new Response(new Uint8Array(made.file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${slidesFileName(plan.filename, plan.title)}"`,
      "cache-control": "no-store",
      "x-slides-basic": made.basic ? "1" : "0",
    },
  });
}
