"use server";

/**
 * Share-link access: accept a Silverleaf Academy email address and remember it.
 * When email is configured the address must be proven with an emailed one-time
 * code (see `requestLoginCodeAction`).
 */
import { consumeLoginCode } from "@/lib/auth/loginCode";
import { isLoginCodeRequired } from "@/lib/auth/loginCodePolicy";
import { resolveSessionSecret } from "@/lib/auth/session-codec";
import { actionFailure, type ActionResult } from "@/lib/contracts";
import { isSchoolEmail, normalizeStaffEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { grantShareAccess } from "@/lib/share/viewer";

export async function shareAccessAction(
  email: string,
  code?: string,
): Promise<ActionResult<"invalid-input" | "not-school-email" | "invalid-code" | "failed">> {
  if (!email?.trim()) return actionFailure("invalid-input");
  if (!isSchoolEmail(email)) return actionFailure("not-school-email");
  if (
    isLoginCodeRequired() &&
    !consumeLoginCode(normalizeStaffEmail(email), code ?? "", resolveSessionSecret(env.SESSION_SECRET, env.NODE_ENV))
  ) {
    return actionFailure("invalid-code");
  }
  try {
    await grantShareAccess(email);
    return { ok: true };
  } catch (err) {
    return actionFailure("failed", { cause: err });
  }
}
