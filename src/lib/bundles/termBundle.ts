import "server-only";

/**
 * The term download — every published plan of one grade and term as a ZIP of
 * its lesson plans (the government form PDFs an admin prepared) and its
 * slides (.pptx, built here), laid out by subject.
 *
 * Two readers: the teachers' download page asks `termBundleIndex` what there
 * is, and `/api/bundles/term` streams `buildTermZip`. Published plans only,
 * for everyone — the bundle is what teachers get.
 */
import { and, asc, eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";

import { db } from "@/lib/db";
import { lessonPlans } from "@/lib/db/schema";
import { type Term, TERM_ORDINAL } from "@/lib/naming/constants";
import { gradeToken } from "@/lib/naming/grade";
import { planPptx } from "@/lib/slides/planPptx";
import { slidesFileName } from "@/lib/slides/fileName";

import { safeSegment } from "./folderName";
import { currentFormPdfIds, readCurrentFormPdf } from "./formPdfs";
import { titledFilename } from "@/lib/naming/titled";

export interface SubjectSummary {
  subject: string;
  /** Published plans in this grade, term and subject. */
  plans: number;
  /** Of those, plans whose government form PDF is prepared and current. */
  formsReady: number;
}

const publishedIn = (gradeNum: number, term: Term) =>
  and(
    eq(lessonPlans.gradeNum, gradeNum),
    eq(lessonPlans.termOrdinal, TERM_ORDINAL[term]),
    eq(lessonPlans.status, "published"),
  );

/** Per-subject counts for a grade and term, subjects A→Z. */
export async function termBundleIndex(gradeNum: number, term: Term): Promise<SubjectSummary[]> {
  const rows = await db
    .select({ id: lessonPlans.id, subject: lessonPlans.subject })
    .from(lessonPlans)
    .where(publishedIn(gradeNum, term))
    .orderBy(asc(lessonPlans.subject));
  const ready = await currentFormPdfIds(rows.map((r) => r.id));
  const bySubject = new Map<string, SubjectSummary>();
  for (const r of rows) {
    const s = bySubject.get(r.subject) ?? { subject: r.subject, plans: 0, formsReady: 0 };
    s.plans += 1;
    if (ready.has(r.id)) s.formsReady += 1;
    bySubject.set(r.subject, s);
  }
  return [...bySubject.values()];
}

/** Download name: `G2_Term1A_Math.zip`, or `G2_Term1A.zip` for every subject. */
export function termZipName(gradeNum: number, term: Term, subject?: string): string {
  const base = `${gradeToken(gradeNum)}_Term${term.toUpperCase()}`;
  return `${base}${subject ? `_${safeSegment(subject)}` : ""}.zip`;
}

export interface TermZip {
  name: string;
  data: Uint8Array;
  plans: number;
  /** Plans with no current form PDF yet (their slides are still included). */
  missingForms: number;
  /** Plans whose content could not be turned into slides. */
  missingSlides: number;
}

/** Build the ZIP, or null when the grade/term(/subject) has no published plan. */
export async function buildTermZip(
  gradeNum: number,
  term: Term,
  subject?: string,
): Promise<TermZip | null> {
  const rows = await db
    .select({
      id: lessonPlans.id,
      title: lessonPlans.title,
      filename: lessonPlans.filename,
      subject: lessonPlans.subject,
      contentJson: lessonPlans.contentJson,
      durationMinutes: lessonPlans.durationMinutes,
    })
    .from(lessonPlans)
    .where(
      subject
        ? and(publishedIn(gradeNum, term), eq(lessonPlans.subject, subject))
        : publishedIn(gradeNum, term),
    )
    .orderBy(
      asc(lessonPlans.subject),
      asc(lessonPlans.week),
      asc(lessonPlans.lesson),
    );
  if (rows.length === 0) return null;

  const subjects = new Set(rows.map((r) => r.subject));
  const files: Record<string, Uint8Array> = {};
  const notes: string[] = [];
  let missingForms = 0;
  let missingSlides = 0;

  // One at a time: a pptx is built in memory, and a grade is a few hundred.
  for (const row of rows) {
    const dir = subjects.size > 1 || !subject ? `${safeSegment(row.subject)}/` : "";
    const form = await readCurrentFormPdf(row.id, row.contentJson);
    if (form) files[`${dir}Lesson_Plans/${titledFilename(row.filename, row.title)}_Lesson_Plan.pdf`] = new Uint8Array(form);
    else {
      missingForms += 1;
      notes.push(`No lesson plan file yet: ${row.filename}`);
    }
    const slides = await planPptx(row);
    if (slides) files[`${dir}Slides/${slidesFileName(row.filename, row.title)}`] = new Uint8Array(slides.file);
    else {
      missingSlides += 1;
      notes.push(`No slides: ${row.filename}`);
    }
  }
  if (notes.length > 0) {
    files["README.txt"] = strToU8(
      `Some files are not in this ZIP yet:\n\n${notes.join("\n")}\n`,
    );
  }

  // PDFs and .pptx are already compressed, so the ZIP only stores them.
  const data = zipSync(files, { level: 0 });
  return { name: termZipName(gradeNum, term, subject), data, plans: rows.length, missingForms, missingSlides };
}
