/**
 * Slide decks — the pure parts: deck → slides, the no-AI fallback deck, the
 * timeline, the language guess and the generation prompt.
 */
import { describe, expect, it } from "vitest";

import { DECK } from "../../../test/fixtures/slideDeck";
import { VALID_PLAN } from "../../../test/fixtures/structuredPlan";
import { SAMPLE_PLANS } from "@/lib/db/scripts/sampleLessonPlans";
import type { StructuredLessonPlan } from "@/lib/ai/lessonPlan/structuredSchema";

import { buildSlidesPrompt } from "./buildPrompt";
import { slideDeckSchema } from "./deckSchema";
import { deckToSlides, MAX_LIST_ITEMS, scriptAt, teacherExtras } from "./deckToSlides";
import { defaultTimings, fallbackDeck, planLanguage, sentences } from "./fallbackDeck";
import { DECK_LABELS } from "./labels";

/** VALID_PLAN with its teaching text in Kiswahili. */
const KISWAHILI_PLAN: StructuredLessonPlan = {
  ...VALID_PLAN,
  teaching_sequence: {
    introduction_hook: {
      ...VALID_PLAN.teaching_sequence.introduction_hook,
      text: "Mwalimu anauliza wanafunzi kuhusu vitendawili na kisha anasikiliza majibu ya wanafunzi.",
    },
    i_do: {
      ...VALID_PLAN.teaching_sequence.i_do,
      text: "Mwalimu anaandika ubaoni maneno ya mpangilio. Kisha anatumia maneno hayo katika sentensi.",
    },
    we_do: { ...VALID_PLAN.teaching_sequence.we_do, text: "Darasa linafanya zoezi la pamoja kwa jozi na kusahihishana." },
    you_do: { ...VALID_PLAN.teaching_sequence.you_do, text: "Kila mwanafunzi anaandika sentensi tano kwenye daftari lake." },
  },
};

describe("slideDeckSchema", () => {
  it("accepts the fixture deck", () => {
    expect(slideDeckSchema.safeParse(DECK).success).toBe(true);
  });

  it("rejects a deck saved in the old (pre-timeline) shape, so it is rebuilt", () => {
    const old = { language: "en", checkpoint_heading: "Check", title: { heading: "x", subheading: "", notes: "" } };
    expect(slideDeckSchema.safeParse(old).success).toBe(false);
  });
});

describe("deckToSlides", () => {
  it("walks the lesson in order: get ready → hook → new learning → practice → on your own → exit → close", () => {
    expect(deckToSlides(DECK).map((s) => s.kind)).toEqual([
      "title",
      "getReady",
      "hook",
      "keyWords",
      "points",
      "example",
      "checkpoint",
      "round",
      "round",
      "checkpoint",
      "exercise",
      "exit",
      "close",
    ]);
  });

  it("carries each phase's minutes, and times the timed activities", () => {
    const slides = deckToSlides(DECK);
    expect(slides[0]!.time).toBeNull();
    expect(slides[2]).toMatchObject({ phase: "hook", time: { start: 2, end: 7 }, timer: 5 });
    expect(slides[7]).toMatchObject({ phase: "weDo", time: { start: 17, end: 27 }, timer: 5 });
    expect(slides[10]).toMatchObject({ phase: "youDo", time: { start: 27, end: 35 }, timer: 8 });
  });

  it("reveals list items and worked-example steps one per click, then the book note", () => {
    const slides = deckToSlides(DECK);
    expect(slides[4]).toMatchObject({ kind: "points", steps: 2 }); // 3 points: first shown
    expect(slides[5]).toMatchObject({ kind: "example", steps: 4 }); // 3 steps + book note
  });

  it("reveals practice answers one per click, counting only answered questions", () => {
    const round = deckToSlides(DECK)[7];
    expect(round).toMatchObject({ kind: "round", steps: 2 }); // one question is open
  });

  it("switches to the marking script once the exercise answers are shown", () => {
    const exercise = deckToSlides(DECK)[10]!;
    expect(scriptAt(exercise, 0)[0]!.text).toBe("Work quietly.");
    expect(scriptAt(exercise, 1)[0]!.text).toBe("Swap books and tick.");
  });

  it("skips the key-words slide when the lesson has no new words", () => {
    const noWords = { ...DECK, i_do: { ...DECK.i_do, key_words: [], key_words_script: [] } };
    expect(deckToSlides(noWords).map((s) => s.kind)).not.toContain("keyWords");
  });

  it("trims lists longer than a slide can hold", () => {
    const long = {
      ...DECK,
      i_do: { ...DECK.i_do, teaching_points: Array.from({ length: 10 }, (_, i) => `Point ${i}`) },
    };
    const points = deckToSlides(long).find((s) => s.kind === "points");
    expect(points?.kind === "points" && points.points).toHaveLength(MAX_LIST_ITEMS);
  });

  it("puts the plan's teacher-only extras on the slides that need them", () => {
    const slides = deckToSlides(DECK);
    expect(slides[5]!.extras).toEqual(["misconceptions"]);
    expect(slides[10]!.extras).toEqual(["differentiation"]);
    const extras = teacherExtras(VALID_PLAN);
    expect(extras.misconceptions.length).toBe(VALID_PLAN.misconceptions.length);
  });
});

describe("defaultTimings", () => {
  it("lays a 40-minute lesson on the standard timeline", () => {
    expect(defaultTimings(40)).toEqual({
      get_ready: { start_minute: 0, end_minute: 2 },
      hook: { start_minute: 2, end_minute: 7 },
      i_do: { start_minute: 7, end_minute: 17 },
      we_do: { start_minute: 17, end_minute: 27 },
      you_do: { start_minute: 27, end_minute: 35 },
      exit_ticket: { start_minute: 35, end_minute: 38 },
      close: { start_minute: 38, end_minute: 40 },
    });
  });

  it("scales to other lesson lengths with no gaps", () => {
    for (const minutes of [30, 45, 60]) {
      const phases = Object.values(defaultTimings(minutes));
      expect(phases[0]!.start_minute).toBe(0);
      expect(phases.at(-1)!.end_minute).toBe(minutes);
      phases.slice(1).forEach((p, i) => expect(p.start_minute).toBe(phases[i]!.end_minute));
    }
  });
});

describe("fallbackDeck", () => {
  it("builds a valid deck from every seeded sample plan", () => {
    for (const sample of SAMPLE_PLANS) {
      const deck = fallbackDeck(sample.structured, sample.durationMinutes);
      expect(slideDeckSchema.safeParse(deck).success).toBe(true);
      expect(deck.close.end_minute).toBe(sample.durationMinutes);
    }
  });

  it("uses the plan's own text and invents no answers", () => {
    const deck = fallbackDeck(VALID_PLAN);
    expect(deck.title.heading).toBe(VALID_PLAN.identifier.title);
    expect(deck.close.self_check).toEqual(VALID_PLAN.success_criteria);
    expect(deck.i_do_checkpoint.answer).toBe("");
    expect(deck.you_do.questions.every((q) => q.answer === "")).toBe(true);
  });

  it("writes Kiswahili headings for a Kiswahili plan", () => {
    const deck = fallbackDeck(KISWAHILI_PLAN);
    expect(deck.language).toBe("sw");
    expect(deck.we_do.heading).toBe("Tufanye pamoja");
    expect(DECK_LABELS[deck.language].copyIntoBook).toBe("Nakili kwenye daftari lako");
  });
});

describe("planLanguage", () => {
  it("tells a Kiswahili plan from an English one by its teaching text", () => {
    expect(planLanguage(VALID_PLAN)).toBe("en");
    expect(planLanguage(KISWAHILI_PLAN)).toBe("sw");
  });
});

describe("sentences", () => {
  it("splits prose into sentences and starts a new one at a question marker", () => {
    expect(sentences("Show 10 pencils. Then show 1! Ask why? Q1: Circle many. Sw2: Taja moja.")).toEqual([
      "Show 10 pencils.",
      "Then show 1!",
      "Ask why?",
      "Q1: Circle many.",
      "Sw2: Taja moja.",
    ]);
  });

  it("does not split at a page reference", () => {
    expect(sentences("Read the story (uk. 8-11) aloud.")).toEqual(["Read the story (uk. 8-11) aloud."]);
  });
});

describe("buildSlidesPrompt", () => {
  it("hands the model the plan, its language and the lesson timeline", () => {
    const en = buildSlidesPrompt(VALID_PLAN, 40);
    expect(en.prompt).toContain('English (language: "en")');
    expect(en.prompt).toContain("lesson_minutes: 40");
    expect(en.prompt).toContain("hook 2–7");
    expect(en.prompt).toContain(VALID_PLAN.identifier.title);
    expect(en.system).toMatch(/the teacher says and does/i);
    expect(en.system).toMatch(/Every question has its correct answer/);
    expect(buildSlidesPrompt(KISWAHILI_PLAN, 30).prompt).toContain('Kiswahili (language: "sw")');
  });
});
