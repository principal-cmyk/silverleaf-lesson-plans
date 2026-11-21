import { asc, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { requireAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { toComplianceForm } from "@/lib/compliance/mapPlan";
import { resolveBatchIds } from "@/lib/admin/batchSelection";
import BatchAutoRun from "@/components/admin/BatchAutoRun";
import ComplianceDocument, {
  COMPLIANCE_STAGE_WIDTH,
} from "@/components/lesson/document/ComplianceDocument";
import PrintButton from "@/components/lesson/document/PrintButton";
import styles from "./governmentForms.module.css";

/** Live, authenticated data — render on demand (never prerender/cache). */
export const dynamic = "force-dynamic";

/**
 * Batch government-form download.
 *
 * The admin plans listing opens this page in a new tab with the selected plan
 * ids in `?ids=`. Every plan whose `content_json` parses is projected onto the
 * official form (the same `toComplianceForm` the teacher page uses) and all of
 * them sit inside ONE `[data-print-root]`, so the single PrintButton at the top
 * captures every form, each into its own landscape PDF, and downloads them
 * together as one ZIP. Plans without
 * structured content have no form to project and are listed as skipped.
 *
 * Drafts are included on purpose: this is the admin's tool for checking and
 * filing forms, not the teacher view (which only ever serves published plans).
 */
export default async function GovernmentFormsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const t = await getTranslations("lpAdmin.plans.forms");
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
            durationMinutes: lessonPlans.durationMinutes,
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

  const forms: Array<{ id: string; filename: string; form: ReturnType<typeof toComplianceForm> }> =
    [];
  const skipped: string[] = [];
  for (const row of rows) {
    const structured = structuredLessonPlanSchema.safeParse(row.contentJson);
    if (structured.success) {
      forms.push({
        id: row.id,
        filename: row.filename,
        form: toComplianceForm(structured.data, row.durationMinutes),
      });
    } else {
      skipped.push(row.title);
    }
  }

  const first = forms[0];
  const last = forms[forms.length - 1];
  const zipName =
    forms.length === 1
      ? `${first!.filename}_Government_Form.zip`
      : `Government_Forms_${first?.filename}_to_${last?.filename}.zip`;

  return (
    <div>
      <BatchAutoRun />
      <p className={styles.back}>
        <Link href="/admin/plans">{t("back")}</Link>
      </p>
      <h1 className={styles.heading}>{t("heading")}</h1>

      {forms.length === 0 ? (
        <p className={styles.hint}>{t("none")}</p>
      ) : (
        <p className={styles.hint}>
          {t("summary", { count: forms.length })} {t("keepOpen")}
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

      {forms.length > 0 ? (
        <div data-print-root>
          <div className={styles.toolbar}>
            <PrintButton
              className={styles.downloadButton}
              fileName={zipName}
              bundle="zip"
              label={t("download", { count: forms.length })}
              orientation="landscape"
              stageWidth={COMPLIANCE_STAGE_WIDTH}
              scale={2}
              jpegQuality={0.85}
            />
          </div>
          {forms.map(({ id, filename, form }) => (
            <div key={id} className={styles.form}>
              <ComplianceDocument
                form={form}
                fileName={`${filename}_Government_Form.pdf`}
                showDownload={false}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
