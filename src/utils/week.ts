import type { WeekWindow } from "../domain/types";

const FRIDAY = 5;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
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

  const byType = (type: string) => {
    const part = parts.find((item) => item.type === type)?.value;
    return Number(part ?? 0);
  };

  return {
    year: byType("year"),
    month: byType("month"),
    day: byType("day"),
    hour: byType("hour"),
    minute: byType("minute"),
    second: byType("second")
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

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = getOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function localDateToIsoDate(localDate: Date): string {
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getWeekWindow(now: Date, timezone: string): WeekWindow {
  const zonedNow = getZonedParts(now, timezone);
  const localCalendarDay = new Date(
    Date.UTC(zonedNow.year, zonedNow.month - 1, zonedNow.day)
  );
  const weekday = localCalendarDay.getUTCDay();
  const daysSinceFriday = (weekday - FRIDAY + 7) % 7;

  const startLocalCalendar = new Date(localCalendarDay);
  startLocalCalendar.setUTCDate(startLocalCalendar.getUTCDate() - daysSinceFriday);

  const endLocalCalendar = new Date(startLocalCalendar);
  endLocalCalendar.setUTCDate(endLocalCalendar.getUTCDate() + 7);

  const startYear = startLocalCalendar.getUTCFullYear();
  const startMonth = startLocalCalendar.getUTCMonth() + 1;
  const startDay = startLocalCalendar.getUTCDate();

  const endYear = endLocalCalendar.getUTCFullYear();
  const endMonth = endLocalCalendar.getUTCMonth() + 1;
  const endDay = endLocalCalendar.getUTCDate();

  const startsAt = zonedLocalToUtc(startYear, startMonth, startDay, 0, 0, 0, timezone);
  const endsAt = zonedLocalToUtc(endYear, endMonth, endDay, 0, 0, 0, timezone);

  return {
    weekId: localDateToIsoDate(startLocalCalendar),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timezone
  };
}

export function getTimeRemainingToSettlement(now: Date, timezone: string): {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
} {
  const window = getWeekWindow(now, timezone);
  const endsAt = new Date(window.endsAt).getTime();
  const totalMs = Math.max(0, endsAt - now.getTime());
  const days = Math.floor(totalMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((totalMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((totalMs % (60 * 60 * 1000)) / (60 * 1000));
  return { totalMs, days, hours, minutes };
}
