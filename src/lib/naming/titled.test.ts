import { describe, expect, it } from "vitest";
import { titledFilename, titleToken } from "./titled";

describe("titled filenames", () => {
  it("appends a safe title after the canonical name", () => {
    expect(titledFilename("G2_Health_T1a_W1_L1", "Living things: what's alive?")).toBe(
      "G2_Health_T1a_W1_L1_Living_things_what_s_alive",
    );
  });
  it("keeps the canonical name when there is no title", () => {
    expect(titledFilename("G2_Health_T1a_W1_L1", "")).toBe("G2_Health_T1a_W1_L1");
    expect(titledFilename("G2_Health_T1a_W1_L1", null)).toBe("G2_Health_T1a_W1_L1");
  });
  it("strips accents and cuts long titles at a word", () => {
    expect(titleToken("Mimea na wanyama wa shambani")).toBe("Mimea_na_wanyama_wa_shambani");
    expect(titleToken("Café")).toBe("Cafe");
    const long = titleToken("Counting 100 to 120 by grouping into hundreds, tens and ones and more words here");
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("_")).toBe(false);
  });
});
