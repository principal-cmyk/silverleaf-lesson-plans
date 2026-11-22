/**
 * One-time email login codes — proof that the person typing a school address
 * can read that mailbox.
 *
 * Held in memory (a `globalThis` singleton so every server bundle shares it):
 * a code lives 10 minutes, works once, and dies after 5 wrong tries. A server
 * restart simply voids pending codes; the teacher asks for a new one.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
/** Minimum gap between two codes for one address, and a per-hour cap. */
export const RESEND_GAP_MS = 60 * 1000;
export const MAX_PER_HOUR = 5;

interface Entry {
  hash: Buffer;
  expiresAt: number;
  attempts: number;
}
interface Store {
  codes: Map<string, Entry>;
  issued: Map<string, number[]>;
}

const g = globalThis as unknown as { __loginCodeStore?: Store };
const store: Store = (g.__loginCodeStore ??= { codes: new Map(), issued: new Map() });

function hash(email: string, code: string, secret: string): Buffer {
  return createHmac("sha256", `login-code:${secret}`).update(`${email}:${code}`).digest();
}

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: "too-soon" | "too-many" };

/** Make a code for `email`, or refuse when it is asked for too often. */
export function issueLoginCode(email: string, secret: string, now = Date.now()): IssueResult {
  const recent = (store.issued.get(email) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length && now - recent[recent.length - 1]! < RESEND_GAP_MS) {
    return { ok: false, reason: "too-soon" };
  }
  if (recent.length >= MAX_PER_HOUR) return { ok: false, reason: "too-many" };
  recent.push(now);
  store.issued.set(email, recent);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  store.codes.set(email, { hash: hash(email, code, secret), expiresAt: now + CODE_TTL_MS, attempts: 0 });
  if (store.codes.size > 5000) {
    for (const [k, v] of store.codes) if (v.expiresAt < now) store.codes.delete(k);
  }
  return { ok: true, code };
}

/** Forget a code that could not be emailed, so the teacher can retry at once. */
export function discardLoginCode(email: string): void {
  store.codes.delete(email);
  store.issued.delete(email);
}

/** Check and use up a code. True only for the right, unexpired, unused code. */
export function consumeLoginCode(email: string, given: string, secret: string, now = Date.now()): boolean {
  const entry = store.codes.get(email);
  if (!entry || entry.expiresAt < now) {
    store.codes.delete(email);
    return false;
  }
  const digits = given.replace(/\s+/g, "");
  entry.attempts += 1;
  const ok = /^\d{6}$/.test(digits) && timingSafeEqual(entry.hash, hash(email, digits, secret));
  if (ok || entry.attempts >= MAX_ATTEMPTS) store.codes.delete(email);
  return ok;
}

/** Test helper: empty the store. */
export function resetLoginCodes(): void {
  store.codes.clear();
  store.issued.clear();
}
