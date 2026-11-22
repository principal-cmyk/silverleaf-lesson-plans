export function normalizeStaffEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The school's email domain: the only addresses a share link opens for. */
export const SCHOOL_EMAIL_DOMAIN = "silverleaf.co.tz";

/** True for a plain `name@silverleaf.co.tz` address (case-insensitive, no lookalike domains). */
export function isSchoolEmail(email: string): boolean {
  return /^[^\s@]+@silverleaf\.co\.tz$/.test(normalizeStaffEmail(email));
}
