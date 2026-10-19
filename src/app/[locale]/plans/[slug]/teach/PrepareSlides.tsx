"use client";

/**
 * PrepareSlides — shown while a plan's deck is generated for the first time
 * (or rebuilt after the plan changed). Starts the generation on mount, then
 * re-renders the page, which now finds the saved deck.
 *
 * A teacher about to teach is never stuck here: if generation fails they can
 * retry or switch to the basic slides built straight from the plan.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import type { SlideDeck } from "@/lib/slides/deckSchema";
import type { TeacherExtras } from "@/lib/slides/deckToSlides";

import SlidePlayer, { errorText } from "./SlidePlayer";
import styles from "./slides.module.css";

export default function PrepareSlides({
  planId,
  planHref,
  fallback,
  extras,
  view,
  canRegenerate,
}: {
  planId: string;
  planHref: string;
  fallback: SlideDeck;
  extras: TeacherExtras;
  view: "audience" | "presenter";
  canRegenerate: boolean;
}) {
  const t = useTranslations("lpSlides");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [useBasic, setUseBasic] = useState(false);
  const started = useRef(false);

  const generate = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/ai/slides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(errorText(t, body.error));
    } catch {
      setError(errorText(t, "network"));
    }
  }, [planId, router, t]);

  useEffect(() => {
    // Once per mount (React dev mode mounts effects twice).
    if (started.current) return;
    started.current = true;
    void generate();
  }, [generate]);

  if (useBasic) {
    return (
      <SlidePlayer
        deck={fallback}
        extras={extras}
        planId={planId}
        planHref={planHref}
        view={view}
        basic
        canRegenerate={canRegenerate}
      />
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.toolbar}>
        <Link href={planHref} className={styles.toolLink}>
          {t("back")}
        </Link>
      </div>
      <div className={styles.preparing} role="status">
        {error ? <p role="alert">{error}</p> : <p>{t("preparing")}</p>}
        {!error ? <span className={styles.spinner} aria-hidden="true" /> : null}
        <div className={styles.preparingActions}>
          {error ? (
            <button type="button" className={styles.toolButton} onClick={() => void generate()}>
              {t("retry")}
            </button>
          ) : null}
          <button type="button" className={styles.toolButton} onClick={() => setUseBasic(true)}>
            {t("useBasic")}
          </button>
        </div>
      </div>
    </div>
  );
}
