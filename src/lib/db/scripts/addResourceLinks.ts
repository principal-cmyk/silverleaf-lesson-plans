/**
 * addResourceLinks.ts — one-off backfill of verified web links onto plans that
 * were saved before `resource_links` existed (new generations get them in
 * `savePlanStructured`).
 *
 * For each plan whose `content_json` parses and has no links yet, it runs the
 * same search + URL check as generation (`findResourceLinks`), then rewrites
 * `content_json`, the rendered markdown and the search text. A saved slide deck
 * that was fresh stays fresh (its source hash is moved to the new content), so
 * no deck is regenerated; the deck shows the links from the plan at render time.
 *
 * Needs OPENROUTER_API_KEY (one web-search call per plan). Idempotent: plans
 * that already have links are skipped. Report-only by default; `--apply`
 * writes. `--limit N` caps how many plans are searched in one run;
 * `--only A,B` restricts to filenames starting with any of those prefixes;
 * `--concurrency N` works on N plans at once (default 1); `--refresh`
 * re-searches plans that already have links (after the search rules change). Like every
 * db:* script, STOP the app first (PGlite is single-connection):
 *
 *   npm run db:run -- ./src/lib/db/scripts/addResourceLinks.ts                # list
 *   npm run db:run -- ./src/lib/db/scripts/addResourceLinks.ts --apply        # write
 *   npm run db:run -- ./src/lib/db/scripts/addResourceLinks.ts --apply --limit 3
 */
import { and, eq } from "drizzle-orm";

import { renderLessonMarkdown } from "@/lib/ai/lessonPlan/renderMarkdown";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { hasApiKey } from "@/lib/ai/model";
import { findResourceLinks } from "@/lib/ai/resources/findLinks";
import { buildSearchText } from "@/lib/lesson/searchText";
import { contentHash } from "@/lib/slides/store";

import { db } from "../client";
import { lessonPlans, lessonSlideDecks } from "../schema";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const refresh = process.argv.includes("--refresh");
const onlyArg = process.argv.indexOf("--only");
/** `--only A,B` — filenames starting with any of these prefixes. */
const only = onlyArg >= 0 ? (process.argv[onlyArg + 1] ?? "").split(",").filter(Boolean) : [];
const concArg = process.argv.indexOf("--concurrency");
const concurrency = Math.max(1, concArg >= 0 ? Number(process.argv[concArg + 1]) || 1 : 1);
const log = (msg: string) => console.log(`[add-links] ${msg}`);

if (apply && !hasApiKey()) {
  log("OPENROUTER_API_KEY is not set — nothing can be searched.");
  process.exit(1);
}

const plans = await db.select().from(lessonPlans);

// Plans that need work, in database order.
const queue = plans.filter((plan) => {
  const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
  if (!structured.success) return false;
  if (only.length > 0 && !only.some((p) => plan.filename.startsWith(p))) return false;
  // Default: only plans without links. --refresh: redo the ones that have them.
  const hasLinks = (structured.data.resource_links?.length ?? 0) > 0;
  return hasLinks === refresh;
});
const todo = queue.length;
let done = 0;
let empty = 0;
let finished = 0;

async function addLinksTo(plan: (typeof plans)[number]): Promise<void> {
  const structured = structuredLessonPlanSchema.parse(plan.contentJson);
  const links = await findResourceLinks(structured);
  finished += 1;
  const progress = `${finished}/${Math.min(todo, limit)}`;
  if (links.length === 0 && !refresh) {
    empty += 1;
    log(`[${progress}] ${plan.filename}: no verified links found — left as is`);
    return;
  }

  // A refresh that finds nothing relevant clears the old links rather than keeping them.
  const contentJson = { ...structured, resource_links: links.length > 0 ? links : undefined };
  const contentMarkdown = renderLessonMarkdown(contentJson);
  const searchText = buildSearchText({
    subject: plan.subject,
    grade: plan.grade,
    term: plan.term,
    title: plan.title,
    topic: plan.topic,
    objectives: plan.objectives ?? [],
    contentMarkdown,
  });
  const oldHash = contentHash(plan.contentJson);

  await db.transaction(async (tx) => {
    await tx
      .update(lessonPlans)
      .set({ contentJson, contentMarkdown, searchText })
      .where(eq(lessonPlans.id, plan.id));
    // The deck does not embed the links, so a fresh deck stays fresh.
    await tx
      .update(lessonSlideDecks)
      .set({ sourceHash: contentHash(contentJson) })
      .where(and(eq(lessonSlideDecks.planId, plan.id), eq(lessonSlideDecks.sourceHash, oldHash)));
  });
  done += 1;
  log(
    `[${progress}] ${plan.filename}: ${links.length > 0 ? `set ${links.length} link(s)` : "cleared old links, none relevant"}`,
  );
}

if (!apply) {
  for (const plan of queue) log(`needs links: ${plan.filename} (${plan.status})`);
} else {
  const work = queue.slice(0, limit);
  let next = 0;
  // N workers pull from the same queue; one plan failing never stops the rest.
  await Promise.all(
    Array.from({ length: Math.min(concurrency, work.length) }, async () => {
      while (next < work.length) {
        const plan = work[next++]!;
        try {
          await addLinksTo(plan);
        } catch (err) {
          finished += 1;
          log(`${plan.filename}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }),
  );
}

log(
  apply
    ? `done — ${done} updated, ${empty} without links, ${Math.max(0, todo - finished)} not searched`
    : `${todo} plan(s) need links — re-run with --apply to search and write`,
);
process.exit(0);
