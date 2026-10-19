/**
 * Slide deck — the pupil-facing deck a teacher drives a whole lesson with.
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
 * Two audiences on every slide:
 *  - pupils: the instructions, what to copy into their books, the questions —
 *    each question carries its answer, revealed by the teacher;
 *  - the teacher: `script`, the lines to say / ask / expect / do while that
 *    slide is up, shown in a strip on the slide itself (a teacher with one
 *    screen still has it) and in the presenter view and speaker notes.
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

/** What the teacher says/asks/expects/does while a slide is up. */
const script = z.array(scriptLine).min(1);

/** A question pupils answer, with the answer the teacher reveals ("" = open). */
const qa = z.object({ question: text, answer: z.string() });

/** The phase's place in the lesson, in minutes from the start. */
const span = {
  start_minute: z.number().int().min(0),
  end_minute: z.number().int().min(1),
};

/** A check for understanding between phases. */
const checkpoint = z.object({ question: text, answer: z.string(), script });

export const slideDeckSchema = z.object({
  /** "en" or "sw": the language every pupil-facing line is written in. */
  language: z.enum(["en", "sw"]),
  /** Length of the lesson the minute ranges add up to. */
  lesson_minutes: z.number().int().min(10),
  title: z.object({ heading: text, subheading: z.string(), script }),
  get_ready: z.object({
    ...span,
    heading: text,
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
    prompt: text,
    sentence_frame: z.string(),
    /** Answers the teacher hopes to hear, revealed after pupils respond. */
    expected_answers: z.array(text).min(1),
    script,
  }),
  i_do: z.object({
    ...span,
    heading: text,
    /** New words and their meanings (may be empty). */
    key_words: z.array(z.object({ word: text, meaning: text })),
    key_words_script: z.array(scriptLine),
    /** The ideas taught, revealed one at a time. */
    teaching_points: z.array(text).min(1),
    teaching_points_script: script,
    worked_examples: z
      .array(
        z.object({
          problem: text,
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
          /** What the class does in this round (whiteboards, pairs, books…). */
          instruction: text,
          minutes: z.number().int().min(1),
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
    /** "In your exercise book, answer…" */
    instruction: text,
    questions: z.array(qa).min(1),
    challenge: qa,
    script,
    /** Lines for going over the answers afterwards. */
    marking_script: script,
  }),
  exit_ticket: z.object({
    ...span,
    heading: text,
    instruction: text,
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
