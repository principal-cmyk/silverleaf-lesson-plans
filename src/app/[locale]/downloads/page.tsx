/**
 * Term downloads — every grade's lesson plans and slides for one term, as
 * ZIPs. One link per grade (all subjects) and one per subject, served by
 * `/api/bundles/term`. Term 1A unless `?term=` says otherwise.
 */
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/lib/auth";
import { parseTermParam } from "@/lib/admin/gradeTerm";
import { termBundleIndex } from "@/lib/bundles/termBundle";
import { SCHOOL_GRADE_NUMS, gradeLabel, gradeToken } from "@/lib/naming/grade";
import styles from "./downloads.module.css";

export const dynamic = "force-dynamic";

const href = (grade: number, term: string, subject?: string) =>
  `/api/bundles/term?grade=${gradeToken(grade)}&term=${term}${
    subject ? `&subject=${encodeURIComponent(subject)}` : ""
  }`;

export default async function DownloadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const t = await getTranslations("lpDownloads");
  const term = parseTermParam((await searchParams).term) ?? "1a";

  const grades = (
    await Promise.all(
      SCHOOL_GRADE_NUMS.map(async (g) => ({ grade: g, subjects: await termBundleIndex(g, term) })),
    )
  ).filter((g) => g.subjects.length > 0);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t("heading", { term: term.toUpperCase() })}</h1>
      <p className={styles.sub}>{t("intro")}</p>

      {grades.length === 0 ? <p>{t("none")}</p> : null}

      {grades.map(({ grade, subjects }) => (
        <section key={grade} className={styles.grade}>
          <div className={styles.gradeHead}>
            <h2>{gradeLabel(grade)}</h2>
            <a className={styles.primary} href={href(grade, term)} download>
              {t("wholeGrade", { grade: gradeLabel(grade) })}
            </a>
          </div>
          <ul className={styles.subjects}>
            {subjects.map((s) => (
              <li key={s.subject}>
                <span>
                  {s.subject}
                  <span className={styles.count}> · {t("plans", { count: s.plans })}</span>
                </span>
                <a className={styles.secondary} href={href(grade, term, s.subject)} download>
                  {t("download")}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
