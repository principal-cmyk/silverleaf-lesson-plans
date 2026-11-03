"use client";

/**
 * SowUploadPanel — upload a SOW file (docx/PDF/CSV/text), preview the parsed rows and
 * header context, tweak the detected scheme metadata, and create the scheme.
 *
 * The state lives in `useSowUpload`, which SchemesClient calls so an
 * in-progress preview survives a hop into the detail view and back (the panel
 * itself unmounts there; the always-mounted parent does not).
 */
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import {
  previewSowUpload,
  createSchemeFromUpload,
} from "@/lib/actions/schemes";
import type { ParsedSowRow, ParsedSowStats } from "@/lib/sow/parse";
import type { SchemeHeaderContext } from "@/lib/sow/types";

import SowPreviewTable from "../SowPreviewTable";
import { SOW_UPLOAD_ACCEPT, fileToSowUploadInput } from "../sowUpload";
import HeaderContextPanel from "./HeaderContextPanel";
import SchemeMetaSummary from "./SchemeMetaSummary";
import styles from "./SchemesClient.module.css";

export function useSowUpload() {
  const t = useTranslations("lpManage.schemes");
  const router = useRouter();
  const pathname = usePathname();

  const [previewRows, setPreviewRows] = useState<ParsedSowRow[] | null>(null);
  const [previewHeader, setPreviewHeader] = useState<SchemeHeaderContext | null>(null);
  const [previewStats, setPreviewStats] = useState<ParsedSowStats | null>(null);
  const [previewMetaExtra, setPreviewMetaExtra] = useState<{
    mainCompetence?: string;
    weeksCount?: number;
    lessonsPerWeek?: number;
    lessonDurationMins?: number;
    totalLessons?: string;
  } | null>(null);
  const [metaOverride, setMetaOverride] = useState({
    title: "",
    grade: "",
    subject: "",
    term: "",
    year: "",
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPending, startUploadTransition] = useTransition();
  const [createPending, startCreateTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setUploadFile(file);
    setPreviewRows(null);
    setPreviewHeader(null);
    setPreviewStats(null);
    setPreviewMetaExtra(null);
    setUploadError(null);
    setCreateMsg(null);
  }

  function handlePreview() {
    if (!uploadFile) return;
    setUploadError(null);
    setCreateMsg(null);

    startUploadTransition(async () => {
      const input = await fileToSowUploadInput(uploadFile);
      const result = await previewSowUpload(input);
      if (!result.ok) {
        setUploadError(result.message ?? t("errorGeneric"));
        return;
      }
      setPreviewRows(result.rows ?? []);
      setPreviewHeader(result.headerContext ?? null);
      setPreviewStats(result.stats ?? null);
      const meta = result.scheme;
      if (meta) {
        setPreviewMetaExtra({
          mainCompetence: meta.mainCompetence ?? undefined,
          weeksCount: meta.weeksCount ?? undefined,
          lessonsPerWeek: meta.lessonsPerWeek ?? undefined,
          lessonDurationMins: meta.lessonDurationMins ?? undefined,
          totalLessons: meta.totalLessons ?? undefined,
        });
        setMetaOverride({
          title: meta.title ?? "",
          grade: meta.grade ?? "",
          subject: meta.subject ?? "",
          term: meta.term ?? "",
          year: meta.year ?? "",
        });
      }
    });
  }

  function handleCreate() {
    if (!uploadFile || !previewRows) return;
    setUploadError(null);
    setCreateMsg(null);

    startCreateTransition(async () => {
      const input = await fileToSowUploadInput(uploadFile);
      const result = await createSchemeFromUpload({
        ...input,
        title: metaOverride.title || undefined,
        grade: metaOverride.grade || undefined,
        subject: metaOverride.subject || undefined,
        term: metaOverride.term || undefined,
        year: metaOverride.year || undefined,
      });

      if (!result.ok) {
        // Show the authored safe detail when present (e.g. which scheme meta
        // fields are still blank) — see docs/server-actions.md rule 3.
        setUploadError(result.message ?? t("errorGeneric"));
        return;
      }

      setCreateMsg(t("created"));
      setPreviewRows(null);
      setPreviewHeader(null);
      setPreviewStats(null);
      setPreviewMetaExtra(null);
      setUploadFile(null);
      // Open the grade/term the new scheme was filed under — it may not be
      // the one on screen. (A navigation re-renders the server list too.)
      if (result.gradeToken && result.term) {
        router.replace(`${pathname}?grade=${result.gradeToken}&term=${result.term}`);
      } else {
        router.refresh();
      }
    });
  }

  return {
    uploadFile,
    previewRows,
    previewHeader,
    previewStats,
    previewMetaExtra,
    metaOverride,
    setMetaOverride,
    uploadPending,
    createPending,
    uploadError,
    createMsg,
    handleFileChange,
    handlePreview,
    handleCreate,
  };
}

export default function SowUploadPanel({
  upload,
}: {
  upload: ReturnType<typeof useSowUpload>;
}) {
  const t = useTranslations("lpManage.schemes");
  const {
    uploadFile,
    previewRows,
    previewHeader,
    previewStats,
    previewMetaExtra,
    metaOverride,
    setMetaOverride,
    uploadPending,
    createPending,
    uploadError,
    createMsg,
    handleFileChange,
    handlePreview,
    handleCreate,
  } = upload;

  return (
    <div className={styles.panel} id="sow-upload">
      <h2 className={styles.panelTitle}>{t("uploadHeading")}</h2>

      <label className={styles.fieldLabel}>
        {t("uploadLabel")}
        <input
          type="file"
          accept={SOW_UPLOAD_ACCEPT}
          className={styles.input}
          onChange={handleFileChange}
          disabled={uploadPending || createPending}
        />
      </label>

      {uploadFile ? (
        <button
          className={styles.btnPrimary}
          onClick={handlePreview}
          disabled={uploadPending || createPending}
        >
          {uploadPending ? t("uploading") : t("uploadButton")}
        </button>
      ) : null}

      {uploadError ? <p className={styles.error}>{uploadError}</p> : null}
      {createMsg ? <p className={styles.success}>{createMsg}</p> : null}

      {previewRows !== null ? (
        <>
          <h3 className={styles.subHeading}>{t("previewHeading")}</h3>

          {/* Editable meta */}
          <div className={styles.metaGrid}>
            {(["title", "grade", "subject", "term", "year"] as const).map((field) => (
              <label key={field} className={styles.fieldLabel}>
                {t(
                  field === "title"
                    ? "metaTitle"
                    : field === "grade"
                      ? "metaGrade"
                      : field === "subject"
                        ? "metaSubject"
                        : field === "term"
                          ? "metaTerm"
                          : "metaYear",
                )}
                <input
                  className={styles.input}
                  value={metaOverride[field]}
                  onChange={(e) =>
                    setMetaOverride((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                  disabled={createPending}
                />
              </label>
            ))}
          </div>

          {previewMetaExtra ? <SchemeMetaSummary meta={previewMetaExtra} /> : null}
          {previewStats ? (
            <p className={styles.muted}>
              {previewStats.parser === "ai"
                ? t("aiExtractedNote", { weeks: previewStats.weekTablesKept })
                : t("weekTablesNote", {
                    kept: previewStats.weekTablesKept,
                    dropped: previewStats.weekTablesDropped,
                  })}
            </p>
          ) : null}
          <HeaderContextPanel ctx={previewHeader} />

          {previewRows.length === 0 ? (
            <p className={styles.muted}>{t("previewEmpty")}</p>
          ) : (
            <SowPreviewTable
              rows={previewRows}
              classNames={{
                wrapper: styles.tableWrapper,
                table: styles.table,
                cell: styles.cellClamp,
              }}
            />
          )}

          <button
            className={styles.btnPrimary}
            onClick={handleCreate}
            disabled={createPending}
          >
            {createPending ? t("creating") : t("createButton")}
          </button>
        </>
      ) : null}
    </div>
  );
}
