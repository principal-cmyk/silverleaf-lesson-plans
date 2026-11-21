"use client";

/**
 * ByGradeDownloads — "download one file per grade" for the plans list.
 *
 * A whole term across every grade is too heavy to draw in one tab. This runs
 * the batch download page once per grade, one after another, each in a hidden
 * frame opened with `?auto=1` (see BatchAutoRun), so the browser downloads one
 * ZIP per grade and only ever holds one grade's work in memory. The frame is
 * thrown away when its grade finishes.
 */
import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { getPathname } from "@/i18n/navigation";
import {
  GOVERNMENT_FORMS_PATH,
  LESSON_PLANS_PDF_PATH,
  SLIDES_PATH,
} from "@/lib/admin/governmentForms";

import type { BatchAutoMessage } from "./BatchAutoRun";
import styles from "./byGradeDownloads.module.css";

export interface GradeRun {
  /** Grade token as stored on plans: `KG1`, `G4`. */
  token: string;
  label: string;
  /** Plans in this grade (under the list's current filters and term). */
  count: number;
}

type RunStatus = "waiting" | "running" | "done" | "failed" | "stopped";

/** One grade may take long (slides ask AI per deck); beyond this it is failed. */
const GRADE_TIMEOUT_MS = 30 * 60_000;

const KINDS = [
  { key: "forms", path: GOVERNMENT_FORMS_PATH },
  { key: "lessonPlans", path: LESSON_PLANS_PDF_PATH },
  { key: "slides", path: SLIDES_PATH },
] as const;

export default function ByGradeDownloads({
  term,
  grades,
  query,
}: {
  /** Term token (`1a`), or null when no term is chosen. */
  term: string | null;
  grades: GradeRun[];
  /** The list's other filters (subject, status, search) to carry along. */
  query: Record<string, string>;
}) {
  const t = useTranslations("lpAdmin.plans.byGrade");
  const locale = useLocale();
  const [statuses, setStatuses] = useState<Record<string, RunStatus>>({});
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  const runnable = grades.filter((g) => g.count > 0);
  const setStatus = (token: string, s: RunStatus) => setStatuses((p) => ({ ...p, [token]: s }));

  /** Run one grade to the end in a hidden frame. */
  function runGrade(path: string, grade: GradeRun): Promise<"done" | "failed"> {
    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      // Off-screen but laid out at a real width, so the page renders as usual.
      iframe.style.cssText =
        "position:fixed;top:0;left:-10000px;width:1200px;height:900px;border:0;pointer-events:none;";
      const finish = (result: "done" | "failed") => {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        clearInterval(stopWatch);
        iframe.remove();
        frame.current = null;
        resolve(result);
      };
      const onMessage = (e: MessageEvent<BatchAutoMessage>) => {
        if (e.origin !== window.location.origin || e.source !== iframe.contentWindow) return;
        if (e.data?.source === "batch-auto") finish(e.data.status);
      };
      const stopWatch = setInterval(() => stop.current && finish("failed"), 500);
      window.addEventListener("message", onMessage);
      const timer = setTimeout(() => finish("failed"), GRADE_TIMEOUT_MS);
      iframe.src = getPathname({
        href: { pathname: path, query: { ...query, grade: grade.token, term: term!, auto: "1" } },
        locale,
      });
      frame.current = iframe;
      document.body.appendChild(iframe);
    });
  }

  async function run(path: string) {
    if (!term || runnable.length === 0) return;
    stop.current = false;
    setRunning(true);
    setStatuses(Object.fromEntries(runnable.map((g) => [g.token, "waiting" as RunStatus])));
    for (const grade of runnable) {
      if (stop.current) {
        setStatus(grade.token, "stopped");
        continue;
      }
      setStatus(grade.token, "running");
      const result = await runGrade(path, grade);
      setStatus(grade.token, stop.current && result === "failed" ? "stopped" : result);
    }
    setRunning(false);
  }

  const started = Object.keys(statuses).length > 0;

  return (
    <section className={styles.panel} aria-labelledby="by-grade-heading">
      <h2 id="by-grade-heading" className={styles.heading}>
        {t("heading")}
      </h2>
      <p className={styles.hint}>{term ? t("hint", { term: term.toUpperCase() }) : t("needTerm")}</p>
      <div className={styles.actions}>
        {KINDS.map(({ key, path }) => (
          <button
            key={key}
            type="button"
            className={styles.button}
            onClick={() => run(path)}
            disabled={running || !term || runnable.length === 0}
          >
            {t(key)}
          </button>
        ))}
        {running ? (
          <button type="button" className={styles.stop} onClick={() => (stop.current = true)}>
            {t("stop")}
          </button>
        ) : null}
      </div>
      {started ? (
        <ol className={styles.list} aria-live="polite">
          {runnable.map((g) => (
            <li key={g.token}>
              <span>
                {g.label} · {t("count", { count: g.count })}
              </span>
              <span className={`${styles.status} ${styles[`status_${statuses[g.token] ?? "waiting"}`] ?? ""}`}>
                {t(`status.${statuses[g.token] ?? "waiting"}`)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
