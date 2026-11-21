import { and, asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { requireAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { toComplianceForm } from "@/lib/compliance/mapPlan";
import { parseGradeParam, parseTermParam } from "@/lib/admin/gradeTerm";
import { TERM_ORDINAL } from "@/lib/naming/constants";
import ComplianceDocument from "@/components/lesson/document/ComplianceDocument";
import styles from "../../government-forms/governmentForms.module.css";
import UploadForms from "./UploadForms";
import { titledFilename } from "@/lib/naming/titled";

export const dynamic = "force-dynamic";

/**
 * Admin: draw one subject's government forms for a grade and term, and store
 * them for the teachers' term download. Same rendering as the batch forms
 * page; the button uploads each PDF instead of downloading a ZIP.
 */
export default async function PrepareTermFormsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const t = await getTranslations("lpAdmin.plans.termDownloads");
  const sp = await searchParams;
  const gradeNum = parseGradeParam(sp.grade);
  const term = parseTermParam(sp.term);
  const subject = (Array.isArray(sp.subject) ? sp.subject[0] : sp.subject)?.trim();

  const rows =
    gradeNum == null || !term || !subject
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
          .where(
            and(
              eq(lessonPlans.gradeNum, gradeNum),
              eq(lessonPlans.termOrdinal, TERM_ORDINAL[term]),
              eq(lessonPlans.subject, subject),
              eq(lessonPlans.status, "published"),
            ),
          )
          .orderBy(asc(lessonPlans.week), asc(lessonPlans.lesson));

  const forms: Array<{ id: string; filename: string; title: string; form: ReturnType<typeof toComplianceForm> }> =
    [];
  const skipped: string[] = [];
  for (const row of rows) {
    const structured = structuredLessonPlanSchema.safeParse(row.contentJson);
    if (structured.success) {
      forms.push({
        id: row.id,
        filename: row.filename,
        title: row.title,
        form: toComplianceForm(structured.data, row.durationMinutes),
      });
    } else {
      skipped.push(row.title);
    }
  }

  return (
    <div>
      <p className={styles.back}>
        <Link href={`/admin/plans/term-downloads?term=${term ?? "1a"}`}>{t("back")}</Link>
      </p>
      <h1 className={styles.heading}>{t("prepareHeading", { subject: subject ?? "" })}</h1>
      {forms.length === 0 ? (
        <p className={styles.hint}>{t("noneToPrepare")}</p>
      ) : (
        <p className={styles.hint}>{t("prepareSummary", { count: forms.length })}</p>
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
        <UploadForms
          // Names as PrintButton reads them from each form's data-print-file.
          planIdByFile={Object.fromEntries(
            forms.map((f) => [`${titledFilename(f.filename, f.title)}_Government_Form.pdf`, f.id]),
          )}
          zipName={`${subject}_forms.zip`}
        >
          {forms.map(({ id, filename, title, form }) => (
            <div key={id} className={styles.form}>
              <ComplianceDocument
                form={form}
                fileName={`${titledFilename(filename, title)}_Government_Form.pdf`}
                showDownload={false}
              />
            </div>
          ))}
        </UploadForms>
      ) : null}
    </div>
  );
}
