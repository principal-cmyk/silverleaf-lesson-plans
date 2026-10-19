/**
 * Deck → .pptx: a real PowerPoint package with the lesson's slides in order,
 * the teacher strip on every slide, each reveal as a following answers slide,
 * and the script in the speaker notes.
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DECK } from "../../../test/fixtures/slideDeck";
import { VALID_PLAN } from "../../../test/fixtures/structuredPlan";

import type { SlideDeck } from "./deckSchema";
import { teacherExtras } from "./deckToSlides";
import { deckToPptx, fitFontSize } from "./pptx";

/** XML text with the five predefined entities decoded. */
const xmlText = (u8: Uint8Array) =>
  strFromU8(u8)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Slide XML texts in slide order, and the notes texts by slide number. */
async function open(deck: SlideDeck) {
  const buf = await deckToPptx(deck, teacherExtras(VALID_PLAN), { title: "Test" });
  const files = unzipSync(new Uint8Array(buf));
  const num = (name: string) => Number(name.match(/(\d+)\.xml$/)![1]);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => num(a) - num(b))
    .map((n) => xmlText(files[n]!));
  const notes = new Map(
    Object.keys(files)
      .filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
      .map((n) => [num(n), xmlText(files[n]!)]),
  );
  return { files, slides, notes };
}

describe("deckToPptx", () => {
  it("writes a PowerPoint package", async () => {
    const { files } = await open(DECK);
    expect(files["ppt/presentation.xml"]).toBeDefined();
    expect(files["[Content_Types].xml"]).toBeDefined();
  });

  it("lays out the lesson with an answers slide after every reveal", async () => {
    const { slides } = await open(DECK);
    // title, get ready, hook ×2, key words, points, example, ✔ ×2,
    // round 1 ×2, round 2 ×2, ✔ ×2, exercise ×2, exit ×2, close
    expect(slides).toHaveLength(20);
    expect(slides[1]).toContain("Copy into your book".toUpperCase());
    // The pupils' answer box (the teacher strip may already name the answer).
    expect(slides[2]).not.toContain("✓ The group of 10");
    expect(slides[3]).toContain("✓ The group of 10");
    expect(slides[9]).toContain("7 or 3?");
    expect(slides[9]).not.toContain("7 is many");
    expect(slides[10]).toContain("7 is many");
  });

  it("shows each phase's minutes and the teacher strip", async () => {
    const { slides } = await open(DECK);
    expect(slides[2]).toContain("2–7 min");
    expect(slides[2]).toContain("5 minutes");
    expect(slides[2]).toContain("Hold up 10 pencils and 1 pencil.");
    expect(slides[2]).toContain("EXPECT");
  });

  it("uses the marking script on the exercise answers slide", async () => {
    const { slides } = await open(DECK);
    const exercise = slides.findIndex((s) => s.includes("circle the MANY group"));
    expect(slides[exercise]).toContain("Work quietly.");
    expect(slides[exercise + 1]).toContain("Swap books and tick.");
  });

  it("puts the script, and the plan's misconceptions where they belong, in the notes", async () => {
    const { notes } = await open(DECK);
    expect(notes.get(1)).toContain("SAY: Welcome the class.");
    // The worked example (slide 7) carries the misconceptions.
    expect(notes.get(7)).toContain(VALID_PLAN.misconceptions[0]!.misconception);
  });

  it("uses Kiswahili labels for a Kiswahili deck", async () => {
    const { slides } = await open({ ...DECK, language: "sw" });
    expect(slides[1]).toContain("NAKILI KWENYE DAFTARI LAKO");
    expect(slides[2]).toContain("dakika 2–7");
    expect(slides[2]).toContain("TARAJIA");
  });
});

describe("fitFontSize", () => {
  it("keeps the largest size for text that fits, and shrinks longer text", () => {
    expect(fitFontSize(["Short line."], 10, 1.4, 14)).toBe(14);
    const long = Array.from({ length: 8 }, () => "A fairly long line of teacher script that wraps a little.");
    const size = fitFontSize(long, 5, 1.4, 14);
    expect(size).toBeLessThan(14);
    expect(size).toBeGreaterThanOrEqual(8);
  });

  it("never goes below the minimum", () => {
    expect(fitFontSize(Array.from({ length: 50 }, () => "x".repeat(200)), 2, 1, 14, 9)).toBe(9);
  });
});
