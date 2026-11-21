/**
 * GET /api/bundles/term?grade=G2&term=1a[&subject=Math] — a ZIP of that
 * grade and term's published lesson plans and slides, by subject.
 *
 * Open to any signed-in teacher. Errors are machine codes, as in the other
 * API routes. `X-Bundle-Missing-Forms` counts plans whose lesson-plan PDF an
 * admin has not prepared yet (also listed in the ZIP's README.txt).
 */
import { requireUser } from "@/lib/auth";
import { buildTermZip } from "@/lib/bundles/termBundle";
import { parseGradeParam, parseTermParam } from "@/lib/admin/gradeTerm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Building a whole grade makes a few hundred decks. */
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  await requireUser();
  const q = new URL(req.url).searchParams;
  const gradeNum = parseGradeParam(q.get("grade") ?? undefined);
  const term = parseTermParam(q.get("term") ?? undefined);
  if (gradeNum == null || !term) return Response.json({ error: "bad-request" }, { status: 400 });
  const subject = q.get("subject")?.trim() || undefined;

  const zip = await buildTermZip(gradeNum, term, subject);
  if (!zip) return Response.json({ error: "not-found" }, { status: 404 });

  return new Response(new Uint8Array(zip.data), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${zip.name}"`,
      "cache-control": "no-store",
      "x-bundle-missing-forms": String(zip.missingForms),
    },
  });
}
