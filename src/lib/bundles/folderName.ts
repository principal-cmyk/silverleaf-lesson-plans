/**
 * Folder names inside download ZIPs. Pure — shared by the server-built term
 * ZIP and the admin batch pages that build ZIPs in the browser.
 */

/** A folder/file-safe form of a subject name (`Social Studies` → `Social_Studies`). */
export function safeSegment(s: string): string {
  return s.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "") || "Subject";
}

/**
 * The subject folder for each plan of a batch — or none at all when the batch
 * is a single subject, where a lone folder would only be in the way.
 */
export function subjectFolder(subject: string, subjectsInBatch: Iterable<string>): string | undefined {
  return new Set(subjectsInBatch).size > 1 ? safeSegment(subject) : undefined;
}
