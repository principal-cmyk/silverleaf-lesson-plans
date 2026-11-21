/**
 * Share links — secret, read-only links an admin hands to teachers.
 *
 * Anyone holding the link (no sign-in) can read the published lesson plans
 * and download or create slides; nothing else. The link is the secret: `token`
 * is 32 random bytes (base64url), unique and unguessable. Revoking sets
 * `revoked_at`; the row stays so the admin list keeps its history.
 *
 * See docs/schema-conventions.md for naming rules.
 */
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { staff } from "./staff";

export const shareLinks = pgTable("share_links", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** The secret in the URL. Unique business key. */
  token: text("token").notNull().unique(),
  /** Admin's note on who the link is for, e.g. "All teachers, Term 1". */
  label: text("label").notNull(),
  createdBy: uuid("created_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when the admin turns the link off. Null while it works. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type ShareLink = typeof shareLinks.$inferSelect;
