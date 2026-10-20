/**
 * The "basic slides" deck: built straight from the plan, no model call. Pure.
 *
 * Used when AI generation is unavailable (no OPENROUTER_API_KEY) or fails —
 * a teacher about to stand in front of a class always gets slides. The plan's
 * own text is cut into slide-sized pieces and laid on the standard lesson
 * timeline; nothing is invented, so there are no worked answers to reveal, no
 * visuals, and the instructions and teacher's script are the plan's own
 * sentences. The AI deck is the real one.
 */
import type { StructuredLessonPlan } from "@/lib/ai/lessonPlan/structuredSchema";

import { NO_VISUAL, type QuestionAnswer, type ScriptLine, type SlideDeck } from "./deckSchema";
import type { DeckLanguage } from "./labels";

/** Lesson length when the plan does not say. */
export const DEFAULT_LESSON_MINUTES = 40;

/**
 * Where each phase starts, as a share of the lesson: for 40 minutes that is
 * get ready 0–2, hook 2–7, new learning 7–17, practice 17–27, on your own
 * 27–35, exit ticket 35–38, close 38–40.
 */
const SHARES = [
  ["get_ready", 0],
  ["hook", 0.05],
  ["i_do", 0.175],
  ["we_do", 0.425],
  ["you_do", 0.675],
  ["exit_ticket", 0.875],
  ["close", 0.95],
] as const;

export type PhaseKey = (typeof SHARES)[number][0];

/** Start/end minute of every phase for a lesson of `minutes`. */
export function defaultTimings(
  minutes: number,
): Record<PhaseKey, { start_minute: number; end_minute: number }> {
  const starts = SHARES.map(([, share]) => Math.round(share * minutes));
  return Object.fromEntries(
    SHARES.map(([key], i) => [
      key,
      {
        start_minute: starts[i]!,
        end_minute: Math.max(starts[i]! + 1, starts[i + 1] ?? minutes),
      },
    ]),
  ) as Record<PhaseKey, { start_minute: number; end_minute: number }>;
}

const HEADINGS = {
  en: {
    getReady: "Get ready",
    hook: "Let's begin",
    iDo: "New learning",
    weDo: "Practice together",
    youDo: "On your own",
    exit: "Exit ticket",
    close: "What did we learn?",
    round: "Round",
    youDoInstruction: "In your exercise book, do these tasks.",
    exitInstruction: "Answer in your exercise book.",
    materials: ["Exercise book", "Pencil"],
    goal: "Today I will",
    getReadySteps: [
      "Take out your exercise book and pencil.",
      "Write the date.",
      "Copy the title and today's goal.",
    ],
  },
  sw: {
    getReady: "Jiandae",
    hook: "Tuanze",
    iDo: "Funzo jipya",
    weDo: "Tufanye pamoja",
    youDo: "Peke yako",
    exit: "Tikiti ya kutoka",
    close: "Tumejifunza nini?",
    round: "Mzunguko",
    youDoInstruction: "Kwenye daftari lako, fanya kazi hizi.",
    exitInstruction: "Jibu kwenye daftari lako.",
    materials: ["Daftari", "Penseli"],
    goal: "Leo nitaweza",
    getReadySteps: ["Toa daftari lako na penseli.", "Andika tarehe.", "Nakili kichwa na lengo la leo."],
  },
} as const;

/** Common short words that tell Kiswahili prose from English. */
const SW_WORDS = new Set(["na", "ya", "wa", "kwa", "ni", "za", "la", "kwamba", "katika", "kisha"]);
const EN_WORDS = new Set(["the", "and", "of", "to", "is", "a", "in", "that", "with", "then"]);

/** Is the plan written in Kiswahili? Decided by its teaching text, not its subject. */
export function planLanguage(plan: StructuredLessonPlan): DeckLanguage {
  const seq = plan.teaching_sequence;
  const words = [seq.introduction_hook.text, seq.i_do.text, seq.we_do.text, seq.you_do.text]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z]+/);
  let sw = 0;
  let en = 0;
  for (const w of words) {
    if (SW_WORDS.has(w)) sw += 1;
    else if (EN_WORDS.has(w)) en += 1;
  }
  return sw > en ? "sw" : "en";
}

/**
 * Split prose into sentences ("Q1: …" / "Sw1: …" markers also start one). A
 * page reference — "(uk. 8-11)", "p. 12", "e.g. 5" — is not a sentence end.
 */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(
      /(?<=[.!?])(?<!\b(?:uk|Uk|p|pp|pg|No|Na|e\.g|i\.e)\.)\s+(?=[A-Z"“'(])|\s(?=(?:Q|Sw)\d+[:.)])/,
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A list of at least one item, falling back to the whole text. */
function pieces(text: string): string[] {
  const parts = sentences(text);
  return parts.length > 0 ? parts : [text.trim() || "—"];
}

/** The plan's own words as "say" lines (at least one). */
const say = (text: string): ScriptLine[] =>
  pieces(text).map((t) => ({ kind: "say" as const, text: t }));

const open = (question: string): QuestionAnswer => ({
  question: question.trim() || "—",
  answer: "",
});

/** The plan as a lesson deck, without a model call. */
export function fallbackDeck(
  plan: StructuredLessonPlan,
  lessonMinutes: number = DEFAULT_LESSON_MINUTES,
): SlideDeck {
  const lang = planLanguage(plan);
  const h = HEADINGS[lang];
  const id = plan.identifier;
  const seq = plan.teaching_sequence;
  const t = defaultTimings(lessonMinutes);
  const subheading = [id.grade, id.subject, id.lesson_number && `L${id.lesson_number}`]
    .filter(Boolean)
    .join(" · ");
  const checkpoint = (question: string) => ({
    question: question.trim() || "—",
    answer: "",
    instructions: [],
    visual: NO_VISUAL,
    script: [{ kind: "ask" as const, text: question.trim() || "—" }],
  });
  const weDoMinutes = t.we_do.end_minute - t.we_do.start_minute;
  const rounds = pieces(seq.we_do.text);

  return {
    language: lang,
    lesson_minutes: lessonMinutes,
    title: {
      heading: id.title || id.specific_competence || "—",
      subheading,
      emoji: "",
      script: say(id.specific_competence || id.title || "—"),
    },
    get_ready: {
      ...t.get_ready,
      heading: h.getReady,
      instructions: [...h.getReadySteps],
      materials: [...h.materials, ...plan.materials_and_prep].slice(0, 6),
      book_title: id.title || id.specific_competence || "—",
      book_goal: `${h.goal}: ${plan.success_criteria[0] ?? ""}`.trim(),
      script: say(plan.success_criteria.join(" ")),
    },
    hook: {
      ...t.hook,
      heading: h.hook,
      instructions: pieces(seq.introduction_hook.text),
      visual: NO_VISUAL,
      sentence_frame: seq.introduction_hook.sentence_frame,
      expected_answers: [seq.introduction_hook.checkpoint],
      script: say(seq.introduction_hook.text),
    },
    i_do: {
      ...t.i_do,
      heading: h.iDo,
      key_words: [],
      key_words_script: [],
      teaching_points: plan.knows,
      teaching_points_visual: NO_VISUAL,
      teaching_points_script: say(seq.i_do.text),
      worked_examples: [
        {
          problem: pieces(seq.i_do.text)[0]!,
          visual: NO_VISUAL,
          steps: pieces(seq.i_do.text).slice(1).length > 0 ? pieces(seq.i_do.text).slice(1) : ["—"],
          book_note: seq.i_do.sentence_frame,
          script: say(seq.i_do.text),
        },
      ],
    },
    i_do_checkpoint: checkpoint(seq.i_do.checkpoint),
    we_do: {
      ...t.we_do,
      heading: h.weDo,
      sentence_frame: seq.we_do.sentence_frame,
      rounds: rounds.map((text, i) => ({
        title: `${h.round} ${i + 1}`,
        instructions: [text],
        visual: NO_VISUAL,
        minutes: Math.max(1, Math.floor(weDoMinutes / rounds.length)),
        questions: [open(i === 0 ? seq.we_do.checkpoint : text)],
        script: say(text),
      })),
    },
    we_do_checkpoint: checkpoint(seq.we_do.checkpoint),
    you_do: {
      ...t.you_do,
      heading: h.youDo,
      instructions: [h.youDoInstruction],
      questions: pieces(seq.you_do.text).map(open),
      challenge: open(plan.differentiation.challenge),
      script: say(seq.you_do.text),
      marking_script: [{ kind: "ask", text: seq.you_do.checkpoint.trim() || "—" }],
    },
    exit_ticket: {
      ...t.exit_ticket,
      heading: h.exit,
      instructions: [h.exitInstruction],
      questions: pieces(plan.conclusion_and_exit_ticket.exit_ticket).map(open),
      script: say(plan.assessment_method),
    },
    close: {
      ...t.close,
      heading: h.close,
      recap: pieces(plan.conclusion_and_exit_ticket.understanding),
      self_check: plan.success_criteria,
      homework: "",
      script: say(plan.conclusion_and_exit_ticket.understanding),
    },
  };
}
