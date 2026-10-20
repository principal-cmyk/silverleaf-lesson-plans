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

import { NO_VISUAL, VISUAL_KINDS } from "./deckSchema";

/** Keys whose value is a list (missing / null → []). */
const LIST_KEYS = new Set([
  "instructions",
  "groups",
  "cards",
  "highlight",
  "headers",
  "rows",
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
  "caption",
  "label",
  "emoji",
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
  i_do_checkpoint: ["instructions"],
  we_do_checkpoint: ["instructions"],
  hook: ["instructions"],
  get_ready: ["instructions"],
};

/** Keys holding a visual. */
const VISUAL_KEYS = new Set(["visual", "teaching_points_visual"]);

/** Objects that must carry a visual (key → visual field); array items by their list's key. */
const REQUIRED_VISUAL: Record<string, string> = {
  hook: "visual",
  i_do: "teaching_points_visual",
  i_do_checkpoint: "visual",
  we_do_checkpoint: "visual",
  rounds: "visual",
  worked_examples: "visual",
};

/** A visual with every field present: the model fills only its kind's fields. */
function fullVisual(value: unknown): unknown {
  if (!value || typeof value !== "object") return NO_VISUAL;
  const v = value as Record<string, unknown>;
  const kind =
    typeof v.kind === "string"
      ? v.kind
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      : "none";
  const obj = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
  return {
    ...NO_VISUAL,
    ...v,
    kind: (VISUAL_KINDS as readonly string[]).includes(kind) ? kind : "none",
    number_line: { ...NO_VISUAL.number_line, ...obj(v.number_line) },
    place_value: { ...NO_VISUAL.place_value, ...obj(v.place_value) },
    table: { ...NO_VISUAL.table, ...obj(v.table) },
  };
}

function fix(value: unknown, key?: string, itemOf?: string): unknown {
  if (key && VISUAL_KEYS.has(key)) return fullVisual(fixObject(value));
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
  if (Array.isArray(value)) return value.map((v) => fix(v, undefined, key));
  if (value && typeof value === "object") {
    const out = fixObject(value) as Record<string, unknown>;
    if (key && REQUIRED_LISTS[key]) {
      for (const k of REQUIRED_LISTS[key]!) if (!(k in out)) out[k] = [];
    }
    // A missing visual becomes "none" rather than failing the deck.
    const visualKey = REQUIRED_VISUAL[key ?? ""] ?? REQUIRED_VISUAL[itemOf ?? ""];
    if (visualKey && !(visualKey in out)) out[visualKey] = NO_VISUAL;
    if (itemOf === "rounds" && !("instructions" in out)) out.instructions = [];
    // A question object with no answer gets "" (an open question).
    if ("question" in out && !("answer" in out)) out.answer = "";
    return out;
  }
  return value;
}

/** Fix each field of an object (no object-level defaults). */
function fixObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = fix(v, k);
  return out;
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
