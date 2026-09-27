import "server-only";

/**
 * PDF scheme ingest (AI Studio v2) — the pdfjs wrapper.
 *
 * Reads a scheme PDF's positioned text with `pdfjs-dist` and hands it to the
 * pure reconstruction in `./pdfTables.ts`, then to the shared table parser.
 * Node-only: pdfjs's legacy build is used without a worker, and the package
 * is externalised in `next.config.ts` because webpack's transform of its ESM
 * build crashes at module load (the same reason `pdf-to-img` is external).
 *
 * The text pass is what makes the STANDARD template ingest free: those PDFs
 * are exported from docx, so every word is real text. A scanned scheme has no
 * text layer and yields no rows here; that case falls through to the
 * model-backed extractor (`./aiExtract.ts`) via `pdfPlainText`, which is empty
 * too — the upload preview then reports "no rows" rather than guessing.
 *
 * @see ./pdfTables.ts — the coordinate → table reconstruction.
 * @see ./parse.ts — `parseSowTables`, the shared core.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { parseSowTables, type ParsedSow } from "./parse";
import { reconstructSowTables, type PdfPageText } from "./pdfTables";

/** Shape of a pdfjs text item we rely on (a subset of `TextItem`). */
interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
}

/**
 * Read every page's positioned text. `transform[4]`/`[5]` are the fragment's
 * x/y in PDF user units with the origin at the bottom-left, which is what the
 * reconstruction expects (it sorts by descending y for top-to-bottom order).
 */
export async function extractPdfPages(buf: Buffer): Promise<PdfPageText[]> {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    // No worker in Node: pdfjs runs the parser on the main thread.
    isEvalSupported: false,
  }).promise;

  try {
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = (content.items as unknown[])
        .filter((it): it is RawTextItem => typeof (it as RawTextItem).str === "string")
        .map((it) => ({
          str: it.str,
          x: it.transform[4] ?? 0,
          y: it.transform[5] ?? 0,
          width: it.width,
        }));
      pages.push({ width: viewport.width, height: viewport.height, items });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/**
 * Parse a scheme PDF into a {@link ParsedSow}: positioned text → rebuilt week
 * tables → the shared table parser.
 *
 * @param buf The raw PDF bytes.
 */
export async function parseSowPdf(buf: Buffer): Promise<ParsedSow> {
  const pages = await extractPdfPages(buf);
  const { tables, titleHints } = reconstructSowTables(pages);
  return parseSowTables(tables, { titleHints });
}

/**
 * The PDF's plain text in reading order, page by page, for the model-backed
 * fallback. Empty for a scanned PDF with no text layer.
 */
export async function pdfPlainText(buf: Buffer): Promise<string> {
  const pages = await extractPdfPages(buf);
  return pages
    .map((p) =>
      [...p.items]
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((it) => it.str)
        .join(" "),
    )
    .join("\n\n");
}
