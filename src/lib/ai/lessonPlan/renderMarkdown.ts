/**
 * Render a v2 structured lesson plan to readable Markdown for human review.
 *
 * Port of silverleaf-lesson-plans-antoine/Lesson_Plan_Silverleaf/pipeline/render_md.py.
 *
 * Section order mirrors the v2 guide and the worked blueprint exemplar. The output
 * is used to populate `lesson_plans.content_markdown` for display and review.
 *
 * Pure module (no `server-only`, no DB, no network).
 */
import { keyLabel, splitExitTicket, stepLines } from "@/lib/lesson/planText";

import { TEACHING_STAGES, type StructuredLessonPlan } from "./structuredSchema";

/** Labels for the teaching stages, indexed by stage key. */
const STAGE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  TEACHING_STAGES.map(({ key, label }) => [key, label]),
);

/** Render a flat array of strings as a Markdown bullet list. */
function bullets(items: string[]): string {
  return items.map((x) => `- ${x}`).join("\n");
}

/** Render a single teaching stage section. */
function renderStage(
  key: string,
  stage: { depth: string; text: string; sentence_frame: string; checkpoint: string },
): string {
  const label = STAGE_LABEL_MAP[key] ?? key;
  // One step per line (`planText`), so the steps do not run together.
  const [first = "", ...rest] = stepLines(stage.text);
  const body = rest.length > 0 ? `${first}\n\n${bullets(rest)}` : first;
  return (
    `### ${label} (${stage.depth})\n${body}\n\n` +
    `- *Sentence frame:* ${stage.sentence_frame}\n` +
    `- *Checkpoint (assessment):* ${stage.checkpoint}\n`
  );
}

/** The exit ticket: its questions, then the answers as a separate marking key. */
function renderExitTicket(text: string): string {
  const { lead, questions, notes } = splitExitTicket(text);
  if (questions.length === 0) return `**Exit ticket:** ${text}`;
  const name = (label: string, i: number) => label || `${i + 1}.`;
  const out = [`**Exit ticket:**${lead ? ` ${lead}` : ""}`, ""];
  out.push(bullets(questions.map((q, i) => `**${name(q.label, i)}** ${q.question}`)));
  if (questions.some((q) => q.answer) || notes) {
    out.push("", "**Marking key:**", "");
    out.push(
      bullets([
        ...questions.flatMap((q, i) => (q.answer ? [`**${name(keyLabel(q.label), i)}** ${q.answer}`] : [])),
        ...(notes ? [notes] : []),
      ]),
    );
  }
  return out.join("\n");
}

/**
 * Render a structured lesson plan to a Markdown string suitable for human review.
 *
 * Mirrors `to_markdown()` in render_md.py.
 */
export function renderLessonMarkdown(plan: StructuredLessonPlan): string {
  const idn = plan.identifier;
  const ts = plan.teaching_sequence;
  const d = plan.differentiation;
  const ex = plan.conclusion_and_exit_ticket;

  const misconceptionsBlock = plan.misconceptions
    .map((m) => `- **${m.misconception}** *${m.description}*`)
    .join("\n");

  const digitalBlock =
    d.digital_resources.length > 0
      ? bullets(d.digital_resources)
      : "_(none suggested)_";

  const teachingSequenceBlock = TEACHING_STAGES
    .map(({ key }) => renderStage(key, ts[key]))
    .join("\n");

  return `# ${idn.title}
${idn.grade} · ${idn.subject} · ${idn.week} · Lesson ${idn.lesson_number}   ·   Main competence ${idn.main_competence} · Specific competence ${idn.specific_competence}

## Success criteria
${bullets(plan.success_criteria)}

## Knows
${bullets(plan.knows)}

## Shows
${bullets(plan.shows)}

## Misconceptions to watch for
${misconceptionsBlock}

## Materials and preparation
${bullets(plan.materials_and_prep)}

## Teaching sequence
${teachingSequenceBlock}
## Differentiation (suggestions)
- **Remedial:** ${d.remedial}
- **Support:** ${d.support}
- **Challenge:** ${d.challenge}
- **Digital resource idea (if available):**
${digitalBlock}

## Conclusion and exit ticket
${ex.understanding}

${renderExitTicket(ex.exit_ticket)}

**Assessment method:** ${plan.assessment_method}

## Watch-for notes
${bullets(plan.watch_for_notes)}

## Teacher reflection
${bullets(plan.teacher_reflection)}
`;
}
