/**
 * Unit tests for SOW parsing — the CSV path and the shared keyword→column
 * mapping are pure (no I/O), so they are exercised directly here. The docx path
 * differs only in how cells are extracted (mammoth → HTML table), which is
 * covered by `extractFirstTable`-style fixtures fed through the same mapper.
 */
import { describe, it, expect } from "vitest";

import {
  parseSowCsv,
  parseSowHtml,
  parseSowTables,
  parseTitleLine,
  splitLessonCell,
  type ParsedSowRow,
} from "./parse";

/** Assert exactly `n` rows and return the first, narrowing it for the asserts. */
function firstRow(rows: ParsedSowRow[], n = 1): ParsedSowRow {
  expect(rows).toHaveLength(n);
  const row = rows[0];
  if (!row) throw new Error("expected at least one parsed row");
  return row;
}

describe("parseSowCsv", () => {
  it("maps canonical headers to the 11 SOW columns", () => {
    const csv = [
      "Week,Lesson,Specific Competence,Main Activity,Lesson Objective,Knowledge and Skills,Assessment / Evidence,Learning Activities,Misconceptions,Differentiation & Support,Resources,Reflection",
      "3,2,4.1 Recognise numbers,Count to ten,Learner can count,Counting,Oral quiz,I do/We do/You do,Confusing 6 and 9,Extra examples,Counters,Went well",
    ].join("\n");

    const row = firstRow(parseSowCsv(csv).rows);
    expect(row.week).toBe(3);
    expect(row.lessonNumber).toBe("2");
    expect(row.specificCompetence).toBe("4.1 Recognise numbers");
    expect(row.mainActivity).toBe("Count to ten");
    expect(row.lessonObjective).toBe("Learner can count");
    expect(row.knowledgeAndSkills).toBe("Counting");
    expect(row.assessmentEvidence).toBe("Oral quiz");
    expect(row.learningActivities).toBe("I do/We do/You do");
    expect(row.misconceptions).toBe("Confusing 6 and 9");
    expect(row.differentiationSupport).toBe("Extra examples");
    expect(row.resources).toBe("Counters");
    expect(row.reflection).toBe("Went well");
  });

  it("is tolerant of header drift and casing", () => {
    const csv = [
      "WK,Lesson No.,SPECIFIC COMPETENCE,Sample Lesson Activities,Teaching & Learning Resources",
      "1,1,Comp A,Do the thing,Textbook p.4",
    ].join("\n");

    const row = firstRow(parseSowCsv(csv).rows);
    expect(row.week).toBe(1);
    expect(row.lessonNumber).toBe("1");
    expect(row.specificCompetence).toBe("Comp A");
    // "Sample Lesson Activities" → learningActivities (the revised-template
    // column), NOT mainActivity.
    expect(row.learningActivities).toBe("Do the thing");
    expect(row.mainActivity).toBeUndefined();
    expect(row.resources).toBe("Textbook p.4");
  });

  it("maps a 'Remarks' column to reflection", () => {
    const csv = ["Lesson,Remarks", "1,See note"].join("\n");
    const row = firstRow(parseSowCsv(csv).rows);
    expect(row.reflection).toBe("See note");
  });

  it("does not let the generic activity rule steal learning activities", () => {
    const csv = [
      "Lesson,Learning Activities,Main Activity",
      "1,LA text,MA text",
    ].join("\n");

    const row = firstRow(parseSowCsv(csv).rows);
    expect(row.learningActivities).toBe("LA text");
    expect(row.mainActivity).toBe("MA text");
  });

  it("preserves unmapped cells in rawCells and skips empty rows", () => {
    const csv = [
      "Lesson,Specific Competence,Custom Notes",
      "1,Comp,Some note",
      ",,",
    ].join("\n");

    const row = firstRow(parseSowCsv(csv).rows);
    expect(row.rawCells["Custom Notes"]).toBe("Some note");
    expect(row.rawCells["Specific Competence"]).toBe("Comp");
  });

  it("parses a week label like 'Week 5' to a number", () => {
    const csv = ["Week,Specific Competence", "Week 5,Comp"].join("\n");
    const row = firstRow(parseSowCsv(csv).rows);
    expect(row.week).toBe(5);
  });

  it("returns no rows for an empty body", () => {
    const csv = "Week,Specific Competence\n";
    expect(parseSowCsv(csv).rows).toHaveLength(0);
  });
});

// ── parseSowHtml (revised multi-table docx) ────────────────────────────────

/** Build an HTML table from a 2-D array of cell strings. */
function htmlTable(rows: string[][]): string {
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${body}</table>`;
}

const META_TABLE = htmlTable([
  ["Grade", "2", "Number of Weeks", "10", "Main Competence", "4.0 Arithmetic"],
  ["Subject", "Arithmetic", "Lessons/Periods per Week", "8", "Term", "1A"],
  ["Specific competences", "4.1 Use mathematical operations", "Year", "2026", "Duration per Lesson/Period", "40min"],
]);

const DESIRED_TABLE = htmlTable([
  ["DESIRED RESULTS"],
  ["Transfer Goal", "Enduring Understandings", "Essential Questions", "Knowledge", "Skills"],
  [
    "Learners use place-value reasoning.",
    "U1- Position tells worth. U2- One quantity, many forms. U3- Compare by place value.",
    "EQ1- Why write numbers? EQ2- Can a symbol mean different things?",
    "K1- A three-digit number has hundreds, tens, ones. K2- Ones are worth 1s.",
    "S1- Illustrate a number. S7a- Compare two numbers. S7b- Explain the comparison.",
  ],
]);

const EVIDENCE_TABLE = htmlTable([
  ["ACCEPTABLE EVIDENCE"],
  ["Task", "Details/Content", "Success Criteria", "When"],
  ["The Market Stall", "Help Mama Njeri order her sales records.", "All amounts in figures.", "Week 5"],
]);

const ASSESSMENT_TABLE = htmlTable([
  ["Formative Assessments (collected throughout)", "Summative Assessments (end of unit)"],
  ["Type", "What learner does", "Assesses", "When", "Type", "Details", "Assesses", "When"],
  ["EXIT TICKETS", "A five-question ticket", "the day's content", "every lesson", "BASELINE ASSESSMENT", "A full written paper", "prior knowledge", "Week 1"],
  ["MONTHLY ASSESSMENTS", "the School Compound Survey performance task is launched", "weeks 2-6", "Week 7", "MID-TERM EXAM", "A 20-mark paper", "all objectives", "Week 11"],
]);

describe("parseSowHtml — metadata", () => {
  it("parses the metadata grid into scheme fields", () => {
    const { scheme } = parseSowHtml(META_TABLE);
    expect(scheme.grade).toBe("Grade 2");
    expect(scheme.subject).toBe("Arithmetic");
    expect(scheme.term).toBe("1A");
    expect(scheme.year).toBe("2026");
    expect(scheme.mainCompetence).toBe("4.0 Arithmetic");
    expect(scheme.weeksCount).toBe(10);
    expect(scheme.lessonsPerWeek).toBe(8);
    expect(scheme.lessonDurationMins).toBe(40);
  });

  it("strips a leading 'Term ' from the term value", () => {
    const html = htmlTable([["Grade", "2", "Term", "Term 1A", "Subject", "Math"]]);
    expect(parseSowHtml(html).scheme.term).toBe("1A");
  });
});

describe("parseSowHtml — desired results", () => {
  it("splits the UbD columns into labelled items", () => {
    const { headerContext: ctx } = parseSowHtml(META_TABLE + DESIRED_TABLE);
    expect(ctx.transferGoal).toContain("place-value");
    expect(ctx.enduringUnderstandings).toHaveLength(3);
    expect(ctx.enduringUnderstandings[0]).toMatch(/^U1-/);
    expect(ctx.essentialQuestions).toHaveLength(2);
    expect(ctx.knowledge).toHaveLength(2);
    // S7a / S7b sub-skills split correctly.
    expect(ctx.skills).toHaveLength(3);
    expect(ctx.skills[2]).toMatch(/^S7b-/);
    expect(ctx.specificCompetences).toContain("4.1");
  });

  it("captures performance tasks from the evidence table", () => {
    const { headerContext: ctx } = parseSowHtml(META_TABLE + EVIDENCE_TABLE);
    expect(ctx.performanceTasks.length).toBeGreaterThan(0);
    expect(ctx.performanceTasks[0]).toContain("The Market Stall");
  });
});

describe("parseSowHtml — assessment plan vs evidence", () => {
  it("routes a formative/summative table to the assessment plan, not performance tasks", () => {
    const { headerContext: ctx } = parseSowHtml(
      META_TABLE + EVIDENCE_TABLE + ASSESSMENT_TABLE,
    );
    expect(ctx.performanceTasks.some((t) => /Market Stall/.test(t))).toBe(true);
    expect(ctx.performanceTasks.some((t) => /EXIT TICKETS/.test(t))).toBe(false);
    expect(ctx.assessment).toBeDefined();
    expect(ctx.assessment?.formative.some((f) => /EXIT TICKETS/.test(f))).toBe(true);
    expect(ctx.assessment?.summative.some((s) => /BASELINE ASSESSMENT/.test(s))).toBe(true);
  });

  it("still classifies the evidence table as performance tasks (regression)", () => {
    const { headerContext: ctx } = parseSowHtml(META_TABLE + EVIDENCE_TABLE);
    expect(ctx.performanceTasks.some((t) => /Market Stall/.test(t))).toBe(true);
    expect(ctx.assessment).toBeUndefined();
  });
});

describe("parseSowHtml — week tables", () => {
  const weekTable = (title: string, lessons: string[][]) =>
    htmlTable([
      [title],
      ["Lesson", "Specific Competence", "Main Activity", "Lesson Objective", "Sample Lesson activities", "Teaching and Learning Resources", "Remarks"],
      ...lessons,
    ]);

  it("extracts lessons and carries the week number from the title row", () => {
    const html =
      META_TABLE +
      weekTable("Week 2: Identifying Numbers", [
        ["1", "4.1 Numbers", "Count to 200", "Learner counts", "I do / We do", "Counters", "Watch reversals"],
      ]);
    const { rows } = parseSowHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.week).toBe(2);
    expect(rows[0]!.lessonNumber).toBe("1");
    expect(rows[0]!.specificCompetence).toBe("4.1 Numbers");
    expect(rows[0]!.mainActivity).toBe("Count to 200");
    // The collision fix: "Sample Lesson activities" → learningActivities.
    expect(rows[0]!.learningActivities).toBe("I do / We do");
    expect(rows[0]!.resources).toBe("Counters");
    expect(rows[0]!.reflection).toBe("Watch reversals");
  });

  it("drops empty week templates and keeps the richest duplicate", () => {
    const rich = weekTable("Week 1: Foundations", [
      ["1", "4.1 Numbers", "Count", "Learner counts", "I do", "Counters", "ok"],
    ]);
    const sparse = weekTable("Week 1: Foundations", [["1", "", "", "", "", "", ""]]);
    const emptyTemplate = weekTable("Week:", [["", "", "", "", "", "", ""]]);

    const { rows, stats } = parseSowHtml(META_TABLE + sparse + rich + emptyTemplate);
    // One week-1 row kept (the rich variant); empties dropped.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.specificCompetence).toBe("4.1 Numbers");
    expect(stats.weekTablesKept).toBe(1);
    expect(stats.weekTablesDropped).toBeGreaterThanOrEqual(2);
  });

  it("orders rows by week number", () => {
    const html =
      META_TABLE +
      weekTable("Week 3: C", [["1", "c", "", "", "", "", ""]]) +
      weekTable("Week 1: A", [["1", "a", "", "", "", "", ""]]);
    const { rows } = parseSowHtml(html);
    expect(rows.map((r) => r.week)).toEqual([1, 3]);
  });

  it("keeps a lesson whose prose mentions 'objective' or 'activity'", () => {
    // Regression: these rows were mistaken for repeated headers and dropped.
    // Both cells below are lifted from the real Grade 2 Health & Environment
    // scheme, which silently lost two lessons this way.
    const html =
      META_TABLE +
      weekTable("Week 6: Can the group change?", [
        [
          "L10 Wk6 · P2",
          "7.1 Observe objects",
          "Benefits of wild animals",
          "Explain a benefit of a wild animal",
          "I do / We do",
          "Pupil's Book page 9, with the habitat activity on page 3.",
          "Note groups ready to lead",
        ],
        [
          "Midterm P1",
          "7.1 Observe objects",
          "Midterm written paper",
          "Show mastery of every 7.1 objective across the full range of demand",
          "Administer the paper",
          "Printed midterm paper",
          "Use the results to plan Term 1B",
        ],
      ]);
    const { rows } = parseSowHtml(html);
    expect(rows.map((r) => r.lessonNumber)).toEqual(["L10 Wk6 · P2", "Midterm P1"]);
  });

  it("still drops a header row repeated inside the body", () => {
    const html =
      META_TABLE +
      htmlTable([
        ["Week 4: Repeats"],
        ["Lesson", "Specific Competence", "Main Activity", "Lesson Objective", "Sample Lesson activities", "Teaching and Learning Resources", "Remarks"],
        ["1", "4.1 Numbers", "Count", "Learner counts", "I do", "Counters", "ok"],
        ["Lesson", "Specific Competence", "Main Activity", "Lesson Objective", "Sample Lesson activities", "Teaching and Learning Resources", "Remarks"],
        ["2", "4.1 Numbers", "Order", "Learner orders", "We do", "Cards", "ok"],
      ]);
    const { rows } = parseSowHtml(html);
    expect(rows.map((r) => r.lessonNumber)).toEqual(["1", "2"]);
  });
});

// ── STANDARD template (one table per week, title line carries the meta) ─────

const STANDARD_HEADERS = [
  "Lesson",
  "Specific Competence",
  "Main Activity",
  "Lesson Objective (By the end of the lesson, the learner should be able to:)",
  "Knowledge and Skills Needed",
  "Assessment / Evidence (How will you know they understood?)",
  "Learning Activities (I Do → We Do → You Do)",
  "Misconceptions",
  "Differentiation / Support",
  "Resources",
  "Reflection",
];

/** A STANDARD week table: title row, header row, lesson rows. */
function standardWeek(week: number, lessons: Array<[label: string, activity: string]>): string[][] {
  return [
    [`SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A | WEEK ${week}: TOPIC`],
    STANDARD_HEADERS,
    ...lessons.map(([label, activity]) => [
      `${label} Week ${week}`,
      "1.1 Demonstrate an understanding of the concept of numbers",
      activity,
      "DOK 1: State… DOK 2: Compare… DOK 3: Justify…",
      "Knows: • SWK that… Skills: • Students will be able to…",
      "Ultimate Assessment Question: … Exit Ticket: Q1 …",
      "Guiding question: … I Do … We Do … You Do …",
      "• “If I finish first I am the best.” — …",
      "For support on content: …",
      "40 slates and a box of chalk",
      "Which learners …",
    ]),
  ];
}

/** The Kiswahili STANDARD template's header row, as in "Grade 5 - Kiswahili T1A.pdf". */
const KISWAHILI_HEADERS = [
  "Kipindi",
  "Umahiri Mahususi",
  "Shughuli ya Ujifunzaji",
  "Lengo la Somo (Mwisho wa somo, mwanafunzi awe na uwezo wa:)",
  "Maarifa na Stadi Zinazohitajika",
  "Tathmini / Ushahidi (Utajuaje kuwa wameelewa?)",
  "Shughuli za Ujifunzaji (Mimi → Sote → Wewe)",
  "Dhana Potofu",
  "Utofautishaji / Msaada",
  "Zana",
  "Tafakari",
];

/** A Kiswahili STANDARD week table: title row, header row, lesson rows. */
function kiswahiliWeek(week: number, lessons: Array<[label: string, activity: string]>): string[][] {
  return [
    [`SILVERLEAF ACADEMY — KISWAHILI DARASA LA 5 MUHULA WA 1A | WIKI ${week}: MSAMIATI NA MPANGILIO`],
    KISWAHILI_HEADERS,
    ...lessons.map(([label, activity]) => [
      `${label} Wiki ${week}`,
      "1.1 Kuendeleza mazungumzo katika miktadha mbalimbali",
      activity,
      "DOK 1: Onyesha jinsi ya kuorodhesha maneno ya mpangilio",
      "Anajua: • SWK kwamba… Stadi: • Tambua…",
      "Swali Kuu la Tathmini: … Tikiti ya Kutoka: Sw1 …",
      "Swali Elekezi: … Mimi (dk 8) … Sote (dk 8) … Wewe …",
      "• “Kuna jibu moja tu” — mara nyingi kuna njia kadhaa sahihi.",
      "Utofautishaji wa maudhui (ngazi 3): …",
      "Kitabu cha Mwanafunzi; ubao; madaftari",
      "Ni wanafunzi gani waliweza …",
    ]),
  ];
}

describe("parseTitleLine", () => {
  it("reads grade, subject, term and week from a STANDARD week title", () => {
    expect(
      parseTitleLine("SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS TERM 1A | WEEK 3: ROMAN NUMERALS"),
    ).toEqual({ grade: "Grade 4", subject: "Mathematics", term: "1A", week: 3 });
  });

  it("reads grade and subject from a 'Schemes of Work' document heading", () => {
    expect(parseTitleLine("Grade 4 Science Schemes of Work 2026")).toEqual({
      grade: "Grade 4",
      subject: "Science",
    });
  });

  it("title-cases a multi-word subject and keeps small words lower", () => {
    expect(parseTitleLine("GRADE 2 HEALTH AND ENVIRONMENT TERM 1B | WEEK 1").subject).toBe(
      "Health and Environment",
    );
  });

  it("never takes the grade digit as the week", () => {
    expect(parseTitleLine("SILVERLEAF ACADEMY — GRADE 4 MATHEMATICS").week).toBeUndefined();
  });

  it("reads a Kiswahili title with the subject before the class", () => {
    expect(
      parseTitleLine(
        "SILVERLEAF ACADEMY — KISWAHILI DARASA LA 5 MUHULA WA 1A | WIKI 2: MSAMIATI NA MPANGILIO (Vipindi 1–5)",
      ),
    ).toEqual({ grade: "Grade 5", subject: "Kiswahili", term: "1A", week: 2 });
  });

  it("reads a Kiswahili title with the subject between class and term, keeping an acronym", () => {
    expect(
      parseTitleLine("SILVERLEAF ACADEMY — DARASA LA 5 HTM MUHULA WA 2A | WIKI 1: MAFUNZO ELEKEZI"),
    ).toEqual({ grade: "Grade 5", subject: "HTM", term: "2A", week: 1 });
  });

  it("never takes the class digit as the week in a Kiswahili title", () => {
    expect(parseTitleLine("SILVERLEAF ACADEMY — KISWAHILI DARASA LA 5 MUHULA WA 1A").week).toBeUndefined();
  });
});

describe("splitLessonCell", () => {
  it("keeps the lesson code and strips the trailing week", () => {
    expect(splitLessonCell("1 (L001) Week 1")).toEqual({ lessonNumber: "1 (L001)", week: 1 });
    expect(splitLessonCell("BL1 (BL1) Week 1")).toEqual({ lessonNumber: "BL1 (BL1)", week: 1 });
    expect(splitLessonCell("57 (L057) Week 10")).toEqual({ lessonNumber: "57 (L057)", week: 10 });
  });

  it("strips a Kiswahili 'Wiki' week too", () => {
    expect(splitLessonCell("1 (L001) Wiki 2")).toEqual({ lessonNumber: "1 (L001)", week: 2 });
    expect(splitLessonCell("MT1 (MT1) Wiki 7")).toEqual({ lessonNumber: "MT1 (MT1)", week: 7 });
  });

  it("leaves a plain label alone", () => {
    expect(splitLessonCell("Baseline P1")).toEqual({ lessonNumber: "Baseline P1", week: undefined });
  });
});

describe("parseSowTables — STANDARD template", () => {
  it("classifies a titled week table as lessons, not as a metadata grid", () => {
    const parsed = parseSowTables([
      standardWeek(1, [["BL1 (BL1)", "How mathematics works in this room"]]),
      standardWeek(2, [["1 (L001)", "Meeting a new kind of number"], ["2 (L002)", "Building 1 to 10"]]),
    ]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map((r) => r.lessonNumber)).toEqual(["BL1 (BL1)", "1 (L001)", "2 (L002)"]);
    expect(parsed.rows.map((r) => r.week)).toEqual([1, 2, 2]);
    expect(parsed.stats).toEqual({ weekTablesKept: 2, weekTablesDropped: 0, parser: "rules" });
  });

  it("maps every one of the 11 columns", () => {
    const [row] = parseSowTables([standardWeek(1, [["BL1 (BL1)", "Slates and codes"]])]).rows;
    expect(row?.specificCompetence).toMatch(/concept of numbers/);
    expect(row?.mainActivity).toBe("Slates and codes");
    expect(row?.lessonObjective).toMatch(/^DOK 1/);
    expect(row?.knowledgeAndSkills).toMatch(/^Knows:/);
    expect(row?.assessmentEvidence).toMatch(/^Ultimate Assessment/);
    expect(row?.learningActivities).toMatch(/I Do/);
    expect(row?.misconceptions).toMatch(/finish first/);
    expect(row?.differentiationSupport).toMatch(/^For support/);
    expect(row?.resources).toMatch(/slates/);
    expect(row?.reflection).toMatch(/^Which learners/);
  });

  it("derives grade, subject and term from the week titles when there is no grid", () => {
    const { scheme } = parseSowTables([standardWeek(1, [["BL1 (BL1)", "x"]]), standardWeek(2, [["1 (L001)", "y"]])]);
    expect(scheme).toMatchObject({ grade: "Grade 4", subject: "Mathematics", term: "1A", weeksCount: 2 });
  });

  it("lets a metadata grid win over the week titles", () => {
    const grid = [["Grade", "3", "Subject", "Arithmetic", "Term", "2B"]];
    const { scheme } = parseSowTables([grid, standardWeek(1, [["1 (L001)", "x"]])]);
    expect(scheme).toMatchObject({ grade: "Grade 3", subject: "Arithmetic", term: "2B" });
  });

  it("falls back to heading hints outside the tables", () => {
    const grid = [
      ["Designer", "School", "Grade", "Subject", "Term", "Year"],
      ["", "", "", "", "1A", "2026"],
    ];
    const week = [
      ["Week 1:"],
      ["Lesson", "Specific Competence", "Main Activity", "Lesson Objective", "Sample Lesson activities", "Teaching and Learning Resources", "Remarks"],
      ["1", "1.1 Fungi", "Athlete's foot", "Describe athlete's foot", "Introduction: …", "Textbook", ""],
    ];
    const { scheme } = parseSowTables([grid, week], {
      titleHints: ["Grade 4 Science Schemes of Work 2026"],
    });
    expect(scheme).toMatchObject({ grade: "Grade 4", subject: "Science", term: "1A", year: "2026" });
  });
});

describe("parseSowTables — Kiswahili STANDARD template", () => {
  it("reads lessons, weeks and scheme metadata from Kiswahili week tables", () => {
    const parsed = parseSowTables([
      kiswahiliWeek(1, [["BL1 (BL1)", "Marudio kabla ya tathmini"]]),
      kiswahiliWeek(2, [["1 (L001)", "Msamiati na Mpangilio"], ["2 (L002)", "Kusimulia Hadithi"]]),
    ]);
    expect(parsed.rows.map((r) => r.lessonNumber)).toEqual(["BL1 (BL1)", "1 (L001)", "2 (L002)"]);
    expect(parsed.rows.map((r) => r.week)).toEqual([1, 2, 2]);
    expect(parsed.scheme).toMatchObject({ grade: "Grade 5", subject: "Kiswahili", term: "1A", weeksCount: 2 });
  });

  it("maps every one of the 11 columns, telling 'Shughuli ya' from 'Shughuli za'", () => {
    const [row] = parseSowTables([kiswahiliWeek(2, [["1 (L001)", "Msamiati na Mpangilio"]])]).rows;
    expect(row?.specificCompetence).toMatch(/^1\.1 Kuendeleza/);
    expect(row?.mainActivity).toBe("Msamiati na Mpangilio");
    expect(row?.lessonObjective).toMatch(/^DOK 1/);
    expect(row?.knowledgeAndSkills).toMatch(/^Anajua:/);
    expect(row?.assessmentEvidence).toMatch(/^Swali Kuu la Tathmini/);
    expect(row?.learningActivities).toMatch(/^Swali Elekezi/);
    expect(row?.misconceptions).toMatch(/jibu moja/);
    expect(row?.differentiationSupport).toMatch(/^Utofautishaji wa maudhui/);
    expect(row?.resources).toMatch(/^Kitabu cha Mwanafunzi/);
    expect(row?.reflection).toMatch(/^Ni wanafunzi/);
  });
});

describe("parseSowTables — metadata grid layouts", () => {
  it("zips a label row over a value row instead of pairing labels with labels", () => {
    const grid = [
      ["Designer", "School", "Grade", "Subject", "Term", "Year"],
      ["A. Teacher", "Silverleaf", "4", "Science", "1A", "2026"],
      ["Main Competencies", "1.0 Demonstrate mastery"],
    ];
    const { scheme } = parseSowTables([grid]);
    expect(scheme).toMatchObject({
      grade: "Grade 4",
      subject: "Science",
      term: "1A",
      year: "2026",
      mainCompetence: "1.0 Demonstrate mastery",
    });
  });
});

describe("parseSowTables — placeholder rows", () => {
  it("drops template leftovers that carry a single stray cell and no lesson label", () => {
    const week = [
      ["Week 1:"],
      ["Lesson", "Specific Competence", "Main Activity", "Lesson Objective", "Sample Lesson activities", "Teaching and Learning Resources", "Remarks"],
      ["", "Baseline Assessments", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["1", "4.1 Numbers", "Count", "Learner counts", "I do", "Counters", "ok"],
    ];
    const { rows } = parseSowTables([week]);
    expect(rows.map((r) => r.lessonNumber)).toEqual(["1"]);
  });

  it("keeps an unlabelled row that fills several columns", () => {
    const week = [
      ["Week 1:"],
      ["Lesson", "Specific Competence", "Main Activity", "Lesson Objective", "Sample Lesson activities"],
      ["", "4.1 Numbers", "Count", "Learner counts", "I do"],
    ];
    expect(parseSowTables([week]).rows).toHaveLength(1);
  });
});

describe("parseSowHtml — heading hints", () => {
  it("reads a document heading outside the tables for grade and subject", () => {
    const html =
      "<h1>Grade 4 Science Schemes of Work 2026</h1>" +
      htmlTable([
        ["Week 1:"],
        ["Lesson", "Specific Competence", "Main Activity", "Lesson Objective", "Sample Lesson activities"],
        ["1", "1.1 Fungi", "Athlete's foot", "Describe it", "Introduction"],
      ]);
    expect(parseSowHtml(html).scheme).toMatchObject({ grade: "Grade 4", subject: "Science" });
  });
});
