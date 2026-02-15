import type { WeekWindow } from "../domain/types";
import {
  addUtcCalendarDays,
  APP_TIME_ZONE,
  getZonedParts,
  utcCalendarDateYmd,
  zonedLocalToUtc
} from "./timezone";

const FRIDAY = 5;

function resolveTimezone(): string {
  return APP_TIME_ZONE;
}

export function getWeekWindow(now: Date, _timezone: string): WeekWindow {
  const timezone = resolveTimezone();
  const zonedNow = getZonedParts(now, timezone);
  const localCalendarDay = new Date(Date.UTC(zonedNow.year, zonedNow.month - 1, zonedNow.day));
  const weekday = localCalendarDay.getUTCDay();
  const daysSinceFriday = (weekday - FRIDAY + 7) % 7;

  const startLocalCalendar = addUtcCalendarDays(localCalendarDay, -daysSinceFriday);

  const endLocalCalendar = addUtcCalendarDays(startLocalCalendar, 7);

  const startYear = startLocalCalendar.getUTCFullYear();
  const startMonth = startLocalCalendar.getUTCMonth() + 1;
  const startDay = startLocalCalendar.getUTCDate();

  const endYear = endLocalCalendar.getUTCFullYear();
  const endMonth = endLocalCalendar.getUTCMonth() + 1;
  const endDay = endLocalCalendar.getUTCDate();

  const startsAt = zonedLocalToUtc(startYear, startMonth, startDay, 0, 0, 0, timezone);
  const endsAt = zonedLocalToUtc(endYear, endMonth, endDay, 0, 0, 0, timezone);

  return {
    weekId: utcCalendarDateYmd(startLocalCalendar),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timezone
  };
}

export function getTimeRemainingToSettlement(now: Date, _timezone: string): {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
} {
  const timezone = resolveTimezone();
  const window = getWeekWindow(now, timezone);
  const endsAt = new Date(window.endsAt).getTime();
  const totalMs = Math.max(0, endsAt - now.getTime());
  const days = Math.floor(totalMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((totalMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((totalMs % (60 * 60 * 1000)) / (60 * 1000));
  return { totalMs, days, hours, minutes };
}
