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

  const folderCount = (n: number) => t("lessonCount", { count: n });
  const countBy = <K,>(rows: typeof all, key: (p: (typeof all)[number]) => K) => {
    const m = new Map<K, number>();
    for (const p of rows) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return m;
  };
  const gradeNum = one(sp.grade) === "" ? NaN : Number(one(sp.grade));
  const subjectParam = one(sp.subject);

  const list = (rows: typeof all, full: boolean) => (
    <ul className={styles.list}>
      {rows.map((p) => (
        <li key={p.slug} className={styles.row}>
          <span className={styles.rowMeta}>
            {full
              ? t("rowMetaFull", {
                  grade: gradeLabel(p.gradeNum),
                  subject: subjectLabel(p.subject),
                  term: p.term.toUpperCase(),
                  week: p.week,
                  lesson: p.lesson,
                })
              : t("rowMeta", { term: p.term.toUpperCase(), week: p.week, lesson: p.lesson })}
          </span>
          <Link className={styles.rowTitle} href={`/share/${token}/${p.slug}`}>
            {p.title}
          </Link>
        </li>
      ))}
    </ul>
  );

  const searchBox = (
    <form className={styles.search} action={`/share/${token}`} method="get" role="search">
      <input type="search" name="q" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
      <button type="submit">{t("search")}</button>
    </form>
  );

  // Level 0 — a search: one flat list across every folder.
  if (q) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>{t("searchResults", { q })}</h1>
        <p className={styles.crumbs}>
          <Link href={`/share/${token}`}>{t("clearSearch")}</Link>
        </p>
        {searchBox}
        {all.length === 0 ? <p className={styles.empty}>{t("none")}</p> : list(all, true)}
      </main>
    );
  }

  const gradesHere = countBy(all, (p) => p.gradeNum);
  const grade = gradesHere.has(gradeNum) ? gradeNum : null;

  // Level 1 — grade folders.
  if (grade === null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>{t("heading")}</h1>
        <p className={styles.hint}>{t("intro")}</p>
        {searchBox}
        {gradesHere.size === 0 ? <p className={styles.empty}>{t("none")}</p> : <h2 className={styles.group}>{t("chooseGrade")}</h2>}
        <ul className={styles.folders}>
          {[...gradesHere].map(([g, n]) => (
            <li key={g}>
              <Link className={styles.folder} href={`/share/${token}?grade=${g}`}>
                <span className={styles.folderName}>{gradeLabel(g)}</span>
                <span className={styles.folderCount}>{folderCount(n)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const inGrade = all.filter((p) => p.gradeNum === grade);
  const subjectsHere = countBy(inGrade, (p) => p.subject);
  const subject = subjectsHere.has(subjectParam) ? subjectParam : null;

  // Level 2 — subject folders inside the grade.
  if (subject === null) {
    return (
      <main className={styles.page}>
        <p className={styles.crumbs} aria-label={t("breadcrumb")}>
          <Link href={`/share/${token}`}>{t("allGrades")}</Link> / {gradeLabel(grade)}
        </p>
        <h1 className={styles.heading}>{gradeLabel(grade)}</h1>
        <h2 className={styles.group}>{t("chooseSubject")}</h2>
        <ul className={styles.folders}>
          {[...subjectsHere].map(([s, n]) => (
            <li key={s}>
              <Link className={styles.folder} href={`/share/${token}?grade=${grade}&subject=${encodeURIComponent(s)}`}>
                <span className={styles.folderName}>{subjectLabel(s)}</span>
                <span className={styles.folderCount}>{folderCount(n)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  // Level 3 — the lessons of one subject, by term (already ordered by week and lesson).
  const byTerm = new Map<string, typeof all>();
  for (const p of inGrade.filter((x) => x.subject === subject)) {
    byTerm.set(p.term, [...(byTerm.get(p.term) ?? []), p]);
  }
  return (
    <main className={styles.page}>
      <p className={styles.crumbs} aria-label={t("breadcrumb")}>
        <Link href={`/share/${token}`}>{t("allGrades")}</Link> /{" "}
        <Link href={`/share/${token}?grade=${grade}`}>{gradeLabel(grade)}</Link> / {subjectLabel(subject)}
      </p>
      <h1 className={styles.heading}>
        {gradeLabel(grade)} · {subjectLabel(subject)}
      </h1>
      {[...byTerm].map(([term, rows]) => (
        <section key={term}>
          <h2 className={styles.group}>{t("termHeading", { term: term.toUpperCase() })}</h2>
          {list(rows, false)}
        </section>
      ))}
    </main>
  );
}
