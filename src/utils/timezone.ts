export const APP_TIME_ZONE = "America/New_York";
let activeTimeZone = APP_TIME_ZONE;

export function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: unknown, fallback: string = APP_TIME_ZONE): string {
  return isValidTimeZone(value) ? String(value).trim() : fallback;
}

export function detectBrowserTimeZone(fallback: string = APP_TIME_ZONE): string {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return normalizeTimeZone(browserTimeZone, fallback);
}

export function getActiveTimeZone(): string {
  return activeTimeZone;
}

export function setActiveTimeZone(value: string | null | undefined): string {
  activeTimeZone = normalizeTimeZone(value, APP_TIME_ZONE);
  return activeTimeZone;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getNumberPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((part) => part.type === type)?.value;
  return Number(value ?? 0);
}

export function getZonedParts(date: Date, timeZone: string = APP_TIME_ZONE): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);

  return {
    year: getNumberPart(parts, "year"),
    month: getNumberPart(parts, "month"),
    day: getNumberPart(parts, "day"),
    hour: getNumberPart(parts, "hour"),
    minute: getNumberPart(parts, "minute"),
    second: getNumberPart(parts, "second")
  };
}

function getOffsetMs(date: Date, timeZone: string): number {
  const zoned = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second
  );
  return asUtc - date.getTime();
}

export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string = APP_TIME_ZONE
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = getOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

export function toUtcCalendarDate(date: Date, timeZone: string = APP_TIME_ZONE): Date {
  const zoned = getZonedParts(date, timeZone);
  return new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day));
}

export function addUtcCalendarDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function utcCalendarDateYmd(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function utcCalendarEpoch(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}
