/**
 * PlanResultList — the search results region.
 *
 * Server-safe. Renders a "Showing 21–40 of 1,836" summary, a list of
 * {@link PlanCard}s (one per row), previous/next page links, and a friendly
 * empty state when nothing matches. `total` is the full match count across all
 * pages; `rows` is just the current page.
 */
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { LessonPlan } from "@/lib/db/schema";
import PlanCard from "./PlanCard";
import styles from "./PlanResultList.module.css";

export interface PlanResultListProps {
  rows: LessonPlan[];
  /** Total matches across all pages (drives the summary line). */
  total: number;
  /** The current 1-based page, and rows per page. */
  page: number;
  pageSize: number;
  /** The search's other query params, carried into the page links. */
  query: Record<string, string | string[]>;
}

export default async function PlanResultList({
  rows,
  total,
  page,
  pageSize,
  query,
}: PlanResultListProps) {
  const t = await getTranslations("lpResults");
  const tSearch = await getTranslations("lpSearch");

  if (total === 0) {
    return (
      <div className={styles.empty} role="status">
        <p className={styles.emptyTitle}>{t("emptyTitle")}</p>
        <p className={styles.emptyHint}>{t("emptyHint")}</p>
      </div>
    );
  }

  const pages = Math.ceil(total / pageSize);
  const pageHref = (n: number) => ({
    pathname: "/search" as const,
    query: n > 1 ? { ...query, page: String(n) } : query,
  });

  return (
    <section className={styles.results} aria-label={tSearch("resultsAriaLabel")}>
      <p className={styles.count} role="status">
        {total > rows.length
          ? t("showing", {
              from: (page - 1) * pageSize + 1,
              to: (page - 1) * pageSize + rows.length,
              total,
            })
          : t("count", { count: total })}
      </p>
      <ul className={styles.list}>
        {rows.map((plan) => (
          <li key={plan.id}>
            <PlanCard plan={plan} />
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav className={styles.pager} aria-label={t("paginationLabel")}>
          {page > 1 ? (
            <Link className={styles.pageLink} href={pageHref(page - 1)}>
              {t("previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className={styles.pageOf}>{t("pageOf", { page, pages })}</span>
          {page < pages ? (
            <Link className={styles.pageLink} href={pageHref(page + 1)}>
              {t("next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
