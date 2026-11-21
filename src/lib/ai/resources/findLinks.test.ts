import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifyUrl, cleanCandidate, titleFromUrl } from "./findLinks";

describe("resource link filtering", () => {
  it("classifies videos, images and pages", () => {
    expect(classifyUrl(new URL("https://www.youtube.com/watch?v=abc"))).toBe("video");
    expect(classifyUrl(new URL("https://youtu.be/abc"))).toBe("video");
    expect(classifyUrl(new URL("https://upload.wikimedia.org/a/b/c.jpg"))).toBe("image");
    expect(classifyUrl(new URL("https://example.org/lesson"))).toBe("page");
  });

  it("keeps only plain https links to real hosts", () => {
    const ok = (url: string) => cleanCandidate({ url, title: "t" }) !== null;
    expect(ok("https://example.org/a#frag")).toBe(true);
    expect(ok("http://example.org/a")).toBe(false);
    expect(ok("https://user:pw@example.org/a")).toBe(false);
    expect(ok("https://localhost/a")).toBe(false);
    expect(ok("https://127.0.0.1/a")).toBe(false);
    expect(ok("not a url")).toBe(false);
  });
});

describe("titles from addresses", () => {
  it("rebuilds a readable title from a Khan Academy address", () => {
    const u = new URL(
      "https://www.khanacademy.org/math/grade-3-tx-teks/x41fbdd6301d5fded:writing-whole-numbers/e/write-whole-numbers-to-100-000-in-expanded-form",
    );
    expect(titleFromUrl(u)).toBe("Write whole numbers to 100 000 in expanded form");
    const colon = new URL("https://www.khanacademy.org/math/c/x0fc7:place-value-expanded-form");
    expect(titleFromUrl(colon)).toBe("Place value expanded form");
  });

  it("replaces a bot-challenge title but keeps a real one", () => {
    const url = "https://www.khanacademy.org/math/x/e/fractions-on-a-number-line";
    expect(cleanCandidate({ url, title: "Client Challenge" })?.title).toBe("Fractions on a number line");
    expect(cleanCandidate({ url, title: "Fractions practice" })?.title).toBe("Fractions practice");
  });
});
