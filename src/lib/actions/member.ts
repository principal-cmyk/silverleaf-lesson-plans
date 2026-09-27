"use server";

/**
 * Member server actions — sign-in / sign-out entry points for the teacher
 * experience. Every action re-resolves identity server-side (never trusts a
 * client-supplied id).
 */
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/lib/auth";
import { verifyEdAdminStaff } from "@/lib/auth/ed-admin";
import type { ActionResult } from "@/lib/contracts";
import { staffRepo } from "@/lib/db/repositories";
import { env } from "@/lib/env";
import { normalizeStaffEmail } from "@/lib/email";

/**
 * Error codes:
 * - "not-registered" → email + Staff ID don't match a known account.
 * - "inactive"       → matched account is disabled.
 * - "invalid-input"  → email or Staff ID was empty.
 * - "failed"         → the directory could not be reached, the deployment is
 *                      misconfigured (no directory token in production), or
 *                      another error.
 */
export type SignInResult = ActionResult<
  "not-registered" | "inactive" | "invalid-input" | "failed"
>;

/**
 * Is the seeded-staff demo fallback allowed in this environment?
 *
 * Outside production it always is (local dev / e2e run without the ed-admin
 * directory). In production it requires the explicit ALLOW_DEMO_AUTH opt-in,
 * so a deploy that loses ED_ADMIN_API_TOKEN fails closed instead of silently
 * accepting email-only sign-in.
 */
function isDemoAuthAllowed(): boolean {
  // ALLOW_DEMO_AUTH is parsed strictly in env.ts: only "1"/"true" are the
  // opt-in — "false"/"0" must never re-open unverified sign-in.
  return env.NODE_ENV !== "production" || env.ALLOW_DEMO_AUTH;
}

/**
 * Sign a staff member in by their work email + Staff ID.
 *
 * Production gates on the ed-admin staff directory (ED_ADMIN_API_TOKEN). When
 * that directory is NOT configured (local demo / showcase), we fall back to the
 * seeded `staff` table so the app can be signed into without the external
 * directory — but never silently in production (see `isDemoAuthAllowed`).
 * Admin privilege is still granted by the email provider via HR_ADMIN_EMAILS
 * after this check passes.
 */
export async function signInMemberAction(input: {
  email: string;
  staffId: string;
}): Promise<SignInResult> {
  const email = normalizeStaffEmail(input.email);
  const staffId = input.staffId?.trim() ?? "";
  if (!email || !staffId) {
    return { ok: false, error: "invalid-input" };
  }

  try {
    // Demo / local fallback — verify against the seeded staff table.
    if (!env.ED_ADMIN_API_TOKEN) {
      if (!isDemoAuthAllowed()) {
        console.error(
          "[auth] Sign-in rejected: ED_ADMIN_API_TOKEN is not set in " +
            "production. Set it, or set ALLOW_DEMO_AUTH=1 to explicitly " +
            "allow the unverified demo fallback.",
        );
        return { ok: false, error: "failed" };
      }
      const staff = await staffRepo.findStaffByEmail(email);
      if (!staff) return { ok: false, error: "not-registered" };
      await signIn(email, staff.fullName ?? undefined);
      return { ok: true };
    }

    const verdict = await verifyEdAdminStaff(email, staffId);
    if (!verdict.ok) {
      if (verdict.reason === "inactive") return { ok: false, error: "inactive" };
      if (verdict.reason === "api-error") return { ok: false, error: "failed" };
      return { ok: false, error: "not-registered" };
    }

    await signIn(email, verdict.fullName || undefined);
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * Sign the current member out and return them to the sign-in page. The locale
 * middleware rewrites the bare path to the active locale.
 */
export async function signOutMemberAction(): Promise<void> {
  await signOut();
  redirect("/sign-in");
}
