/**
 * Calculate a human-readable "survival duration" label from a past date to now.
 *
 * Examples:
 *   "存活: 5分钟"   (less than 1 hour)
 *   "存活: 2小时"   (less than 1 day)
 *   "存活: 3天 5小时"
 */

export function getSurvivalLabel(createdAt: string): string {
  const created = new Date(createdAt);
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
