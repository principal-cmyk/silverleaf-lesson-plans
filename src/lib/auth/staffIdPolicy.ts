import { env } from "@/lib/env";

/** Work-email domain accepted when signing in with email only. */
export const STAFF_EMAIL_DOMAIN = "@silverleaf.co.tz";

/**
 * The Staff ID is only required when the ed-admin directory is configured
 * (it is what the ID is verified against). Without the directory, sign-in is
 * email-only, restricted to the school's email domain.
 */
export function isStaffIdRequired(): boolean {
  return Boolean(env.ED_ADMIN_API_TOKEN);
}
