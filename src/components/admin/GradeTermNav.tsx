"use client";

/**
 * GradeTermNav — the grade bar (KG1 … Grade 6) and term tabs (1A, 1B, 2A, 2B)
 * shared by the AI Studio Schemes of Work page and the admin Plans list.
 *
 * Pure links over the URL (`?grade=KG1&term=1a`, see lib/admin/gradeTerm.ts):
 * every other query param is kept, so it composes with the Plans search /
 * subject / status filters, and any view can be bookmarked or shared.
 *
 * `rememberKey` keeps each admin's last grade + term in localStorage and
 * restores it when they open the page with no grade in the URL — a Grade 4
 * coordinator lands back on Grade 4. Storage failures (private mode, blocked
 * site data) are ignored; the page then just shows its server default.
 */
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { GradeCount, TermCount } from "@/lib/admin/gradeTerm";
import type { Term } from "@/lib/naming/constants";
import { gradeToken } from "@/lib/naming/grade";
import styles from "./GradeTermNav.module.css";

export interface GradeTermNavProps {
  grades: GradeCount[];
  terms: TermCount[];
  /** Selected grade; null = all grades (only with `allowAll`). */
  grade: number | null;
  /** Selected term; null = all terms (only with `allowAll`). */
  term: Term | null;
  /** Offer "All grades" / "All terms" entries (the Plans list). */
  allowAll?: boolean;
  /** localStorage key for remembering the last grade + term. */
  rememberKey?: string;
}

/** Grade-bar text: "KG1" or "Grade 4" ("Darasa 4" in Kiswahili). */
export function useGradeName(): (gradeNum: number) => string {
  const t = useTranslations("lpAdmin.gradeNav");
  return (n) => (n < 0 ? gradeToken(n) : t("grade", { value: n }));
}

function readRemembered(key: string): { grade: string; term: string | null } | null {
  try {
    const raw = window.localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as { grade?: unknown; term?: unknown }) : null;
    return v && typeof v.grade === "string"
      ? { grade: v.grade, term: typeof v.term === "string" ? v.term : null }
      : null;
  } catch {
    return null;
  }
}

export default function GradeTermNav({
  grades,
  terms,
  grade,
  term,
  allowAll = false,
  rememberKey,
}: GradeTermNavProps) {
  const t = useTranslations("lpAdmin.gradeNav");
  const gradeName = useGradeName();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlHasGrade = searchParams.has("grade");

  // Restore the remembered view once, only when the URL doesn't choose one.
  useEffect(() => {
    if (!rememberKey || urlHasGrade) return;
    const saved = readRemembered(rememberKey);
    if (!saved) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("grade", saved.grade);
    if (saved.term) params.set("term", saved.term);
    router.replace(`${pathname}?${params.toString()}`);
    // Mount-only by design: later navigation is the admin's own choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember what is on screen whenever the URL picks it explicitly.
  useEffect(() => {
    if (!rememberKey || !urlHasGrade || grade == null) return;
    try {
      window.localStorage.setItem(
        rememberKey,
        JSON.stringify({ grade: gradeToken(grade), term }),
      );
    } catch {
      // Storage unavailable — remembering is a convenience only.
    }
  }, [rememberKey, urlHasGrade, grade, term]);

  /** Same URL with `grade` / `term` set (null removes the param). */
  function hrefWith(next: { grade?: number | null; term?: Term | null }): string {
    const params = new URLSearchParams(searchParams.toString());
    if (next.grade !== undefined) {
      if (next.grade == null) params.delete("grade");
      else params.set("grade", gradeToken(next.grade));
    }
    if (next.term !== undefined) {
      if (next.term == null) params.delete("term");
      else params.set("term", next.term);
    }
    // A selection change always starts the list from its first page.
    params.delete("page");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const allTermsCount = terms.reduce((sum, x) => sum + x.count, 0);
  const allGradesCount = grades.reduce((sum, x) => sum + x.count, 0);

  return (
    <div className={styles.wrap}>
      <nav aria-label={t("gradesLabel")}>
        <ul className={styles.grades}>
          {allowAll ? (
            <li>
              <Link
                href={hrefWith({ grade: null })}
                className={styles.grade}
                aria-current={grade == null ? "page" : undefined}
              >
                {t("allGrades")}
                <span className={styles.count}>{allGradesCount}</span>
              </Link>
            </li>
          ) : null}
          {grades.map((g) => (
            <li key={g.gradeNum}>
              <Link
                href={hrefWith({ grade: g.gradeNum })}
                className={styles.grade}
                aria-current={grade === g.gradeNum ? "page" : undefined}
                data-empty={g.count === 0 ? "" : undefined}
              >
                {gradeName(g.gradeNum)}
                <span className={styles.count}>{g.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label={t("termsLabel")}>
        <ul className={styles.terms}>
          {allowAll ? (
            <li>
              <Link
                href={hrefWith({ term: null })}
                className={styles.term}
                aria-current={term == null ? "page" : undefined}
              >
                {t("allTerms")}
                <span className={styles.count}>{allTermsCount}</span>
              </Link>
            </li>
          ) : null}
          {terms.map((x) => (
            <li key={x.term}>
              <Link
                href={hrefWith({ term: x.term })}
                className={styles.term}
                aria-current={term === x.term ? "page" : undefined}
                data-empty={x.count === 0 ? "" : undefined}
              >
                {t("term", { value: x.term.toUpperCase() })}
                <span className={styles.count}>{x.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
