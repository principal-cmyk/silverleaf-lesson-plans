/**
 * Unit tests for the PDF coordinate → table reconstruction. The module is
 * pure, so pages are built here as positioned fragments laid out the way
 * pdfjs reports a STANDARD-template scheme: a wide title fragment, a header
 * band whose labels wrap over several baselines, then lesson rows whose cells
 * wrap within fixed column x positions. Origin is bottom-left (PDF space), so
 * a higher `y` is nearer the top of the page.
 */
import { describe, it, expect } from "vitest";

import {
  buildVocabulary,
  groupLines,
  reconstructSowTables,
  repairSplitWords,
  type PdfPageText,
  type PdfTextItem,
} from "./pdfTables";

const PAGE = { width: 842, height: 1190 };

/** Column left edges of the STANDARD landscape table, as pdfjs reports them. */
const COL = [33, 63, 116, 174, 244, 328, 436, 572, 640, 714, 759] as const;

/** A fragment at (x, y); width defaults to a rough per-character estimate. */
function frag(str: string, x: number, y: number, width?: number): PdfTextItem {
  return { str, x, y, width: width ?? Math.max(4, str.length * 4.2) };
}

/** Lay out a cell's wrapped lines in column `col`, starting at baseline `y`. */
function cell(col: number, y: number, lines: string[]): PdfTextItem[] {
  return lines.map((line, i) => frag(line, COL[col]!, y - i * 11.5));
}

/** The header band: labels wrapped exactly as the real PDF wraps them. */
function headerBand(y: number): PdfTextItem[] {
  return [
    frag("Lesson", 33, y),
    frag("Specific", 72, y),
    frag("Competenc", 65, y - 12.5),
    frag("e", 84, y - 25),
    frag("Main Activity", 116, y),
    frag("Lesson Objective", 174, y),
    frag("(By the end of", 180, y - 12.5),
    frag("Knowledge and Skills", 244, y),
    frag("Needed", 269, y - 12.5),
    frag("Assessment / Evidence", 335, y),
    frag("Learning Activities (I Do", 436, y),
    frag("→", 527, y),
    frag("We Do", 538, y),
    frag("→", 479, y - 12.5),
    frag("You Do)", 491, y - 12.5),
    frag("Misconception", 572, y),
    frag("s", 597, y - 12.5),
    frag("Differentiation /", 640, y),
    frag("Support", 655, y - 12.5),
    frag("Resources", 714, y),
    frag("Reflection", 759, y),
  ];
}

function title(week: number, y: number): PdfTextItem {
  return frag(
    `SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A | WEEK ${week}: TOPIC`,
    143,
    y,
    544,
  );
}

/** A full lesson row at baseline `y` with every column filled. */
function lessonRow(label: string, week: string[], y: number, activity: string): PdfTextItem[] {
  return [
    ...cell(0, y, [label, `(${label})`, ...week]),
    ...cell(1, y, ["1.1", "Demonstrate", "an", "understandin", "g of the", "concept of", "numbers"]),
    ...cell(2, y, [activity]),
    ...cell(3, y, ["DOK 1: State the", "four routines"]),
    ...cell(4, y, ["Knows:", "• SWK that every"]),
    ...cell(5, y, ["Ultimate Assessment", "Question:"]),
    ...cell(6, y, ["Guiding question:", "I Do (modelling)"]),
    ...cell(7, y, ["• “If I finish first”"]),
    ...cell(8, y, ["For support on", "content: slates"]),
    ...cell(9, y, ["40 slates and", "chalk"]),
    ...cell(10, y, ["Which learners", "stood a slate"]),
  ];
}

describe("groupLines", () => {
  it("groups fragments on one baseline and orders lines top to bottom, x left to right", () => {
    const lines = groupLines([
      frag("b", 100, 500),
      frag("a", 10, 501),
      frag("lower", 10, 400),
    ]);
    expect(lines.map((l) => l.frags.map((f) => f.str))).toEqual([["a", "b"], ["lower"]]);
  });
});

describe("repairSplitWords", () => {
  const vocab = buildVocabulary([
    "an understanding of the",
    "Demonstrate an understanding",
    "the manila card model at the",
    "demonstration slates",
  ]);

  it("re-joins a word wrapped mid-word when the pieces make a known word", () => {
    expect(repairSplitWords(["understandin", "g of the"], vocab)).toBe("understanding of the");
  });

  it("re-joins a lone trailing letter even when the word is unknown", () => {
    expect(repairSplitWords(["Competenc", "e"], vocab)).toBe("Competence");
  });

  it("does not glue a real word onto a two-letter word", () => {
    expect(repairSplitWords(["Demonstrate", "an"], buildVocabulary([]))).toBe("Demonstrate an");
  });

  it("never treats the article 'a' as a fragment", () => {
    expect(repairSplitWords(["Chalkboard", "a box of chalk"], buildVocabulary([]))).toBe(
      "Chalkboard a box of chalk",
    );
  });

  it("re-joins a two-letter tail only on a vocabulary hit", () => {
    expect(repairSplitWords(["demonstrati", "on slates"], vocab)).toBe("demonstration slates");
    expect(repairSplitWords(["demonstrati", "on slates"], buildVocabulary([]))).toBe(
      "demonstrati on slates",
    );
  });

  it("joins ordinary wrapped lines with a space", () => {
    expect(repairSplitWords(["the manila card", "model at the"], vocab)).toBe(
      "the manila card model at the",
    );
  });
});

/** The Kiswahili header band; "Kipindi" wraps as "Kipind" / "i" in the narrow first column. */
function kiswahiliHeaderBand(y: number): PdfTextItem[] {
  return [
    frag("Kipind", 33, y),
    frag("i", 33, y - 12.5),
    frag("Umahiri", 72, y),
    frag("Mahususi", 65, y - 12.5),
    frag("Shughuli ya", 116, y),
    frag("Ujifunzaji", 120, y - 12.5),
    frag("Lengo la Somo", 174, y),
    frag("Maarifa na Stadi", 244, y),
    frag("Tathmini / Ushahidi", 335, y),
    frag("Shughuli za Ujifunzaji (Mimi →", 436, y),
    frag("Sote → Wewe)", 479, y - 12.5),
    frag("Dhana Potofu", 572, y),
    frag("Utofautishaji /", 640, y),
    frag("Msaada", 655, y - 12.5),
    frag("Zana", 714, y),
    frag("Tafakari", 759, y),
  ];
}

describe("reconstructSowTables", () => {
  it("rebuilds title, header and lesson rows from one page", () => {
    const page: PdfPageText = {
      ...PAGE,
      items: [
        title(1, 1125),
        ...headerBand(1104),
        ...lessonRow("BL1", ["Week 1"], 1035, "How mathematics works"),
        ...lessonRow("BL2", ["Week 1"], 900, "Sitting the baseline"),
      ],
    };
    const { tables, titleHints } = reconstructSowTables([page]);

    expect(titleHints).toEqual([
      "SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A | WEEK 1: TOPIC",
    ]);
    expect(tables).toHaveLength(1);
    const [titleRow, header, ...rows] = tables[0]!;
    expect(titleRow).toEqual(["SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A | WEEK 1: TOPIC"]);
    // Wrapped header labels are re-joined, including the mid-word splits.
    expect(header?.[1]).toBe("Specific Competence");
    expect(header?.[6]).toBe("Learning Activities (I Do → We Do → You Do)");
    expect(header?.[7]).toBe("Misconceptions");
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]).toBe("BL1 (BL1) Week 1");
    expect(rows[0]![1]).toBe("1.1 Demonstrate an understanding of the concept of numbers");
    expect(rows[0]![2]).toBe("How mathematics works");
    expect(rows[1]![2]).toBe("Sitting the baseline");
    expect(rows[0]![10]).toBe("Which learners stood a slate");
  });

  it("keeps a row whole across a page break with no header on the second page", () => {
    const page1: PdfPageText = {
      ...PAGE,
      items: [title(2, 1125), ...headerBand(1104), ...lessonRow("1", ["Week 2"], 1035, "Roman numerals")],
    };
    const page2: PdfPageText = {
      ...PAGE,
      items: [
        ...cell(6, 1143, ["Round 2 — Pair frames:", "pairs build X"]),
        ...cell(3, 1143, ["DOK 3: Justify"]),
        ...lessonRow("2", ["Week 2"], 900, "Building 1 to 10"),
      ],
    };
    const { tables } = reconstructSowTables([page1, page2]);
    const rows = tables[0]!.slice(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]![6]).toBe("Guiding question: I Do (modelling) Round 2 — Pair frames: pairs build X");
    expect(rows[0]![3]).toBe("DOK 1: State the four routines DOK 3: Justify");
    expect(rows[1]![0]).toBe("2 (2) Week 2");
  });

  it("does not open a phantom row when 'Week 10' wraps onto two lines", () => {
    const page: PdfPageText = {
      ...PAGE,
      items: [
        title(10, 1125),
        ...headerBand(1104),
        ...lessonRow("57", ["Week", "10"], 1035, "Multiples ladder"),
        ...lessonRow("58", ["Week", "10"], 900, "Remainders"),
      ],
    };
    const rows = reconstructSowTables([page]).tables[0]!.slice(2);
    expect(rows.map((r) => r[0])).toEqual(["57 (57) Week 10", "58 (58) Week 10"]);
  });

  it("rebuilds a Kiswahili week: 'Wiki' title, Kiswahili header band and lesson rows", () => {
    const kiswahiliTitle =
      "SILVERLEAF ACADEMY — KISWAHILI DARASA LA 5 MUHULA WA 1A | WIKI 2: MSAMIATI NA MPANGILIO (Vipindi 1–5)";
    const page: PdfPageText = {
      ...PAGE,
      items: [
        frag(kiswahiliTitle, 143, 1125, 544),
        ...kiswahiliHeaderBand(1104),
        ...lessonRow("1", ["Wiki 2"], 1035, "Msamiati na Mpangilio"),
        ...lessonRow("2", ["Wiki", "2"], 900, "Kusimulia Hadithi"),
      ],
    };
    const { tables, titleHints } = reconstructSowTables([page]);
    expect(titleHints).toEqual([kiswahiliTitle]);
    const [, header, ...rows] = tables[0]!;
    expect(header?.[0]).toBe("Kipindi");
    expect(header?.[2]).toBe("Shughuli ya Ujifunzaji");
    expect(header?.[6]).toBe("Shughuli za Ujifunzaji (Mimi → Sote → Wewe)");
    // A "Wiki" label wrapped onto its own line opens no phantom row.
    expect(rows.map((r) => r[0])).toEqual(["1 (1) Wiki 2", "2 (2) Wiki 2"]);
    expect(rows[1]![2]).toBe("Kusimulia Hadithi");
  });

  it("does not mistake a wide lesson baseline for a week title", () => {
    // Eleven narrow fragments on one baseline whose text mentions "Week 3"
    // and "term" — together they span the page, but no single fragment does.
    const page: PdfPageText = {
      ...PAGE,
      items: [
        title(3, 1125),
        ...headerBand(1104),
        ...lessonRow("9", ["Week 3"], 1035, "Week 3 an term of"),
        ...lessonRow("10", ["Week 3"], 900, "Forty and fifty"),
      ],
    };
    const { tables, titleHints } = reconstructSowTables([page]);
    expect(titleHints).toHaveLength(1);
    expect(tables[0]!.slice(2)).toHaveLength(2);
  });

  it("keeps a mid-column bold fragment in its own column", () => {
    const page: PdfPageText = {
      ...PAGE,
      items: [
        title(1, 1125),
        ...headerBand(1104),
        ...lessonRow("1", ["Week 1"], 1035, "x"),
        // A bold run inside Learning Activities, starting well right of the
        // column's left edge but before Misconceptions begins at 572.
        frag("Developing (2–3):", 436, 1000),
        frag("Monitor;", 520, 1000),
      ],
    };
    const row = reconstructSowTables([page]).tables[0]![2]!;
    expect(row[6]).toContain("Developing (2–3): Monitor;");
    expect(row[7]).not.toContain("Monitor");
  });

  it("starts a new table at each week title", () => {
    const page: PdfPageText = {
      ...PAGE,
      items: [
        title(1, 1125),
        ...headerBand(1104),
        ...lessonRow("BL1", ["Week 1"], 1035, "a"),
        title(2, 700),
        ...headerBand(680),
        ...lessonRow("1", ["Week 2"], 610, "b"),
      ],
    };
    const { tables } = reconstructSowTables([page]);
    expect(tables).toHaveLength(2);
    expect(tables[0]![2]![2]).toBe("a");
    expect(tables[1]![2]![2]).toBe("b");
  });

  it("returns nothing for a page with no header band (e.g. a scanned PDF)", () => {
    expect(reconstructSowTables([{ ...PAGE, items: [] }]).tables).toEqual([]);
  });
});
