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
 * Returns tomorrow's date in Beijing time as YYYY-MM-DD.
 *
 * We extract the Beijing calendar date from the current instant via
 * formatToParts, then compute tomorrow's Beijing midnight fully in UTC
 * arithmetic so the result is independent of the server's local timezone.
 *
 *   Beijing midnight today  =  (y-m-d 00:00 UTC+8)
 *                            =  Date.UTC(y, m-1, d) - 8 h
 *   Beijing midnight tomorrow = + 24 h
 *                            =  Date.UTC(y, m-1, d) + 16 h
 */
export function getTomorrowBeijingDate(): string {
  const parts = dateFormatter.formatToParts(new Date());
  const y = +parts.find((p) => p.type === "year")!.value;
  const m = +parts.find((p) => p.type === "month")!.value;
  const d = +parts.find((p) => p.type === "day")!.value;

  // UTC midnight of the Beijing calendar date + 16 h = Beijing midnight tomorrow
  const bjTomorrowUtc = Date.UTC(y, m - 1, d) + 16 * 3600_000;

  return dateFormatter.format(new Date(bjTomorrowUtc));
}

/**
 * Parse a YYYY-MM-DD string as Beijing midnight, returning the UTC
 * timestamp (ms).  Beijing is UTC+8, so midnight Beijing = 16:00 UTC
 * the previous day = Date.UTC(y, m-1, d) - 8 h.
 */
export function beijingMidnightToUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - 8 * 3600_000;
}

/**
 * Given a Beijing date string (YYYY-MM-DD), return the NEXT Beijing
 * date string (YYYY-MM-DD) using safe `setUTCDate(+1)` arithmetic.
 *
 * This correctly handles month- and year-boundary rollovers:
 *   2026-06-30 → 2026-07-01
 *   2026-12-31 → 2027-01-01
 */
export function getTomorrowForBeijingDate(dateStr: string): string {
  const utcMs = beijingMidnightToUtc(dateStr);
  const d = new Date(utcMs);
  d.setUTCDate(d.getUTCDate() + 1); // safe across month/year
  return dateFormatter.format(d);
}

/**
 * Given a Beijing date string (YYYY-MM-DD), return the PREVIOUS Beijing
 * date string (YYYY-MM-DD) using safe `setUTCDate(-1)` arithmetic.
 *
 * This correctly handles month- and year-boundary rollovers:
 *   2026-07-01 → 2026-06-30
 *   2027-01-01 → 2026-12-31
 */
export function getYesterdayForBeijingDate(dateStr: string): string {
  const utcMs = beijingMidnightToUtc(dateStr);
  const d = new Date(utcMs);
  d.setUTCDate(d.getUTCDate() - 1); // safe across month/year
  return dateFormatter.format(d);
}

/**
 * Format a Date as YYYY-MM-DD in the Asia/Shanghai timezone.
 */
export function formatBeijingDate(d: Date): string {
  return dateFormatter.format(d);
}
