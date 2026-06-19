/**
 * Calculate a human-readable "survival duration" label from a past date to now.
 *
 * Examples:
 *   "存活: 5分钟"   (less than 1 hour)
 *   "存活: 2小时"   (less than 1 day)
 *   "存活: 3天 5小时"
 */

/**
 * Parse a Beijing-time datetime string into a real Date object.
 * Accepts:
 *   "2026-06-19 12:20:18"     (from frontmatter `create` field)
 *   "2026-06-19-122018"       (from inspiration filename/id)
 * Both are treated as Asia/Shanghai (UTC+8).
 */
export function parseBeijingTime(raw: string): Date {
  // Normalize: replace first space with "T", strip extra dashes in time part,
  // then append +08:00 timezone offset.
  let s = raw.trim();
  // "2026-06-19 12:20:18" → "2026-06-19T12:20:18"
  // "2026-06-19-122018"  → "2026-06-19T12:20:18"
  if (s.length === 19 && s[10] === " ") {
    s = s.slice(0, 10) + "T" + s.slice(11);
  } else if (s.length === 17 && s[10] === "-") {
    s =
      s.slice(0, 10) +
      "T" +
      s.slice(11, 13) +
      ":" +
      s.slice(13, 15) +
      ":" +
      s.slice(15, 17);
  }

  // Force Beijing timezone
  return new Date(s + "+08:00");
}

export function getSurvivalLabel(createdAt: string): string {
  const created = parseBeijingTime(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();

  if (diffMs <= 0) return "⏳ 刚刚";

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);

  if (minutes < 60) {
    return `⏳ 存活: ${minutes}分钟`;
  }

  if (hours < 24) {
    return `⏳ 存活: ${hours}小时`;
  }

  const remainHours = hours - days * 24;
  if (remainHours > 0) {
    return `⏳ 存活: ${days}天 ${remainHours}小时`;
  }
  return `⏳ 存活: ${days}天`;
}
