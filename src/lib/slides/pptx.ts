import "server-only";

/**
 * Slide deck → PowerPoint (.pptx), for teachers who present offline or want to
 * edit. Built from the same slides the in-app player shows, so the two agree
 * on content, order and wording.
 *
 * Every slide keeps the player's layout: the phase and its minutes along the
 * top, the class's numbered instructions, the pupil-facing content and its
 * visual (drawn with shapes and emoji, so it needs no image files). The
 * teacher's script (Say / Ask / Expect / Do) is in the speaker notes only,
 * with the plan's misconceptions, things to watch for and support/challenge
 * where they apply.
 *
 * A .pptx cannot reveal on click, so all of a slide's instructions show at
 * once and each answer reveal becomes a following slide: questions, then the
 * same questions with their answers (the exercise's answer slide carries the
 * marking script). Timed activities show their time.
 *
 * Calibri, not the brand font: a school laptop opening the file may not have
 * Montserrat, and PowerPoint's substitute is unpredictable.
 */
import PptxGenJS from "pptxgenjs";

import type { QuestionAnswer, ScriptLine, SlideDeck, Visual } from "./deckSchema";
import { deckToSlides, hasVisual, instructionClicks, type Slide, type TeacherExtras } from "./deckToSlides";
import { DECK_LABELS, type DeckLabels, type DeckLanguage } from "./labels";

const NAVY = "002368";
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
/** Content area between the heading and the footer. */
const BODY_Y = 1.45;
const BODY_H = 5.45;
/** With a visual, the text takes the left column and the visual the right. */
const TEXT_W = 6.9;
const VISUAL_X = MARGIN + TEXT_W + 0.35;
const VISUAL_W = BODY_W - TEXT_W - 0.35;
const PANEL = "F5F8FC";
const PANEL_LINE = "E3E8F0";

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
  opts: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    size?: number;
    bold?: boolean;
  } = {},
) {
  const h = opts.h ?? BODY_H;
  const w = opts.w ?? BODY_W;
  s.addText(text, {
    x: opts.x ?? MARGIN,
    y: opts.y ?? BODY_Y,
    w,
    h,
    fontFace: FONT,
    fontSize: fitFontSize([text], w - 0.2, h - 0.1, opts.size ?? bodySize(text.length), 12),
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
          options: {
            softBreakBefore: true,
            breakLine: true,
            bold: true,
            color: GREEN,
          },
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
      options: {
        fontSize: 20,
        bold: l.bold,
        color: l.bold ? NAVY : INK,
        breakLine: true,
      },
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

type Area = { x: number; y: number; w: number; h: number };

/** Height (in) `lines` take at `size` pt in a box `w` wide. */
function textHeight(lines: string[], w: number, size: number, paraPt = 8): number {
  const charsPerRow = Math.max(1, Math.floor((w * 72) / (size * 0.5)));
  const rows = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerRow)), 0);
  return (rows * size * 1.2 + lines.length * paraPt) / 72 + 0.2;
}

/**
 * The class's numbered instructions in a tinted panel at the top of `area`;
 * returns what is left of the area beneath it.
 */
function instructionsPanel(s: PptxSlide, items: string[], area: Area): Area {
  if (items.length === 0) return area;
  // Each step is a navy number disc and its text — drawn, not a list bullet,
  // which renderers indent unpredictably.
  const disc = 0.36;
  const w = area.w - disc - 0.45;
  // At most ~45% of the area: the questions and content still need room.
  const maxH = area.h * 0.45;
  const size = fitFontSize(items, w, maxH - 0.2, 20, 12);
  const heights = items.map((item) => textHeight([item], w, size, 0) - 0.08);
  const h = Math.min(maxH, heights.reduce((a, b) => a + b, 0) + 0.2);
  s.addShape("rect", { ...area, h, fill: { color: LIGHT30 }, line: { color: LIGHT30 } });
  let y = area.y + 0.1;
  items.forEach((text, i) => {
    const rowH = heights[i]!;
    s.addText(String(i + 1), {
      x: area.x + 0.12,
      y: y + 0.06,
      w: disc,
      h: disc,
      shape: "ellipse",
      fill: { color: NAVY },
      fontFace: FONT,
      fontSize: Math.min(14, size - 4),
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
      margin: 0,
    });
    s.addText(text, {
      x: area.x + disc + 0.25,
      y,
      w,
      h: rowH,
      fontFace: FONT,
      fontSize: size,
      bold: true,
      color: NAVY,
      valign: "top",
      margin: [4, 4, 0, 4],
    });
    y += rowH;
  });
  return { ...area, y: area.y + h + 0.2, h: area.h - h - 0.2 };
}

/** A sentence frame in a gold box, its type sized to fit. */
function frameBox(s: PptxSlide, text: string, at: Area) {
  const fontSize = fitFontSize([text], at.w - 0.35, at.h - 0.25, 20, 11);
  box(s, [{ text, options: { fontSize, italic: true, color: INK } }], at, GOLD15, GOLD);
}

/** The text column: the full width, or the left column beside a visual. */
function textArea(slide: Slide): Area {
  return {
    x: MARGIN,
    y: BODY_Y,
    w: hasVisual(slide.visual) ? TEXT_W : BODY_W,
    h: BODY_H,
  };
}

/** Draw a slide's visual in the right-hand column, if it has one. */
function visualPanel(s: PptxSlide, visual: Visual) {
  if (!hasVisual(visual)) return;
  const area: Area = { x: VISUAL_X, y: BODY_Y, w: VISUAL_W, h: BODY_H - 0.1 };
  s.addShape("roundRect", {
    ...area,
    fill: { color: PANEL },
    line: { color: PANEL_LINE, width: 1 },
    rectRadius: 0.12,
  });
  const caption = visual.caption.trim();
  const inner: Area = {
    x: area.x + 0.2,
    y: area.y + 0.2,
    w: area.w - 0.4,
    h: area.h - 0.4 - (caption ? 0.7 : 0),
  };
  drawVisual(s, visual, inner);
  if (caption) {
    s.addText(caption, {
      x: area.x + 0.2,
      y: area.y + area.h - 0.85,
      w: area.w - 0.4,
      h: 0.65,
      fontFace: FONT,
      fontSize: fitFontSize([caption], area.w - 0.5, 0.6, 16, 10),
      bold: true,
      color: NAVY,
      align: "center",
      valign: "middle",
    });
  }
}

function drawVisual(s: PptxSlide, visual: Visual, at: Area) {
  switch (visual.kind) {
    case "objects": {
      // Groups one above another, each as wide as the panel, centred.
      const groups = visual.groups.filter((g) => g.count > 0).slice(0, 4);
      const gap = 0.2;
      const gh = Math.min(2.2, (at.h - gap * (groups.length - 1)) / groups.length);
      const top = at.y + (at.h - (gh * groups.length + gap * (groups.length - 1))) / 2;
      const shape = (g: Visual["groups"][number]) => {
        const n = Math.min(g.count, 30);
        const perRow = Math.min(10, n);
        return { n, perRow, rows: Math.ceil(n / perRow), labelH: g.label ? 0.45 : 0 };
      };
      // One emoji size for every group, so pupils compare amounts, not sizes.
      const size = Math.max(
        10,
        Math.min(
          40,
          ...groups.map((g) => {
            const { perRow, rows, labelH } = shape(g);
            return Math.min(((at.w - 0.3) * 72) / (perRow * 1.45), ((gh - labelH - 0.2) * 72) / (rows * 1.3));
          }),
        ),
      );
      groups.forEach((g, i) => {
        const { n, perRow, rows, labelH } = shape(g);
        const y = top + i * (gh + gap);
        s.addShape("roundRect", {
          x: at.x,
          y,
          w: at.w,
          h: gh,
          fill: { color: "FFFFFF" },
          line: { color: "9AA6B8", width: 1, dashType: "dash" },
          rectRadius: 0.1,
        });
        const lines = Array.from({ length: rows }, (_, r) =>
          Array.from({ length: Math.min(perRow, n - r * perRow) }, () => g.emoji).join(" "),
        );
        s.addText(lines.join("\n"), {
          x: at.x,
          y: y + 0.05,
          w: at.w,
          h: gh - labelH - 0.05,
          fontSize: size,
          align: "center",
          valign: "middle",
        });
        if (g.label) {
          s.addText(g.label, {
            x: at.x,
            y: y + gh - labelH - 0.05,
            w: at.w,
            h: labelH,
            fontFace: FONT,
            fontSize: fitFontSize([g.label], at.w - 0.2, labelH - 0.05, 18, 10),
            bold: true,
            color: NAVY,
            align: "center",
            valign: "middle",
          });
        }
      });
      break;
    }
    case "number_line": {
      const { from, to, step, highlight } = visual.number_line;
      const count = Math.min(40, Math.floor((to - from) / step));
      const y = at.y + at.h / 2;
      const x0 = at.x + 0.15;
      const span = at.w - 0.3;
      const xAt = (i: number) => x0 + (i / Math.max(1, count)) * span;
      s.addShape("line", {
        x: x0,
        y,
        w: span,
        h: 0,
        line: { color: NAVY, width: 2 },
      });
      // Label every tick when they fit, else every other one.
      const every = count > 20 ? 2 : 1;
      for (let i = 0; i <= count; i++) {
        const n = +(from + i * step).toFixed(4);
        const on = highlight.includes(n);
        if (on) {
          s.addShape("ellipse", {
            x: xAt(i) - 0.15,
            y: y - 0.15,
            w: 0.3,
            h: 0.3,
            fill: { color: GOLD },
            line: { color: GOLD },
          });
        }
        s.addShape("line", {
          x: xAt(i),
          y: y - 0.12,
          w: 0,
          h: 0.24,
          line: { color: NAVY, width: 1.5 },
        });
        if (i % every === 0 || on) {
          s.addText(String(n), {
            x: xAt(i) - 0.35,
            y: y + 0.2,
            w: 0.7,
            h: 0.4,
            fontFace: FONT,
            fontSize: count > 12 ? 11 : 15,
            bold: on,
            color: NAVY,
            align: "center",
          });
        }
      }
      break;
    }
    case "place_value": {
      const pv = visual.place_value;
      const head = {
        bold: true,
        color: "FFFFFF",
        fill: { color: NAVY },
        align: "center" as const,
      };
      const cell = {
        bold: true,
        color: NAVY,
        fontSize: 40,
        align: "center" as const,
      };
      s.addTable(
        [
          ["H", "T", "O"].map((text) => ({ text, options: head })),
          [pv.hundreds, pv.tens, pv.ones].map((d) => ({
            text: String(d),
            options: cell,
          })),
        ],
        {
          x: at.x + 0.2,
          y: at.y + at.h / 2 - 1,
          w: at.w - 0.4,
          rowH: [0.5, 1.2],
          fontFace: FONT,
          fontSize: 18,
          valign: "middle",
          border: { type: "solid", pt: 1.5, color: NAVY },
        },
      );
      break;
    }
    case "table": {
      const { headers, rows } = visual.table;
      const body = rows.slice(0, 8);
      const cols = Math.max(headers.length, ...body.map((r) => r.length), 1);
      const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
      const all = [...(headers.length ? [headers] : []), ...body].map(pad);
      const rowH = Math.min(0.6, at.h / all.length);
      s.addTable(
        all.map((r, ri) =>
          r.map((text) => ({
            text,
            options:
              ri === 0 && headers.length
                ? { bold: true, color: "FFFFFF", fill: { color: NAVY } }
                : { color: INK, fill: { color: "FFFFFF" } },
          })),
        ),
        {
          x: at.x,
          y: at.y,
          w: at.w,
          rowH,
          fontFace: FONT,
          fontSize: Math.max(11, Math.min(18, rowH * 30)),
          align: "center",
          valign: "middle",
          border: { type: "solid", pt: 1, color: NAVY },
        },
      );
      break;
    }
    case "word_cards": {
      const cards = visual.cards.slice(0, 6);
      const perRow = cards.length > 3 ? 2 : 1;
      const rows = Math.ceil(cards.length / perRow);
      const gap = 0.2;
      const cw = (at.w - gap * (perRow - 1)) / perRow;
      const ch = Math.min(1.5, (at.h - gap * (rows - 1)) / rows);
      cards.forEach((c, i) => {
        const x = at.x + (i % perRow) * (cw + gap);
        const y = at.y + Math.floor(i / perRow) * (ch + gap);
        s.addText(
          [
            ...(c.emoji ? [{ text: `${c.emoji}  `, options: { fontSize: 28 } }] : []),
            { text: c.text, options: { bold: true, color: NAVY } },
          ],
          {
            x,
            y,
            w: cw,
            h: ch,
            fontFace: FONT,
            fontSize: fitFontSize([`${c.emoji}  ${c.text}`], cw - 0.3, ch - 0.2, 24, 11),
            fill: { color: "FFFFFF" },
            line: { color: GOLD, width: 2 },
            align: "center",
            valign: "middle",
          },
        );
      });
      break;
    }
    case "picture":
      s.addText(visual.emoji, {
        ...at,
        fontSize: 120,
        align: "center",
        valign: "middle",
      });
      break;
    default:
      break;
  }
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
      {
        rect: {
          x: W * 0.82,
          y: 0,
          w: W * 0.18,
          h: 0.12,
          fill: { color: GOLD },
        },
      },
      {
        text: {
          text: "Silverleaf Academy",
          options: {
            x: MARGIN,
            y: 7.12,
            w: 4,
            h: 0.3,
            fontFace: FONT,
            fontSize: 10,
            color: MUTED,
          },
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

  /** A new slide with the phase bar, visual and notes already on. */
  const add = (slide: Slide, script: ScriptLine[] = slide.script) => {
    const s = pptx.addSlide({ masterName: "SILVERLEAF" });
    phaseBar(s, slide, labels);
    visualPanel(s, slide.visual);
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
        if (slide.emoji) {
          s.addText(slide.emoji, {
            x: MARGIN,
            y: 0.5,
            w: 2,
            h: 1.2,
            fontSize: 60,
            valign: "middle",
          });
        }
        s.addText(slide.heading, {
          x: MARGIN,
          y: 1.8,
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
            y: 3.7,
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
          y: 4.5,
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
        const rest = instructionsPanel(s, slide.instructions, textArea(slide));
        s.addText(labels.youNeed.toUpperCase(), {
          x: MARGIN,
          y: rest.y,
          w: 5,
          h: 0.4,
          fontFace: FONT,
          fontSize: 14,
          bold: true,
          color: MUTED,
        });
        list(s, slide.materials, false, {
          y: rest.y + 0.45,
          w: 5,
          h: rest.h - 0.45,
        });
        box(
          s,
          bookLines(labels, [
            { text: labels.date },
            { text: slide.bookTitle, bold: true },
            { text: slide.bookGoal },
          ]),
          { x: MARGIN + 5.6, y: rest.y, w: BODY_W - 5.6, h: rest.h - 0.2 },
          "FFFFFF",
          "C7D4E6",
        );
        break;
      }
      case "hook": {
        const draw = (withAnswers: boolean) => {
          const s = add(slide);
          heading(s, slide.heading);
          let rest = instructionsPanel(s, slide.instructions, textArea(slide));
          if (slide.sentenceFrame.trim()) {
            frameBox(s, slide.sentenceFrame, { ...rest, h: 0.65 });
            rest = { ...rest, y: rest.y + 0.85, h: rest.h - 0.85 };
          }
          if (withAnswers) {
            box(
              s,
              slide.answers.map((a) => ({
                text: `✓ ${a}`,
                options: {
                  fontSize: 18,
                  bold: true,
                  color: GREEN,
                  breakLine: true,
                },
              })),
              {
                ...rest,
                h: Math.min(rest.h, 0.35 + slide.answers.length * 0.4),
              },
              GREEN_BG,
              GREEN,
            );
          }
        };
        draw(false);
        if (slide.steps > instructionClicks(slide)) draw(true);
        break;
      }
      case "keyWords": {
        const s = add(slide);
        heading(s, slide.heading, labels.newWords);
        // Cards, three to a row.
        const perRow = Math.min(3, slide.words.length);
        const rows = Math.ceil(slide.words.length / perRow);
        const gap = 0.3;
        const cw = (BODY_W - gap * (perRow - 1)) / perRow;
        const ch = Math.min(2.6, (BODY_H - 0.1 - gap * (rows - 1)) / rows);
        const top = BODY_Y + (BODY_H - (ch * rows + gap * (rows - 1))) / 2;
        slide.words.forEach((w, i) => {
          const x = MARGIN + (i % perRow) * (cw + gap);
          const y = top + Math.floor(i / perRow) * (ch + gap);
          s.addShape("roundRect", {
            x,
            y,
            w: cw,
            h: ch,
            fill: { color: "FFFFFF" },
            line: { color: LIGHT, width: 1.5 },
            rectRadius: 0.12,
          });
          s.addShape("rect", {
            x,
            y,
            w: cw,
            h: 0.1,
            fill: { color: GOLD },
            line: { color: GOLD },
          });
          const meaningSize = fitFontSize([w.meaning], cw - 0.3, ch * 0.35, 18, 11);
          s.addText(
            [
              ...(w.emoji
                ? [
                    {
                      text: w.emoji,
                      options: { fontSize: 40, breakLine: true },
                    },
                  ]
                : []),
              {
                text: w.word,
                options: {
                  fontSize: 26,
                  bold: true,
                  color: NAVY,
                  breakLine: true,
                },
              },
              {
                text: w.meaning,
                options: { fontSize: meaningSize, color: INK },
              },
            ],
            {
              x,
              y: y + 0.15,
              w: cw,
              h: ch - 0.2,
              fontFace: FONT,
              align: "center",
              valign: "middle",
              margin: 8,
            },
          );
        });
        break;
      }
      case "points": {
        const s = add(slide);
        heading(s, slide.heading);
        list(s, slide.points, false, textArea(slide));
        break;
      }
      case "example": {
        const s = add(slide);
        heading(s, slide.heading, labels.workedExample(slide.number));
        const area = textArea(slide);
        body(s, slide.problem, { ...area, h: 0.8, size: 22, bold: true });
        const hasNote = Boolean(slide.bookNote.trim());
        if (hasVisual(slide.visual)) {
          // Steps, with the book note under them, beside the visual.
          const noteH = hasNote ? 1.4 : 0;
          list(s, slide.workSteps, true, {
            ...area,
            y: BODY_Y + 0.9,
            h: BODY_H - 0.9 - noteH,
          });
          if (hasNote) {
            box(
              s,
              bookLines(labels, [{ text: slide.bookNote }]),
              { ...area, y: BODY_Y + BODY_H - noteH, h: noteH - 0.1 },
              "FFFFFF",
              "C7D4E6",
            );
          }
        } else {
          list(s, slide.workSteps, true, {
            y: BODY_Y + 0.9,
            w: hasNote ? 7.2 : BODY_W,
            h: BODY_H - 0.9,
          });
          if (hasNote) {
            box(
              s,
              bookLines(labels, [{ text: slide.bookNote }]),
              { x: MARGIN + 7.5, y: BODY_Y + 0.9, w: BODY_W - 7.5, h: 2.6 },
              "FFFFFF",
              "C7D4E6",
            );
          }
        }
        break;
      }
      case "checkpoint": {
        const draw = (withAnswer: boolean) => {
          const s = add(slide);
          heading(s, labels.checkpoint);
          const area = textArea(slide);
          const qh = Math.min(1.8, textHeight([slide.question], area.w, 28));
          body(s, slide.question, { ...area, h: qh, size: 28, bold: true });
          const rest = instructionsPanel(s, slide.instructions, {
            ...area,
            y: area.y + qh + 0.1,
            h: area.h - qh - 0.1,
          });
          if (withAnswer) {
            box(
              s,
              [
                {
                  text: labels.answer.toUpperCase(),
                  options: {
                    fontSize: 13,
                    bold: true,
                    color: GREEN,
                    breakLine: true,
                  },
                },
                { text: slide.answer, options: { fontSize: 22, color: INK } },
              ],
              { ...rest, h: Math.min(rest.h, 1.5) },
              GREEN_BG,
              GREEN,
            );
          }
        };
        draw(false);
        if (slide.steps > instructionClicks(slide)) draw(true);
        break;
      }
      case "round": {
        const hasFrame = Boolean(slide.sentenceFrame.trim());
        withAnswers(
          slide,
          (s, qs) => {
            heading(s, slide.heading, slide.title);
            const rest = instructionsPanel(s, slide.instructions, textArea(slide));
            const frameH = hasFrame ? 0.8 : 0;
            list(s, qs, true, { ...rest, h: rest.h - frameH });
            if (hasFrame) {
              frameBox(s, slide.sentenceFrame, { ...rest, y: rest.y + rest.h - 0.65, h: 0.6 });
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
            list(s, qs, true, instructionsPanel(s, slide.instructions, textArea(slide)));
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
            list(s, qs, true, instructionsPanel(s, slide.instructions, textArea(slide)));
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
          h: hasHomework ? BODY_H - 2.1 : BODY_H - 0.45,
        });
        if (hasHomework) {
          box(
            s,
            [
              {
                text: `🏠 ${labels.homework.toUpperCase()}`,
                options: {
                  fontSize: 13,
                  bold: true,
                  color: BOOK,
                  breakLine: true,
                },
              },
              { text: slide.homework, options: { fontSize: 18, color: INK } },
            ],
            { x: MARGIN, y: BODY_Y + BODY_H - 1.5, w: 5.8, h: 1.4 },
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
          slide.selfCheck.map((text) => ({
            text: `👍 👌 👎   ${text}`,
            options: { breakLine: true },
          })),
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
