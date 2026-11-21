import { describe, expect, it } from "vitest";

import { safeSegment, subjectFolder } from "./folderName";

describe("zip folder names", () => {
  it("makes subject names safe for a path", () => {
    expect(safeSegment("Social Studies")).toBe("Social_Studies");
    expect(safeSegment("Math / Science")).toBe("Math_Science");
    expect(safeSegment("///")).toBe("Subject");
  });

  it("uses a folder only when the batch holds more than one subject", () => {
    expect(subjectFolder("Math", ["Math", "Math"])).toBeUndefined();
    expect(subjectFolder("Social Studies", ["Math", "Social Studies"])).toBe("Social_Studies");
  });
});
