import { describe, expect, it } from "vitest";

import {
  gradeCounts,
  isFiled,
  parseGradeParam,
  parseTermParam,
  resolveGradeTerm,
  termCounts,
} from "./gradeTerm";

const items = [
  { gradeNum: 4, termOrdinal: 1 },
  { gradeNum: 4, termOrdinal: 1 },
  { gradeNum: 4, termOrdinal: 3 },
  { gradeNum: -2, termOrdinal: 2 },
  { gradeNum: 7, termOrdinal: 4, count: 5 },
  { gradeNum: 0, termOrdinal: 1 }, // legacy unreadable grade
];

describe("URL params", () => {
  it("reads grade tokens and labels", () => {
    expect(parseGradeParam("KG1")).toBe(-2);
    expect(parseGradeParam("G4")).toBe(4);
    expect(parseGradeParam(["kg2"])).toBe(-1);
    expect(parseGradeParam("nope")).toBeNull();
    expect(parseGradeParam(undefined)).toBeNull();
  });

  it("reads term tokens in any common spelling", () => {
    expect(parseTermParam("1a")).toBe("1a");
    expect(parseTermParam("2B")).toBe("2b");
    expect(parseTermParam("T1b")).toBe("1b");
    expect(parseTermParam("Term 2a")).toBe("2a");
    expect(parseTermParam("3a")).toBeNull();
  });
});

describe("counts", () => {
  it("always lists KG1 … Grade 6, plus extra grades with items, KG first", () => {
    expect(gradeCounts(items)).toEqual([
      { gradeNum: -2, count: 1 },
      { gradeNum: -1, count: 0 },
      { gradeNum: 1, count: 0 },
      { gradeNum: 2, count: 0 },
      { gradeNum: 3, count: 0 },
      { gradeNum: 4, count: 3 },
      { gradeNum: 5, count: 0 },
      { gradeNum: 6, count: 0 },
      { gradeNum: 7, count: 5 },
    ]);
  });

  it("counts the four terms in order for one grade or all", () => {
    expect(termCounts(items, 4).map((t) => t.count)).toEqual([2, 0, 1, 0]);
    expect(termCounts(items, null).map((t) => t.term)).toEqual(["1a", "1b", "2a", "2b"]);
    expect(termCounts(items, null).map((t) => t.count)).toEqual([3, 1, 1, 5]);
  });

  it("flags items the navigation cannot place", () => {
    expect(isFiled({ gradeNum: 0, termOrdinal: 1 })).toBe(false);
    expect(isFiled({ gradeNum: 4, termOrdinal: 0 })).toBe(false);
    expect(isFiled({ gradeNum: -1, termOrdinal: 4 })).toBe(true);
  });
});

describe("resolveGradeTerm", () => {
  it("defaults to the first grade with items, then its first term with items", () => {
    expect(resolveGradeTerm(items, { grade: null, term: null })).toEqual({ grade: -2, term: "1b" });
  });

  it("keeps a valid request, even for an empty grade", () => {
    expect(resolveGradeTerm(items, { grade: 5, term: "2a" })).toEqual({ grade: 5, term: "2a" });
    expect(resolveGradeTerm(items, { grade: 4, term: null })).toEqual({ grade: 4, term: "1a" });
  });

  it("falls back to KG1 · Term 1A when nothing exists yet", () => {
    expect(resolveGradeTerm([], { grade: null, term: null })).toEqual({ grade: -2, term: "1a" });
  });
});
