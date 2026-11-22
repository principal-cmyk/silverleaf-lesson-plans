"use server";

/**
 * Email a one-time login code to a school address. The code is checked later
 * by the sign-in actions (`signInMemberAction`, `shareAccessAction`) — never
 * by the browser.
 *
 * Error codes: "invalid-input" (not a school address), "too-soon" /
 * "too-many" (asked too often), "not-configured" (no mail account),
 * "failed" (the email could not be sent).
 */
import { discardLoginCode, issueLoginCode } from "@/lib/auth/loginCode";
import { isLoginCodeRequired } from "@/lib/auth/loginCodePolicy";
import { resolveSessionSecret } from "@/lib/auth/session-codec";
import { actionFailure, type ActionResult } from "@/lib/contracts";
import { isSchoolEmail, normalizeStaffEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail/smtp";

export type RequestLoginCodeResult = ActionResult<
  "invalid-input" | "too-soon" | "too-many" | "not-configured" | "failed"
>;

export async function requestLoginCodeAction(input: string): Promise<RequestLoginCodeResult> {
  const email = normalizeStaffEmail(input ?? "");
  if (!isSchoolEmail(email)) return actionFailure("invalid-input");
  if (!isLoginCodeRequired()) return actionFailure("not-configured");

  const issued = issueLoginCode(email, resolveSessionSecret(env.SESSION_SECRET, env.NODE_ENV));
  if (!issued.ok) return actionFailure(issued.reason);

  try {
    await sendMail({
      to: email,
      subject: `Your Silverleaf sign-in code: ${issued.code}`,
      text:
        `Your Silverleaf Lesson Plans sign-in code is:\n\n    ${issued.code}\n\n` +
        `It works once and expires in 10 minutes. If you did not ask for it, ignore this email.\n\n` +
        `Nambari yako ya kuingia Silverleaf Lesson Plans ni: ${issued.code}\n` +
        `Inatumika mara moja na huisha baada ya dakika 10. Kama hukuiomba, puuza barua pepe hii.\n`,
    });
    return { ok: true };
  } catch (err) {
    discardLoginCode(email);
    return actionFailure("failed", { cause: err });
  }
}
