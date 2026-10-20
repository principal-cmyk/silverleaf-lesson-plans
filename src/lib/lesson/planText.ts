/**
 * planText — read the structure out of a plan's free-text fields.
 *
 * A teaching stage's `text` and the `exit_ticket` are single strings in the
 * stored plan (changing their shape would demote every saved plan — see
 * structuredSchema.ts), and models lay them out in several ways:
 *
 *   - one paragraph with inline markers: "KLP 1: … KLP 2: …",
 *     "Round 1 — … Round 2 — …", "Q1: … (Marking guide: …) Q2: …";
 *   - one step per line, often bulleted ("- Model the laugh…");
 *   - an exit ticket's questions on lines, then a "Marking guide:" block
 *     that repeats "Q1: …" with the answers.
 *
 * Rendering the string as one paragraph runs every step together and mixes
 * the exit ticket's questions with their answers. These functions recover
 * the steps (one level of sub-steps too: "(i) … (ii) …", "1) … 2) …") and
 * separate each exit-ticket question from its answer, so the document, the
 * government form and the markdown copy can show them apart.
 *
 * Markers only count in an unbroken run from 1 (KLP 1, KLP 2, …), so a stray
 * "Q5" or "3." in the prose never splits it. Text with no structure comes
 * back whole, as the lead.
 *
 * Pure module (no `server-only`).
 */

export interface Step {
  /** The step's own label ("KLP 1", "Round 2 (Pair frames)"), "" for a plain step. */
  label: string;
  text: string;
  /** Numbered sub-steps found inside this step, if any. */
  sub: Step[];
}

export interface StepText {
  /** Text before the first step (an introduction), or the whole text when it has no steps. */
  lead: string;
  steps: Step[];
  /**
   * Whether the steps are a sequence to number: true for "1) …", "1. …"
   * lines and the like; false for bulleted lines and sentences of prose.
   */
  numbered: boolean;
}

export interface ExitQuestion {
  label: string;
  question: string;
  /** The expected answer / marking guide, "" when the ticket gives none. */
  answer: string;
}

export interface ExitTicketParts {
  /** Any instruction before the questions ("On slates; board headings covered"). */
  lead: string;
  questions: ExitQuestion[];
  /** A marking guide for the ticket as a whole ("Q1–Q3: station records…"), "" when none. */
  notes: string;
}

/** A marker family: how its markers look, and how to read each one's number. */
interface Family {
  re: RegExp;
  /** Ordinal families ("1)", "(ii)") number a list; named ones ("KLP 2") keep their label. */
  ordinal: boolean;
  num: (m: RegExpExecArray) => number;
}

/**
 * After a named marker: ":", ". ", ")", " — ", "(" , "[", or a capitalised word
 * ("Q1 Pronounce …"). A dash only when no number follows, so a range
 * ("Q1–Q5", "KLP 1-3") is not a marker.
 */
const AFTER = String.raw`(?=\s*(?::|\.\s|\)|\s[—–-]\s(?![A-Za-z]{0,6}\s?\d)|[—–](?!\s?[A-Za-z]{0,6}\s?\d)|\(|\[)|\s+[A-Z])`;

const named = (word: string): Family => ({
  re: new RegExp(String.raw`\b${word}\s*(\d{1,2})\b${AFTER}`, "g"),
  ordinal: false,
  num: (m) => Number(m[1]),
});

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };

/** Top-level families, in no particular order: the one that starts first wins. */
const STEP_FAMILIES: Family[] = [
  "KLP",
  "Round",
  "Mzunguko",
  "Step",
  "Hatua",
  "Part",
  "Task",
  "Kazi",
  "Activity",
  "Q",
  "Sw",
  "Swali",
].map(named);

/** Families that number sub-steps inside a step. */
const SUB_FAMILIES: Family[] = [
  { re: /(?<=^|[\s:;])(\d{1,2})\)\s/g, ordinal: true, num: (m) => Number(m[1]) },
  { re: /(?<=^|[\s:;])\((\d{1,2})\)\s/g, ordinal: true, num: (m) => Number(m[1]) },
  { re: /(?<=^|[\s:;])\((i{1,3}|iv|vi{0,3}|v)\)\s/g, ordinal: true, num: (m) => ROMAN[m[1]!] ?? 0 },
  { re: /(?<=^|[:;]\s?|\.\s)(\d{1,2})\.\s+(?=[A-Z'"‘“])/g, ordinal: true, num: (m) => Number(m[1]) },
];

const Q_FAMILY = [named("Q"), named("Sw"), named("Swali")];

/** A bullet or list number at the start of a line. */
const LINE_BULLET = /^(?:[-•*▪●–]|\d{1,2}[.)])\s+/;

/** One marker found in the text. */
interface Hit {
  index: number;
  marker: string;
}

/**
 * The family's markers that run 1, 2, 3, … in order (at least two), or null.
 * One missing number is allowed (Q1, Q2, Q4 — the model skipped a question).
 */
function run(text: string, family: Family): Hit[] | null {
  const hits: Hit[] = [];
  let expected = 1;
  // matchAll starts from the regex's lastIndex: always scan from the start.
  family.re.lastIndex = 0;
  for (const m of text.matchAll(family.re)) {
    const n = family.num(m as RegExpExecArray);
    if (n !== expected && !(hits.length > 0 && n === expected + 1)) continue;
    hits.push({ index: m.index!, marker: m[0] });
    expected = n + 1;
  }
  return hits.length >= 2 ? hits : null;
}

/** The family whose run starts earliest in the text. */
function firstRun(text: string, families: Family[]): { family: Family; hits: Hit[] } | null {
  let best: { family: Family; hits: Hit[] } | null = null;
  for (const family of families) {
    const hits = run(text, family);
    if (hits && (!best || hits[0]!.index < best.hits[0]!.index)) best = { family, hits };
  }
  return best;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Strip the punctuation that joins a marker to its text ("KLP 1: x" → "x"). */
const afterMarker = (s: string) => s.replace(/^[\s:.)—–-]+/, "");

/** A named step's label, taking in a title: "Round 3 (The Switcher)", "Q1 [pronounce]". */
function labelled(marker: string, rest: string): { label: string; text: string } {
  const title = rest.match(/^\s*(?:\(([^()]{1,60})\)|\[([^[\]]{1,60})\])\s*[:—–-]?\s*/);
  if (title) {
    const tag = title[1] !== undefined ? `(${tidy(title[1])})` : `[${tidy(title[2]!)}]`;
    return { label: `${tidy(marker)} ${tag}`, text: rest.slice(title[0].length) };
  }
  return { label: tidy(marker), text: afterMarker(rest) };
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf|p|pp|pg|uk|Uk|No|Na|Mr|Mrs|Ms|Dr|Mwl)\.$/;

/**
 * Prose split into sentences — never inside quoted speech ('First, I put
 * toothpaste on the brush. Then I brush…' stays whole), nor after an
 * abbreviation. An apostrophe inside or after a word ("teacher's",
 * "learners'") is not a quote.
 */
export function proseSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quote: { close: string; at: number } | null = null;
  const CLOSE: Record<string, string> = { "'": "'", "‘": "’", '"': '"', "“": "”" };
  /** End a sentence at `i` when the text after it starts a new one. */
  const endAt = (i: number) => {
    const sentence = text.slice(start, i + 1);
    if (ABBREVIATION.test(sentence)) return;
    if (!/^[A-Z0-9"'‘“(]/.test(text.slice(i + 1).trimStart())) return;
    out.push(tidy(sentence));
    start = i + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const prev = text[i - 1] ?? " ";
    const next = text[i + 1] ?? " ";
    if (quote) {
      // A close is a quote mark not followed by a letter; an unclosed quote
      // (a stray apostrophe) gives up after a long stretch.
      if ((c === quote.close || (quote.close === "'" && c === "’")) && !/\w/.test(next)) {
        quote = null;
        // "… teeth.' Teacher models …" — the sentence ends with the quote.
        if (/[.!?]/.test(prev) && /\s/.test(next)) endAt(i);
      } else if (i - quote.at > 500) quote = null;
      continue;
    }
    if (CLOSE[c] && !/\w/.test(prev)) {
      quote = { close: CLOSE[c]!, at: i };
      continue;
    }
    if (/[.!?]/.test(c) && /\s/.test(next)) endAt(i);
  }
  const last = tidy(text.slice(start));
  if (last) out.push(last);
  return out;
}

/** Split `text` at the markers of one run. */
function splitAt(text: string, hits: Hit[], ordinal: boolean): StepText {
  const steps = hits.map((hit, i) => {
    const end = hits[i + 1]?.index ?? text.length;
    const rest = text.slice(hit.index + hit.marker.length, end);
    const { label, text: body } = ordinal ? { label: "", text: afterMarker(rest) } : labelled(hit.marker, rest);
    return { label, text: body, sub: [] as Step[] };
  });
  return { lead: tidy(text.slice(0, hits[0]!.index)), steps, numbered: ordinal };
}

/** Give a step its sub-steps ("(i) … (ii)", "Part 1: … Part 2:"), when its text numbers some. */
function withSub(step: Step): Step {
  const found = firstRun(step.text, [...STEP_FAMILIES, ...SUB_FAMILIES]);
  if (!found) return { ...step, text: tidy(step.text) };
  const inner = splitAt(step.text, found.hits, found.family.ordinal);
  return { label: step.label, text: inner.lead, sub: inner.steps.map((s) => ({ ...s, text: tidy(s.text) })) };
}

/** A line's own label, when it starts with a named marker ("Round 1 (Choral): …"). */
function lineStep(line: string): Step {
  for (const family of STEP_FAMILIES) {
    family.re.lastIndex = 0;
    const m = family.re.exec(line);
    family.re.lastIndex = 0;
    if (m && m.index === 0) {
      const { label, text } = labelled(m[0], line.slice(m[0].length));
      return withSub({ label, text, sub: [] });
    }
  }
  return withSub({ label: "", text: line, sub: [] });
}

/** Prose shorter than this stays a paragraph: only long run-on text is split. */
const PROSE_SPLIT_CHARS = 200;

/** A teaching stage's text as an introduction and its steps. */
export function splitSteps(text: string): StepText {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // "- Teacher says … - Teacher models …": bullets run onto one line.
    .replace(/^\s*-\s.*$/gm, (line) => line.replace(/\s+-\s+(?=[A-Z'"‘“])/g, "\n- "))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // One step per line: bulleted lines are steps; plain lines before the
  // first bullet introduce them (all lines are steps when none is bulleted).
  if (lines.length >= 2) {
    const bulleted = lines.some((l) => LINE_BULLET.test(l));
    const lead: string[] = [];
    const steps: Step[] = [];
    for (const line of lines) {
      if (bulleted && !LINE_BULLET.test(line) && steps.length === 0) lead.push(line);
      else steps.push(lineStep(line.replace(LINE_BULLET, "")));
    }
    const numbered = lines.some((l) => /^\d{1,2}[.)]\s/.test(l));
    return { lead: tidy(lead.join(" ")), steps, numbered };
  }

  const one = lines[0] ?? "";
  const found = firstRun(one, [...STEP_FAMILIES, ...SUB_FAMILIES]);
  if (!found) {
    // Long plain prose: each sentence is an instruction (three or more).
    const sentences = one.length >= PROSE_SPLIT_CHARS ? proseSentences(one) : [];
    if (sentences.length < 3) return { lead: tidy(one), steps: [], numbered: false };
    return {
      lead: "",
      steps: sentences.map((text) => ({ label: "", text, sub: [] })),
      numbered: false,
    };
  }
  const split = splitAt(one, found.hits, found.family.ordinal);
  return { ...split, steps: split.steps.map(withSub) };
}

/** Words that introduce an answer, inline or in the marking section (longest first). */
const ANSWER_WORDS = String.raw`(?:Marking guide|Marking|Expected answers?|Expected responses?|Expected|Correct answers?|Correct responses?|Correct|Sample answers?|Model answers?|Possible answers?|Accept|Answer key|Answers?|Jibu|Majibu|Mwongozo wa kusahihisha)`;

/** A heading for a marking guide that covers the whole ticket. */
const GUIDE_HEADING = /(?:^|\s)(?:Marking guide|Marking|Answer key|Mwongozo wa kusahihisha)\s*:/i;

/** Split a question from an answer written inside it. */
function questionAndAnswer(raw: string): { question: string; answer: string } {
  // "(Marking guide: …)" / "(Expected: …)" — up to the matching ")".
  const open = raw.search(new RegExp(String.raw`\(\s*${ANSWER_WORDS}\s*:`, "i"));
  if (open >= 0) {
    let depth = 0;
    let close = raw.length;
    for (let i = open; i < raw.length; i++) {
      if (raw[i] === "(") depth += 1;
      else if (raw[i] === ")" && --depth === 0) {
        close = i;
        break;
      }
    }
    const inner = raw.slice(open + 1, close);
    return {
      question: tidy(raw.slice(0, open) + " " + raw.slice(close + 1)),
      answer: tidy(inner.replace(new RegExp(String.raw`^\s*${ANSWER_WORDS}\s*:`, "i"), "")),
    };
  }
  // "… Expected answer: …" on the same or the next line.
  const plain = raw.match(new RegExp(String.raw`(?:^|\s)${ANSWER_WORDS}\s*:`, "i"));
  if (plain && plain.index! > 0) {
    return {
      question: tidy(raw.slice(0, plain.index)),
      answer: tidy(raw.slice(plain.index! + plain[0].length)),
    };
  }
  // "Random-cue five vowels. → clean"
  const arrow = raw.match(/\s(?:→|->|=>)\s*/);
  if (arrow && arrow.index! > 0) {
    return { question: tidy(raw.slice(0, arrow.index)), answer: tidy(raw.slice(arrow.index! + arrow[0].length)) };
  }
  // "Pronounce /e/. (Clean /e/)" — brackets after a finished question hold its answer.
  const trailing = tidy(raw).match(/^(.*[.?!])\s*\(([^()]+)\)\.?$/);
  if (trailing) return { question: trailing[1]!, answer: tidy(trailing[2]!) };
  return { question: tidy(raw), answer: "" };
}

/** The exit ticket's instruction, without a repeated "Exit ticket" heading. */
function exitLead(lead: string): string {
  const rest = lead
    .replace(/^(?:exit[- ]ticket|tiketi ya kutoka)(?:\s+questions?)?\b\s*/i, "")
    .replace(/^\((.*)\)\s*:?$/, "$1")
    .replace(/^[:\s—–-]+|[:\s]+$/g, "")
    .trim();
  // "(with answers and marking guide)" only describes the layout.
  return /^(?:with\s+)?(?:answers?|marking)\b/i.test(rest) && rest.length < 60 ? "" : rest;
}

/** An exit ticket as its questions, each with its answer kept apart. */
export function splitExitTicket(text: string): ExitTicketParts {
  const all = text.replace(/\r\n?/g, "\n");
  const found = firstRun(all, Q_FAMILY);
  if (!found) {
    // No Q-numbered questions: numbered lines, or a single activity.
    // (Only lines or "1) …" markers — prose sentences are one activity.)
    const steps = /\n|(?:^|\s)\(?1[.)]\s/.test(all.trim()) ? splitSteps(all) : { lead: all, steps: [] };
    if (steps.steps.length === 0) return { lead: tidy(all), questions: [], notes: "" };
    return {
      notes: "",
      lead: exitLead(steps.lead),
      questions: steps.steps.map((s) => ({
        label: "",
        ...questionAndAnswer([s.text, ...s.sub.map((x) => x.text)].join(" ")),
      })),
    };
  }

  // A second run of Q1, Q2, … after the first is the answer section.
  const qs = found.hits;
  const after = qs[qs.length - 1]!.index + qs[qs.length - 1]!.marker.length;
  const second = run(all.slice(after), found.family);
  const answerStart = second ? after + second[0]!.index : all.length;

  const questions = splitAt(all.slice(0, answerStart), qs, false);
  // (The second run's positions count from the end of the questions.)
  const answers = second ? splitAt(all.slice(after), second, false).steps : [];

  // A marking guide for the whole ticket after the last question ("Marking
  // guide: Q1–Q3: station records…", "Marking guide: Secure: ≥4 correct…"):
  // kept apart as notes, not taken for the last question's answer.
  let notes = "";
  const last = questions.steps[questions.steps.length - 1]!;
  const heading = last.text.match(GUIDE_HEADING);
  if (!second && heading && heading.index! > 0) {
    notes = tidy(last.text.slice(heading.index! + heading[0].length));
    last.text = last.text.slice(0, heading.index);
  }

  return {
    notes,
    lead: exitLead(questions.lead),
    questions: questions.steps.map((step, i) => {
      // An answer written with the question wins; else the answer section's.
      // (The section's own heading, ending the last question, splits off as
      // an empty inline answer.)
      const own = questionAndAnswer(step.text);
      const keyed = answers[i] ? tidy(answers[i]!.text) : "";
      return { label: step.label, question: own.question, answer: own.answer || keyed };
    }),
  };
}

/** Plain lines for a cell or a list: "KLP 1: …", "1. …" or "• …", with sub-steps as "(1) …". */
export function stepLines(text: string): string[] {
  const { lead, steps, numbered } = splitSteps(text);
  const lines = lead ? [lead] : [];
  steps.forEach((s, i) => {
    const head = s.label ? `${s.label}: ` : numbered ? `${i + 1}. ` : "• ";
    const sub = s.sub.map((x, j) => ` (${j + 1}) ${x.text}`).join("");
    lines.push(`${head}${s.text}${sub}`.trim());
  });
  return lines.length > 0 ? lines : [text];
}

/** A question's label without its tag, for the marking key: "Q1 [DOK 1]" → "Q1". */
export function keyLabel(label: string): string {
  return label.replace(/\s*[[(].*$/, "");
}

/** The exit ticket as plain lines: the questions, then "Marking key" and the answers. */
export function exitTicketLines(text: string): string[] {
  const { lead, questions, notes } = splitExitTicket(text);
  if (questions.length === 0) return [text];
  const name = (q: ExitQuestion, i: number) => (q.label ? `${q.label}:` : `${i + 1}.`);
  const lines = lead ? [lead] : [];
  questions.forEach((q, i) => lines.push(`${name(q, i)} ${q.question}`));
  const answered = questions.filter((q) => q.answer);
  if (answered.length > 0 || notes) {
    lines.push("Marking key:");
    questions.forEach((q, i) => {
      if (q.answer) lines.push(`${name({ ...q, label: keyLabel(q.label) }, i)} ${q.answer}`);
    });
    if (notes) lines.push(notes);
  }
  return lines;
}
