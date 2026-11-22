import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { SESSION_SECRET: "test-secret", NODE_ENV: "test" } }));

import { isSchoolEmail } from "@/lib/email";

import { decodeShareCookie, encodeShareCookie } from "./viewer";

describe("isSchoolEmail", () => {
  it("accepts Silverleaf addresses in any case", () => {
    expect(isSchoolEmail("Jane.Doe@silverleaf.co.tz")).toBe(true);
    expect(isSchoolEmail("  il@SILVERLEAF.CO.TZ ")).toBe(true);
  });
  it("rejects other and lookalike domains", () => {
    for (const e of ["a@gmail.com", "a@silverleaf.co.tz.evil.com", "a@evilsilverleaf.co.tz", "a@sub.silverleaf.co.tz", "silverleaf.co.tz", "a b@silverleaf.co.tz", ""]) {
      expect(isSchoolEmail(e)).toBe(false);
    }
  });
});

describe("share cookie", () => {
  it("round-trips a school email", () => {
    expect(decodeShareCookie(encodeShareCookie("t@silverleaf.co.tz"))).toBe("t@silverleaf.co.tz");
  });
  it("rejects tampering, junk and non-school emails", () => {
    const good = encodeShareCookie("t@silverleaf.co.tz");
    const forged = `${Buffer.from("x@gmail.com").toString("base64url")}.${good.split(".")[1]}`;
    expect(decodeShareCookie(forged)).toBeNull();
    expect(decodeShareCookie(encodeShareCookie("x@gmail.com"))).toBeNull();
    expect(decodeShareCookie("junk")).toBeNull();
    expect(decodeShareCookie("")).toBeNull();
  });
});
