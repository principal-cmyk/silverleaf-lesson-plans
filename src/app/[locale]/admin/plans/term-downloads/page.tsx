import { getTranslations } from "next-intl/server";

import { requireAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { parseTermParam } from "@/lib/admin/gradeTerm";
import { termBundleIndex } from "@/lib/bundles/termBundle";
import { SCHOOL_GRADE_NUMS, gradeLabel, gradeToken } from "@/lib/naming/grade";
import styles from "../government-forms/governmentForms.module.css";

export const dynamic = "force-dynamic";

/**
 * Admin: prepare the teachers' term download. Lists every grade and subject
 * of the term with how many plans have their government-form PDF ready; each
 * row links to the page that draws and stores the missing ones. (Slides need
 * no preparing — the ZIP builds them, using AI decks where they exist.)
 */
export default async function TermDownloadsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const t = await getTranslations("lpAdmin.plans.termDownloads");
  const term = parseTermParam((await searchParams).term) ?? "1a";

  const grades = (
    await Promise.all(
      SCHOOL_GRADE_NUMS.map(async (g) => ({ grade: g, subjects: await termBundleIndex(g, term) })),
    )
  ).filter((g) => g.subjects.length > 0);

  return (
    <div>
      <p className={styles.back}>
        <Link href="/admin/plans">{t("back")}</Link>
      </p>
      <h1 className={styles.heading}>{t("heading", { term: term.toUpperCase() })}</h1>
      <p className={styles.hint}>{t("intro")}</p>
      {grades.length === 0 ? <p className={styles.hint}>{t("none")}</p> : null}
      {grades.map(({ grade, subjects }) => (
        <section key={grade}>
          <h2>{gradeLabel(grade)}</h2>
          <ul>
            {subjects.map((s) => (
              <li key={s.subject}>
                {s.subject}: {t("ready", { ready: s.formsReady, total: s.plans })}{" "}
                {s.formsReady < s.plans ? (
                  <Link
                    href={`/admin/plans/term-downloads/prepare?grade=${gradeToken(grade)}&term=${term}&subject=${encodeURIComponent(s.subject)}`}
                  >
                    {t("prepare")}
                  </Link>
                ) : (
                  <span>✓</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
