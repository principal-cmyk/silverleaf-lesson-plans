import { describe, expect, it } from "vitest";

import { buildMessage } from "./smtp";

describe("buildMessage", () => {
  it("builds a base64 UTF-8 message with encoded subject", () => {
    const raw = buildMessage("Silverleaf <no-reply@silverleaf.co.tz>", {
      to: "teacher@silverleaf.co.tz",
      subject: "Code: 123456",
      text: "Nambari yako ni 123456",
    });
    expect(raw).toContain("To: teacher@silverleaf.co.tz");
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Code: 123456").toString("base64")}?=`);
    expect(raw).toContain("Content-Transfer-Encoding: base64");
    expect(raw).toContain(Buffer.from("Nambari yako ni 123456").toString("base64"));
    expect(raw).toMatch(/Message-ID: <[^@]+@silverleaf\.co\.tz>/);
  });
});
