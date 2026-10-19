/**
 * The fixed wording a deck prints on its slides, in the deck's language.
 *
 * Pupil-facing text the model writes (questions, notes, examples) is already
 * in the lesson's language; these are the labels the layout adds around it —
 * "Copy into your book", "Answers", the phase names, the teacher-strip cues.
 * One table for the player and the PowerPoint, so both say the same thing.
 * Pure and client-safe.
 */
export type DeckLanguage = "en" | "sw";

/** A line of the teacher's script: what to say, ask, expect, or do. */
export type ScriptKind = "say" | "ask" | "expect" | "do";

export type Phase = "start" | "getReady" | "hook" | "iDo" | "weDo" | "youDo" | "exit" | "close";

export interface DeckLabels {
  phase: Record<Phase, string>;
  script: Record<ScriptKind, string>;
  teacher: string;
  minutes: (from: number, to: number) => string;
  duration: (n: number) => string;
  youNeed: string;
  copyIntoBook: string;
  date: string;
  newWords: string;
  workedExample: (n: number) => string;
  checkpoint: string;
  answer: string;
  answers: string;
  challenge: string;
  homework: string;
  thumbs: string;
  recap: string;
}

export const DECK_LABELS: Record<DeckLanguage, DeckLabels> = {
  en: {
    phase: {
      start: "Lesson",
      getReady: "Get ready",
      hook: "Hook",
      iDo: "New learning",
      weDo: "Practice together",
      youDo: "On your own",
      exit: "Exit ticket",
      close: "Close",
    },
    script: { say: "Say", ask: "Ask", expect: "Expect", do: "Do" },
    teacher: "Teacher",
    minutes: (from, to) => `${from}–${to} min`,
    duration: (n) => `${n} minute${n === 1 ? "" : "s"}`,
    youNeed: "You need",
    copyIntoBook: "Copy into your book",
    date: "Date: ________",
    newWords: "New words",
    workedExample: (n) => `Worked example ${n}`,
    checkpoint: "Check for understanding",
    answer: "Answer",
    answers: "Answers",
    challenge: "Challenge",
    homework: "Homework",
    thumbs: "Show me with your thumb",
    recap: "What we learned",
  },
  sw: {
    phase: {
      start: "Somo",
      getReady: "Jiandae",
      hook: "Kianzio",
      iDo: "Funzo jipya",
      weDo: "Tufanye pamoja",
      youDo: "Peke yako",
      exit: "Tikiti ya kutoka",
      close: "Hitimisho",
    },
    script: { say: "Sema", ask: "Uliza", expect: "Tarajia", do: "Fanya" },
    teacher: "Mwalimu",
    minutes: (from, to) => `dakika ${from}–${to}`,
    duration: (n) => `dakika ${n}`,
    youNeed: "Unahitaji",
    copyIntoBook: "Nakili kwenye daftari lako",
    date: "Tarehe: ________",
    newWords: "Maneno mapya",
    workedExample: (n) => `Mfano ${n}`,
    checkpoint: "Swali la ukaguzi",
    answer: "Jibu",
    answers: "Majibu",
    challenge: "Changamoto",
    homework: "Kazi ya nyumbani",
    thumbs: "Nionyeshe kwa kidole gumba",
    recap: "Tumejifunza nini",
  },
};
