/**
 * Beijing-time-aware date utilities.
 * All date strings generated here use Asia/Shanghai (UTC+8),
 * regardless of where the server or browser is located.
 */

const TZ = "Asia/Shanghai";
const LOCALE = "en-CA"; // en-CA defaults to YYYY-MM-DD format

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Returns today's date in Beijing time as YYYY-MM-DD */
export function getBeijingDateString(): string {
  return dateFormatter.format(new Date());
}

/** Returns current Beijing datetime as YYYY-MM-DD HH:mm:ss */
export function getBeijingDateTimeString(): string {
  const now = new Date();
  const date = dateFormatter.format(now);
  const time = timeFormatter.format(now);
  return `${date} ${time}`;
}

/** Returns Beijing timestamp for filenames: YYYY-MM-DD-HHmmss */
export function getBeijingTimestamp(): string {
  const dt = getBeijingDateTimeString();
  return dt.replace(" ", "-").replace(/:/g, "");
}

/**
 * Format a Date as YYYY-MM-DD in the Asia/Shanghai timezone.
 */
export function formatBeijingDate(d: Date): string {
  return dateFormatter.format(d);
}
