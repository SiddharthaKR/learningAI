/** A per-process fixed-window limiter for the single-node pilot service. */
export function createAuthRateLimiter(maxAttempts: number, windowMs: number) {
  const attempts = new Map<string, { start: number; count: number }>();
  return {
    allow(key: string, now = Date.now()): boolean {
      const existing = attempts.get(key);
      if (!existing || now - existing.start >= windowMs) {
        attempts.set(key, { start: now, count: 1 });
        return true;
      }
      if (existing.count >= maxAttempts) return false;
      existing.count++;
      return true;
    },
  };
}
