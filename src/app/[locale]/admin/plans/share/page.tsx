import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { listShareLinks } from "@/lib/share/links";

import ShareLinksAdmin from "./ShareLinksAdmin";

export const dynamic = "force-dynamic";

/** Admin: create, copy and turn off the teacher share links. */
export default async function ShareLinksPage() {
  await requireAdmin();
  const t = await getTranslations("share.admin");

  // Prefer the configured public address; otherwise build it from the request.
  let origin = env.PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (!origin) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    origin = `${proto}://${host}`;
  }

  const rows = (await listShareLinks()).map((l) => ({
    id: l.id,
    label: l.label,
    url: `${origin}/share/${l.token}`,
    createdAt: l.createdAt.toISOString().slice(0, 10),
    active: l.revokedAt === null,
  }));

  return (
    <div>
      <p>
        <Link href="/admin/plans">{t("back")}</Link>
      </p>
      <h1>{t("heading")}</h1>
      <p style={{ maxWidth: "46rem" }}>{t("intro")}</p>
      <ShareLinksAdmin links={rows} />
    </div>
  );
}
