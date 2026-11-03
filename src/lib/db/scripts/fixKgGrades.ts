/**
 * fixKgGrades.ts — one-off repair for kindergarten records saved before
 * `src/lib/naming/grade.ts` existed.
 *
 * Until then every grade label was read as "its first digits", so a "KG1"
 * scheme was stored with grade_num 1 (Grade 1) and its generated plans were
 * filed as `G1_…` — sorted, filtered and named as Grade 1. This script:
 *
 *   1. schemes_of_work — re-reads each `grade` label; fixes `grade_num` and
 *      canonicalises the label ("kg 1" → "KG1").
 *   2. textbooks — same, for rows whose label names kindergarten.
 *   3. lesson_plans — every plan generated from a KG scheme (via
 *      scheme_lesson_id) whose grade disagrees with its scheme gets the KG
 *      token, grade_num, filename and slug (`KG1_…`, `kg1-…`), plus its
 *      identifier, rendered markdown and search text rebuilt to match. The
 *      slug change moves the plan's URL; ids — and so feedback, slide decks
 *      and usage logs — are untouched.
 *
 * Idempotent: a second run finds nothing to change. Dry run by default; pass
 * `--apply` to write. Like every db:* script, STOP the app first (PGlite is
 * single-connection):
 *
 *   npm run db:run -- ./src/lib/db/scripts/fixKgGrades.ts            # report
 *   npm run db:run -- ./src/lib/db/scripts/fixKgGrades.ts --apply    # write
 */
import { eq } from "drizzle-orm";

import { applyKnownIdentifier } from "@/lib/ai/lessonPlan/identifier";
import { renderLessonMarkdown } from "@/lib/ai/lessonPlan/renderMarkdown";
import { structuredLessonPlanSchema } from "@/lib/ai/lessonPlan/structuredSchema";
import { buildSearchText } from "@/lib/lesson/searchText";
import { buildFilename } from "@/lib/naming/format";
import { gradeLabel, gradeToken, parseGradeNum } from "@/lib/naming/grade";
import { parse } from "@/lib/naming/parse";

import { db } from "../client";
import { lessonPlans, schemesOfWork, sowLessons, textbooks } from "../schema";

const apply = process.argv.includes("--apply");
const log = (msg: string) => console.log(`[fix-kg] ${msg}`);

async function fixSchemes(): Promise<void> {
  const rows = await db.select().from(schemesOfWork);
  for (const s of rows) {
    const n = parseGradeNum(s.grade);
    if (n == null) {
      log(`scheme "${s.title}": grade "${s.grade}" unreadable — left as is`);
      continue;
    }
    const label = gradeLabel(n);
    if (n === s.gradeNum && label === s.grade) continue;
    log(`scheme "${s.title}": ${s.grade}/${s.gradeNum} → ${label}/${n}`);
    if (apply) {
      await db
        .update(schemesOfWork)
        .set({ grade: label, gradeNum: n })
        .where(eq(schemesOfWork.id, s.id));
    }
  }
}

async function fixTextbooks(): Promise<void> {
  const rows = await db.select().from(textbooks);
  for (const b of rows) {
    const n = parseGradeNum(b.grade ?? "");
    // Only kindergarten was misread; leave primary grades exactly as stored.
    if (n == null || n > 0 || n === b.gradeNum) continue;
    log(`textbook "${b.title}": ${b.grade}/${b.gradeNum} → ${gradeLabel(n)}/${n}`);
    if (apply) {
      await db
        .update(textbooks)
        .set({ grade: gradeLabel(n), gradeNum: n })
        .where(eq(textbooks.id, b.id));
    }
  }
}

async function slugTaken(slug: string, exceptId: string): Promise<boolean> {
  const hit = await db
    .select({ id: lessonPlans.id })
    .from(lessonPlans)
    .where(eq(lessonPlans.slug, slug))
    .limit(1);
  return hit.length > 0 && hit[0]!.id !== exceptId;
}

async function fixPlans(): Promise<void> {
  // Re-read schemes so a dry run still sees each scheme's corrected grade.
  const plans = await db
    .select({ plan: lessonPlans, schemeGrade: schemesOfWork.grade })
    .from(lessonPlans)
    .innerJoin(sowLessons, eq(sowLessons.id, lessonPlans.schemeLessonId))
    .innerJoin(schemesOfWork, eq(schemesOfWork.id, sowLessons.schemeId));

  for (const { plan, schemeGrade } of plans) {
    const n = parseGradeNum(schemeGrade);
    if (n == null || n > 0) continue; // only KG plans were misfiled
    const token = gradeToken(n);
    if (plan.grade === token && plan.gradeNum === n) continue;

    const filename = buildFilename({
      grade: n,
      subject: plan.subject,
      term: plan.term,
      week: plan.week,
      lesson: plan.lesson,
    });
    const parsed = parse(filename);
    if (!parsed.ok) {
      log(`plan ${plan.slug}: cannot rename (${parsed.reason}) — skipped`);
      continue;
    }
    let slug = parsed.value.slug;
    for (let i = 2; await slugTaken(slug, plan.id); i += 1) {
      slug = `${parsed.value.slug}-${i}`;
    }

    // Keep the stored document consistent with the new coordinates.
    const structured = structuredLessonPlanSchema.safeParse(plan.contentJson);
    const contentJson = structured.success
      ? applyKnownIdentifier(structured.data, {
          grade: token,
          subject: plan.subject,
          term: plan.term,
          week: plan.week,
          lesson: plan.lesson,
        })
      : plan.contentJson;
    const contentMarkdown = structured.success
      ? renderLessonMarkdown(contentJson as typeof structured.data)
      : plan.contentMarkdown;
    const searchText = buildSearchText({
      subject: plan.subject,
      grade: token,
      term: plan.term,
      title: plan.title,
      topic: plan.topic,
      objectives: plan.objectives ?? [],
      contentMarkdown,
    });

    log(`plan ${plan.filename} → ${filename} (slug ${plan.slug} → ${slug})`);
    if (apply) {
      await db
        .update(lessonPlans)
        .set({ grade: token, gradeNum: n, filename, slug, contentJson, contentMarkdown, searchText })
        .where(eq(lessonPlans.id, plan.id));
    }
  }
}

await fixSchemes();
await fixTextbooks();
await fixPlans();
log(apply ? "done (changes written)" : "dry run — re-run with --apply to write");
process.exit(0);
