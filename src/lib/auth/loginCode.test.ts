import { beforeEach, describe, expect, it } from "vitest";

import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_PER_HOUR,
  RESEND_GAP_MS,
  consumeLoginCode,
  discardLoginCode,
  issueLoginCode,
  resetLoginCodes,
} from "./loginCode";

const SECRET = "test-secret";
const EMAIL = "teacher@silverleaf.co.tz";

function issue(now = 1_000_000) {
  const r = issueLoginCode(EMAIL, SECRET, now);
  if (!r.ok) throw new Error(r.reason);
  return r.code;
}

describe("login codes", () => {
  beforeEach(resetLoginCodes);

  it("accepts the right code once", () => {
    const code = issue();
    expect(code).toMatch(/^\d{6}$/);
    expect(consumeLoginCode(EMAIL, code, SECRET, 1_000_001)).toBe(true);
    expect(consumeLoginCode(EMAIL, code, SECRET, 1_000_002)).toBe(false);
  });

  it("accepts the code typed with spaces", () => {
    const code = issue();
    expect(consumeLoginCode(EMAIL, `${code.slice(0, 3)} ${code.slice(3)}`, SECRET, 1_000_001)).toBe(true);
  });

  it("rejects a code for another address or secret", () => {
    const code = issue();
    expect(consumeLoginCode("other@silverleaf.co.tz", code, SECRET, 1_000_001)).toBe(false);
    expect(consumeLoginCode(EMAIL, code, "different", 1_000_001)).toBe(false);
  });

  it("expires after ten minutes", () => {
    const code = issue(1_000_000);
    expect(consumeLoginCode(EMAIL, code, SECRET, 1_000_000 + CODE_TTL_MS + 1)).toBe(false);
  });

  it("locks the code after too many wrong tries", () => {
    const code = issue();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect(consumeLoginCode(EMAIL, wrong, SECRET, 1_000_001)).toBe(false);
    expect(consumeLoginCode(EMAIL, code, SECRET, 1_000_002)).toBe(false);
  });

  it("limits how often a code can be asked for", () => {
    issue(1_000_000);
    expect(issueLoginCode(EMAIL, SECRET, 1_000_000 + RESEND_GAP_MS - 1)).toEqual({ ok: false, reason: "too-soon" });
    let t = 1_000_000;
    for (let i = 1; i < MAX_PER_HOUR; i++) {
      t += RESEND_GAP_MS + 1;
      expect(issueLoginCode(EMAIL, SECRET, t).ok).toBe(true);
    }
    expect(issueLoginCode(EMAIL, SECRET, t + RESEND_GAP_MS + 1)).toEqual({ ok: false, reason: "too-many" });
  });

  it("a discarded code can be re-requested at once", () => {
    issue();
    discardLoginCode(EMAIL);
    expect(issueLoginCode(EMAIL, SECRET, 1_000_001).ok).toBe(true);
  });
});
