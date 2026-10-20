/**
 * Prompt for turning a structured lesson plan into the pupil-facing deck a
 * teacher drives the whole lesson with. Pure.
 *
 * The plan sets WHAT is taught (objectives, success criteria, activities,
 * checkpoints, exit ticket) and the model must follow it. The model writes
 * what a plan leaves implicit but a lesson needs: the notes pupils copy, worked
 * examples, practice and exercise questions with their answers, and the
 * teacher's words for every slide — all on the plan's objectives, at its grade,
 * in its language, laid on a minute-by-minute timeline.
 */
import type { StructuredLessonPlan } from "@/lib/ai/lessonPlan/structuredSchema";

import { defaultTimings, planLanguage } from "./fallbackDeck";

export const SLIDES_SYSTEM = `You build a thoroughly prepared, plug-and-play slide deck a primary-school teacher at Silverleaf Academy (Tanzania) projects to DRIVE a whole lesson, minute by minute. Pupils look at the slides: each one gives the class numbered instructions, revealed one per click, with a picture the app draws. The teacher's own lines (what to say, ask, expect and do) are in the presenter view, never on the projected slide. The teacher should need nothing but the deck.

FOLLOW THE PLAN
- The plan decides what is taught: its competence, success criteria, knows/shows, activities, checkpoints and exit ticket. Keep to them and their order. Use the plan's own examples, questions and resources first.
- You MAY write what the plan leaves out but the lesson needs: the notes pupils copy into their books, worked examples, practice questions, exercise questions and their answers. Everything you write must serve the plan's objectives, suit the plan's grade, and use familiar Tanzanian contexts (shillings, mangoes, maize, daladala, local names). Never contradict the plan or add new topics.
- Every question has its correct answer in "answer" (short). Use "" only for a genuinely open question.

LANGUAGE
- Write EVERY field in the plan's language (set "language"). For Kiswahili, plain simple Kiswahili a primary pupil understands.

INSTRUCTIONS ON THE SLIDE ("instructions")
- The steps the class follows on that slide, in order, written TO the pupils: "Look at the two groups.", "Count the mangoes with me.", "Which group has more? Point to it.", "On your slate, write the bigger number.", "Turn to your partner and say: …". They are what the teacher would say to drive the activity, turned into numbered steps; each appears on a click.
- 2–5 steps, each one short sentence (about 15 words at most). Concrete: what to do and where (slate, exercise book, partner, hands up).
- Never write the teacher's private lines here ("Expect…", "Hold up the cards", "Cold-call 3 pupils") — those go in the script.

OTHER PUPIL-FACING TEXT (headings, materials, book_title, book_goal, key_words, teaching_points, problem, steps, book_note, questions, recap, self_check, homework, captions)
- Short, concrete, age-appropriate, one idea per line. No teacher jargon (no "DOK", "CFU", "SWK", "UAQ"), no stage directions, nothing in brackets meant for the teacher.

VISUALS ("visual", "teaching_points_visual", each worked example's "visual")
- Give a slide a visual whenever a picture helps pupils SEE the idea, so the teacher needs no props. Pick the kind that fits; fill only that kind's fields and leave the rest empty (groups [], cards [], table {headers: [], rows: []}, emoji "", number_line {from: 0, to: 0, step: 1, highlight: []}, place_value {hundreds: 0, tens: 0, ones: 0}):
  objects — groups of one emoji each, repeated "count" times (at most 20 per group), with a short label: comparing amounts, counting, adding, sharing. E.g. [{emoji: "🥭", count: 8, label: "8 mangoes"}, {emoji: "🥭", count: 3, label: "3 mangoes"}].
  number_line — from, to, step, and the numbers to highlight: counting on, ordering, skip counting.
  place_value — hundreds, tens and ones digits: reading and writing numbers.
  table — headers and rows: data, sorting, a times table, matching.
  word_cards — big word cards, each word with an emoji: vocabulary, phonics, Kiswahili/English words.
  picture — one large emoji for a story, object or topic.
  none — only when no picture helps.
- The visual must match the slide's numbers and words exactly (if the question says 8 beans, show 8 beans). Use familiar objects: 🥭 🍌 🌽 🫘 ✏️ 📚 🐐 🐄 🐔 🥚 🪙 🍊.
- key_words: each word gets an emoji. title.emoji: one emoji for the lesson's topic.

TEACHER SCRIPT ("script", "key_words_script", "teaching_points_script", "marking_script")
- Everything the teacher says and does while that slide is up, in order, as 3–10 lines, each one of:
  say — words the teacher says aloud;
  ask — a question the teacher asks the class;
  expect — the answer or behaviour the teacher should hear or see;
  do — an action (point to the visual, write on the board, walk round, cold-call 3 pupils).
- Each line under ~30 words. It is the teacher's private guide in the presenter view and speaker notes.

STRUCTURE AND TIMING (minutes from the start of the lesson)
- start_minute/end_minute for every phase, in order, with no gaps, ending at lesson_minutes. Unless the plan says otherwise, for a 40-minute lesson: get_ready 0–2, hook 2–7, i_do 7–17, we_do 17–27, you_do 27–35, exit_ticket 35–38, close 38–40 (scale for other lengths).
- get_ready: instructions for getting ready, what pupils need on their desks, and the book_title and book_goal ("Today I will…" / "Leo nitaweza…") they copy, with the date.
- hook: instructions that run the plan's hook, a visual, its sentence frame, and 1–3 expected answers (revealed after the instructions).
- i_do: key_words (0–5 new words, child-friendly meanings, emoji; [] if none — then key_words_script is []), 2–5 teaching_points revealed one by one with a teaching_points_visual, and 1–3 worked_examples, each a problem, a visual, the board working in 2–5 steps, and the book_note pupils copy.
- i_do_checkpoint / we_do_checkpoint: the plan's checkpoint for that stage as a question written to the pupils (never in the teacher's voice — no "I will hold up…"; that goes in the script), 1–3 instructions for how pupils answer (think, slate, hands up), a visual if it helps, and its answer.
- we_do: 2–3 rounds that follow the plan's guided practice; each has its instructions (how the class works: choral, slates, pairs), its minutes (they add up to we_do's length), a visual, and 2–4 questions with answers.
- you_do: instructions for the exercise-book work (e.g. "Open your exercise book.", "Write today's date.", "Answer questions 1 to 5."), 3–5 questions with answers, one harder challenge, and a marking_script for going over the answers.
- exit_ticket: instructions, and the plan's exit ticket as 1–3 questions with answers, written in books.
- close: 2–3 recap lines, 2–4 "I can…" / "Ninaweza…" self_check statements matching the goals, and homework ("" unless the plan sets it).`;

/** The user prompt: the plan as JSON, its language, and the lesson length. */
export function buildSlidesPrompt(
  plan: StructuredLessonPlan,
  lessonMinutes: number,
): { system: string; prompt: string } {
  const lang = planLanguage(plan) === "sw" ? 'Kiswahili (language: "sw")' : 'English (language: "en")';
  const t = defaultTimings(lessonMinutes);
  const timeline = Object.entries(t)
    .map(([phase, s]) => `${phase} ${s.start_minute}–${s.end_minute}`)
    .join(", ");
  return {
    system: SLIDES_SYSTEM,
    prompt: [
      `This lesson plan is written in ${lang}. The lesson lasts ${lessonMinutes} minutes (lesson_minutes: ${lessonMinutes}); default timeline: ${timeline}.`,
      "Build the deck the teacher will drive this lesson with.",
      "",
      "LESSON PLAN (JSON):",
      JSON.stringify(plan, null, 2),
    ].join("\n"),
  };
}
