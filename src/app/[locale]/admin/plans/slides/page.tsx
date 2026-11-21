import { asc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { requireAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { lessonPlans, lessonSlideDecks } from "@/lib/db/schema";
import { hasApiKey } from "@/lib/ai/model";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { resolveBatchIds } from "@/lib/admin/batchSelection";
import { slideDeckSchema } from "@/lib/slides/deckSchema";
import { slidesFileName } from "@/lib/slides/fileName";
import { contentHash } from "@/lib/slides/store";
import BulkSlides, { type BulkSlideItem } from "./BulkSlides";
// Same page chrome as the batch government-forms page.
import styles from "../government-forms/governmentForms.module.css";

/** Live, authenticated data — render on demand (never prerender/cache). */
export const dynamic = "force-dynamic";

/**
 * Batch slide download — every selected plan's deck as a PowerPoint file, all
 * in one ZIP.
 *
 * The admin plans listing opens this page with the selected ids in `?ids=`.
 * The server works out which plans already have a deck matching their
 * current content; {@link BulkSlides} then has the rest generated (one model
 * call each, a few at a time), fetches every .pptx and zips them in the
 * browser. Plans without structured content have no deck and are listed as
 * skipped. Drafts are included, as on the forms page.
 */
export default async function SlidesDownloadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const t = await getTranslations("lpAdmin.plans.slides");
  const ids = await resolveBatchIds(await searchParams);

  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: lessonPlans.id,
            title: lessonPlans.title,
            filename: lessonPlans.filename,
            contentJson: lessonPlans.contentJson,
          })
          .from(lessonPlans)
          .where(inArray(lessonPlans.id, ids))
          .orderBy(
            asc(lessonPlans.gradeNum),
            asc(lessonPlans.subject),
            asc(lessonPlans.termOrdinal),
            asc(lessonPlans.week),
            asc(lessonPlans.lesson),
          );

  const decks =
    rows.length === 0
      ? []
      : await db
          .select({
            planId: lessonSlideDecks.planId,
            sourceHash: lessonSlideDecks.sourceHash,
            deck: lessonSlideDecks.deck,
          })
          .from(lessonSlideDecks)
          .where(inArray(lessonSlideDecks.planId, rows.map((r) => r.id)));
  // A deck saved in an older format no longer parses and must be rebuilt, so
  // it does not count as ready (the slides page and .pptx route agree).
  const deckHash = new Map(
    decks.filter((d) => slideDeckSchema.safeParse(d.deck).success).map((d) => [d.planId, d.sourceHash]),
  );

  const items: BulkSlideItem[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    if (!structuredLessonPlanSchema.safeParse(row.contentJson).success) {
      skipped.push(row.title);
      continue;
    }
    items.push({
      id: row.id,
      title: row.title,
      fileName: slidesFileName(row.filename),
      ready: deckHash.get(row.id) === contentHash(row.contentJson),
    });
  }

  const first = rows.find((r) => items.some((i) => i.id === r.id));
  const last = [...rows].reverse().find((r) => items.some((i) => i.id === r.id));
  const zipName =
    items.length === 1
      ? `${first!.filename}_Slides.zip`
      : `Slides_${first?.filename}_to_${last?.filename}.zip`;
  const toGenerate = items.filter((i) => !i.ready).length;
  const aiAvailable = hasApiKey();

  return (
    <div>
      <p className={styles.back}>
        <Link href="/admin/plans">{t("back")}</Link>
      </p>
      <h1 className={styles.heading}>{t("heading")}</h1>

      {items.length === 0 ? (
        <p className={styles.hint}>{t("none")}</p>
      ) : (
        <p className={styles.hint}>
          {t("summary", { count: items.length, ready: items.length - toGenerate, toGenerate })}{" "}
          {toGenerate > 0 ? (aiAvailable ? t("costNote") : t("noAi")) : null} {t("keepOpen")}
        </p>
      )}

      {skipped.length > 0 ? (
        <div className={styles.skipped} role="note">
          <p>{t("skipped", { count: skipped.length })}</p>
          <ul>
            {skipped.map((title, i) => (
              <li key={i}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {items.length > 0 ? <BulkSlides items={items} zipName={zipName} aiAvailable={aiAvailable} /> : null}
    </div>
  );
}
