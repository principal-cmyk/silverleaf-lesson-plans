import { describe, expect, it } from "vitest";

import {
  governmentFormsHref,
  MAX_FORMS_PER_PDF,
  parseGovernmentFormIds,
} from "./governmentForms";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parseGovernmentFormIds", () => {
  it("round-trips the ids the listing puts in the link", () => {
    const ids = [id(1), id(2), id(3)];
    const query = new URL(governmentFormsHref(ids), "http://x").searchParams.get("ids")!;
    expect(parseGovernmentFormIds(query)).toEqual(ids);
  });

  it("drops non-uuids and duplicates, and handles a missing param", () => {
    expect(parseGovernmentFormIds(`${id(1)},,nope,${id(1)}, ${id(2)} `)).toEqual([
      id(1),
      id(2),
    ]);
    expect(parseGovernmentFormIds(undefined)).toEqual([]);
  });

  it("caps a selection at one PDF's worth", () => {
    const many = Array.from({ length: MAX_FORMS_PER_PDF + 5 }, (_, i) => id(i));
    expect(parseGovernmentFormIds(many.join(","))).toHaveLength(MAX_FORMS_PER_PDF);
  });
});
