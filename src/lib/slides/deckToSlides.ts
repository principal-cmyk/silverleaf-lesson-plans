/**
 * Deck → ordered slides, the shape the player and the PowerPoint walk through.
 * Pure.
 *
 * Every slide knows its lesson phase and minute range, the teacher's script
 * for while it is up, and `steps`: how many clicks it takes before "next"
 * moves on. Lists and worked-example steps reveal one per click; questions
 * reveal their answers (one per click in practice rounds, all at once for the
 * exercise and exit ticket, where the class marks together).
 *
 * The plan's teacher-only material — misconceptions, things to watch for,
 * support and challenge — rides along on the slides where the teacher needs
 * it, for the presenter view and speaker notes.
 */
import type { StructuredLessonPlan } from "@/lib/ai/lessonPlan/structuredSchema";

import type { QuestionAnswer, ScriptLine, SlideDeck } from "./deckSchema";
import type { Phase } from "./labels";

/** Longest list a slide shows; the model is asked for less, this is the guard. */
export const MAX_LIST_ITEMS = 6;

/** Teacher-only extras taken straight from the plan (never AI-rewritten). */
export interface TeacherExtras {
  misconceptions: Array<{ misconception: string; description: string }>;
  watchFor: string[];
  differentiation: { remedial: string; support: string; challenge: string };
}

/** Which extras a slide shows in the presenter view / speaker notes. */
export type ExtraKind = "misconceptions" | "watchFor" | "differentiation";

interface Base {
  phase: Phase;
  /** Minute range in the lesson, or null for the title slide. */
  time: { start: number; end: number } | null;
  heading: string;
  /** The teacher's lines while this slide is up. */
  script: ScriptLine[];
  /** Replaces `script` once the slide's answers are revealed (marking). */
  scriptAfterReveal?: ScriptLine[];
  /** Clicks this slide takes before moving on (0 = none). */
  steps: number;
  /** Countdown for a timed activity, in minutes. */
  timer: number | null;
  /** Offer the pupil picker (cold-calling). */
  picker: boolean;
  extras: ExtraKind[];
}

export type Slide = Base &
  (
    | { kind: "title"; subheading: string; lessonMinutes: number }
    | { kind: "getReady"; materials: string[]; bookTitle: string; bookGoal: string }
    | { kind: "hook"; prompt: string; sentenceFrame: string; answers: string[] }
    | { kind: "keyWords"; words: Array<{ word: string; meaning: string }> }
    | { kind: "points"; points: string[] }
    | { kind: "example"; number: number; problem: string; workSteps: string[]; bookNote: string }
    | { kind: "checkpoint"; question: string; answer: string }
    | {
        kind: "round";
        title: string;
        instruction: string;
        questions: QuestionAnswer[];
        sentenceFrame: string;
      }
    | { kind: "exercise"; instruction: string; questions: QuestionAnswer[]; challenge: QuestionAnswer }
    | { kind: "exit"; instruction: string; questions: QuestionAnswer[] }
    | { kind: "close"; recap: string[]; selfCheck: string[]; homework: string }
  );

const cap = <T>(items: T[]): T[] => items.slice(0, MAX_LIST_ITEMS);
const answered = (qs: QuestionAnswer[]) => qs.filter((q) => q.answer.trim()).length;
const span = (p: { start_minute: number; end_minute: number }) => ({
  start: p.start_minute,
  end: p.end_minute,
});
/** A phase's own length, for its countdown (at least a minute). */
const length = (p: { start_minute: number; end_minute: number }) =>
  Math.max(1, p.end_minute - p.start_minute);

/** The deck's slides, in teaching order. */
export function deckToSlides(deck: SlideDeck): Slide[] {
  const slides: Slide[] = [];
  const iDo = deck.i_do;

  slides.push({
    kind: "title",
    phase: "start",
    time: null,
    heading: deck.title.heading,
    subheading: deck.title.subheading,
    lessonMinutes: deck.lesson_minutes,
    script: deck.title.script,
    steps: 0,
    timer: null,
    picker: false,
    extras: [],
  });

  slides.push({
    kind: "getReady",
    phase: "getReady",
    time: span(deck.get_ready),
    heading: deck.get_ready.heading,
    materials: cap(deck.get_ready.materials),
    bookTitle: deck.get_ready.book_title,
    bookGoal: deck.get_ready.book_goal,
    script: deck.get_ready.script,
    steps: 0,
    timer: null,
    picker: false,
    extras: [],
  });

  slides.push({
    kind: "hook",
    phase: "hook",
    time: span(deck.hook),
    heading: deck.hook.heading,
    prompt: deck.hook.prompt,
    sentenceFrame: deck.hook.sentence_frame,
    answers: cap(deck.hook.expected_answers),
    script: deck.hook.script,
    steps: deck.hook.expected_answers.length > 0 ? 1 : 0,
    timer: length(deck.hook),
    picker: true,
    extras: [],
  });

  if (iDo.key_words.length > 0) {
    slides.push({
      kind: "keyWords",
      phase: "iDo",
      time: span(iDo),
      heading: iDo.heading,
      words: cap(iDo.key_words),
      script: iDo.key_words_script,
      steps: 0,
      timer: null,
      picker: false,
      extras: [],
    });
  }

  const points = cap(iDo.teaching_points);
  slides.push({
    kind: "points",
    phase: "iDo",
    time: span(iDo),
    heading: iDo.heading,
    points,
    script: iDo.teaching_points_script,
    steps: Math.max(0, points.length - 1),
    timer: null,
    picker: false,
    extras: ["misconceptions"],
  });

  iDo.worked_examples.forEach((ex, i) => {
    const workSteps = cap(ex.steps);
    slides.push({
      kind: "example",
      phase: "iDo",
      time: span(iDo),
      heading: iDo.heading,
      number: i + 1,
      problem: ex.problem,
      workSteps,
      bookNote: ex.book_note,
      script: ex.script,
      // The problem shows first; each click adds a step, then the book note.
      steps: workSteps.length + (ex.book_note.trim() ? 1 : 0),
      timer: null,
      picker: false,
      extras: ["misconceptions"],
    });
  });

  const checkpoint = (cp: SlideDeck["i_do_checkpoint"], phase: Phase, time: Base["time"]): Slide => ({
    kind: "checkpoint",
    phase,
    time,
    // The layout heads a checkpoint with its own label ("Check for understanding").
    heading: "",
    question: cp.question,
    answer: cp.answer,
    script: cp.script,
    steps: cp.answer.trim() ? 1 : 0,
    timer: null,
    picker: true,
    extras: ["watchFor"],
  });

  slides.push(checkpoint(deck.i_do_checkpoint, "iDo", span(iDo)));

  for (const round of deck.we_do.rounds) {
    const questions = cap(round.questions);
    slides.push({
      kind: "round",
      phase: "weDo",
      time: span(deck.we_do),
      heading: deck.we_do.heading,
      title: round.title,
      instruction: round.instruction,
      questions,
      sentenceFrame: deck.we_do.sentence_frame,
      script: round.script,
      // Answers revealed one per click, as the class works through them.
      steps: answered(questions),
      timer: round.minutes,
      picker: true,
      extras: ["misconceptions", "watchFor"],
    });
  }

  slides.push(checkpoint(deck.we_do_checkpoint, "weDo", span(deck.we_do)));

  const exercise = cap(deck.you_do.questions);
  slides.push({
    kind: "exercise",
    phase: "youDo",
    time: span(deck.you_do),
    heading: deck.you_do.heading,
    instruction: deck.you_do.instruction,
    questions: exercise,
    challenge: deck.you_do.challenge,
    script: deck.you_do.script,
    scriptAfterReveal: deck.you_do.marking_script,
    // One click shows every answer for marking together.
    steps: answered([...exercise, deck.you_do.challenge]) > 0 ? 1 : 0,
    timer: length(deck.you_do),
    picker: false,
    extras: ["differentiation"],
  });

  const exit = cap(deck.exit_ticket.questions);
  slides.push({
    kind: "exit",
    phase: "exit",
    time: span(deck.exit_ticket),
    heading: deck.exit_ticket.heading,
    instruction: deck.exit_ticket.instruction,
    questions: exit,
    script: deck.exit_ticket.script,
    steps: answered(exit) > 0 ? 1 : 0,
    timer: length(deck.exit_ticket),
    picker: false,
    extras: ["watchFor"],
  });

  slides.push({
    kind: "close",
    phase: "close",
    time: span(deck.close),
    heading: deck.close.heading,
    recap: cap(deck.close.recap),
    selfCheck: cap(deck.close.self_check),
    homework: deck.close.homework,
    script: deck.close.script,
    steps: 0,
    timer: null,
    picker: false,
    extras: [],
  });

  return slides;
}

/** The script that applies at a given reveal step. */
export function scriptAt(slide: Slide, step: number): ScriptLine[] {
  return step >= 1 && slide.scriptAfterReveal ? slide.scriptAfterReveal : slide.script;
}

/** The plan's teacher-only extras, for the presenter view and notes. */
export function teacherExtras(plan: StructuredLessonPlan): TeacherExtras {
  return {
    misconceptions: plan.misconceptions.map((m) => ({
      misconception: m.misconception,
      description: m.description,
    })),
    watchFor: plan.watch_for_notes,
    differentiation: {
      remedial: plan.differentiation.remedial,
      support: plan.differentiation.support,
      challenge: plan.differentiation.challenge,
    },
  };
}
