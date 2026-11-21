import { randomUUID } from "node:crypto";

import { lt } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { batchSelections } from "@/lib/db/schema";

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
