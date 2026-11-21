"use server";

/**
 * Admin server actions — teacher share links. Admin-only; the public share
 * pages themselves expose no actions at all.
 */
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { actionFailure, type ActionResult } from "@/lib/contracts";
import { createShareLink, revokeShareLink } from "@/lib/share/links";

export async function createShareLinkAction(label: string): Promise<ActionResult> {
  const user = await requireAdmin();
  const clean = label.trim().slice(0, 120);
  if (!clean) return actionFailure("invalid-input");
  try {
    await createShareLink(clean, user.id);
    revalidatePath("/[locale]/admin/plans/share", "page");
    return { ok: true };
  } catch (err) {
    return actionFailure("failed", { cause: err });
  }
}

export async function revokeShareLinkAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const done = await revokeShareLink(id);
    if (!done) return actionFailure("not-found");
    revalidatePath("/[locale]/admin/plans/share", "page");
    return { ok: true };
  } catch (err) {
    return actionFailure("failed", { cause: err });
  }
}
