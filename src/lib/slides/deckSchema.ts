/**
 * Slide deck — the pupil-facing, plug-and-play deck a teacher drives a whole
 * lesson with.
 *
 * A FIXED sequence of lesson phases, each with its minute range, so the model
 * fills every part of the lesson in order and every deck renders alike:
 *
 *   get ready → hook → new learning (key words, teaching points, worked
 *   examples) → ✔ → practice together (rounds) → ✔ → on your own (exercise)
 *   → exit ticket → close
 *
 * (✔ = a checkpoint question with its expected answer.)
 *
 * Two audiences:
 *  - pupils see each slide's `instructions` — numbered steps written to the
 *    class, revealed one per click — with the questions, what to copy into
 *    their books, and a `visual` (objects to count, a number line, a place-
 *    value chart, a table, word cards or a picture) so the teacher needs no
 *    props; every question carries its answer, revealed last;
 *  - the teacher gets `script` — every line to say / ask / expect / do — in
 *    the presenter view and the PowerPoint speaker notes, never on the
 *    projected slide.
 *
 * Arrays only set a minimum: provider structured-output modes differ in how
 * they treat `maxItems`, so the player trims long lists instead.
 *
 * Pure and client-safe — imported by the player as well as the server.
 */
import { z } from "zod";

const text = z.string().min(1);

/** One line of the teacher's script. */
const scriptLine = z.object({
  kind: z.enum(["say", "ask", "expect", "do"]),
  text,
});

/** Everything the teacher says/asks/expects/does while a slide is up. */
const script = z.array(scriptLine).min(1);

/** Numbered steps written to the class, revealed one per click. */
const instructions = z.array(text);

/** A question pupils answer, with the answer the teacher reveals ("" = open). */
const qa = z.object({ question: text, answer: z.string() });

/** The phase's place in the lesson, in minutes from the start. */
const span = {
  start_minute: z.number().int().min(0),
  end_minute: z.number().int().min(1),
};

export const VISUAL_KINDS = [
  "none",
  "objects",
  "number_line",
  "place_value",
  "table",
  "word_cards",
  "picture",
] as const;

/**
 * A picture the app draws itself, so it works offline and looks the same in
 * the player and the PowerPoint. ONE flat shape: `kind` says which fields are
 * used, the rest stay empty — a flat object is what models fill most
 * reliably (a union of shapes is not).
 */
const visual = z.object({
  kind: z.enum(VISUAL_KINDS),
  /** A short line under the visual ("" for none). */
  caption: z.string(),
  /** objects: groups of one emoji, repeated `count` times, with a label. */
  groups: z.array(
    z.object({
      emoji: text,
      count: z.number().int().min(0),
      label: z.string(),
    }),
  ),
  /** number_line: from…to in `step`s, with `highlight` marked. */
  number_line: z.object({
    from: z.number(),
    to: z.number(),
    step: z.number(),
    highlight: z.array(z.number()),
  }),
  /** place_value: the digits in each column. */
  place_value: z.object({
    hundreds: z.number().int().min(0),
    tens: z.number().int().min(0),
    ones: z.number().int().min(0),
  }),
  /** table: a header row and body rows. */
  table: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  /** word_cards: big cards, each a word with an emoji ("" for none). */
  cards: z.array(z.object({ text, emoji: z.string() })),
  /** picture: one large emoji. */
  emoji: z.string(),
});

/** A check for understanding between phases. */
const checkpoint = z.object({
  question: text,
  answer: z.string(),
  instructions,
  visual,
  script,
});

export const slideDeckSchema = z.object({
  /** "en" or "sw": the language every pupil-facing line is written in. */
  language: z.enum(["en", "sw"]),
  /** Length of the lesson the minute ranges add up to. */
  lesson_minutes: z.number().int().min(10),
  title: z.object({
    heading: text,
    subheading: z.string(),
    emoji: z.string(),
    script,
  }),
  get_ready: z.object({
    ...span,
    heading: text,
    instructions,
    /** What pupils need on their desks. */
    materials: z.array(text).min(1),
    /** The lesson title pupils copy into their books. */
    book_title: text,
    /** The learning goal pupils copy under it ("Today I will…"). */
    book_goal: text,
    script,
  }),
  hook: z.object({
    ...span,
    heading: text,
    instructions,
    visual,
    sentence_frame: z.string(),
    /** Answers the teacher hopes to hear, revealed after the instructions. */
    expected_answers: z.array(text).min(1),
    script,
  }),
  i_do: z.object({
    ...span,
    heading: text,
    /** New words, each with a child-friendly meaning and an emoji (may be empty). */
    key_words: z.array(z.object({ word: text, meaning: text, emoji: z.string() })),
    key_words_script: z.array(scriptLine),
    /** The ideas taught, revealed one at a time. */
    teaching_points: z.array(text).min(1),
    teaching_points_visual: visual,
    teaching_points_script: script,
    worked_examples: z
      .array(
        z.object({
          problem: text,
          visual,
          /** The working, step by step, as written on the board. */
          steps: z.array(text).min(1),
          /** What pupils copy into their books for this example. */
          book_note: z.string(),
          script,
        }),
      )
      .min(1),
  }),
  i_do_checkpoint: checkpoint,
  we_do: z.object({
    ...span,
    heading: text,
    sentence_frame: z.string(),
    rounds: z
      .array(
        z.object({
          title: text,
          /** How the class works this round (slates, pairs, chorus…), step by step. */
          instructions: z.array(text).min(1),
          minutes: z.number().int().min(1),
          visual,
          questions: z.array(qa).min(1),
          script,
        }),
      )
      .min(1),
  }),
  we_do_checkpoint: checkpoint,
  you_do: z.object({
    ...span,
    heading: text,
    /** "Open your exercise book…", "Write the date…", "Answer Q1–Q5…" */
    instructions: z.array(text).min(1),
    questions: z.array(qa).min(1),
    challenge: qa,
    script,
    /** Lines for going over the answers afterwards. */
    marking_script: script,
  }),
  exit_ticket: z.object({
    ...span,
    heading: text,
    instructions: z.array(text).min(1),
    questions: z.array(qa).min(1),
    script,
  }),
  close: z.object({
    ...span,
    heading: text,
    recap: z.array(text).min(1),
    /** "I can…" statements pupils rate with a thumb. */
    self_check: z.array(text).min(1),
    /** "" when the plan sets none. */
    homework: z.string(),
    script,
  }),
});

export type SlideDeck = z.infer<typeof slideDeckSchema>;
export type ScriptLine = z.infer<typeof scriptLine>;
export type QuestionAnswer = z.infer<typeof qa>;
export type Visual = z.infer<typeof visual>;

/** A visual that draws nothing — for slides without one and for the basic deck. */
export const NO_VISUAL: Visual = {
  kind: "none",
  caption: "",
  groups: [],
  number_line: { from: 0, to: 0, step: 1, highlight: [] },
  place_value: { hundreds: 0, tens: 0, ones: 0 },
  table: { headers: [], rows: [] },
  cards: [],
  emoji: "",
};
