import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import ComplianceDocument from "@/components/lesson/document/ComplianceDocument";
import LessonPlanDocument from "@/components/lesson/document/LessonPlanDocument";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { toComplianceForm } from "@/lib/compliance/mapPlan";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { markdownToReact } from "@/lib/lesson/markdownToReact";
import { formatPlanMeta } from "@/lib/lesson/planMeta";
import { gradeLabel } from "@/lib/naming/grade";
import { subjectLabel } from "@/lib/naming/subjectLabel";
import { titledFilename } from "@/lib/naming/titled";
import { findActiveShareLink } from "@/lib/share/links";
import { isFresh, loadDeck } from "@/lib/slides/store";

import PlanVersionSwitch from "../../../plans/[slug]/PlanVersionSwitch";
import planStyles from "../../../plans/[slug]/plan.module.css";
import styles from "../../share.module.css";
import ShareSlides from "../ShareSlides";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * One shared plan (no sign-in): both versions to read, the government form to
 * download, and the slides to download or create. Read-only by construction —
 * no feedback form, no usage logging, no admin tools, no server actions.
 */
export default async function SharedPlanPage({
  params,
}: {
  params: Promise<{ token: string; slug: string }>;
}) {
  const { token, slug } = await params;
  if (!(await findActiveShareLink(token))) notFound();

  const [plan] = await db
    .select()
    .from(lessonPlans)
    .where(and(eq(lessonPlans.slug, slug), eq(lessonPlans.status, "published")))
    .limit(1);
  if (!plan) notFound();

  const t = await getTranslations("lpPlan");
  const ts = await getTranslations("share");
  const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
  const deck = structured.success ? await loadDeck(plan.id) : null;
  const slidesReady = !!deck && isFresh(deck, plan.contentJson);

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <Link href={`/share/${token}?grade=${plan.gradeNum}&subject=${encodeURIComponent(plan.subject)}&term=${plan.term}`}>
          {ts("backToFolder", { grade: gradeLabel(plan.gradeNum), subject: subjectLabel(plan.subject), term: plan.term.toUpperCase() })}
        </Link>
      </p>
      <h1 className={styles.title}>{plan.title}</h1>
      <p className={styles.meta}>{formatPlanMeta(plan, t)}</p>

      {structured.success ? (
        <>
          <ShareSlides token={token} planId={plan.id} ready={slidesReady} />
          <PlanVersionSwitch
            groupLabel={t("versionLabel")}
            brandedLabel={t("versionBranded")}
            governmentLabel={t("versionGovernment")}
            branded={<LessonPlanDocument plan={structured.data} showPrint={false} />}
            government={
              <ComplianceDocument
                form={toComplianceForm(structured.data, plan.durationMinutes)}
                fileName={`${titledFilename(plan.filename, plan.title)}_Government_Form.pdf`}
                downloadLabel={t("downloadGovernment")}
              />
            }
          />
        </>
      ) : (
        markdownToReact(plan.contentMarkdown, {
          paragraph: planStyles.paragraph,
          h2: planStyles.bodyH2,
          h3: planStyles.bodyH3,
          h4: planStyles.bodyH4,
          list: planStyles.bodyList,
        })
      )}
    </main>
  );
}
