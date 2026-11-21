"use client";

/**
 * BatchAutoRun — lets a batch download page run itself when opened with
 * `?auto=1`, as the plans list's "download by grade" run does inside a hidden
 * frame. It presses the page's download button, waits for it to finish, and
 * tells the parent window how it went (`batch-auto` message). Without
 * `?auto=1` it does nothing, so the pages stay manual for everyone else.
 */
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export interface BatchAutoMessage {
  source: "batch-auto";
  status: "done" | "failed";
}

const POLL_MS = 500;
/** Give up waiting for the page to render its button. */
const START_TIMEOUT_MS = 60_000;

export default function BatchAutoRun() {
  const auto = useSearchParams().get("auto") === "1";

  useEffect(() => {
    if (!auto || window.parent === window) return;
    let cancelled = false;
    const tell = (status: BatchAutoMessage["status"]) =>
      window.parent.postMessage({ source: "batch-auto", status } satisfies BatchAutoMessage, window.location.origin);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const button = () => document.querySelector<HTMLButtonElement>("button[data-batch-download]");

    (async () => {
      const began = Date.now();
      let btn = button();
      while (!cancelled && (!btn || btn.disabled) && Date.now() - began < START_TIMEOUT_MS) {
        await sleep(POLL_MS);
        btn = button();
      }
      if (cancelled) return;
      if (!btn || btn.disabled) return tell("failed");
      btn.click();
      // Busy while it works; done when it stops being busy again.
      await sleep(POLL_MS);
      while (!cancelled && button()?.getAttribute("aria-busy") === "true") await sleep(POLL_MS);
      if (cancelled) return;
      // A finished run leaves an alert behind only when it failed.
      tell(document.querySelector('[role="alert"]') ? "failed" : "done");
    })();

    return () => {
      cancelled = true;
    };
  }, [auto]);

  return null;
}
