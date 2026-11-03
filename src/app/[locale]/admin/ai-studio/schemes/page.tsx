import { getTranslations } from "next-intl/server";

import { requireAdmin } from "@/lib/auth";
import { listSchemes } from "@/lib/actions/schemes";
import {
  parseGradeParam,
  parseTermParam,
  resolveGradeTerm,
} from "@/lib/admin/gradeTerm";

import SchemesClient from "./SchemesClient";

/** Live admin data — never prerender or cache. */
export const dynamic = "force-dynamic";

/**
 * Admin Schemes of Work listing page.
 *
 * Server side: gate with requireAdmin, load schemes list, resolve which
 * grade + term to show from `?grade=&term=` (defaulting to the first grade and
 * term that hold schemes), pass to client. The client groups the list
 * Grade → Term → Subject. All mutations (upload, create, edit, delete) live in
 * the client component.
 */
export default async function AdminSchemesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const t = await getTranslations("lpManage.schemes");

  const [result, params] = await Promise.all([listSchemes(), searchParams]);
  const schemes = result.schemes ?? [];
  const { grade, term } = resolveGradeTerm(schemes, {
    grade: parseGradeParam(params.grade),
    term: parseTermParam(params.term),
  });

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
          {t("count", { count: schemes.length })}
        </span>
      </div>

      {!result.ok ? (
        <p style={{ color: "var(--ink-muted)", marginBottom: "1rem" }}>
          {t("errorGeneric")}
        </p>
      ) : null}

      <SchemesClient initialSchemes={schemes} grade={grade} term={term} />
    </div>
  );
}
