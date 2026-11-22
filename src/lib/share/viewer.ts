import "server-only";

/**
 * Who may use a share link: anyone who gave a Silverleaf Academy email address
 * (or is already signed in to the app with one). The proof is a signed cookie
 * holding only the email — it opens the share pages and nothing else (it is not
 * an app session, so it never reaches feedback, points or admin).
 *
 * The address is typed, not verified by mail, so this keeps the link to people
 * who know the school's domain; the secret token still decides which links work.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { resolveSessionSecret } from "@/lib/auth/session-codec";
import { isSchoolEmail, normalizeStaffEmail } from "@/lib/email";
import { env } from "@/lib/env";

const COOKIE = "__sla_share";
const MAX_AGE = 60 * 60 * 24 * 30;

/** Domain-separated from the app session so one cookie can never stand in for the other. */
function sign(value: string): string {
  const key = `share-access:${resolveSessionSecret(env.SESSION_SECRET, env.NODE_ENV)}`;
  return createHmac("sha256", key).update(value).digest("base64url");
}

export function encodeShareCookie(email: string): string {
  const body = Buffer.from(email).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The email in a share cookie, or null when malformed, forged or not a school address. */
export function decodeShareCookie(raw: string): string | null {
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1), "base64url");
  const want = Buffer.from(sign(body), "base64url");
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const email = Buffer.from(body, "base64url").toString("utf8");
  return isSchoolEmail(email) ? email : null;
}

/** Remember this school email on this browser. Caller must have checked it. */
export async function grantShareAccess(email: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, encodeShareCookie(normalizeStaffEmail(email)), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/** True when the visitor has a school-email cookie or is signed in with a school email. */
export async function hasShareAccess(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw && decodeShareCookie(raw)) return true;
  const user = await getCurrentUser();
  return !!user && isSchoolEmail(user.email);
}
