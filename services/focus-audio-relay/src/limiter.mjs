export function createConcurrencyLimiter({ maxTotal, maxPerIp }) {
  let total = 0;
  const byIp = new Map();

  return {
    tryAcquire(ip) {
      const currentForIp = byIp.get(ip) ?? 0;
      if (total >= maxTotal || currentForIp >= maxPerIp) return null;

      total += 1;
      byIp.set(ip, currentForIp + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        total -= 1;
        const nextForIp = (byIp.get(ip) ?? 1) - 1;
        if (nextForIp <= 0) byIp.delete(ip);
        else byIp.set(ip, nextForIp);
      };
    },
    snapshot() {
      return { total, byIp: new Map(byIp) };
    },
  };
}

export function createFixedWindowRateLimiter({ windowMs, maxRequests }) {
  const entries = new Map();
  let calls = 0;

  return {
    consume(key, now = Date.now()) {
      const current = entries.get(key);
      const entry = !current || now >= current.resetAt
        ? { count: 0, resetAt: now + windowMs }
        : current;
      entry.count += 1;
      entries.set(key, entry);

      calls += 1;
      if (calls % 256 === 0) {
        for (const [entryKey, value] of entries) {
          if (now >= value.resetAt) entries.delete(entryKey);
        }
      }

      return {
        allowed: entry.count <= maxRequests,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    },
  };
}
