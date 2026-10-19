"use client";

/**
 * BulkSlides — makes every selected plan's PowerPoint and downloads them as
 * one ZIP.
 *
 * Per plan, a few at a time: if its deck is missing or out of date, ask
 * `POST /api/ai/slides` to make it (retrying a busy provider with back-off),
 * then fetch `GET /api/slides/[planId]/pptx`. A plan whose AI generation
 * fails still gets the basic deck — the .pptx route falls back by itself —
 * and is labelled so. Running out of AI credit stops further generation for
 * the batch (every later call would fail the same way).
 *
 * The ZIP is built in the browser (fflate, store-only: .pptx is already
 * compressed) once every plan has finished.
 */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import styles from "./bulkSlides.module.css";

export interface BulkSlideItem {
  id: string;
  title: string;
  /** Name of the .pptx inside the ZIP. */
  fileName: string;
  /** Already has a deck matching the plan's current content. */
  ready: boolean;
}

type Status = "waiting" | "generating" | "building" | "ready" | "basic" | "failed";

/** Plans worked on at once — the model calls are the slow part. */
const CONCURRENCY = 3;
/** Back-off before each retry of a busy (429) or flaky (502) generation. */
const RETRY_DELAYS_MS = [5_000, 15_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function BulkSlides({
  items,
  zipName,
  aiAvailable,
}: {
  items: BulkSlideItem[];
  zipName: string;
  aiAvailable: boolean;
}) {
  const t = useTranslations("lpAdmin.plans.slides");
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = useRef<Record<string, Uint8Array>>({});
  const outOfCredit = useRef(false);

  const setStatus = (id: string, s: Status) => setStatuses((prev) => ({ ...prev, [id]: s }));

  /** Make the deck if needed. Resolves false when AI could not make it. */
  async function generate(item: BulkSlideItem): Promise<boolean> {
    if (item.ready) return true;
    if (!aiAvailable || outOfCredit.current) return false;
    setStatus(item.id, "generating");
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await fetch("/api/ai/slides", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planId: item.id }),
        });
        if (res.ok) return true;
        if (res.status === 402) {
          outOfCredit.current = true;
          return false;
        }
        const retryable = res.status === 429 || res.status === 502;
        if (!retryable || attempt >= RETRY_DELAYS_MS.length) return false;
      } catch {
        if (attempt >= RETRY_DELAYS_MS.length) return false;
      }
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }

  async function process(item: BulkSlideItem) {
    await generate(item);
    setStatus(item.id, "building");
    try {
      const res = await fetch(`/api/slides/${item.id}/pptx`);
      if (!res.ok) throw new Error(String(res.status));
      files.current[item.fileName] = new Uint8Array(await res.arrayBuffer());
      setStatus(item.id, res.headers.get("x-slides-basic") === "1" ? "basic" : "ready");
    } catch {
      setStatus(item.id, "failed");
    }
  }

  async function run() {
    setRunning(true);
    setError(null);
    files.current = {};
    outOfCredit.current = false;
    setStatuses(Object.fromEntries(items.map((i) => [i.id, "waiting" as Status])));

    const queue = [...items];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) await process(item);
      }),
    );

    const names = items.map((i) => i.fileName).filter((n) => files.current[n]);
    if (names.length === 0) {
      setError(t("noneMade"));
    } else {
      const { zipSync } = await import("fflate");
      const archive = zipSync(
        Object.fromEntries(names.map((n) => [n, files.current[n]!])),
        { level: 0 },
      );
      const url = URL.createObjectURL(new Blob([archive as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    setRunning(false);
  }

  const done = items.filter((i) => ["ready", "basic", "failed"].includes(statuses[i.id] ?? "")).length;
  const started = Object.keys(statuses).length > 0;

  return (
    <div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.downloadButton} onClick={run} disabled={running}>
          {started && !running ? t("again") : t("download", { count: items.length })}
        </button>
        {started ? (
          <span className={styles.progress} aria-live="polite">
            {t("progress", { done, total: items.length })}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <ol className={styles.list}>
        {items.map((item) => {
          const status = statuses[item.id];
          return (
            <li key={item.id} className={styles.item}>
              <span className={styles.title}>{item.title}</span>
              <span className={styles.file}>{item.fileName}</span>
              {status ? (
                <span className={`${styles.status} ${styles[`status_${status}`] ?? ""}`}>
                  {t(`status.${status}`)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
