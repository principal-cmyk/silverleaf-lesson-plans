import { randomUUID } from "node:crypto";

import { lt } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { batchSelections, lessonPlans } from "@/lib/db/schema";
import { TERM_ORDINAL } from "@/lib/naming/constants";

import { resolveBatchIds, saveSelection } from "./batchSelection";

describe("batch selections", () => {
  it("round-trips a selection far bigger than fits in a URL, in order", async () => {
    const ids = Array.from({ length: 3000 }, () => randomUUID());
    const sel = await saveSelection(ids, null);
    expect(await resolveBatchIds({ sel })).toEqual(ids);
  });

  it("still reads the older ?ids= list", async () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(await resolveBatchIds({ ids: `${a},${b},nonsense` })).toEqual([a, b]);
  });

  it("names a grade and term by the list's own filters", async () => {
    const mk = (n: number, grade: string, gradeNum: number, ord: number) => ({
      slug: `batch-sel-${n}-${randomUUID()}`,
      filename: `${grade}_BatchSel_T1a_W1_L${n}`,
      title: `t${n}`,
      grade,
      gradeNum,
      subject: "BatchSel",
      term: "1a",
      termOrdinal: ord,
      week: 1,
      lesson: n,
      status: "published" as const,
      contentJson: {},
      contentMarkdown: "",
      searchText: "",
    });
    const rows = [];
    for (const v of [mk(1, "G3", 3, TERM_ORDINAL["1a"]), mk(2, "G3", 3, TERM_ORDINAL["1a"]), mk(3, "G4", 4, TERM_ORDINAL["1a"])]) {
      rows.push(...(await db.insert(lessonPlans).values(v).returning()));
    }
    const g3 = rows.filter((r) => r.grade === "G3").map((r) => r.id);
    expect((await resolveBatchIds({ grade: "G3", term: "1a", subject: "BatchSel" })).sort()).toEqual(g3.sort());
  });

  it("answers an unknown or malformed selection with nothing", async () => {
    expect(await resolveBatchIds({ sel: randomUUID() })).toEqual([]);
    expect(await resolveBatchIds({ sel: "nope" })).toEqual([]);
    expect(await resolveBatchIds({})).toEqual([]);
  });

  it("sweeps selections older than a day when saving a new one", async () => {
    const old = await saveSelection([randomUUID()], null);
    await db
      .update(batchSelections)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    await saveSelection([randomUUID()], null);
    expect(await resolveBatchIds({ sel: old })).toEqual([]);
    expect(await db.select().from(batchSelections).where(lt(batchSelections.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))).toHaveLength(0);
  });
});
