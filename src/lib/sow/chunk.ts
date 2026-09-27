/**
 * Scheme text chunking (AI Studio v2) — PURE: no DB, no network, no `ai`.
 *
 * The model-backed extractor (`./aiExtract.ts`) cannot send a whole scheme in
 * one call — a term's scheme runs to hundreds of thousands of characters —
 * so the plain text is cut into chunks that each fit comfortably in a
 * request. Cuts land on lesson or week boundaries wherever the text shows
 * one ("Week 3", "Lesson 12", "L012", "BL1 …"), so a lesson is not split
 * between two calls and extracted twice, or half-extracted in each.
 */

/** Default chunk budget in characters (~3.5k tokens of prose). */
export const DEFAULT_CHUNK_CHARS = 14_000;

/**
 * A line that opens a new lesson or week — the preferred places to cut.
 * Kept deliberately loose: the whole point of the fallback is that we do not
 * know the format, so any line that merely starts with a week/lesson label
 * counts.
 */
const BOUNDARY_LINE =
  /^\s*(?:week\s*\d+\b|lesson\s*\d+\b|(?:BL|MT|ET|ER|L)\s?\d{1,3}\b|\d{1,3}\s*\((?:BL|MT|ET|ER|L)\s?\d{1,3}\))/i;

/**
 * Split `text` into chunks of at most `maxChars` characters, cutting at the
 * last lesson/week boundary before the limit when one exists, and otherwise
 * at the last blank line, and otherwise at the last newline. A single line
 * longer than the limit is emitted on its own.
 *
 * @param text The scheme's plain text.
 * @param maxChars Chunk budget; see {@link DEFAULT_CHUNK_CHARS}.
 */
export function chunkSchemeText(text: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  if (!normalised) return [];
  if (normalised.length <= maxChars) return [normalised];

  const lines = normalised.split("\n");
  const chunks: string[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  /** Index in `buffer` of the last boundary line, or -1. */
  let lastBoundary = -1;
  /** Index in `buffer` of the last blank line, or -1. */
  let lastBlank = -1;

  const flush = (upTo: number) => {
    // Emit buffer[0..upTo) and keep the rest.
    const head = buffer.slice(0, upTo);
    const chunk = head.join("\n").trim();
    if (chunk) chunks.push(chunk);
    buffer = buffer.slice(upTo);
    bufferLen = buffer.reduce((n, l) => n + l.length + 1, 0);
    lastBoundary = -1;
    lastBlank = -1;
    buffer.forEach((l, i) => {
      if (BOUNDARY_LINE.test(l)) lastBoundary = i;
      if (!l.trim()) lastBlank = i;
    });
  };

  for (const line of lines) {
    if (bufferLen + line.length + 1 > maxChars && buffer.length > 0) {
      // Prefer a cut at a boundary (but not at index 0 — that would loop),
      // then a blank line, then just here.
      const cutAt =
        lastBoundary > 0 ? lastBoundary : lastBlank > 0 ? lastBlank : buffer.length;
      flush(cutAt);
    }
    if (BOUNDARY_LINE.test(line)) lastBoundary = buffer.length;
    if (!line.trim()) lastBlank = buffer.length;
    buffer.push(line);
    bufferLen += line.length + 1;
  }
  if (buffer.length > 0) flush(buffer.length);

  return chunks;
}
