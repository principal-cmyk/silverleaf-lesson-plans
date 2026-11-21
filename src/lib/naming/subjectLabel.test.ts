import { describe, expect, it } from "vitest";

import { subjectLabel } from "./subjectLabel";

describe("subjectLabel", () => {
  it("splits a TitleCase token into words, lower-casing joining words", () => {
    expect(subjectLabel("HealthAndEnvironment")).toBe("Health and Environment");
    expect(subjectLabel("ListeningAndSpeaking")).toBe("Listening and Speaking");
    expect(subjectLabel("JollyPhonics")).toBe("Jolly Phonics");
  });

  it("keeps single words and acronyms as they are", () => {
    expect(subjectLabel("Mathematics")).toBe("Mathematics");
    expect(subjectLabel("HTM")).toBe("HTM");
    expect(subjectLabel("ICTSkills")).toBe("ICT Skills");
  });

  it("names known tokens explicitly, including imported typos", () => {
    expect(subjectLabel("EralyLifeSkills")).toBe("Early Life Skills");
    expect(subjectLabel("HistoriaYATanzaniaNAMaadili")).toBe("Historia ya Tanzania na Maadili");
    expect(subjectLabel("NumeracyScienceAndICT")).toBe("Numeracy, Science and ICT");
    expect(subjectLabel("Ict")).toBe("ICT");
  });
});
