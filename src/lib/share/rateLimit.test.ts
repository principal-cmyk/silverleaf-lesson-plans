import { describe, expect, it } from "vitest";

import { RateLimiter } from "./rateLimit";

describe("RateLimiter", () => {
  it("allows up to the maximum, then refuses until the window passes", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("a", 10)).toBe(true);
    expect(rl.take("a", 20)).toBe(false);
    expect(rl.take("b", 20)).toBe(true);
    expect(rl.take("a", 1001)).toBe(true);
  });
});
