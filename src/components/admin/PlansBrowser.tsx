"use client";

/**
 * PlansBrowser — accumulating list + "Show more" for the admin plans page.
 *
 * Seeded with the server-rendered first batch ({@link PlanRow}[]). "Show more"
 * calls the `loadMorePlans` server action for the next page and appends it, so
 * the list grows in place without a full navigation or scroll jump.
 *
 * Filter changes are owned by the URL ({@link PlansFilterBar}); the page remounts
 * this component (via `key`) when filters change, resetting the accumulated list
 * back to the new first batch.
 *
 * Row mutations (publish/unpublish/delete) commit via server actions inside
 * {@link PlansTable}, which reports each success back through `onStatusChanged`
 * / `onDeleted` so the accumulated state is patched in place. That callback
 * path is load-bearing: the rows live in `useState`, so the fresh
 * `initialPlans` prop a post-mutation `router.refresh()` delivers can never
 * reach them — and the refreshed first page couldn't describe changes to rows
 * on later "Show more" pages anyway.
 *
 * Selection + bulk actions: the selection is a set of plan ids owned here, so
 * it survives "Show more". "Select all" asks the server for every id matching
 * the filters (not just the loaded rows); Publish / Unpublish / Delete then run
 * as bulk server actions, and "Download government forms" / "Download lesson
 * plans" / "Download slides" open the batch page for the selection in a new
 * tab, where the files are built.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { getPathname, useRouter } from "@/i18n/navigation";
import {
  bulkDeletePlans,
  bulkSetPlanStatus,
  listPlanIds,
  loadMorePlans,
} from "@/lib/actions/adminPlans";
import {
  GOVERNMENT_FORMS_PATH,
  LESSON_PLANS_PDF_PATH,
  MAX_FORMS_PER_PDF,
  SLIDES_PATH,
} from "@/lib/admin/governmentForms";
import type { PlanFilters, PlanRow } from "@/lib/admin/plansQuery";
import PlansTable from "./PlansTable";
import styles from "./PlansBrowser.module.css";

export interface PlansBrowserProps {
  initialPlans: PlanRow[];
  initialHasMore: boolean;
  filters: PlanFilters;
  /** How many plans match the filters (the "Select all" target). */
  total: number;
}

export default function PlansBrowser({
  initialPlans,
  initialHasMore,
  filters,
  total: initialTotal,
}: PlansBrowserProps) {
  const t = useTranslations("lpAdmin.plans");
  const tb = useTranslations("lpAdmin.plans.bulk");
  const locale = useLocale();
  const router = useRouter();
  const [total, setTotal] = useState(initialTotal);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkPending, startBulk] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allSelected = total > 0 && selected.size >= total;
  const someSelected = selected.size > 0 && !allSelected;

  // "Some selected" is a DOM-only checkbox state (no HTML attribute).
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);
  const [plans, setPlans] = useState<PlanRow[]>(initialPlans);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasActiveFilters = Boolean(
    filters.grade || filters.subject || filters.status || filters.q,
  );

  function onShowMore() {
    setError(null);
    startTransition(async () => {
      try {
        const { rows, hasMore: more } = await loadMorePlans({
          filters,
          offset: plans.length,
        });
        setPlans((prev) => [...prev, ...rows]);
        setHasMore(more);
      } catch {
        setError(t("showMore.error"));
      }
    });
  }

  function onToggleSelected(planId: string, isSelected: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isSelected) next.add(planId);
      else next.delete(planId);
      return next;
    });
  }

  function onToggleAll(checked: boolean) {
    setNotice(null);
    setBulkError(null);
    if (!checked) {
      setSelected(new Set());
      return;
    }
    startBulk(async () => {
      const res = await listPlanIds(filters);
      if (!res.ok || !res.ids) {
        setBulkError(tb("error"));
        return;
      }
      setSelected(new Set(res.ids));
      setTotal(res.ids.length);
    });
  }

  function onBulkStatus(status: PlanRow["status"]) {
    const ids = [...selected];
    setNotice(null);
    setBulkError(null);
    startBulk(async () => {
      const res = await bulkSetPlanStatus(ids, status);
      if (!res.ok) {
        setBulkError(tb("error"));
        return;
      }
      const changed = new Set(ids);
      setPlans((prev) =>
        prev.map((p) => (changed.has(p.id) ? { ...p, status } : p)),
      );
      setNotice(
        tb(status === "published" ? "publishedCount" : "unpublishedCount", {
          count: res.updated ?? ids.length,
        }),
      );
      router.refresh();
    });
  }

  function onBulkDelete() {
    const ids = [...selected];
    if (!window.confirm(tb("confirmDelete", { count: ids.length }))) return;
    setNotice(null);
    setBulkError(null);
    startBulk(async () => {
      const res = await bulkDeletePlans(ids);
      if (!res.ok) {
        setBulkError(tb("error"));
        return;
      }
      const gone = new Set(res.deleted ?? []);
      setPlans((prev) => prev.filter((p) => !gone.has(p.id)));
      // Keep the plans that could not be deleted selected, so the admin can
      // unpublish them straight away.
      setSelected(new Set(res.blocked ?? []));
      setTotal((n) => Math.max(0, n - gone.size));
      const blocked = res.blocked?.length ?? 0;
      setNotice(
        blocked > 0
          ? `${tb("deletedCount", { count: gone.size })} ${tb("blockedCount", { count: blocked })}`
          : tb("deletedCount", { count: gone.size }),
      );
      router.refresh();
    });
  }

  function onDownloadPdf(pathname: string) {
    setNotice(null);
    setBulkError(null);
    if (selected.size > MAX_FORMS_PER_PDF) {
      setBulkError(tb("tooManyForms", { max: MAX_FORMS_PER_PDF }));
      return;
    }
    // Resolve the ids to the order the listing shows: loaded rows first (they
    // are already canonical), then any selected-but-unloaded ids.
    const loadedOrder = plans.map((p) => p.id).filter((id) => selected.has(id));
    const rest = [...selected].filter((id) => !loadedOrder.includes(id));
    const href = getPathname({
      href: {
        pathname,
        query: { ids: [...loadedOrder, ...rest].join(",") },
      },
      locale,
    });
    window.open(href, "_blank");
  }

  function onPlanStatusChanged(planId: string, status: PlanRow["status"]) {
    setPlans((prev) =>
      prev.map((p) => (p.id === planId ? { ...p, status } : p)),
    );
  }

  // Dropping the row keeps later "Show more" offsets aligned: `plans.length`
  // shrinks in step with the server-side list (canonical order is stable).
  function onPlanDeleted(planId: string) {
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    onToggleSelected(planId, false);
    setTotal((n) => Math.max(0, n - 1));
  }

  // A filtered query with no matches reads differently from an empty catalogue;
  // PlansTable's generic empty state only fits the latter.
  if (plans.length === 0 && hasActiveFilters) {
    return <p className={styles.empty}>{t("emptyFiltered")}</p>;
  }

  return (
    <div>
      {total > 0 ? (
        <div className={styles.bulkBar} aria-busy={bulkPending}>
          <label className={styles.selectAll}>
            <input
              ref={selectAllRef}
              type="checkbox"
              className={styles.checkbox}
              checked={allSelected}
              onChange={(e) => onToggleAll(e.target.checked)}
              disabled={bulkPending}
            />
            {tb("selectAll", { count: total })}
          </label>

          {selected.size > 0 ? (
            <>
              <span className={styles.selectedCount}>
                {tb("selectedCount", { count: selected.size })}
              </span>
              <div className={styles.bulkActions}>
                <button
                  type="button"
                  className={styles.bulkBtn}
                  onClick={() => onBulkStatus("published")}
                  disabled={bulkPending}
                >
                  {tb("publish")}
                </button>
                <button
                  type="button"
                  className={styles.bulkBtn}
                  onClick={() => onBulkStatus("draft")}
                  disabled={bulkPending}
                >
                  {tb("unpublish")}
                </button>
                <button
                  type="button"
                  className={`${styles.bulkBtn} ${styles.bulkBtnDanger}`}
                  onClick={onBulkDelete}
                  disabled={bulkPending}
                >
                  {tb("delete")}
                </button>
                <button
                  type="button"
                  className={`${styles.bulkBtn} ${styles.bulkBtnPrimary}`}
                  onClick={() => onDownloadPdf(GOVERNMENT_FORMS_PATH)}
                  disabled={bulkPending}
                >
                  {tb("download")}
                </button>
                <button
                  type="button"
                  className={`${styles.bulkBtn} ${styles.bulkBtnPrimary}`}
                  onClick={() => onDownloadPdf(LESSON_PLANS_PDF_PATH)}
                  disabled={bulkPending}
                >
                  {tb("downloadPlans")}
                </button>
                <button
                  type="button"
                  className={`${styles.bulkBtn} ${styles.bulkBtnPrimary}`}
                  onClick={() => onDownloadPdf(SLIDES_PATH)}
                  disabled={bulkPending}
                >
                  {tb("downloadSlides")}
                </button>
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={() => onToggleAll(false)}
                  disabled={bulkPending}
                >
                  {tb("clear")}
                </button>
              </div>
            </>
          ) : null}

          {bulkPending ? <span className={styles.working}>{tb("working")}</span> : null}
          {notice ? (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          ) : null}
          {bulkError ? (
            <p className={styles.error} role="alert">
              {bulkError}
            </p>
          ) : null}
        </div>
      ) : null}

      <PlansTable
        plans={plans}
        onStatusChanged={onPlanStatusChanged}
        onDeleted={onPlanDeleted}
        selectedIds={selected}
        onToggleSelected={onToggleSelected}
      />

      {hasMore ? (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.showMore}
            onClick={onShowMore}
            disabled={pending}
          >
            {pending ? t("showMore.loading") : t("showMore.label")}
          </button>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
