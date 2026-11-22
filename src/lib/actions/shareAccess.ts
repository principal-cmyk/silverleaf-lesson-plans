"use server";

/** Share-link access: accept a Silverleaf Academy email address and remember it. */
import { actionFailure, type ActionResult } from "@/lib/contracts";
import { isSchoolEmail } from "@/lib/email";
import { grantShareAccess } from "@/lib/share/viewer";

export async function shareAccessAction(email: string): Promise<ActionResult<"invalid-input" | "not-school-email" | "failed">> {
  if (!email?.trim()) return actionFailure("invalid-input");
  if (!isSchoolEmail(email)) return actionFailure("not-school-email");
  try {
    await grantShareAccess(email);
    return { ok: true };
  } catch (err) {
    return actionFailure("failed", { cause: err });
  }
}
