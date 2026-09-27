/**
 * Shared SOW upload encoding — turn a picked File into the `SowUploadInput`
 * the `previewSowUpload` / `createSchemeFromUpload` server actions accept.
 *
 * Used by both upload surfaces (the Studio's Scheme & Lesson panel and the
 * Schemes admin page) so the kind detection and the base64 encoding can
 * never drift between them.
 */
import type { SowUploadInput, SowUploadKind } from "@/lib/actions/schemes";

/** The file extensions an upload picker accepts, in `accept=` form. */
export const SOW_UPLOAD_ACCEPT = ".docx,.pdf,.csv,.txt,.md";

/** Read a File as base64 (data-URL body, prefix stripped). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip data-url prefix
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/**
 * Which kind a picked file is, by extension first and MIME type second
 * (browsers report `.docx` as an octet stream often enough that the name is
 * the reliable signal). Anything unrecognised is treated as a docx, the
 * historic default, so the server can still reject it with a clear error.
 */
export function sowUploadKind(file: File): SowUploadKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".csv") || file.type === "text/csv") return "csv";
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return "text";
  }
  return "docx";
}

/**
 * Encode an uploaded SOW file for the server actions: CSV and plain-text
 * files travel as text, binary files (docx, pdf) as base64 bytes.
 */
export async function fileToSowUploadInput(file: File): Promise<SowUploadInput> {
  const kind = sowUploadKind(file);
  if (kind === "csv" || kind === "text") {
    const text = await file.text();
    return { kind, text, filename: file.name };
  }
  const dataBase64 = await fileToBase64(file);
  return { kind, dataBase64, filename: file.name };
}
