"use client";

/**
 * SearchFilters — the interactive search controls for the lesson-plan catalogue.
 *
 * The URL querystring is the single source of truth: every control reads its
 * current value from `useSearchParams()` and, on change, pushes an updated
 * querystring so the (force-dynamic) server page re-runs the query. We use the
 * locale-aware `useRouter`/`usePathname` from `@/i18n/navigation` so the active
 * locale is preserved.
 *
 * Behaviour:
 *  - Text box: controlled local state, debounced ~300ms before it hits the URL
 *    (so typing doesn't fire a request per keystroke). Submitting the form
 *    flushes immediately.
 *  - Facets (grade / subject / term / week): multi-select toggle chips, in the
 *    order a teacher narrows down. Each facet's options are counted against
 *    the other selections, and empty ones are hidden, so no chip leads to an
 *    empty page. Selected filters also show as removable pills.
 *  - On phones the facets fold behind a "Filters (n)" button so results are
 *    on the first screen.
 *  - Sort: shown only with a text query (Best match, the default, / Course
 *    order); browsing is always in course order.
 *  - Any change to a filter resets pagination back to page 1.
 *
 * All controls are >= 44px tall for comfortable tapping on phones.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { subjectLabel } from "@/lib/naming/subjectLabel";
import styles from "./SearchFilters.module.css";

/** One selectable facet bucket. */
export interface FacetOption {
  value: string;
  count: number;
}

type FacetKey = "grade" | "subject" | "term" | "week";

export interface SearchFiltersProps {
  /** The current text query (from the URL) — seeds the input. */
  q: string;
  /** Available facet buckets, each narrowed by the other facets' selections. */
  grades: FacetOption[];
  subjects: FacetOption[];
  terms: FacetOption[];
  weeks: FacetOption[];
  /** Currently-selected facet values (from the URL). */
  selected: Record<FacetKey, string[]>;
  /** Current sort mode (from the URL; relevance is the default with a query). */
  sort: "relevance" | "naming";
}

/** Debounce window before a keystroke change is committed to the URL. */
const DEBOUNCE_MS = 300;

export default function SearchFilters({
  q,
  grades,
  subjects,
  terms,
  weeks,
  selected,
  sort,
}: SearchFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("lpSearch");
  /** Phones: the facets fold away behind a "Filters" button (always open on wider screens). */
  const [open, setOpen] = useState(false);

  // Controlled text input, seeded from the URL and kept in sync if the URL `q`
  // changes underneath us (e.g. back/forward navigation).
  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);

  /**
   * Navigate to a querystring built from the *current* URL plus a set of
   * mutations. `null` deletes a key; a string sets it; a string[] sets repeated
   * values. Any mutation drops `page` so results restart at page 1. Typing
   * replaces the history entry rather than adding one per keystroke.
   */
  function commit(
    mutations: Record<string, string | string[] | null>,
    mode: "push" | "replace" = "push",
  ) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(mutations)) {
      params.delete(key);
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, v);
      } else if (value !== null && value !== "") {
        params.set(key, value);
      }
    }
    // Filter changes always reset pagination.
    params.delete("page");
    const qs = params.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  // Debounce committing the text box to the URL.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onTextChange(next: string) {
    setText(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      commit({ q: next.trim() || null }, "replace");
    }, DEBOUNCE_MS);
  }

  // Clear any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    commit({ q: text.trim() || null });
  }

  function clearText() {
    setText("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    commit({ q: null });
  }

  /** Toggle a value within a repeated facet param. */
  function toggleFacet(key: FacetKey, value: string) {
    const current = searchParams.getAll(key);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    commit({ [key]: next });
  }

  function setSort(next: "relevance" | "naming") {
    // Relevance is the default with a query; only persist the override.
    commit({ sort: next === "relevance" ? null : next });
  }

  const hasQuery = text.trim() !== "";
  const labelOf: Record<FacetKey, (v: string) => string> = {
    grade: (v) =>
      /^g\d+$/i.test(v) ? t("gradeLabel", { value: v.slice(1) }) : v,
    subject: subjectLabel,
    term: (v) => t("termLabel", { value: v }),
    week: (v) => t("weekLabel", { value: v }),
  };
  const active = (["grade", "subject", "term", "week"] as const).flatMap(
    (key) =>
      selected[key].map((value) => ({
        key,
        value,
        label: labelOf[key](value),
      })),
  );

  function clearAll() {
    setText("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    commit({ q: null, subject: [], grade: [], term: [], week: [], sort: null });
  }

  return (
    <div
      className={styles.filters}
      data-pending={isPending ? "true" : undefined}
    >
      <form className={styles.searchRow} onSubmit={onSubmit} role="search">
        <div className={styles.searchBox}>
          <input
            type="search"
            name="q"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("ariaLabel")}
            className={styles.searchInput}
            autoComplete="off"
          />
          {text ? (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={clearText}
              aria-label={t("clearSearch")}
            >
              ×
            </button>
          ) : null}
        </div>
        <button type="submit" className={styles.searchSubmit}>
          {t("submit")}
        </button>
      </form>

      {/* What is applied, each removable in one tap. */}
      {active.length > 0 || hasQuery ? (
        <div className={styles.activeRow}>
          <ul className={styles.activeList} aria-label={t("activeFilters")}>
            {active.map((f) => (
              <li key={`${f.key}:${f.value}`}>
                <button
                  type="button"
                  className={styles.activePill}
                  onClick={() => toggleFacet(f.key, f.value)}
                  aria-label={t("removeFilter", { label: f.label })}
                >
                  {f.label}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.clearAll} onClick={clearAll}>
            {t("clearAll")}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.filtersToggle}
        aria-expanded={open}
        aria-controls="search-facets"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? t("hideFilters") : t("filtersButton", { count: active.length })}
      </button>

      <div
        id="search-facets"
        className={styles.facets}
        data-open={open ? "true" : undefined}
      >
        <FacetGroup
          legend={t("facets.grade")}
          paramKey="grade"
          options={grades}
          selected={selected.grade}
          onToggle={toggleFacet}
          labelOf={labelOf.grade}
        />
        <FacetGroup
          legend={t("facets.subject")}
          paramKey="subject"
          options={subjects}
          selected={selected.subject}
          onToggle={toggleFacet}
          labelOf={labelOf.subject}
        />
        <FacetGroup
          legend={t("facets.term")}
          paramKey="term"
          options={terms}
          selected={selected.term}
          onToggle={toggleFacet}
          labelOf={labelOf.term}
        />
        <FacetGroup
          legend={t("facets.week")}
          paramKey="week"
          options={weeks}
          selected={selected.week}
          onToggle={toggleFacet}
          labelOf={labelOf.week}
          compact
        />
      </div>

      {/* Ordering only matters for a typed search; browsing is always in course order. */}
      {hasQuery ? (
        <div className={styles.sortRow}>
          <span className={styles.sortLabel}>{t("sort")}</span>
          <div
            className={styles.sortToggle}
            role="group"
            aria-label={t("sortAriaLabel")}
          >
            <button
              type="button"
              className={styles.sortOption}
              aria-pressed={sort === "relevance"}
              title={t("relevanceEnabledHint")}
              onClick={() => setSort("relevance")}
            >
              {t("relevance")}
            </button>
            <button
              type="button"
              className={styles.sortOption}
              aria-pressed={sort === "naming"}
              onClick={() => setSort("naming")}
            >
              {t("browseOrder")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface FacetGroupProps {
  legend: string;
  paramKey: FacetKey;
  options: FacetOption[];
  selected: string[];
  onToggle: (key: FacetKey, value: string) => void;
  labelOf: (value: string) => string;
  /** Small chips (weeks: many short options). */
  compact?: boolean;
}

/**
 * A labelled group of multi-select facet chips. Options the other filters
 * leave empty are not offered (a selected one stays, so it can be removed).
 */
function FacetGroup({
  legend,
  paramKey,
  options,
  selected,
  onToggle,
  labelOf,
  compact,
}: FacetGroupProps) {
  const shown = options.filter(
    (o) => o.count > 0 || selected.includes(o.value),
  );
  if (shown.length === 0) return null;

  return (
    <fieldset className={styles.facetGroup}>
      <legend className={styles.facetLegend}>{legend}</legend>
      <div className={styles.chips}>
        {shown.map((opt) => {
          const isOn = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              className={`${styles.chip} ${compact ? styles.chipCompact : ""}`}
              aria-pressed={isOn}
              onClick={() => onToggle(paramKey, opt.value)}
            >
              <span className={styles.chipLabel}>{labelOf(opt.value)}</span>
              <span className={styles.chipCount}>{opt.count}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
