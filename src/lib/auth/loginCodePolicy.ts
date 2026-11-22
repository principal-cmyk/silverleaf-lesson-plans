import { isMailConfigured } from "@/lib/mail/smtp";

/**
 * Emailed one-time codes are required exactly when the app can send email
 * (SMTP_USER + SMTP_PASSWORD set). Without a mail account — local dev, tests,
 * the e2e run — sign-in stays email-only so nobody is locked out.
 */
export function isLoginCodeRequired(): boolean {
  return isMailConfigured();
}
