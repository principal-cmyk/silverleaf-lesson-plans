import "server-only";

/**
 * Share links — create, look up, list, revoke. The link's token is the only
 * credential, so lookups ignore revoked rows and never reveal why a token fails.
 */
import { randomBytes } from "node:crypto";

import { desc, eq, and, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { shareLinks, type ShareLink } from "@/lib/db/schema";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as base64url — 43 characters, unguessable. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The working link for this token, or null (unknown, malformed or revoked). */
export async function findActiveShareLink(token: string): Promise<ShareLink | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.token, token), isNull(shareLinks.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function createShareLink(label: string, createdBy: string): Promise<ShareLink> {
  const [row] = await db
    .insert(shareLinks)
    .values({ token: newShareToken(), label, createdBy })
    .returning();
  return row!;
}

export async function listShareLinks(): Promise<ShareLink[]> {
  return db.select().from(shareLinks).orderBy(desc(shareLinks.createdAt));
}

/** Turn a link off. False when it was not found or already off. */
export async function revokeShareLink(id: string): Promise<boolean> {
  const rows = await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, id), isNull(shareLinks.revokedAt)))
    .returning();
  return rows.length > 0;
}
