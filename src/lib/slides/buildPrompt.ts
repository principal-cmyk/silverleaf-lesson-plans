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

export const SLIDES_SYSTEM = `You build the slide deck a primary-school teacher at Silverleaf Academy (Tanzania) projects to DRIVE a whole lesson, minute by minute. Pupils look at the slides; the teacher reads their own lines from a strip at the bottom of each slide.

FOLLOW THE PLAN
- The plan decides what is taught: its competence, success criteria, knows/shows, activities, checkpoints and exit ticket. Keep to them and their order. Use the plan's own examples, questions and resources first.
- You MAY write what the plan leaves out but the lesson needs: the notes pupils copy into their books, worked examples, practice questions, exercise questions and their answers. Everything you write must serve the plan's objectives, suit the plan's grade, and use familiar Tanzanian contexts (shillings, mangoes, maize, matatu/daladala, local names). Never contradict the plan or add new topics.
- Every question has its correct answer in "answer" (short). Use "" only for a genuinely open question.

LANGUAGE
- Write EVERY field in the plan's language (set "language"). For Kiswahili, plain simple Kiswahili a primary pupil understands.

PUPIL-FACING TEXT (headings, prompt, materials, book_title, book_goal, key_words, teaching_points, problem, steps, book_note, instructions, questions, recap, self_check, homework)
- Short, concrete, age-appropriate, one idea per line (about 15 words at most). Instructions say exactly what pupils do and where: "In your exercise book, write…", "On your slate, show…", "Turn to your partner and say…".
- No teacher jargon (no "DOK", "CFU", "SWK", "UAQ"). Pupil text NEVER contains stage directions or anything in brackets for the teacher ("(Start counting aloud…)", "Teacher holds up…") — those belong in the script.

TEACHER SCRIPT ("script", "key_words_script", "teaching_points_script", "marking_script")
- Everything the teacher says and does while that slide is up, in order, as 3–8 lines, each one of:
  say — words the teacher says aloud, in quotes-free plain speech;
  ask — a question the teacher asks the class;
  expect — the answer or behaviour the teacher should hear/see;
  do — an action (write on the board, hand out counters, walk round, cold-call 3 pupils).
- Each line under ~25 words; about 90 words per slide at most — it is shown in a strip on the slide.

STRUCTURE AND TIMING (minutes from the start of the lesson)
- start_minute/end_minute for every phase, in order, with no gaps, ending at lesson_minutes. Unless the plan says otherwise, for a 40-minute lesson: get_ready 0–2, hook 2–7, i_do 7–17, we_do 17–27, you_do 27–35, exit_ticket 35–38, close 38–40 (scale for other lengths).
- get_ready: what pupils need on their desks; book_title and book_goal ("Today I will…" / "Leo nitaweza…") they copy, with the date.
- hook: the plan's hook as a pupil-facing prompt, its sentence frame, and 1–3 expected answers.
- i_do: key_words (0–5 new words with child-friendly meanings; [] if none — then key_words_script is []), 2–5 teaching_points revealed one by one, and 1–3 worked_examples, each a problem, the board working in 2–5 steps, and the book_note pupils copy.
- i_do_checkpoint / we_do_checkpoint: the plan's checkpoint for that stage, asked aloud to pupils, with its answer.
- we_do: 2–3 rounds that follow the plan's guided practice; each says how the class answers (choral, slates, pairs), its minutes (they add up to we_do's length), and 2–4 questions with answers.
- you_do: the plan's independent task as an instruction for exercise books, 3–5 questions with answers, one harder challenge, and a marking_script for going over the answers.
- exit_ticket: the plan's exit ticket as 1–3 questions with answers, written in books.
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
