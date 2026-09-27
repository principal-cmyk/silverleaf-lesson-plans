import { describe, it, expect } from "vitest";

import { DEFAULT_CHUNK_CHARS, chunkSchemeText } from "./chunk";

/** A lesson block of `n` body lines, opened by a STANDARD-style label. */
function lesson(label: string, n: number): string {
  const body = Array.from({ length: n }, (_, i) => `line ${i} of ${label} with some text`);
  return [label, ...body].join("\n");
}

describe("chunkSchemeText", () => {
  it("returns nothing for blank text and one chunk when it fits", () => {
    expect(chunkSchemeText("   \n\n")).toEqual([]);
    expect(chunkSchemeText("Week 1\nLesson text", 100)).toEqual(["Week 1\nLesson text"]);
  });

  it("normalises CRLF line endings", () => {
    expect(chunkSchemeText("Week 1\r\nLesson text\r\n", 100)).toEqual(["Week 1\nLesson text"]);
  });

  it("cuts at the last lesson boundary before the limit", () => {
    const text = [lesson("1 (L001)", 4), lesson("2 (L002)", 4), lesson("3 (L003)", 4)].join("\n");
    const one = lesson("1 (L001)", 4).length;
    // Budget fits two lessons but not three, so the cut lands before the third.
    const chunks = chunkSchemeText(text, one * 2 + 40);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe([lesson("1 (L001)", 4), lesson("2 (L002)", 4)].join("\n"));
    expect(chunks[1]).toBe(lesson("3 (L003)", 4));
  });

  it("recognises week headings and bare lesson codes as boundaries", () => {
    const text = [lesson("Week 1", 3), lesson("BL1", 3), lesson("Week 2", 3)].join("\n");
    const one = lesson("Week 1", 3).length;
    const chunks = chunkSchemeText(text, one * 2 + 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.startsWith("Week 2")).toBe(true);
  });

  it("falls back to a blank line, then a newline, when there is no boundary", () => {
    const para = (k: string) => Array.from({ length: 3 }, () => `${k} prose line`).join("\n");
    const text = [para("aaaa"), "", para("bbbb"), "", para("cccc")].join("\n");
    const chunks = chunkSchemeText(text, para("aaaa").length * 2 + 4);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe([para("aaaa"), "", para("bbbb")].join("\n").trim());
    expect(chunks[1]).toBe(para("cccc"));

    const noBlank = ["one", "two", "three", "four"].join("\n");
    expect(chunkSchemeText(noBlank, 9)).toEqual(["one\ntwo", "three", "four"]);
  });

  it("emits a single over-long line on its own rather than dropping it", () => {
    const long = "x".repeat(50);
    expect(chunkSchemeText(`Week 1\n${long}\nWeek 2`, 20)).toEqual(["Week 1", long, "Week 2"]);
  });

  it("never loses text: the chunks re-join to the input", () => {
    const text = Array.from({ length: 40 }, (_, i) => lesson(`${i + 1} (L${String(i + 1).padStart(3, "0")})`, 6)).join("\n");
    const chunks = chunkSchemeText(text, 600);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(600);
    expect(chunks.join("\n")).toBe(text);
  });

  it("uses a default budget that keeps a request well inside a model context", () => {
    expect(DEFAULT_CHUNK_CHARS).toBeLessThanOrEqual(20_000);
  });
});
