/**
 * Repair a model's near-miss slide deck before it is validated. Pure.
 *
 * The deck is a large structured object, and models occasionally slip on its
 * shape rather than its content: `null` where a string or list belongs, a
 * script cue in capitals ("SAY"), a minute written as text, an optional list
 * left out, the JSON wrapped in a code fence. Each of those used to fail the
 * whole generation. This fixes only such slips — it never invents lesson
 * content — and hands back text for the schema to judge as before.
 */

/** Keys whose value is a list (missing / null → []). */
const LIST_KEYS = new Set([
  "materials",
  "expected_answers",
  "key_words",
  "key_words_script",
  "teaching_points",
  "teaching_points_script",
  "worked_examples",
  "steps",
  "script",
  "marking_script",
  "rounds",
  "questions",
  "recap",
  "self_check",
]);

/** Keys whose value is a whole number of minutes. */
const NUMBER_KEYS = new Set(["lesson_minutes", "start_minute", "end_minute", "minutes"]);

/** Keys that may legitimately be "" (missing / null → ""). */
const OPTIONAL_TEXT_KEYS = new Set([
  "subheading",
  "sentence_frame",
  "book_note",
  "answer",
  "homework",
]);

/** Script cues the model sometimes uses instead of the four allowed. */
const CUE_ALIASES: Record<string, "say" | "ask" | "expect" | "do"> = {
  say: "say",
  says: "say",
  tell: "say",
  ask: "ask",
  asks: "ask",
  question: "ask",
  expect: "expect",
  expected: "expect",
  answer: "expect",
  do: "do",
  action: "do",
  act: "do",
  note: "do",
};

/** Every list key the deck has, so a dropped empty list comes back. */
const REQUIRED_LISTS: Record<string, string[]> = {
  i_do: ["key_words", "key_words_script"],
};

function fix(value: unknown, key?: string): unknown {
  if (key && LIST_KEYS.has(key)) {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) return [fix(value)];
  }
  if (key && NUMBER_KEYS.has(key) && typeof value === "string" && /^\s*\d+\s*$/.test(value)) {
    return Number(value);
  }
  if (key && OPTIONAL_TEXT_KEYS.has(key) && (value === null || value === undefined)) return "";
  if (key === "kind" && typeof value === "string") {
    return CUE_ALIASES[value.trim().toLowerCase()] ?? value;
  }
  if (key === "language" && typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v.startsWith("sw") || v.startsWith("kis")) return "sw";
    if (v.startsWith("en")) return "en";
  }
  if (Array.isArray(value)) return value.map((v) => fix(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fix(v, k);
    if (key && REQUIRED_LISTS[key]) {
      for (const k of REQUIRED_LISTS[key]!) if (!(k in out)) out[k] = [];
    }
    // A question object with no answer gets "" (an open question).
    if ("question" in out && !("answer" in out)) out.answer = "";
    return out;
  }
  return value;
}

/**
 * The repaired JSON text, or null when the text is not JSON at all (the
 * caller's retry then takes over).
 */
export function repairDeckText(text: string): string | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return JSON.stringify(fix(parsed));
  } catch {
    return null;
  }
}
