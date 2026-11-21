import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import ByGradeDownloads, { type GradeRun } from "@/components/admin/ByGradeDownloads";
import { TERM_ORDINAL } from "@/lib/naming/constants";
import { gradeLabel, gradeToken } from "@/lib/naming/grade";

import { requireAdmin } from "@/lib/auth";
import { gradeCounts, parseGradeParam, termCounts } from "@/lib/admin/gradeTerm";
import {
  countPlans,
  fetchGradeTermCounts,
  fetchPlanFilterOptions,
  fetchPlansPage,
  PAGE_SIZE,
  parsePlanFilters,
} from "@/lib/admin/plansQuery";
import PlansBrowser from "@/components/admin/PlansBrowser";
import GradeTermNav from "@/components/admin/GradeTermNav";
import PlansFilterBar from "@/components/admin/PlansFilterBar";

/** Live, authenticated data — render on demand (never prerender/cache). */
export const dynamic = "force-dynamic";

/**
 * Admin plans listing.
 *
 * Grouped by a grade bar (KG1 … Grade 6) and term tabs (1A … 2B) — see
 * {@link GradeTermNav}, shared with AI Studio → Schemes of Work — and further
 * filterable (subject / status / free-text); all state lives in URL params,
 * and the list is
 * ordered by the canonical naming sort (grade → subject → term → week → lesson).
 * Renders only the first {@link PAGE_SIZE} rows; the client {@link PlansBrowser}
 * grows the list in place via its "Show more" control, while {@link PlansTable}
 * (inside it) owns the publish/unpublish/delete actions and edit links.
 */
export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const t = await getTranslations("lpAdmin.plans");

  const parsed = parsePlanFilters(await searchParams);
  const gradeNum = parseGradeParam(parsed.grade);
  const options = await fetchPlanFilterOptions(gradeNum);
  // A subject picked under another grade may not exist in this one: drop it.
  const filters =
    parsed.subject && !options.subjects.includes(parsed.subject)
      ? { ...parsed, subject: undefined }
      : parsed;

  const [total, rows, groups] = await Promise.all([
    countPlans(filters),
    fetchPlansPage(filters, { offset: 0, limit: PAGE_SIZE }),
    fetchGradeTermCounts(filters),
  ]);

  // Grades with plans in the chosen term (under the other filters), for the
  // "download one file per grade" run.
  const byGrade: GradeRun[] = filters.term
    ? groups
        .filter((g) => g.termOrdinal === TERM_ORDINAL[filters.term!] && (g.count ?? 0) > 0)
        .sort((a, b) => a.gradeNum - b.gradeNum)
        .map((g) => ({ token: gradeToken(g.gradeNum), label: gradeLabel(g.gradeNum), count: g.count ?? 0 }))
    : [];

  const initialHasMore = total > rows.length;
  // Re-key the browser on the active filters so a filter change resets the
  // accumulated "Show more" list back to the new first batch.
  const filterKey = JSON.stringify(filters);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <h1>{t("heading")}</h1>
        <span style={{ fontSize: "0.875rem", color: "var(--ink-muted)" }}>
          {t("count", { count: total })}
          {" · "}
          <Link href="/admin/plans/term-downloads">{t("termDownloadsLink")}</Link>
        </span>
      </div>

      <GradeTermNav
        grades={gradeCounts(groups)}
        terms={termCounts(groups, gradeNum)}
        grade={gradeNum}
        term={filters.term ?? null}
        allowAll
      />

      <PlansFilterBar options={options} filters={filters} />

      <ByGradeDownloads
        term={filters.term ?? null}
        grades={byGrade}
        query={Object.fromEntries(
          Object.entries({ subject: filters.subject, status: filters.status, q: filters.q }).filter(
            (e): e is [string, string] => Boolean(e[1]),
          ),
        )}
      />

      <PlansBrowser
        key={filterKey}
        initialPlans={rows}
        initialHasMore={initialHasMore}
        filters={filters}
        total={total}
      />
    </div>
  );
}
