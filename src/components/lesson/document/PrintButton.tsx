"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import styles from "./lessonPlanDocument.module.css";

/**
 * PrintButton — converts a print-ready document into a real PDF (one page per
 * `[data-print-page]` section, rasterised with html2canvas and assembled into an
 * A4 `jsPDF`) and opens that PDF in a new tab, so what gets printed / saved is
 * the generated PDF file itself rather than the live page.
 *
 * Shared by both documents on the plan page: the portrait Silverleaf booklet
 * (`LessonPlanDocument`, the defaults below) and the landscape government form
 * (`ComplianceDocument`, which passes `orientation="landscape"`). Everything
 * except the page geometry is orientation-agnostic.
 *
 * The capture never uses the on-screen layout directly: embedded in a narrow
 * reading column (e.g. the ~712px teacher card) a document renders through its
 * squished `@container` single-column styles, and stretching that capture onto
 * A4 warps the type. Instead the `[data-print-root]` document is cloned into an
 * off-screen stage wider than its container breakpoint (`stageWidth`), so every
 * page is photographed at its true desktop layout, then placed on the A4 page at
 * its captured aspect ratio (uniform scale only — never stretched).
 *
 * jsPDF + html2canvas are dynamically imported so they never ship in the
 * initial bundle — only pulled in the moment a teacher actually clicks print.
 *
 * When the conversion fails (html2canvas is unmaintained and can choke on
 * newer CSS) the error is logged and surfaced to the teacher — we do NOT
 * auto-fire `window.print()`, which would print the whole app page. The
 * `@media print` rules in plan.module.css keep a manual browser print usable.
 *
 * Kept as its own client component so `LessonPlanDocument` can stay a plain
 * presentational component — server-renderable on the plan page yet client-safe
 * for the Studio preview (the document markup carries no interactivity). The
 * button's strings come from the `lpPlan` catalog: the document body is
 * deliberately English-only content, but the button is app chrome and follows
 * the active locale.
 */
export default function PrintButton({
  className,
  fileName = "lesson-plan.pdf",
  label,
  orientation = "portrait",
  stageWidth = "232mm",
  scale = 3,
  jpegQuality = 0.98,
  overflow = "shrink",
  bundle = "pdf",
}: {
  className?: string;
  fileName?: string;
  /** Button text; defaults to the branded document's "Print / Save as PDF". */
  label?: string;
  /** Page geometry of the document being captured. */
  orientation?: "portrait" | "landscape";
  /** Off-screen capture width — must exceed the document's `@container` breakpoint. */
  stageWidth?: string;
  /**
   * Capture resolution multiplier and JPEG quality. The defaults suit one plan;
   * the batch forms page lowers both so a few hundred pages fit in memory.
   */
  scale?: number;
  jpegQuality?: number;
  /**
   * How pages map onto sheets. "shrink" (the government form): one sheet per
   * page, a page taller than the sheet scaled down onto it. "flow" (the branded
   * booklet, whose teaching and closing pages run well past A4): the pages are
   * stacked into one continuous document, exactly as it scrolls on screen, and
   * poured onto as many full-width sheets as it needs (see `findSheetCuts`),
   * each numbered "n / N" in its bottom margin.
   */
  overflow?: "shrink" | "flow";
  /**
   * What a batch page (one nested `[data-print-root]` per document) downloads:
   * "pdf" — every document in ONE combined PDF; "zip" — a ZIP (named
   * `fileName`) holding one PDF per document, each named by its root's
   * `data-print-file`.
   */
  bundle?: "pdf" | "zip";
}) {
  const t = useTranslations("lpPlan");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    page: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    setError(null);

    // Resolve the document containing THIS button — a page can hold more than
    // one `[data-print-root]` (e.g. an admin preview), and a global
    // querySelector would always grab the first one.
    const root =
      event.currentTarget.closest<HTMLElement>("[data-print-root]") ??
      document.querySelector<HTMLElement>("[data-print-root]");
    const livePages = root
      ? Array.from(root.querySelectorAll<HTMLElement>("[data-print-page]"))
      : [];
    if (!root || livePages.length === 0) {
      window.print();
      return;
    }

    setBusy(true);

    // A batch page nests one `[data-print-root]` per document inside the root
    // that holds this button; each is captured on its own (see below). A plain
    // single-document page is its own and only unit.
    const nested = Array.from(
      root.querySelectorAll<HTMLElement>("[data-print-root]"),
    );
    const units = nested.length > 0 ? nested : [root];
    const totalPages = livePages.length;

    // Off-screen stage wider than the document's @container breakpoint, so the
    // clone lays out at its full A4 width even when the live one sits squished
    // inside a narrow reading column.
    const stage = document.createElement("div");
    stage.setAttribute("aria-hidden", "true");
    stage.style.cssText = `position:fixed;top:0;left:-10000px;width:${stageWidth};z-index:-1;pointer-events:none;`;
    document.body.appendChild(stage);

    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const landscape = orientation === "landscape";
      const pageW = landscape ? 297 : 210;
      const pageH = landscape ? 210 : 297;
      let done = 0;

      /** One output PDF: the jsPDF plus how many sheets already hold an image. */
      type Out = {
        pdf: InstanceType<typeof jsPDF>;
        sheets: number;
        // [first, end) sheet indexes of each flowed document, for numbering.
        numbered: Array<[number, number]>;
      };
      const newOut = (): Out => ({
        pdf: new jsPDF({
          unit: "mm",
          format: "a4",
          orientation,
          compress: true,
        }),
        // jsPDF starts with one blank sheet, which the first image fills.
        sheets: 0,
        numbered: [],
      });
      const nextSheet = (out: Out) => {
        if (out.sheets++ > 0) out.pdf.addPage();
      };

      /**
       * "flow": capture the staged document as ONE continuous image — its
       * sections stacked flush, without the on-screen sheet chrome (min-height,
       * gaps, shadows, the "n / 3" corner numbers and the print bar, which are
       * marked `data-print-hide`) — then slice it onto A4 sheets inside an
       * even FLOW_MARGIN_MM margin (printers cannot print to the paper's edge),
       * so the document is scaled down a touch to the margin's width.
       */
      async function flowOntoSheets(host: HTMLElement, out: Out) {
        const docEl = host.firstElementChild as HTMLElement;
        for (const el of Array.from(
          docEl.querySelectorAll("[data-print-hide]"),
        )) {
          el.remove();
        }
        docEl.style.background = "#fff";
        docEl.style.padding = "0";
        const pages = Array.from(
          docEl.querySelectorAll<HTMLElement>("[data-print-page]"),
        );
        for (const page of pages) {
          page.style.minHeight = "0";
          page.style.margin = "0 auto";
          page.style.boxShadow = "none";
        }

        const docRect = docEl.getBoundingClientRect();
        const pageRect = pages[0]!.getBoundingClientRect();
        // Document px per mm, and sheet mm per document mm.
        const pxPerMm = pageRect.width / pageW;
        const contentW = pageW - 2 * FLOW_MARGIN_MM;
        const k = contentW / pageW;
        const cuts = findSheetCuts(
          docEl,
          ((pageH - 2 * FLOW_MARGIN_MM) / k) * pxPerMm,
          KEEP_WITH_HEADER_MM * pxPerMm,
          MIN_PIECE_MM * pxPerMm,
        );

        const canvas = await html2canvas(docEl, {
          scale,
          useCORS: true,
          backgroundColor: "#ffffff",
          ignoreElements: (el) =>
            el.hasAttribute("data-print-root") && !host.contains(el),
        });
        // Crop to the page column: the stage is wider than the A4 page.
        const ratio = canvas.width / docRect.width;
        const sx = Math.round((pageRect.left - docRect.left) * ratio);
        const sw = Math.round(pageRect.width * ratio);
        const bounds = [0, ...cuts, docRect.height];
        const first = out.sheets;
        for (let i = 0; i < bounds.length - 1; i += 1) {
          const sy = Math.round(bounds[i]! * ratio);
          const sh = Math.round(bounds[i + 1]! * ratio) - sy;
          const slice = document.createElement("canvas");
          slice.width = sw;
          slice.height = sh;
          slice
            .getContext("2d")!
            .drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
          const data = slice.toDataURL("image/jpeg", jpegQuality);
          slice.width = 0;
          slice.height = 0;
          nextSheet(out);
          out.pdf.addImage(
            data,
            "JPEG",
            FLOW_MARGIN_MM,
            FLOW_MARGIN_MM,
            contentW,
            (sh * contentW) / sw,
          );
        }
        canvas.width = 0;
        canvas.height = 0;
        out.numbered.push([first, out.sheets]);
      }

      /** One sheet per page; a page taller than the sheet shrinks onto it. */
      async function pagesOntoSheets(host: HTMLElement, out: Out) {
        const pages = Array.from(
          host.querySelectorAll<HTMLElement>("[data-print-page]"),
        );
        for (const page of pages) {
          done += 1;
          setProgress({ page: done, total: totalPages });
          const canvas = await html2canvas(page, {
            scale,
            useCORS: true,
            backgroundColor: "#ffffff",
            ignoreElements: (el) =>
              el.hasAttribute("data-print-root") && !host.contains(el),
          });
          const imgData = canvas.toDataURL("image/jpeg", jpegQuality);
          const { width: capturedW, height: capturedH } = canvas;
          // Release the canvas backing store now — a batch captures hundreds.
          canvas.width = 0;
          canvas.height = 0;
          nextSheet(out);
          // Place at the captured aspect ratio — uniform scaling only. Forcing
          // the image onto the exact A4 rectangle stretches the glyphs whenever
          // a section isn't one: pages set a `min-height`, so content may run
          // longer, and such a page shrinks to fit rather than being clipped.
          const naturalH = (capturedH * pageW) / capturedW;
          if (naturalH <= pageH) {
            out.pdf.addImage(imgData, "JPEG", 0, 0, pageW, naturalH);
          } else {
            const fitW = (capturedW * pageH) / capturedH;
            out.pdf.addImage(
              imgData,
              "JPEG",
              (pageW - fitW) / 2,
              0,
              fitW,
              pageH,
            );
          }
        }
      }

      /** Stamp flowed documents' sheet numbers and the title, then finish. */
      function finish(out: Out, name: string) {
        // Counted per document, so a combined batch numbers each plan on its own.
        for (const [first, last] of out.numbered) {
          for (let n = first; n < last; n += 1) {
            out.pdf.setPage(n + 1);
            out.pdf.setFontSize(8);
            out.pdf.setTextColor(120, 126, 136);
            out.pdf.text(
              `${n - first + 1} / ${last - first}`,
              pageW - FLOW_MARGIN_MM,
              pageH - 3,
              { align: "right" },
            );
          }
        }
        out.pdf.setProperties({ title: name.replace(/\.pdf$/i, "") });
      }

      const zip = bundle === "zip" && nested.length > 0;
      const files: Record<string, Uint8Array> = {};
      const combined: Out | null = zip ? null : newOut();

      // html2canvas re-clones the WHOLE page for every capture, so the stage
      // only ever holds ONE document, and the live (on-screen) documents are
      // skipped via ignoreElements. Staging a whole batch at once made every
      // capture clone every form — quadratic, many minutes for ~70 pages.
      for (const unit of units) {
        stage.replaceChildren(unit.cloneNode(true));

        // Give the browser a frame to lay the stage out before capturing it.
        // rAF never fires in hidden tabs (e.g. the teacher switches away while
        // the PDF is preparing), so a timeout backstop keeps this from hanging.
        await new Promise<void>((resolve) => {
          const backstop = setTimeout(resolve, 200);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(backstop);
              resolve();
            }),
          );
        });

        const out = combined ?? newOut();
        if (overflow === "flow") {
          done += stage.querySelectorAll("[data-print-page]").length;
          await flowOntoSheets(stage, out);
          setProgress({ page: done, total: totalPages });
        } else {
          await pagesOntoSheets(stage, out);
        }

        if (zip) {
          const name = uniqueName(
            files,
            unit.getAttribute("data-print-file") ||
              `document-${units.indexOf(unit) + 1}.pdf`,
          );
          finish(out, name);
          files[name] = new Uint8Array(out.pdf.output("arraybuffer"));
        }
      }

      if (zip) {
        // PDFs are already compressed, so the ZIP only stores them.
        const { zipSync } = await import("fflate");
        const archive = zipSync(files, { level: 0 });
        const url = URL.createObjectURL(
          new Blob([archive as BlobPart], { type: "application/zip" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }

      const pdf = combined!.pdf;
      finish(combined!, fileName);

      // jsPDF's typings claim `URL`, but "bloburl" returns the object-URL string.
      const blobUrl = pdf.output("bloburl") as unknown as string;
      const printWindow = window.open(blobUrl, "_blank");
      if (!printWindow) {
        // Popup blocked — fall back to a direct download of the same PDF.
        pdf.save(fileName);
        URL.revokeObjectURL(blobUrl);
      } else {
        // Free the multi-MB blob once the new tab has had time to load it —
        // revoking immediately would break the tab's fetch of the URL.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      }
    } catch (err) {
      console.error("[PrintButton] PDF export failed:", err);
      setError(t("printFailed"));
    } finally {
      stage.remove();
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={busy}
        aria-busy={busy}
      >
        {busy
          ? progress && progress.total > 1
            ? t("preparingPdfProgress", progress)
            : t("preparingPdf")
          : (label ?? t("printLabel"))}
      </button>
      {error ? (
        <span className={styles.printError} role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

/** `name`, or `name (2).pdf` etc. when `taken` already has it. */
function uniqueName(taken: Record<string, unknown>, name: string): string {
  if (!(name in taken)) return name;
  const stem = name.replace(/\.pdf$/i, "");
  let n = 2;
  while (`${stem} (${n}).pdf` in taken) n += 1;
  return `${stem} (${n}).pdf`;
}

/** Even white margin around every flowed sheet. */
const FLOW_MARGIN_MM = 8;

/** How much of each section's top (its header band and first card) is never split off. */
const KEEP_WITH_HEADER_MM = 60;

/** The least of a card that may be left on either side of a break inside it. */
const MIN_PIECE_MM = 20;

/**
 * Where to cut a flowed document into sheets, as y offsets (CSS px from its
 * top), each slice at most `room` tall. The aim is full sheets, like a printed
 * document, without ugly breaks:
 *
 *  - never through a text line or an image;
 *  - between two cards (anything drawn with a background, border or shadow)
 *    when such a gap lies in the bottom 15% of the sheet;
 *  - otherwise between two lines inside a card, anywhere in the lower half,
 *    leaving at least `minPiecePx` of that card on each side;
 *  - otherwise (a huge image) hard at the limit.
 *
 * The first `keepPx` of every section is unbreakable, so a section header is
 * never left alone at the foot of a sheet. Each cut sits midway across its gap
 * so the space is shared by both sheets.
 */
function findSheetCuts(
  root: HTMLElement,
  room: number,
  keepPx: number,
  minPiecePx: number,
): number[] {
  const rootRect = root.getBoundingClientRect();
  const origin = rootRect.top;
  const total = rootRect.height;

  // Spans [top, bottom] that must not be cut through.
  const lines: Array<[number, number]> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.height > 0) lines.push([r.top - origin, r.bottom - origin]);
    }
  }
  for (const img of Array.from(root.querySelectorAll("img, svg, canvas"))) {
    const r = img.getBoundingClientRect();
    if (r.height > 0) lines.push([r.top - origin, r.bottom - origin]);
  }
  for (const section of Array.from(
    root.querySelectorAll("[data-print-page]"),
  )) {
    const top = section.getBoundingClientRect().top - origin;
    if (top > 0) lines.push([top + 1, top + keepPx]);
  }

  // Cards. One taller than a sheet has to be broken anyway, so it is ignored.
  const cards: Array<[number, number]> = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const css = getComputedStyle(el);
    const drawn =
      !/^(transparent|rgba\(.*,\s*0\))$/.test(css.backgroundColor) ||
      parseFloat(css.borderTopWidth) > 0 ||
      parseFloat(css.borderBottomWidth) > 0 ||
      css.boxShadow !== "none";
    if (!drawn) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.height < room)
      cards.push([r.top - origin, r.bottom - origin]);
  }

  // Midpoints of the gaps (zero-width included) between the merged spans.
  const gaps = (spans: Array<[number, number]>) => {
    const sorted = [...spans].sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    let end = -Infinity;
    for (const [top, bottom] of sorted) {
      if (top >= end && end > -Infinity) out.push((end + top) / 2);
      end = Math.max(end, bottom);
    }
    return out;
  };
  const cardGaps = gaps([...lines, ...cards]);
  // A break inside a card must leave a decent piece of it on both sheets.
  const lineGaps = gaps(lines).filter((y) =>
    cards.every(
      ([top, bottom]) =>
        y <= top ||
        y >= bottom ||
        (y - top >= minPiecePx && bottom - y >= minPiecePx),
    ),
  );

  const cuts: number[] = [];
  let start = 0;
  while (total - start > room) {
    const lowest = (ys: number[], from: number) =>
      ys.filter((y) => y > start + from * room && y <= start + room).pop();
    const cut = lowest(cardGaps, 0.85) ?? lowest(lineGaps, 0.5) ?? start + room;
    cuts.push(cut);
    start = cut;
  }
  return cuts;
}
