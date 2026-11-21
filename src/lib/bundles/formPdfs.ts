import "server-only";

/**
 * Stored government-form PDFs (table `plan_form_pdfs`) — save one, and read
 * back the ones that are still current for a set of plans.
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { lessonPlans, planFormPdfs } from "@/lib/db/schema";
import { contentHash } from "@/lib/slides/store";
import { getStorage } from "@/lib/storage";

/** A form PDF is a few hundred KB; this only stops a runaway upload. */
export const MAX_FORM_PDF_BYTES = 4 * 1024 * 1024;

const PDF_MAGIC = "%PDF-";

/** Does this look like a PDF? (Magic bytes only — the admin's own browser made it.) */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > PDF_MAGIC.length &&
    PDF_MAGIC.split("").every((c, i) => bytes[i] === c.charCodeAt(0))
  );
}

/** Save (replace) the form PDF for a plan, stamped with the plan's current content. */
export async function saveFormPdf(input: {
  planId: string;
  filename: string;
  bytes: Uint8Array;
  contentJson: unknown;
  createdBy: string | null;
}): Promise<void> {
  const storage = getStorage();
  const [existing] = await db
    .select({ fileKey: planFormPdfs.fileKey })
    .from(planFormPdfs)
    .where(eq(planFormPdfs.planId, input.planId))
    .limit(1);

  const { key } = await storage.upload({
    filename: `${input.filename}_Government_Form.pdf`,
    contentType: "application/pdf",
    data: input.bytes,
  });
  const values = {
    planId: input.planId,
    fileKey: key,
    sizeBytes: input.bytes.length,
    sourceHash: contentHash(input.contentJson),
    createdBy: input.createdBy,
  };
  await db
    .insert(planFormPdfs)
    .values(values)
    .onConflictDoUpdate({ target: planFormPdfs.planId, set: values });
  if (existing && existing.fileKey !== key) await storage.delete(existing.fileKey);
}

/** Plan ids (of those asked about) whose stored form PDF still matches the plan. */
export async function currentFormPdfIds(planIds: string[]): Promise<Set<string>> {
  if (planIds.length === 0) return new Set();
  const rows = await db
    .select({ id: lessonPlans.id, contentJson: lessonPlans.contentJson, hash: planFormPdfs.sourceHash })
    .from(planFormPdfs)
    .innerJoin(lessonPlans, eq(lessonPlans.id, planFormPdfs.planId))
    .where(inArray(planFormPdfs.planId, planIds));
  return new Set(rows.filter((r) => r.hash === contentHash(r.contentJson)).map((r) => r.id));
}

/** The stored PDF's bytes if it is still current for this plan, else null. */
export async function readCurrentFormPdf(
  planId: string,
  contentJson: unknown,
): Promise<Buffer | null> {
  const [row] = await db
    .select({ fileKey: planFormPdfs.fileKey, hash: planFormPdfs.sourceHash })
    .from(planFormPdfs)
    .where(eq(planFormPdfs.planId, planId))
    .limit(1);
  if (!row || row.hash !== contentHash(contentJson)) return null;
  return getStorage().read(row.fileKey);
}
