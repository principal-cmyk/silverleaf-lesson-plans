/**
 * A small in-memory limiter for the one costly thing a share link allows:
 * creating slides with the AI model. Per caller (IP) and per link, over a
 * rolling window. It resets when the server restarts — enough to stop a
 * leaked link or a script from running up the model bill, not a security
 * boundary.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Count this attempt. False once `key` has used up its allowance. */
  take(key: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

const HOUR = 60 * 60 * 1000;

/** 10 new decks per person per hour, 200 per link per day. */
export const perCallerLimit = new RateLimiter(10, HOUR);
export const perLinkLimit = new RateLimiter(200, 24 * HOUR);

/** Best-effort caller id behind a proxy. */
export function callerId(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}
