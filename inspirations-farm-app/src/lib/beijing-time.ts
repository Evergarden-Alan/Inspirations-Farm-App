/**
 * Beijing-time-aware date utilities.
 * All date strings generated here use Asia/Shanghai (UTC+8),
 * regardless of where the server or browser is located.
 */

const TZ = "Asia/Shanghai";
const LOCALE = "en-CA"; // en-CA defaults to YYYY-MM-DD format

/** Returns today's date in Beijing time as YYYY-MM-DD */
export function getBeijingDateString(): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Returns current Beijing datetime as YYYY-MM-DD HH:mm:ss */
export function getBeijingDateTimeString(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return `${date} ${time}`;
}

/** Returns Beijing timestamp for filenames: YYYY-MM-DD-HHmmss */
export function getBeijingTimestamp(): string {
  const dt = getBeijingDateTimeString();
  return dt.replace(" ", "-").replace(/:/g, "");
}

/** Returns tomorrow's date in Beijing time as YYYY-MM-DD */
export function getTomorrowBeijingDate(): string {
  // Parse today's Beijing date as midnight Beijing time, then add 24h
  const parts = getBeijingDateString().split("-").map(Number);
  const todayBeijing = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
  const tomorrow = new Date(todayBeijing.getTime() + 86400000);
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
}
