import { describe, expect, it } from "vitest";

import { accessToken, isTunnelRequest, safeEqual } from "./accessGate";

describe("accessGate", () => {
  it("treats only cloudflare-forwarded requests as tunnel traffic", () => {
    expect(isTunnelRequest(new Headers({ "cf-connecting-ip": "1.2.3.4" }))).toBe(true);
    expect(isTunnelRequest(new Headers())).toBe(false);
  });

  it("compares strings exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("derives a token that changes with the code and the secret", async () => {
    const a = await accessToken("code", "secret");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await accessToken("code", "secret")).toBe(a);
    expect(await accessToken("other", "secret")).not.toBe(a);
    expect(await accessToken("code", "other")).not.toBe(a);
  });
});

import { gatePageHtml, safeNext } from "./accessGate";

describe("safeNext", () => {
  it("keeps same-site paths and rejects anything else", () => {
    expect(safeNext("/en/plans/abc?x=1")).toBe("/en/plans/abc?x=1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("/__access")).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("escapes the destination in the form", () => {
    expect(gatePageHtml(false, '/a"><script>')).not.toContain("<script>");
  });
});
