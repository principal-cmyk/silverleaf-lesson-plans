/**
 * repairDeckText — fixes a near-miss deck's shape, never its content.
 */
import { describe, expect, it } from "vitest";

import { DECK } from "../../../test/fixtures/slideDeck";

import { slideDeckSchema } from "./deckSchema";
import { repairDeckText } from "./repair";

const repaired = (value: unknown) => JSON.parse(repairDeckText(JSON.stringify(value))!);

describe("repairDeckText", () => {
  it("leaves a valid deck exactly as it is", () => {
    expect(repaired(DECK)).toEqual(DECK);
  });

  it("fixes the slips models make on the deck's shape, so it validates", () => {
    const slipped = {
      ...DECK,
      language: "Kiswahili",
      lesson_minutes: "40",
      hook: { ...DECK.hook, sentence_frame: null, script: [{ kind: "SAY", text: "Habari." }] },
      i_do: { ...DECK.i_do, key_words: null, key_words_script: undefined },
      you_do: { ...DECK.you_do, challenge: { question: "Draw a FEW group" } },
      close: { ...DECK.close, homework: null },
    };
    expect(slideDeckSchema.safeParse(slipped).success).toBe(false);
    const fixed = repaired(slipped);
    expect(slideDeckSchema.safeParse(fixed).success).toBe(true);
    expect(fixed).toMatchObject({
      language: "sw",
      lesson_minutes: 40,
      hook: { sentence_frame: "", script: [{ kind: "say", text: "Habari." }] },
      i_do: { key_words: [], key_words_script: [] },
      you_do: { challenge: { question: "Draw a FEW group", answer: "" } },
      close: { homework: "" },
    });
  });

  it("unwraps a code fence around the JSON", () => {
    expect(JSON.parse(repairDeckText("```json\n" + JSON.stringify(DECK) + "\n```")!)).toEqual(DECK);
  });

  it("gives up (null) on text that is not JSON", () => {
    expect(repairDeckText("I cannot help with that.")).toBeNull();
  });
});
