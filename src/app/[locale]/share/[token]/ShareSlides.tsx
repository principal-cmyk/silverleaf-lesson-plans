"use client";

/**
 * ShareSlides — the slides box on a shared plan. Downloads the slides when they
 * are ready; otherwise creates them first (one AI call, shared by everyone) and
 * downloads when done. The basic deck, built straight from the plan, is always
 * one click away so nobody is stuck waiting. No editing exists here.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";

import styles from "../share.module.css";

const KNOWN = new Set(["too-many", "no-api-key", "no-credits", "rate-limit", "model-error", "network"]);

export default function ShareSlides({
  token,
  planId,
  ready,
}: {
  token: string;
  planId: string;
  ready: boolean;
}) {
  const t = useTranslations("share.slides");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pptx = `/api/share/${token}/slides/${planId}/pptx`;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${token}/slides/${planId}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error && KNOWN.has(body.error) ? body.error : "model-error");
        return;
      }
      window.location.assign(pptx);
      router.refresh();
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.slides} aria-labelledby="share-slides-heading">
      <h2 id="share-slides-heading">{t("heading")}</h2>
      <p className={styles.hint}>{ready ? t("ready") : t("notReady")}</p>
      <div className={styles.slidesActions}>
        {ready ? (
          <a className={styles.button} href={pptx}>
            {t("download")}
          </a>
        ) : (
          <>
            <button type="button" className={styles.button} onClick={create} disabled={busy}>
              {busy ? t("creating") : t("create")}
            </button>
            <a className={`${styles.button} ${styles.buttonAlt}`} href={pptx}>
              {t("basic")}
            </a>
          </>
        )}
      </div>
      {busy ? <p className={styles.status}>{t("wait")}</p> : null}
      {error ? (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {t(`error.${error}`)}
        </p>
      ) : null}
    </section>
  );
}
