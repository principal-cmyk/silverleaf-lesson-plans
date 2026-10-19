import { asc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { requireAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import {
  structuredLessonPlanSchema,
  type StructuredLessonPlan,
} from "@/lib/ai/lessonPlan/structuredSchema";
import { parseGovernmentFormIds } from "@/lib/admin/governmentForms";
import LessonPlanDocument from "@/components/lesson/document/LessonPlanDocument";
import PrintButton from "@/components/lesson/document/PrintButton";
// Same page chrome as the batch government-forms page.
import styles from "../government-forms/governmentForms.module.css";

/** Live, authenticated data — render on demand (never prerender/cache). */
export const dynamic = "force-dynamic";

/**
 * Batch branded lesson-plan download — the portrait twin of the government
 * forms page.
 *
 * The admin plans listing opens this page in a new tab with the selected plan
 * ids in `?ids=`. Every plan whose `content_json` parses is rendered as the
 * Silverleaf-branded `LessonPlanDocument` (without its own download button),
 * all inside ONE `[data-print-root]`, so the single PrintButton at the top
 * captures every plan, each into its own portrait PDF, and downloads them
 * together as one ZIP. Plans without structured
 * content are listed as skipped.
 *
 * Admin-only: teachers never get the branded PDF (see `LessonPlanDocument`).
 * Drafts are included, as on the forms page.
 */
export default async function LessonPlansPdfPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const t = await getTranslations("lpAdmin.plans.lessonPlans");
  const ids = parseGovernmentFormIds((await searchParams).ids);

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

  const plans: Array<{ id: string; filename: string; plan: StructuredLessonPlan }> = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const structured = structuredLessonPlanSchema.safeParse(row.contentJson);
    if (structured.success) {
      plans.push({ id: row.id, filename: row.filename, plan: structured.data });
    } else {
      skipped.push(row.title);
    }
  }

  const first = plans[0];
  const last = plans[plans.length - 1];
  const zipName =
    plans.length === 1
      ? `${first!.filename}_Lesson_Plan.zip`
      : `Lesson_Plans_${first?.filename}_to_${last?.filename}.zip`;

  return (
    <div>
      <p className={styles.back}>
        <Link href="/admin/plans">{t("back")}</Link>
      </p>
      <h1 className={styles.heading}>{t("heading")}</h1>

      {plans.length === 0 ? (
        <p className={styles.hint}>{t("none")}</p>
      ) : (
        <p className={styles.hint}>
          {t("summary", { count: plans.length })} {t("keepOpen")}
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

      {plans.length > 0 ? (
        <div data-print-root>
          <div className={styles.toolbar}>
            <PrintButton
              className={styles.downloadButton}
              fileName={zipName}
              bundle="zip"
              label={t("download", { count: plans.length })}
              scale={2}
              jpegQuality={0.85}
              overflow="flow"
            />
          </div>
          {plans.map(({ id, filename, plan }) => (
            <div key={id} className={styles.form}>
              <LessonPlanDocument plan={plan} fileName={`${filename}_Lesson_Plan.pdf`} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
