import { defineSchedule } from "eve/schedules";

import photon from "../channels/photon";
import {
  formatScheduleListing,
  listCalendarAliases,
  listCalendarEventsInRange,
  resolveCalendar,
  toListTimeBound,
  type CalendarEvent,
} from "../lib/google-calendar";
import { imessageThreadId, listPhotonUserPhones } from "../lib/photon-notify";
import { getEffectiveTimeZone } from "../lib/preferences";

/** 8:27am America/New_York in UTC for both EDT (12) and EST (13). */
const CRON = "27 12,13 * * *";
const TIME_ZONE = "America/New_York";
const LOCAL_HOUR = 8;
const LOCAL_MINUTE = 27;

function isLocalClock(date: Date, timeZone: string, hour: number, minute: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const h = Number(parts.find((part) => part.type === "hour")?.value);
  const m = Number(parts.find((part) => part.type === "minute")?.value);
  return h === hour && m === minute;
}

function localYmd(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nextCalendarYmd(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

async function listTodaysMatchingEvents(): Promise<{
  events: CalendarEvent[];
  timeZone: string;
  listing: string;
}> {
  const timeZone = await getEffectiveTimeZone();
  const today = localYmd(new Date(), timeZone);
  const tomorrow = nextCalendarYmd(today);
  const timeMin = toListTimeBound(today, timeZone);
  const timeMax = toListTimeBound(tomorrow, timeZone);

  const perCalendar = await Promise.all(
    listCalendarAliases().map(async (alias) => {
      const { calendarId } = resolveCalendar(alias);
      return listCalendarEventsInRange({
        calendarId,
        timeMin,
        timeMax,
        timeZone,
        maxResults: 50,
      });
    }),
  );

  const events = perCalendar.flat();
  const listing = formatScheduleListing(events, timeZone, "nothing scheduled");
  return { events, timeZone, listing };
}

export default defineSchedule({
  cron: CRON,
  async run({ to, waitUntil, appAuth }) {
    if (!isLocalClock(new Date(), TIME_ZONE, LOCAL_HOUR, LOCAL_MINUTE)) return;

    waitUntil(
      (async () => {
        const { listing } = await listTodaysMatchingEvents();
        if (listing === "nothing scheduled") {
          console.log(
            "[daily-calendar-schedule] no matching events today, skipping message",
          );
          return;
        }

        const eventCount = listing.split("\n").length;
        console.log(
          `[daily-calendar-schedule] morning job completed; ${eventCount} matching event(s), sending list`,
        );

        const phones = await listPhotonUserPhones();
        await Promise.all(
          phones.map((phone) =>
            to(photon, {
              adapterName: "imessage",
              threadId: imessageThreadId(phone),
            }).send(`Reply with exactly this text and nothing else:\n\n${listing}`, {
              auth: appAuth,
            }),
          ),
        );
      })(),
    );
  },
});
