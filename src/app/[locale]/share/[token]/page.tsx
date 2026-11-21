import type { Metadata } from "next";
import { and, asc, eq, ilike } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { gradeLabel } from "@/lib/naming/grade";
import { subjectLabel } from "@/lib/naming/subjectLabel";
import { findActiveShareLink } from "@/lib/share/links";

import styles from "../share.module.css";

export const dynamic = "force-dynamic";

/** The link is the secret: keep it out of search engines and referrers. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Shared library (no sign-in). Read-only list of every published plan, found by
 * grade, term and a title search. Each row opens the plan; nothing here writes.
 */
export default async function SharedLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const t = await getTranslations("share");
  const link = await findActiveShareLink(token);
  if (!link) {
    return (
      <main className={styles.gone}>
        <h1>{t("gone.heading")}</h1>
        <p>{t("gone.body")}</p>
      </main>
    );
  }

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 80);

  const all = await db
    .select({
      slug: lessonPlans.slug,
      title: lessonPlans.title,
      gradeNum: lessonPlans.gradeNum,
      subject: lessonPlans.subject,
      term: lessonPlans.term,
      termOrdinal: lessonPlans.termOrdinal,
      week: lessonPlans.week,
      lesson: lessonPlans.lesson,
    })
    .from(lessonPlans)
    .where(
      and(
        eq(lessonPlans.status, "published"),
        q ? ilike(lessonPlans.title, `%${q.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
      ),
    )
    .orderBy(
      asc(lessonPlans.gradeNum),
      asc(lessonPlans.termOrdinal),
      asc(lessonPlans.subject),
      asc(lessonPlans.week),
      asc(lessonPlans.lesson),
    );

  const grades = [...new Set(all.map((p) => p.gradeNum))];
  const wantedGrade = Number(one(sp.grade));
  const grade = grades.includes(wantedGrade) ? wantedGrade : (grades[0] ?? null);
  const inGrade = all.filter((p) => p.gradeNum === grade);
  const terms = [...new Set(inGrade.map((p) => p.term))];
  const term = terms.includes(one(sp.term)) ? one(sp.term) : null;
  const shown = term ? inGrade.filter((p) => p.term === term) : inGrade;

  const href = (next: { grade?: number | null; term?: string | null }) => {
    const qs = new URLSearchParams();
    if (next.grade != null) qs.set("grade", String(next.grade));
    if (next.term) qs.set("term", next.term);
    if (q) qs.set("q", q);
    const s = qs.toString();
    return `/share/${token}${s ? `?${s}` : ""}`;
  };

  // Group rows by subject within the chosen grade/term.
  const bySubject = new Map<string, typeof shown>();
  for (const p of shown) bySubject.set(p.subject, [...(bySubject.get(p.subject) ?? []), p]);

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t("heading")}</h1>
      <p className={styles.hint}>{t("intro")}</p>

      <form className={styles.search} action={`/share/${token}`} method="get" role="search">
        {grade != null ? <input type="hidden" name="grade" value={grade} /> : null}
        <input type="search" name="q" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        <button type="submit">{t("search")}</button>
      </form>

      {grades.length === 0 ? <p className={styles.empty}>{t("none")}</p> : null}

      <nav className={styles.chips} aria-label={t("grades")}>
        {grades.map((g) => (
          <Link key={g} href={href({ grade: g })} className={`${styles.chip} ${g === grade ? styles.chipOn : ""}`}>
            {gradeLabel(g)}
          </Link>
        ))}
      </nav>
      {terms.length > 1 ? (
        <nav className={styles.chips} aria-label={t("terms")}>
          <Link href={href({ grade })} className={`${styles.chip} ${term === null ? styles.chipOn : ""}`}>
            {t("allTerms")}
          </Link>
          {terms.map((x) => (
            <Link key={x} href={href({ grade, term: x })} className={`${styles.chip} ${x === term ? styles.chipOn : ""}`}>
              {t("termName", { term: x.toUpperCase() })}
            </Link>
          ))}
        </nav>
      ) : null}

      {[...bySubject].map(([subject, rows]) => (
        <section key={subject}>
          <h2 className={styles.group}>{subjectLabel(subject)}</h2>
          <ul className={styles.list}>
            {rows.map((p) => (
              <li key={p.slug} className={styles.row}>
                <span className={styles.rowMeta}>
                  {t("rowMeta", { term: p.term.toUpperCase(), week: p.week, lesson: p.lesson })}
                </span>
                <Link className={styles.rowTitle} href={`/share/${token}/${p.slug}`}>
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
