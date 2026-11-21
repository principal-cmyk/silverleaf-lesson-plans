/**
 * Download names for slide decks. Pure — shared by the .pptx route and the
 * bulk ZIP page so a single download and a ZIP entry are named alike.
 */

import { titledFilename } from "@/lib/naming/titled";

/** A plan's deck file, e.g. `G1_Arithmetic_T1a_W1_L1_Slides.pptx`. */
export function slidesFileName(planFilename: string, title?: string | null): string {
  return `${titledFilename(planFilename, title)}_Slides.pptx`;
}
