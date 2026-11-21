/**
 * titled.ts — download names that say what the lesson covers.
 *
 * The canonical filename (`G2_Health_T1a_W1_L1`) stays first so files sort in
 * teaching order; the lesson title follows so a teacher can tell lessons apart
 * without opening them. Pure module (no I/O).
 */

const MAX_TITLE_CHARS = 60;

/** `"Counting 100 to 120, by grouping"` → `"Counting_100_to_120_by_grouping"`, capped at a word. */
export function titleToken(title: string): string {
  const words = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let out = "";
  for (const word of words) {
    const next = out ? `${out}_${word}` : word;
    if (next.length > MAX_TITLE_CHARS) break;
    out = next;
  }
  return out || words.join("_").slice(0, MAX_TITLE_CHARS);
}

/** `G2_Health_T1a_W1_L1` + title → `G2_Health_T1a_W1_L1_Living_things_and_non-living…`. */
export function titledFilename(filename: string, title: string | null | undefined): string {
  const token = title ? titleToken(title) : "";
  return token ? `${filename}_${token}` : filename;
}
