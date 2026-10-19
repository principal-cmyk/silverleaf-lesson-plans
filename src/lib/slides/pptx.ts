import "server-only";

/**
 * Slide deck → PowerPoint (.pptx), for teachers who present offline or want to
 * edit. Built from the same slides the in-app player shows, so the two agree
 * on content, order and wording.
 *
 * Every slide keeps the player's layout: the phase and its minutes along the
 * top, the pupil-facing content, and the teacher strip (Say / Ask / Expect /
 * Do) along the bottom. The script also goes into the speaker notes, with the
 * plan's misconceptions, things to watch for and support/challenge where they
 * apply.
 *
 * A .pptx cannot reveal on click, so each reveal becomes a following slide:
 * questions, then the same questions with their answers (the exercise's
 * answer slide carries the marking script). Timed activities show their time.
 *
 * Calibri, not the brand font: a school laptop opening the file may not have
 * Montserrat, and PowerPoint's substitute is unpredictable.
 */
import PptxGenJS from "pptxgenjs";

import type { QuestionAnswer, ScriptLine, SlideDeck } from "./deckSchema";
import { deckToSlides, type Slide, type TeacherExtras } from "./deckToSlides";
import { DECK_LABELS, type DeckLabels, type DeckLanguage } from "./labels";

const NAVY = "002368";
const STRIP = "0F2A5C";
const GOLD = "FFC952";
const GOLD15 = "FFF7E5";
const LIGHT = "80BFEC";
const LIGHT30 = "D9ECF9";
const INK = "1A2233";
const GREEN = "2E8B57";
const GREEN_BG = "E6F6EA";
const MUTED = "6B778A";
const BOOK = "B35C00";
const FONT = "Calibri";

/** LAYOUT_WIDE is 13.333 × 7.5 in. */
const W = 13.333;
const MARGIN = 0.6;
const BODY_W = W - 2 * MARGIN;
/** Content area between the heading and the teacher strip. */
const BODY_Y = 1.45;
const BODY_H = 3.85;
const STRIP_Y = 5.45;
const STRIP_H = 1.6;

/**
 * Cue colours on the teacher strip. The cue word itself is coloured (not a
 * highlight behind it): many PowerPoint versions drop text highlighting, which
 * would leave a navy cue invisible on the navy strip.
 */
const CUE: Record<ScriptLine["kind"], string> = {
  say: GOLD,
  ask: LIGHT,
  expect: "9EE6B4",
  do: "C9D3E3",
};

/** Hanging indent (points) between a list marker and its text. */
const INDENT = 30;

/** Speaker-note headings for the plan's extras. */
const NOTE_WORDS = {
  en: {
    misconceptions: "Misconceptions to watch",
    watchFor: "Watch for",
    remedial: "Fill the gap",
    support: "Support",
    challenge: "Challenge",
  },
  sw: {
    misconceptions: "Dhana potofu za kuangalia",
    watchFor: "Angalia",
    remedial: "Ziba pengo",
    support: "Msaada",
    challenge: "Changamoto",
  },
} as const;

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

/** Font size that keeps `chars` of text inside the content area. */
function bodySize(chars: number): number {
  if (chars <= 140) return 26;
  if (chars <= 260) return 22;
  if (chars <= 420) return 19;
  if (chars <= 650) return 16;
  return 14;
}

const total = (items: string[]) => items.reduce((n, s) => n + s.length, 0);

function phaseBar(s: PptxSlide, slide: Slide, labels: DeckLabels) {
  if (!slide.time) return;
  const phase = labels.phase[slide.phase].toUpperCase();
  s.addText(phase, {
    x: MARGIN,
    y: 0.28,
    w: Math.min(5, 0.4 + phase.length * 0.13),
    h: 0.36,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: "FFFFFF",
    fill: { color: NAVY },
    align: "center",
    valign: "middle",
  });
  const time = [
    `⏱ ${labels.minutes(slide.time.start, slide.time.end)}`,
    slide.timer ? labels.duration(slide.timer) : "",
  ]
    .filter(Boolean)
    .join("   ·   ");
  s.addText(time, {
    x: W - MARGIN - 6,
    y: 0.28,
    w: 6,
    h: 0.36,
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    color: NAVY,
    align: "right",
    valign: "middle",
  });
}

function heading(s: PptxSlide, text: string, chip?: string) {
  const runs: PptxGenJS.TextProps[] = chip
    ? [
        { text: `${chip}   `, options: { color: MUTED, fontSize: 18 } },
        { text, options: {} },
      ]
    : [{ text, options: {} }];
  s.addText(runs, {
    x: MARGIN,
    y: 0.72,
    w: BODY_W,
    h: 0.7,
    fontFace: FONT,
    fontSize: 28,
    bold: true,
    color: NAVY,
    valign: "middle",
    fit: "shrink",
  });
}

/** Plain text block in the content area. */
function body(
  s: PptxSlide,
  text: string,
  opts: { y?: number; h?: number; size?: number; bold?: boolean } = {},
) {
  const h = opts.h ?? BODY_H;
  s.addText(text, {
    x: MARGIN,
    y: opts.y ?? BODY_Y,
    w: BODY_W,
    h,
    fontFace: FONT,
    fontSize: fitFontSize([text], BODY_W - 0.2, h - 0.1, opts.size ?? bodySize(text.length), 12),
    bold: opts.bold,
    color: opts.bold ? NAVY : INK,
    valign: "top",
    fit: "shrink",
  });
}

/** A numbered or ticked list; an item may show its answer in green beneath it. */
function list(
  s: PptxSlide,
  items: Array<string | { text: string; answer?: string }>,
  numbered: boolean,
  at: { x?: number; y?: number; w?: number; h?: number } = {},
) {
  const texts = items.map((i) => (typeof i === "string" ? i : `${i.text} ${i.answer ?? ""}`));
  // Each item, and each shown answer, is its own line for the fit estimate.
  const lines = items.flatMap((i) =>
    typeof i === "string" ? [i] : i.answer?.trim() ? [i.text, `→ ${i.answer}`] : [i.text],
  );
  const w = at.w ?? BODY_W;
  const h = at.h ?? BODY_H;
  const bullet = numbered
    ? { type: "number" as const, indent: INDENT }
    : { code: "2713", indent: INDENT };
  s.addText(
    items.flatMap((item): PptxGenJS.TextProps[] => {
      if (typeof item === "string") return [{ text: item, options: { bullet, breakLine: true } }];
      if (!item.answer?.trim()) return [{ text: item.text, options: { bullet, breakLine: true } }];
      return [
        { text: item.text, options: { bullet } },
        {
          text: `→ ${item.answer}`,
          options: { softBreakBefore: true, breakLine: true, bold: true, color: GREEN },
        },
      ];
    }),
    {
      x: at.x ?? MARGIN,
      y: at.y ?? BODY_Y,
      w,
      h,
      fontFace: FONT,
      // Less the hanging indent; paragraph spacing is 8pt, not the 3pt assumed.
      fontSize: fitFontSize(lines, w - 0.55, h - lines.length * 0.07, bodySize(total(texts)), 11),
      color: INK,
      valign: "top",
      paraSpaceAfter: 8,
      fit: "shrink",
    },
  );
}

/** A tinted box — the exercise book, a sentence frame, an answer. */
function box(
  s: PptxSlide,
  lines: PptxGenJS.TextProps[],
  at: { x: number; y: number; w: number; h: number },
  fill: string,
  line: string,
) {
  s.addText(lines, {
    ...at,
    fontFace: FONT,
    fill: { color: fill },
    line: { color: line, width: 1.5 },
    margin: 10,
    valign: "top",
    fit: "shrink",
  });
}

/** The "Copy into your book" box's lines. */
function bookLines(labels: DeckLabels, lines: Array<{ text: string; bold?: boolean }>): PptxGenJS.TextProps[] {
  return [
    {
      text: `✏ ${labels.copyIntoBook.toUpperCase()}`,
      options: { fontSize: 13, bold: true, color: BOOK, breakLine: true },
    },
    ...lines.map((l) => ({
      text: l.text,
      options: { fontSize: 20, bold: l.bold, color: l.bold ? NAVY : INK, breakLine: true },
    })),
  ];
}

/**
 * The largest font size (pt, at most `max`) at which `lines` fit a box `w` ×
 * `h` inches, estimating wrapping from an average character width. PowerPoint's
 * own shrink-to-fit often waits until the text is edited, so the deck sizes
 * its text itself rather than open with lines cut off.
 */
export function fitFontSize(lines: string[], w: number, h: number, max: number, min = 8): number {
  for (let size = max; size > min; size -= 0.5) {
    const charsPerRow = Math.max(1, Math.floor((w * 72) / (size * 0.5)));
    const rows = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerRow)), 0);
    // Line height ≈ 1.2 × size, plus the paragraph spacing between lines.
    if ((rows * size * 1.2 + lines.length * 3) / 72 <= h) return size;
  }
  return min;
}

/** The teacher strip along the foot of the slide; a long script takes two columns. */
function teacherStrip(s: PptxSlide, lines: ScriptLine[], labels: DeckLabels) {
  if (lines.length === 0) return;
  s.addShape("rect", {
    x: 0,
    y: STRIP_Y,
    w: W,
    h: STRIP_H,
    fill: { color: STRIP },
    line: { color: STRIP },
  });
  s.addText(`🗣 ${labels.teacher}`, {
    x: MARGIN,
    y: STRIP_Y + 0.1,
    w: 1.5,
    h: 0.4,
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    color: GOLD,
  });

  const columns = lines.length > 5 ? [lines.slice(0, Math.ceil(lines.length / 2)), lines.slice(Math.ceil(lines.length / 2))] : [lines];
  const gap = 0.25;
  const colW = (BODY_W - 1.5 - gap * (columns.length - 1)) / columns.length;
  const asText = (l: ScriptLine) => `${labels.script[l.kind].toUpperCase()}  ${l.text}`;
  // One size for both columns, fitted to the fuller one.
  const size = Math.min(
    ...columns.map((col) => fitFontSize(col.map(asText), colW - 0.1, STRIP_H - 0.25, 14)),
  );
  columns.forEach((col, i) => {
    s.addText(
      col.flatMap((line): PptxGenJS.TextProps[] => [
        { text: `${labels.script[line.kind].toUpperCase()}  `, options: { bold: true, color: CUE[line.kind] } },
        { text: line.text, options: { color: "FFFFFF", breakLine: true } },
      ]),
      {
        x: MARGIN + 1.5 + i * (colW + gap),
        y: STRIP_Y + 0.1,
        w: colW,
        h: STRIP_H - 0.2,
        fontFace: FONT,
        fontSize: size,
        valign: "top",
        paraSpaceAfter: 3,
        margin: 2,
      },
    );
  });
}

/** Speaker notes: the script, then the extras this slide calls for. */
function notesFor(
  slide: Slide,
  lines: ScriptLine[],
  extras: TeacherExtras,
  labels: DeckLabels,
  lang: DeckLanguage,
): string {
  const words = NOTE_WORDS[lang];
  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(lines.map((l) => `${labels.script[l.kind].toUpperCase()}: ${l.text}`).join("\n"));
  }
  if (slide.extras.includes("misconceptions") && extras.misconceptions.length > 0) {
    parts.push(
      `${words.misconceptions}:\n${extras.misconceptions
        .map((m) => `• ${m.misconception} — ${m.description}`)
        .join("\n")}`,
    );
  }
  if (slide.extras.includes("watchFor") && extras.watchFor.length > 0) {
    parts.push(`${words.watchFor}:\n${extras.watchFor.map((w) => `• ${w}`).join("\n")}`);
  }
  if (slide.extras.includes("differentiation")) {
    const d = extras.differentiation;
    parts.push(
      [
        `${words.remedial}: ${d.remedial}`,
        `${words.support}: ${d.support}`,
        `${words.challenge}: ${d.challenge}`,
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

/** Build the deck as a .pptx file. */
export async function deckToPptx(
  deck: SlideDeck,
  extras: TeacherExtras,
  meta: { title: string },
): Promise<Buffer> {
  const labels = DECK_LABELS[deck.language];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = meta.title;
  pptx.company = "Silverleaf Academy";

  pptx.defineSlideMaster({
    title: "SILVERLEAF",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: W * 0.82, h: 0.12, fill: { color: NAVY } } },
      { rect: { x: W * 0.82, y: 0, w: W * 0.18, h: 0.12, fill: { color: GOLD } } },
      {
        text: {
          text: "Silverleaf Academy",
          options: { x: MARGIN, y: 7.12, w: 4, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED },
        },
      },
    ],
    slideNumber: {
      x: W - MARGIN - 1,
      y: 7.12,
      w: 1,
      h: 0.3,
      fontFace: FONT,
      fontSize: 10,
      color: MUTED,
      align: "right",
    },
  });

  /** A new slide with the phase bar, teacher strip and notes already on. */
  const add = (slide: Slide, script: ScriptLine[] = slide.script) => {
    const s = pptx.addSlide({ masterName: "SILVERLEAF" });
    phaseBar(s, slide, labels);
    teacherStrip(s, script, labels);
    const notes = notesFor(slide, script, extras, labels, deck.language);
    if (notes) s.addNotes(notes);
    return s;
  };

  /** Questions, then (if any are answered) the same questions with answers. */
  const withAnswers = (
    slide: Slide,
    draw: (s: PptxSlide, qs: Array<{ text: string; answer?: string }>) => void,
    questions: QuestionAnswer[],
    answerScript: ScriptLine[] = slide.script,
  ) => {
    draw(
      add(slide),
      questions.map((q) => ({ text: q.question })),
    );
    if (questions.some((q) => q.answer.trim())) {
      draw(
        add(slide, answerScript),
        questions.map((q) => ({ text: q.question, answer: q.answer })),
      );
    }
  };

  for (const slide of deckToSlides(deck)) {
    switch (slide.kind) {
      case "title": {
        const s = add(slide);
        s.background = { color: NAVY };
        s.addText(slide.heading, {
          x: MARGIN,
          y: 1.4,
          w: BODY_W,
          h: 1.7,
          fontFace: FONT,
          fontSize: 44,
          bold: true,
          color: "FFFFFF",
          valign: "bottom",
          fit: "shrink",
        });
        if (slide.subheading) {
          s.addText(slide.subheading, {
            x: MARGIN,
            y: 3.3,
            w: Math.min(BODY_W, 0.6 + slide.subheading.length * 0.16),
            h: 0.6,
            fontFace: FONT,
            fontSize: 22,
            bold: true,
            color: NAVY,
            fill: { color: GOLD },
            margin: 8,
            fit: "shrink",
          });
        }
        s.addText(`⏱ ${labels.duration(slide.lessonMinutes)}`, {
          x: MARGIN,
          y: 4.1,
          w: 5,
          h: 0.5,
          fontFace: FONT,
          fontSize: 18,
          color: "D9E2F2",
        });
        break;
      }
      case "getReady": {
        const s = add(slide);
        heading(s, slide.heading);
        s.addText(labels.youNeed.toUpperCase(), {
          x: MARGIN,
          y: BODY_Y,
          w: 5,
          h: 0.4,
          fontFace: FONT,
          fontSize: 14,
          bold: true,
          color: MUTED,
        });
        list(s, slide.materials, false, { y: BODY_Y + 0.45, w: 5, h: BODY_H - 0.45 });
        box(
          s,
          bookLines(labels, [
            { text: labels.date },
            { text: slide.bookTitle, bold: true },
            { text: slide.bookGoal },
          ]),
          { x: MARGIN + 5.6, y: BODY_Y, w: BODY_W - 5.6, h: BODY_H - 0.2 },
          "FFFFFF",
          "C7D4E6",
        );
        break;
      }
      case "hook": {
        const draw = (withAnswers: boolean) => {
          const s = add(slide);
          heading(s, slide.heading);
          body(s, slide.prompt, { h: 1.8, size: Math.min(28, bodySize(slide.prompt.length) + 2) });
          if (slide.sentenceFrame.trim()) {
            box(
              s,
              [{ text: slide.sentenceFrame, options: { fontSize: 20, italic: true, color: INK } }],
              { x: MARGIN, y: BODY_Y + 1.9, w: BODY_W, h: 0.65 },
              GOLD15,
              GOLD,
            );
          }
          if (withAnswers) {
            box(
              s,
              slide.answers.map((a) => ({
                text: `✓ ${a}`,
                options: { fontSize: 18, bold: true, color: GREEN, breakLine: true },
              })),
              { x: MARGIN, y: BODY_Y + 2.7, w: BODY_W, h: 1.1 },
              GREEN_BG,
              GREEN,
            );
          }
        };
        draw(false);
        if (slide.steps > 0) draw(true);
        break;
      }
      case "keyWords": {
        const s = add(slide);
        heading(s, slide.heading, labels.newWords);
        const rowH = Math.min(0.75, (BODY_H - 0.1) / slide.words.length);
        slide.words.forEach((w, i) => {
          s.addText(
            [
              { text: w.word, options: { bold: true, color: NAVY } },
              { text: `   —   ${w.meaning}`, options: { color: INK } },
            ],
            {
              x: MARGIN,
              y: BODY_Y + i * rowH,
              w: BODY_W,
              h: rowH - 0.08,
              fontFace: FONT,
              fontSize: 20,
              fill: { color: LIGHT30 },
              margin: 8,
              valign: "middle",
              fit: "shrink",
            },
          );
        });
        break;
      }
      case "points": {
        const s = add(slide);
        heading(s, slide.heading);
        list(s, slide.points, false);
        break;
      }
      case "example": {
        const s = add(slide);
        heading(s, slide.heading, labels.workedExample(slide.number));
        body(s, slide.problem, { h: 0.7, size: 22, bold: true });
        const hasNote = Boolean(slide.bookNote.trim());
        list(s, slide.workSteps, true, {
          y: BODY_Y + 0.8,
          w: hasNote ? 7.2 : BODY_W,
          h: BODY_H - 0.8,
        });
        if (hasNote) {
          box(
            s,
            bookLines(labels, [{ text: slide.bookNote }]),
            { x: MARGIN + 7.5, y: BODY_Y + 0.8, w: BODY_W - 7.5, h: BODY_H - 0.9 },
            "FFFFFF",
            "C7D4E6",
          );
        }
        break;
      }
      case "checkpoint": {
        const draw = (withAnswer: boolean) => {
          const s = add(slide);
          heading(s, labels.checkpoint);
          body(s, slide.question, {
            h: withAnswer ? 2 : BODY_H,
            size: Math.min(30, bodySize(slide.question.length) + 4),
            bold: true,
          });
          if (withAnswer) {
            box(
              s,
              [
                {
                  text: labels.answer.toUpperCase(),
                  options: { fontSize: 13, bold: true, color: GREEN, breakLine: true },
                },
                { text: slide.answer, options: { fontSize: 22, color: INK } },
              ],
              { x: MARGIN, y: BODY_Y + 2.1, w: BODY_W, h: 1.5 },
              GREEN_BG,
              GREEN,
            );
          }
        };
        draw(false);
        if (slide.steps > 0) draw(true);
        break;
      }
      case "round": {
        const hasFrame = Boolean(slide.sentenceFrame.trim());
        withAnswers(
          slide,
          (s, qs) => {
            heading(s, slide.heading, slide.title);
            body(s, slide.instruction, { h: 0.6, size: 20, bold: true });
            list(s, qs, true, { y: BODY_Y + 0.7, h: hasFrame ? 2.35 : 3.1 });
            if (hasFrame) {
              box(
                s,
                [{ text: slide.sentenceFrame, options: { fontSize: 18, italic: true, color: INK } }],
                { x: MARGIN, y: BODY_Y + 3.15, w: BODY_W, h: 0.6 },
                GOLD15,
                GOLD,
              );
            }
          },
          slide.questions,
        );
        break;
      }
      case "exercise": {
        const all: QuestionAnswer[] = [
          ...slide.questions,
          {
            question: `⭐ ${labels.challenge}: ${slide.challenge.question}`,
            answer: slide.challenge.answer,
          },
        ];
        withAnswers(
          slide,
          (s, qs) => {
            heading(s, slide.heading);
            body(s, `✏ ${slide.instruction}`, { h: 0.6, size: 20, bold: true });
            list(s, qs, true, { y: BODY_Y + 0.7, h: BODY_H - 0.7 });
          },
          all,
          slide.scriptAfterReveal,
        );
        break;
      }
      case "exit": {
        withAnswers(
          slide,
          (s, qs) => {
            heading(s, slide.heading);
            body(s, `✏ ${slide.instruction}`, { h: 0.6, size: 20, bold: true });
            list(s, qs, true, { y: BODY_Y + 0.7, h: BODY_H - 0.7 });
          },
          slide.questions,
        );
        break;
      }
      case "close": {
        const s = add(slide);
        heading(s, slide.heading);
        s.addText(labels.recap.toUpperCase(), {
          x: MARGIN,
          y: BODY_Y,
          w: 5.8,
          h: 0.4,
          fontFace: FONT,
          fontSize: 14,
          bold: true,
          color: MUTED,
        });
        const hasHomework = Boolean(slide.homework.trim());
        list(s, slide.recap, false, {
          y: BODY_Y + 0.45,
          w: 5.8,
          h: hasHomework ? 2.1 : BODY_H - 0.45,
        });
        if (hasHomework) {
          box(
            s,
            [
              {
                text: `🏠 ${labels.homework.toUpperCase()}`,
                options: { fontSize: 13, bold: true, color: BOOK, breakLine: true },
              },
              { text: slide.homework, options: { fontSize: 18, color: INK } },
            ],
            { x: MARGIN, y: BODY_Y + 2.65, w: 5.8, h: 1.15 },
            "FFFFFF",
            "C7D4E6",
          );
        }
        s.addText(labels.thumbs.toUpperCase(), {
          x: MARGIN + 6.2,
          y: BODY_Y,
          w: BODY_W - 6.2,
          h: 0.4,
          fontFace: FONT,
          fontSize: 14,
          bold: true,
          color: MUTED,
        });
        s.addText(
          slide.selfCheck.map((text) => ({ text: `👍 👌 👎   ${text}`, options: { breakLine: true } })),
          {
            x: MARGIN + 6.2,
            y: BODY_Y + 0.45,
            w: BODY_W - 6.2,
            h: BODY_H - 0.45,
            fontFace: FONT,
            fontSize: Math.min(20, bodySize(total(slide.selfCheck))),
            color: INK,
            valign: "top",
            paraSpaceAfter: 8,
            fit: "shrink",
          },
        );
        break;
      }
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
