import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { getStaffSummary, getTeacherPlanAccess } from "@/lib/admin/insights";
import { parseRange, rangeDays } from "@/lib/admin/range";

/** Live, authenticated data — render on demand (never prerender/cache). */
export const dynamic = "force-dynamic";

const cell: React.CSSProperties = { padding: "0.5rem 0.75rem", textAlign: "left" };
const num: React.CSSProperties = { ...cell, textAlign: "right" };

/** Admin drill-down: which plans one teacher has opened, in the chosen range. */
export default async function TeacherAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin();
  const { staffId } = await params;
  const range = parseRange((await searchParams).range);

  const teacher = await getStaffSummary(staffId);
  if (!teacher) notFound();

  const [t, plans] = await Promise.all([
    getTranslations("lpAdmin.dashboard.teacherActivity"),
    getTeacherPlanAccess(teacher.id, rangeDays(range)),
  ]);
  const tp = (k: string, v?: Record<string, string | number>) =>
    t(`teacherPage.${k}`, v);

  return (
    <div>
      <p>
        <Link href={`/admin?range=${range}`}>← {tp("back")}</Link>
      </p>
      <h1 style={{ margin: "0.5rem 0" }}>{tp("heading", { name: teacher.fullName })}</h1>
      <p style={{ opacity: 0.7, marginBottom: "1rem" }}>
        {teacher.email} ·{" "}
        {range === "all" ? t("range.all") : t("range.days", { days: Number(range) })}
      </p>

      {plans.length === 0 ? (
        <p>{tp("empty")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th scope="col" style={cell}>{tp("plan")}</th>
                <th scope="col" style={cell}>{tp("gradeSubject")}</th>
                <th scope="col" style={num}>{tp("opens")}</th>
                <th scope="col" style={num}>{tp("downloads")}</th>
                <th scope="col" style={cell}>{tp("last")}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.planId}>
                  <td style={cell}>
                    <Link href={`/admin/plans/${p.slug}/edit`}>{p.title}</Link>
                  </td>
                  <td style={cell}>{p.grade} · {p.subject}</td>
                  <td style={num}>{p.events}</td>
                  <td style={num}>{p.downloads}</td>
                  <td style={cell}>
                    {p.lastAt.toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
