/**
 * subjectLabel — the readable name of a stored subject token.
 *
 * Subjects are stored as the filename's single TitleCase token
 * ("HealthAndEnvironment", "NumeracyScienceAndICT"); teachers should read
 * "Health and Environment". Known tokens — including ones imported with a
 * typo or odd casing — have an explicit name; anything else is split at its
 * capitals, with short joining words lower-cased.
 *
 * Subject names are proper names, the same in every locale (like the
 * government form's labels), so this is not i18n.
 *
 * Pure module (no `server-only`) — used by server pages and client filters.
 */

const KNOWN: Record<string, string> = {
  EralyLifeSkills: "Early Life Skills",
  HistoriaYATanzaniaNAMaadili: "Historia ya Tanzania na Maadili",
  CultureArtsAndSports: "Culture, Arts and Sports",
  CultureReligiousEducationArtsAndSports: "Culture, Religious Education, Arts and Sports",
  NumeracyScienceAndICT: "Numeracy, Science and ICT",
};

/** Joining words written in lower case inside a name (English and Kiswahili). */
const SMALL_WORDS = new Set(["and", "of", "the", "ya", "na", "wa", "za", "la"]);

export function subjectLabel(token: string): string {
  const known = KNOWN[token];
  if (known) return known;
  const words = token
    // "HealthAnd" → "Health And"; "ICTSkills" → "ICT Skills"
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ");
  return words
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(" ");
}
