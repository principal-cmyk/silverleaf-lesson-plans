/**
 * Grade levels — KG1/KG2 must never be read as Grade 1/2, and must sort first.
 */
import { describe, expect, it } from "vitest";

import { buildFilename } from "./format";
import {
  findGradeInText,
  gradeKey,
  gradeLabel,
  gradeToken,
  normalizeGradeLabel,
  parseGradeNum,
  SCHOOL_GRADE_NUMS,
} from "./grade";
import { parse } from "./parse";

describe("parseGradeNum", () => {
  it.each([
    ["KG1", -2],
    ["KG2", -1],
    ["kg 1", -2],
    ["K.G. 2", -1],
    ["KG-1", -2],
    ["Kindergarten 2", -1],
    ["Chekechea 1", -2],
    ["Awali 2", -1],
    ["Grade 1", 1],
    ["G4", 4],
    ["g12", 12],
    ["Standard 6", 6],
    ["Darasa la 3", 3],
    ["5", 5],
    [3, 3],
    [-2, -2],
  ] as const)("%s → %s", (raw, expected) => {
    expect(parseGradeNum(raw)).toBe(expected);
  });

  it.each(["", "Grade", "G0", "KG3", "2024", "Year 13", null, undefined, 0, -3])(
    "rejects %s",
    (raw) => {
      expect(parseGradeNum(raw as string)).toBeNull();
    },
  );
});

describe("grade forms", () => {
  it("token / label / key", () => {
    expect([-2, -1, 1, 6].map(gradeToken)).toEqual(["KG1", "KG2", "G1", "G6"]);
    expect([-2, -1, 1, 6].map(gradeLabel)).toEqual(["KG1", "KG2", "Grade 1", "Grade 6"]);
    expect([-2, 4].map(gradeKey)).toEqual(["kg1", "g4"]);
  });

  it("orders the school's grades KG1, KG2, Grade 1 … Grade 6", () => {
    expect([...SCHOOL_GRADE_NUMS].sort((a, b) => a - b).map(gradeLabel)).toEqual([
      "KG1", "KG2", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
    ]);
  });

  it("normalizeGradeLabel canonicalises and keeps unreadable text", () => {
    expect(normalizeGradeLabel("kg 2")).toBe("KG2");
    expect(normalizeGradeLabel("GRADE 4")).toBe("Grade 4");
    expect(normalizeGradeLabel("Pre-primary")).toBe("Pre-primary");
  });
});

describe("findGradeInText", () => {
  it("finds KG before any digit-only reading", () => {
    expect(findGradeInText("SILVERLEAF ACADEMY — KG1 MATHEMATICS TERM 1A")?.gradeNum).toBe(-2);
    expect(findGradeInText("SILVERLEAF ACADEMY — GRADE 4 SCIENCE")?.gradeNum).toBe(4);
  });

  it("does not read the kilogram unit as kindergarten", () => {
    expect(findGradeInText("Measure 1 kg 2 times")).toBeNull();
    expect(findGradeInText("Weigh 2.5 kg 1 bag")).toBeNull();
  });
});

describe("filename convention with KG", () => {
  it("round-trips KG1 / KG2 and keeps them distinct from G1 / G2", () => {
    const kg1 = buildFilename({ grade: -2, subject: "Literacy", term: "1a", week: 1, lesson: 1 });
    expect(kg1).toBe("KG1_Literacy_T1a_W1_L1");
    expect(buildFilename({ grade: "KG2", subject: "Literacy", term: "2b", week: 3, lesson: 2 }))
      .toBe("KG2_Literacy_T2b_W3_L2");

    const parsed = parse(kg1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.grade).toBe("KG1");
    expect(parsed.value.gradeNum).toBe(-2);
    expect(parsed.value.slug).toBe("kg1-literacy-t1a-w1-l1");

    const g1 = parse("G1_Literacy_T1a_W1_L1");
    expect(g1.ok && g1.value.slug).toBe("g1-literacy-t1a-w1-l1");
  });

  it("rejects grade tokens outside KG1–KG2 / G1–G12", () => {
    for (const bad of ["KG3_Math_T1a_W1_L1", "G0_Math_T1a_W1_L1", "G13_Math_T1a_W1_L1"]) {
      expect(parse(bad).ok, bad).toBe(false);
    }
  });

  it("buildFilename throws on an unreadable grade instead of writing GNaN", () => {
    expect(() =>
      buildFilename({ grade: "Grade", subject: "Math", term: "1a", week: 1, lesson: 1 }),
    ).toThrow(/not a valid grade/);
  });
});
