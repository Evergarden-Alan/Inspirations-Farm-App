const DURATION_RE = /^(?:(\d+)h)?(?:(\d+)m)?$/;

function assertValidSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.floor(seconds))) {
    throw new RangeError("Focus duration must be a non-negative safe number");
  }
  return Math.floor(seconds);
}

export function parseDurationToSeconds(
  duration: string | null | undefined
): number | null {
  if (typeof duration !== "string" || duration.length === 0) return null;

  const match = duration.match(DURATION_RE);
  if (!match || (!match[1] && !match[2])) return null;

  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : 0;
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes)) return null;

  const totalMinutes = hours * 60 + minutes;
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes > Math.floor(Number.MAX_SAFE_INTEGER / 60)) {
    return null;
  }

  return totalMinutes * 60;
}

export function formatSecondsToMdDuration(seconds: number): string {
  const wholeSeconds = assertValidSeconds(seconds);
  const totalMinutes = Math.max(1, Math.floor(wholeSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

export function addDurations(
  existing: string | null,
  additionalSeconds: number
): string {
  const existingSeconds = existing === null ? 0 : parseDurationToSeconds(existing);
  if (existingSeconds === null) {
    throw new RangeError("Existing focus duration is invalid");
  }

  const increment = assertValidSeconds(additionalSeconds);
  const recordedIncrement = parseDurationToSeconds(formatSecondsToMdDuration(increment))!;
  const total = existingSeconds + recordedIncrement;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Focus duration exceeds the safe integer range");
  }

  return formatSecondsToMdDuration(total);
}
