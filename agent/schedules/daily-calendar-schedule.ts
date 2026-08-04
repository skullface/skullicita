import { defineSchedule } from "eve/schedules";

import photon, { photonCredentials } from "../channels/photon";
import {
  BUSY_SUMMARY,
  listCalendarAliases,
  listCalendarEventsInRange,
  resolveCalendar,
  toListTimeBound,
  type CalendarEvent,
} from "../lib/google-calendar";
import { getEffectiveTimeZone } from "../lib/preferences";

/** 8:27am America/New_York in UTC for both EDT (12) and EST (13). */
const CRON = "27 12,13 * * *";
const TIME_ZONE = "America/New_York";
const LOCAL_HOUR = 8;
const LOCAL_MINUTE = 27;

const PERSONAL_COMMITMENT = "🏠 Personal Commitment";

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

function imessageThreadId(phone: string): string {
  return `imessage:iMessage;-;${phone.trim()}`;
}

async function listPhotonUserPhones(): Promise<string[]> {
  const { projectId, projectSecret } = await photonCredentials();
  const auth = Buffer.from(`${projectId}:${projectSecret}`).toString("base64");
  const res = await fetch(`https://spectrum.photon.codes/projects/${encodeURIComponent(projectId)}/users/`, {
    headers: { authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    throw new Error(`Photon list users failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    data?: { users?: Array<{ phoneNumber?: string }> };
  };
  const phones = (body.data?.users ?? [])
    .map((user) => user.phoneNumber?.trim())
    .filter((phone): phone is string => Boolean(phone));
  if (phones.length === 0) {
    throw new Error("Photon project has no registered users to notify.");
  }
  return [...new Set(phones)];
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

function slotKey(event: CalendarEvent): string {
  return `${event.start ?? ""}|${event.end ?? ""}`;
}

/**
 * Drop placeholder / free-busy mirrors when another named event shares the
 * exact same start/end (`🏠 Personal Commitment` or `busy`).
 */
function dedupePlaceholderEvents(events: CalendarEvent[]): CalendarEvent[] {
  const isPlaceholder = (summary: string | null) =>
    summary === PERSONAL_COMMITMENT || summary === BUSY_SUMMARY;

  const occupied = new Set(
    events.filter((event) => !isPlaceholder(event.summary)).map(slotKey),
  );
  return events.filter(
    (event) => !isPlaceholder(event.summary) || !occupied.has(slotKey(event)),
  );
}

async function listTodaysMatchingEvents(): Promise<CalendarEvent[]> {
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

  return dedupePlaceholderEvents(perCalendar.flat());
}

export default defineSchedule({
  cron: CRON,
  async run({ receive, waitUntil, appAuth }) {
    if (!isLocalClock(new Date(), TIME_ZONE, LOCAL_HOUR, LOCAL_MINUTE)) return;

    waitUntil(
      (async () => {
        const events = await listTodaysMatchingEvents();
        if (events.length === 0) {
          console.log(
            "[daily-calendar-schedule] no matching events today, skipping message",
          );
          return;
        }

        console.log(
          `[daily-calendar-schedule] morning job completed; ${events.length} matching event(s), sending list`,
        );

        const phones = await listPhotonUserPhones();
        await Promise.all(
          phones.map((phone) =>
            receive(photon, {
              message:
                "List today's events across all calendars using the google calendar skill (list-calendars, then list-calendar-events for today on every alias; merge, dedupe, and format per that skill). Reply with only the chronological list in the skill's line format, nothing else.",
              target: {
                adapterName: "imessage",
                threadId: imessageThreadId(phone),
              },
              auth: appAuth,
            }),
          ),
        );
      })(),
    );
  },
});
