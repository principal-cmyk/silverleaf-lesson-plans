"use client";

/**
 * SchemesClient — interactive Schemes of Work admin panel.
 *
 * Two views, split by responsibility:
 *   list   → Grade → Term → Subject: `GradeTermNav` (grade bar + term tabs,
 *            URL-driven) over one row per subject for the selected grade and
 *            term, with lesson-plan coverage and the subjects that still lack
 *            a scheme this term; then `SowUploadPanel` (upload state lives
 *            here via `useSowUpload` so a preview survives a hop into detail
 *            and back)
 *   detail → `SchemeDetailView` (inline row editing via `LessonEditForm`,
 *            add row, delete scheme) — this component loads/owns its data
 *
 * Mutations call server actions then call router.refresh() so the server
 * re-fetches and updates the initial props on next render.
 */

import { useMemo, useState, useTransition } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import GradeTermNav, { useGradeName } from "@/components/admin/GradeTermNav";
import { getScheme, deleteScheme } from "@/lib/actions/schemes";
import {
  gradeCounts,
  isFiled,
  termCounts,
  termOfOrdinal,
} from "@/lib/admin/gradeTerm";
import type { Term } from "@/lib/naming/constants";
import { subjectToken } from "@/lib/naming/format";
import { gradeToken } from "@/lib/naming/grade";

import SchemeDetailView from "./SchemeDetailView";
import SowUploadPanel, { useSowUpload } from "./SowUploadPanel";
import type { SchemeDetail, SchemeRow, SowLesson } from "./types";
import styles from "./SchemesClient.module.css";

interface SchemesClientProps {
  initialSchemes: SchemeRow[];
  /** Grade on screen (resolved server-side from `?grade=`). */
  grade: number;
  /** Term on screen (resolved server-side from `?term=`). */
  term: Term;
}

/**
 * Loose subject key so the same subject written differently across terms
 * matches: "HEALTH ENVIRONMENT" = "Health and Environment", "Numeracy,
 * Science & ICT" = "NUMERACY, SCIENCE AND ICT", "Kusoma (kiswahili)" = "KUSOMA".
 */
const subjectKey = (subject: string) =>
  subject
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&|\band\b/g, " ")
    .replace(/[^a-z]+/g, "");

/** Shorten text a broken parse may have filled with a whole paragraph. */
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

export default function SchemesClient({ initialSchemes, grade, term }: SchemesClientProps) {
  const t = useTranslations("lpManage.schemes");
  const gradeName = useGradeName();
  const router = useRouter();

  // Render the list straight from the server prop: router.refresh() re-renders
  // this component with fresh props but PRESERVES client state, so a useState
  // copy would never show a newly created/deleted scheme until a hard reload.
  const schemes = initialSchemes;
  const [view, setView] = useState<"list" | "detail">("list");
  const [detail, setDetail] = useState<SchemeDetail | null>(null);
  const [lessons, setLessons] = useState<SowLesson[]>([]);

  // ── Grade → Term → Subject grouping ────────────────────────────────────────
  const grouping = useMemo(() => {
    const filed = schemes.filter(isFiled);
    const termOrdinal = (["1a", "1b", "2a", "2b"] as const).indexOf(term) + 1;
    const inView = filed
      .filter((s) => s.gradeNum === grade && s.termOrdinal === termOrdinal)
      .sort((a, b) => a.subject.localeCompare(b.subject));
    // Subjects this grade has a scheme for in another term but not this one —
    // the gaps a coordinator needs to fill.
    const here = new Set(inView.map((s) => subjectKey(s.subject)));
    const missing = new Map<string, string>();
    for (const s of filed) {
      const key = subjectKey(s.subject);
      if (s.gradeNum === grade && !here.has(key) && !missing.has(key)) {
        missing.set(key, s.subject.trim());
      }
    }
    return {
      grades: gradeCounts(filed),
      terms: termCounts(filed, grade),
      inView,
      missing: [...missing.values()].sort((a, b) => a.localeCompare(b)),
      // Schemes whose grade or term the navigation cannot place (e.g. a term
      // typed as "Term 1"): listed so they are never silently hidden.
      unfiled: schemes.filter((s) => !isFiled(s)),
    };
  }, [schemes, grade, term]);

  /** Admin Plans list filtered to one scheme's grade, term and subject. */
  function plansHref(s: SchemeRow): string {
    const params = new URLSearchParams({
      grade: gradeToken(s.gradeNum),
      term: termOfOrdinal(s.termOrdinal) ?? term,
      subject: subjectToken(s.subject),
    });
    return `/admin/plans?${params.toString()}`;
  }

  // Upload panel state (hook, so it survives the detail view unmounting the panel).
  const upload = useSowUpload();

  // Detail loading state
  const [detailPending, startDetailTransition] = useTransition();
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();

  // ── detail view ─────────────────────────────────────────────────────────────

  function openDetail(scheme: SchemeRow) {
    setDetailError(null);
    startDetailTransition(async () => {
      const result = await getScheme(scheme.id);
      if (!result.ok) {
        setDetailError(t("errorGeneric"));
        return;
      }
      setDetail({
        id: scheme.id,
        title: result.scheme?.title ?? scheme.title,
        grade: result.scheme?.grade ?? scheme.grade,
        subject: result.scheme?.subject ?? scheme.subject,
        term: result.scheme?.term ?? scheme.term,
        year: result.scheme?.year,
        mainCompetence: result.scheme?.mainCompetence,
        weeksCount: result.scheme?.weeksCount,
        lessonsPerWeek: result.scheme?.lessonsPerWeek,
        lessonDurationMins: result.scheme?.lessonDurationMins,
        totalLessons: result.scheme?.totalLessons,
        headerContext: result.scheme?.headerContext,
      });
      setLessons((result.lessons as SowLesson[]) ?? []);
      setView("detail");
    });
  }

  function handleLessonSaved() {
    if (!detail) return;
    startDetailTransition(async () => {
      const result = await getScheme(detail.id);
      if (result.ok) {
        setLessons((result.lessons as SowLesson[]) ?? []);
      }
    });
  }

  function handleDelete() {
    if (!detail) return;
    if (!confirm(t("deleteConfirm"))) return;
    startDeleteTransition(async () => {
      const result = await deleteScheme(detail.id);
      if (!result.ok) {
        setDetailError(t("errorGeneric"));
        return;
      }
      setView("list");
      setDetail(null);
      setLessons([]);
      router.refresh();
    });
  }

  // ── render: detail ──────────────────────────────────────────────────────────

  if (view === "detail" && detail) {
    return (
      <SchemeDetailView
        detail={detail}
        lessons={lessons}
        pending={detailPending}
        error={detailError}
        deletePending={deletePending}
        onBack={() => {
          setView("list");
          setDetail(null);
        }}
        onLessonSaved={handleLessonSaved}
        onDelete={handleDelete}
      />
    );
  }

  // ── render: list ────────────────────────────────────────────────────────────

  return (
    <div className={styles.wrap}>
      <GradeTermNav
        grades={grouping.grades}
        terms={grouping.terms}
        grade={grade}
        term={term}
        rememberKey="silverleaf.schemes.gradeTerm"
      />

      {detailError ? <p className={styles.error}>{detailError}</p> : null}

      <section aria-labelledby="schemes-in-view">
        <h2 id="schemes-in-view" className={styles.groupHeading}>
          {t("groupHeading", { grade: gradeName(grade), term: term.toUpperCase() })}
        </h2>

        {grouping.inView.length === 0 ? (
          <p className={styles.empty}>
            {t("emptyGroup", { grade: gradeName(grade), term: term.toUpperCase() })}{" "}
            <a href="#sow-upload">{t("uploadOne")}</a>
          </p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("columns.subject")}</th>
                  <th>{t("columns.rows")}</th>
                  <th>{t("columns.plans")}</th>
                  <th>{t("columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {grouping.inView.map((s) => {
                  const pct =
                    s.rowCount > 0 ? Math.round((s.plannedCount / s.rowCount) * 100) : 0;
                  return (
                    <tr key={s.id}>
                      <td>
                        <span className={styles.subjectName}>{s.subject}</span>
                        <span className={styles.subjectTitle}>{s.title}</span>
                      </td>
                      <td>{s.rowCount}</td>
                      <td>
                        <div className={styles.coverage}>
                          <span>
                            {t("plannedOf", { planned: s.plannedCount, total: s.rowCount })}
                          </span>
                          <span
                            className={styles.coverageTrack}
                            role="img"
                            aria-label={t("plannedPct", { pct })}
                          >
                            <span className={styles.coverageFill} style={{ width: `${pct}%` }} />
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            className={styles.btnSmall}
                            onClick={() => openDetail(s)}
                            disabled={detailPending}
                          >
                            {t("view")}
                          </button>
                          {s.plannedCount > 0 ? (
                            <Link href={plansHref(s)} className={styles.linkSmall}>
                              {t("openPlans")}
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {grouping.missing.length > 0 ? (
          <div className={styles.missing} role="note">
            <p className={styles.missingTitle}>
              {t("missingHeading", { term: term.toUpperCase() })}
            </p>
            <ul className={styles.missingList}>
              {grouping.missing.map((subject) => (
                <li key={subject}>
                  {subject}{" "}
                  <a href="#sow-upload" className={styles.linkSmall}>
                    {t("uploadOne")}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {grouping.unfiled.length > 0 ? (
        <div className={styles.missing} role="note">
          <p className={styles.missingTitle}>{t("unfiledHeading")}</p>
          <ul className={styles.missingList}>
            {grouping.unfiled.map((s) => (
              <li key={s.id}>
                {clip(s.title, 80)} ({clip(s.grade, 20) || "?"} · {clip(s.term, 20) || "?"}){" "}
                <button
                  className={styles.btnSmall}
                  onClick={() => openDetail(s)}
                  disabled={detailPending}
                >
                  {t("view")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SowUploadPanel upload={upload} />
    </div>
  );
}
