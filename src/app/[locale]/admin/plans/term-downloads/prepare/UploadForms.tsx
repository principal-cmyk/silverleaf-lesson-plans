"use client";

/**
 * UploadForms — the print root of the prepare page. Its button draws every
 * form (PrintButton, as on the batch forms page) and then stores each PDF
 * through `PUT /api/admin/form-pdfs/[planId]` instead of downloading a ZIP.
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { COMPLIANCE_STAGE_WIDTH } from "@/components/lesson/document/ComplianceDocument";
import PrintButton from "@/components/lesson/document/PrintButton";
import styles from "../../government-forms/governmentForms.module.css";

export default function UploadForms({
  planIdByFile,
  zipName,
  children,
}: {
  planIdByFile: Record<string, string>;
  zipName: string;
  children: ReactNode;
}) {
  const t = useTranslations("lpAdmin.plans.termDownloads");
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function onFiles(files: Record<string, Uint8Array>) {
    const entries = Object.entries(files);
    let stored = 0;
    const bad: string[] = [];
    for (const [name, bytes] of entries) {
      const planId = planIdByFile[name];
      setMessage(t("uploading", { done: stored, total: entries.length }));
      try {
        const res = planId
          ? await fetch(`/api/admin/form-pdfs/${planId}`, {
              method: "PUT",
              headers: { "content-type": "application/pdf" },
              body: bytes as BodyInit,
            })
          : null;
        if (res?.ok) stored += 1;
        else bad.push(name);
      } catch {
        bad.push(name);
      }
    }
    setFailed(bad.length > 0);
    setMessage(
      bad.length > 0
        ? t("uploadPartial", { stored, total: entries.length })
        : t("uploadDone", { count: stored }),
    );
  }

  return (
    <div data-print-root>
      <div className={styles.toolbar}>
        <PrintButton
          className={styles.downloadButton}
          fileName={zipName}
          bundle="zip"
          label={t("prepareButton")}
          orientation="landscape"
          stageWidth={COMPLIANCE_STAGE_WIDTH}
          scale={2}
          jpegQuality={0.85}
          onFiles={onFiles}
        />
        {message ? (
          <span role={failed ? "alert" : "status"} aria-live="polite">
            {message}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
