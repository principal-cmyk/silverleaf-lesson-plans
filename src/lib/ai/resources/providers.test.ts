import { describe, expect, it } from "vitest";

import { providerForHost, providersFor, isDocumentFile, leadProviders, scoreLink, teachingLanguage, tooAdvanced } from "./providers";

describe("provider selection", () => {
  it("picks age-appropriate providers", () => {
    const kg = providersFor(0, "Jolly Phonics").map((p) => p.hosts[0]);
    expect(kg).toContain("khankids.org");
    expect(kg).toContain("jollylearning.co.uk");
    expect(kg).not.toContain("khanacademy.org");

    const g5 = providersFor(5, "Mathematics").map((p) => p.hosts[0]);
    expect(g5).toContain("khanacademy.org");
    expect(g5).not.toContain("khankids.org");
    expect(g5).not.toContain("jollylearning.co.uk");
  });

  it("matches hosts by suffix only", () => {
    const suited = providersFor(5, "Mathematics");
    expect(providerForHost("www.khanacademy.org", suited)?.name).toBe("Khan Academy");
    expect(providerForHost("evilkhanacademy.org", suited)).toBeUndefined();
  });
});

describe("teaching language", () => {
  it("is English except for Kiswahili", () => {
    expect(teachingLanguage("Mathematics")).toBe("en");
    expect(teachingLanguage("Jolly Phonics")).toBe("en");
    expect(teachingLanguage("Kiswahili")).toBe("sw");
  });
});

describe("ranking", () => {
  const suited = providersFor(4, "Science");
  const rank = (
    host: string,
    title: string,
    kind: "video" | "page",
    language: "en" | "sw" = "en",
  ) => scoreLink({ host, title, url: `https://${host}/x`, kind }, suited, language);

  it("puts an English video above an English page", () => {
    expect(rank("youtube.com", "The water cycle", "video")).toBeGreaterThan(
      rank("example.org", "The water cycle", "page"),
    );
  });

  it("ranks Kiswahili material below English for an English lesson", () => {
    expect(rank("youtube.com", "Mzunguko wa maji — Kiswahili", "video")).toBeLessThan(
      rank("example.org", "The water cycle", "page"),
    );
  });

  it("prefers Kiswahili material for a Kiswahili lesson", () => {
    expect(rank("youtube.com", "Somo la Kiswahili", "video", "sw")).toBeGreaterThan(
      rank("youtube.com", "A lesson", "video", "sw"),
    );
  });

  it("puts a preferred-provider video above a random video", () => {
    expect(rank("khanacademy.org", "Plants", "video")).toBeGreaterThan(
      rank("youtube.com", "Plants", "video"),
    );
  });

  it("gives Tanzanian English material a smaller bonus", () => {
    expect(rank("youtube.com", "Plants in Tanzania", "video")).toBeGreaterThan(
      rank("youtube.com", "Plants", "video"),
    );
  });
});

describe("age guard", () => {
  it("keeps secondary notes off primary plans only", () => {
    expect(tooAdvanced("Road Safety Form One Notes", "https://x.tz/a", 4)).toBe(true);
    expect(tooAdvanced("Road Safety", "https://x.tz/form-two-notes", 6)).toBe(true);
    expect(tooAdvanced("Road Safety Form One Notes", "https://x.tz/a", 8)).toBe(false);
    expect(tooAdvanced("Safety signs for kids", "https://x.tz/a", 4)).toBe(false);
  });
});

describe("document files", () => {
  it("flags raw downloads but not pages", () => {
    expect(isDocumentFile("https://x.org/a/Words.docx")).toBe(true);
    expect(isDocumentFile("https://x.org/syllabus.PDF")).toBe(true);
    expect(isDocumentFile("https://x.org/lesson/fractions")).toBe(false);
    expect(isDocumentFile("https://www.youtube.com/watch?v=abc.pdf")).toBe(false);
  });
});

describe("lead providers", () => {
  it("names Khan Academy for primary maths and Khan Academy Kids for KG", () => {
    expect(leadProviders(providersFor(5, "Mathematics")).map((p) => p.name)).toContain("Khan Academy");
    expect(leadProviders(providersFor(0, "Numeracy Science and ICT")).map((p) => p.name)).toContain(
      "Khan Academy Kids",
    );
  });
  it("never returns more than the cap", () => {
    expect(leadProviders(providersFor(5, "Science"), 2).length).toBeLessThanOrEqual(2);
  });
});

describe("UK labels", () => {
  it("rank below the same link without one", () => {
    const suited = providersFor(5, "Mathematics");
    const r = (title: string) =>
      scoreLink({ host: "x.org", title, url: "https://x.org/a", kind: "page" }, suited);
    expect(r("Fractions - KS2 Maths")).toBeLessThan(r("Fractions"));
  });
});
