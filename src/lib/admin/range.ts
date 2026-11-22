/** Date-range filter shared by the admin activity views (`?range=`). */
export const RANGE_OPTIONS = ["7", "14", "30", "90", "all"] as const;
export type RangeOption = (typeof RANGE_OPTIONS)[number];

export const DEFAULT_RANGE: RangeOption = "14";

export function parseRange(raw: string | string[] | undefined): RangeOption {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (RANGE_OPTIONS as readonly string[]).includes(v ?? "")
    ? (v as RangeOption)
    : DEFAULT_RANGE;
}

/** Days in the range, or null for "all time". */
export function rangeDays(r: RangeOption): number | null {
  return r === "all" ? null : Number(r);
}

/** Days to draw on the trend chart ("all" is capped at 90 bars). */
export function trendDays(r: RangeOption): number {
  return r === "all" ? 90 : Number(r);
}
