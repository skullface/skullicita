import {
  formatEventLine,
  listCalendarEventsInRange,
  resolveCalendar,
  toListTimeBound,
} from "../lib/google-calendar";
import { getEffectiveTimeZone } from "../lib/preferences";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "List Google Calendar events on one calendar alias. For full-schedule listings across all calendars, prefer list-schedule instead. timeMin/timeMax may be YYYY-MM-DD or ISO without offset — they are interpreted in the user's effective timezone. Free/busy-only calendars return blocks titled \"busy\" with start/end times.",
  inputSchema: z.object({
    calendar: z
      .string()
      .optional()
      .describe(
        "Opaque calendar alias from the configured map. Omit to use GOOGLE_CALENDAR_DEFAULT.",
      ),
    timeMin: z
      .string()
      .optional()
      .describe(
        "Inclusive start of the window. Prefer YYYY-MM-DD or RFC3339; bare datetimes use the effective timezone. Defaults to now.",
      ),
    timeMax: z
      .string()
      .optional()
      .describe(
        "Exclusive end of the window. Prefer YYYY-MM-DD or RFC3339; bare datetimes use the effective timezone.",
      ),
    timeZone: z
      .string()
      .optional()
      .describe(
        "Optional IANA timezone override for this call only. Omit to use the saved travel/home preference.",
      ),
    query: z
      .string()
      .optional()
      .describe("Free-text search across event fields (Google Calendar q)."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max events to return (1–50). Defaults to 20."),
  }),
  outputSchema: z.object({
    calendar: z.string(),
    timeZone: z.string(),
    count: z.number().int(),
    events: z.array(
      z.object({
        id: z.string(),
        status: z.string().nullable(),
        summary: z.string().nullable(),
        description: z.string().nullable(),
        location: z.string().nullable(),
        htmlLink: z.string().nullable(),
        start: z.string().nullable(),
        end: z.string().nullable(),
        allDay: z.boolean(),
        line: z
          .string()
          .describe(
            "Preformatted schedule line. Prefer list-schedule for multi-calendar replies.",
          ),
        attendees: z.array(
          z.object({
            email: z.string(),
            displayName: z.string().nullable(),
            responseStatus: z.string().nullable(),
          }),
        ),
        recurringEventId: z.string().nullable(),
      }),
    ),
  }),
  async execute({ calendar, timeMin, timeMax, timeZone, query, maxResults }) {
    const { calendar: alias, calendarId } = resolveCalendar(calendar);
    const zone = timeZone?.trim() || (await getEffectiveTimeZone());
    const events = await listCalendarEventsInRange({
      calendarId,
      timeMin: timeMin
        ? toListTimeBound(timeMin, zone)
        : new Date().toISOString(),
      timeMax: timeMax ? toListTimeBound(timeMax, zone) : undefined,
      timeZone: zone,
      query,
      maxResults: maxResults ?? 20,
    });

    return {
      calendar: alias,
      timeZone: zone,
      count: events.length,
      events: events.map((event) => ({
        ...event,
        line: formatEventLine(event, zone) ?? "",
      })),
    };
  },
});
