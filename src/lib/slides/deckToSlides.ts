/**
 * Deck → ordered slides, the shape the player and the PowerPoint walk through.
 * Pure.
 *
 * Every slide knows its lesson phase and minute range, its visual, the
 * teacher's script (presenter view / speaker notes), and how it builds: the
 * slide's numbered `instructions` appear one per click — the first is up when
 * the slide opens — and then its answers (one per click in practice rounds,
 * all at once for the exercise and exit ticket, where the class marks
 * together). Lists and worked-example steps build the same way.
 *
 * The plan's teacher-only material — misconceptions, things to watch for,
 * support and challenge — rides along on the slides where the teacher needs
 * it, for the presenter view and speaker notes.
 */
import type { StructuredLessonPlan } from "@/lib/ai/lessonPlan/structuredSchema";

import { NO_VISUAL, type QuestionAnswer, type ScriptLine, type SlideDeck, type Visual } from "./deckSchema";
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
  /** Numbered steps for the class, revealed one per click. */
  instructions: string[];
  visual: Visual;
  /** The teacher's lines while this slide is up (presenter view, notes). */
  script: ScriptLine[];
  /** Replaces `script` once the slide's answers are shown (marking). */
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
    | {
        kind: "title";
        subheading: string;
        lessonMinutes: number;
        emoji: string;
      }
    | {
        kind: "getReady";
        materials: string[];
        bookTitle: string;
        bookGoal: string;
      }
    | { kind: "hook"; sentenceFrame: string; answers: string[] }
    | {
        kind: "keyWords";
        words: Array<{ word: string; meaning: string; emoji: string }>;
      }
    | { kind: "points"; points: string[] }
    | {
        kind: "example";
        number: number;
        problem: string;
        workSteps: string[];
        bookNote: string;
      }
    | { kind: "checkpoint"; question: string; answer: string }
    | {
        kind: "round";
        title: string;
        questions: QuestionAnswer[];
        sentenceFrame: string;
      }
    | {
        kind: "exercise";
        questions: QuestionAnswer[];
        challenge: QuestionAnswer;
      }
    | { kind: "exit"; questions: QuestionAnswer[] }
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

/** Clicks spent building a slide's instructions: all but the first. */
export function instructionClicks(slide: Pick<Base, "instructions">): number {
  return Math.max(0, slide.instructions.length - 1);
}

/** How far a slide has got past its instructions (0 = answers not yet shown). */
export function answerStep(slide: Slide, step: number): number {
  return Math.max(0, step - instructionClicks(slide));
}

/** The deck's slides, in teaching order. */
export function deckToSlides(deck: SlideDeck): Slide[] {
  const slides: Slide[] = [];
  const iDo = deck.i_do;
  /** Build a slide's step count: its instructions, then `answers` more clicks. */
  const withInstructions = (instructions: string[], answers: number) => {
    const list = cap(instructions);
    return {
      instructions: list,
      steps: Math.max(0, list.length - 1) + answers,
    };
  };

  slides.push({
    kind: "title",
    phase: "start",
    time: null,
    heading: deck.title.heading,
    subheading: deck.title.subheading,
    lessonMinutes: deck.lesson_minutes,
    emoji: deck.title.emoji,
    instructions: [],
    visual: NO_VISUAL,
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
    ...withInstructions(deck.get_ready.instructions, 0),
    visual: NO_VISUAL,
    materials: cap(deck.get_ready.materials),
    bookTitle: deck.get_ready.book_title,
    bookGoal: deck.get_ready.book_goal,
    script: deck.get_ready.script,
    timer: null,
    picker: false,
    extras: [],
  });

  slides.push({
    kind: "hook",
    phase: "hook",
    time: span(deck.hook),
    heading: deck.hook.heading,
    ...withInstructions(deck.hook.instructions, deck.hook.expected_answers.length > 0 ? 1 : 0),
    visual: deck.hook.visual,
    sentenceFrame: deck.hook.sentence_frame,
    answers: cap(deck.hook.expected_answers),
    script: deck.hook.script,
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
      instructions: [],
      visual: NO_VISUAL,
      words: cap(iDo.key_words),
      script: iDo.key_words_script,
      // One word card per click.
      steps: Math.max(0, cap(iDo.key_words).length - 1),
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
    instructions: [],
    visual: iDo.teaching_points_visual,
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
      instructions: [],
      visual: ex.visual,
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
    ...withInstructions(cp.instructions, cp.answer.trim() ? 1 : 0),
    visual: cp.visual,
    script: cp.script,
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
      // Answers come one per click, after the instructions.
      ...withInstructions(round.instructions, answered(questions)),
      visual: round.visual,
      questions,
      sentenceFrame: deck.we_do.sentence_frame,
      script: round.script,
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
    // One click after the instructions shows every answer, for marking.
    ...withInstructions(deck.you_do.instructions, answered([...exercise, deck.you_do.challenge]) > 0 ? 1 : 0),
    visual: NO_VISUAL,
    questions: exercise,
    challenge: deck.you_do.challenge,
    script: deck.you_do.script,
    scriptAfterReveal: deck.you_do.marking_script,
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
    ...withInstructions(deck.exit_ticket.instructions, answered(exit) > 0 ? 1 : 0),
    visual: NO_VISUAL,
    questions: exit,
    script: deck.exit_ticket.script,
    timer: length(deck.exit_ticket),
    picker: false,
    extras: ["watchFor"],
  });

  slides.push({
    kind: "close",
    phase: "close",
    time: span(deck.close),
    heading: deck.close.heading,
    instructions: [],
    visual: NO_VISUAL,
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

/** The script that applies at a given click: the marking script once answers are shown. */
export function scriptAt(slide: Slide, step: number): ScriptLine[] {
  return answerStep(slide, step) >= 1 && slide.scriptAfterReveal ? slide.scriptAfterReveal : slide.script;
}

/** Does a visual draw anything? */
export function hasVisual(visual: Visual): boolean {
  switch (visual.kind) {
    case "objects":
      return visual.groups.some((g) => g.count > 0);
    case "number_line":
      return visual.number_line.to > visual.number_line.from && visual.number_line.step > 0;
    case "place_value":
      return true;
    case "table":
      return visual.table.headers.length > 0 || visual.table.rows.length > 0;
    case "word_cards":
      return visual.cards.length > 0;
    case "picture":
      return Boolean(visual.emoji.trim());
    default:
      return false;
  }
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
