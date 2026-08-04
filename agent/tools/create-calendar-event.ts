import {
  getCalendarClient,
  resolveCalendar,
  serializeEvent,
  toEventDateTime,
} from "../lib/google-calendar";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Create a Google Calendar event. Pass a configured calendar alias, or omit to use the default. Use ISO-8601 for timed events, or YYYY-MM-DD for all-day.",
  inputSchema: z.object({
    calendar: z
      .string()
      .optional()
      .describe(
        "Opaque calendar alias from the configured map. Omit to use GOOGLE_CALENDAR_DEFAULT.",
      ),
    summary: z.string().min(1).describe("Event title."),
    start: z
      .string()
      .describe(
        "Start time as ISO-8601 / RFC3339, or YYYY-MM-DD for an all-day event.",
      ),
    end: z
      .string()
      .describe(
        "End time as ISO-8601 / RFC3339, or YYYY-MM-DD for an all-day event (exclusive for all-day).",
      ),
    description: z.string().optional().describe("Optional event body."),
    location: z.string().optional().describe("Optional location string."),
    timeZone: z
      .string()
      .optional()
      .describe(
        "IANA timezone for timed events (e.g. America/New_York). Recommended when start/end lack an offset.",
      ),
    attendees: z
      .array(z.string().email())
      .optional()
      .describe("Optional attendee email addresses."),
  }),
  outputSchema: z.object({
    calendar: z.string(),
    event: z.object({
      id: z.string(),
      status: z.string().nullable(),
      summary: z.string().nullable(),
      description: z.string().nullable(),
      location: z.string().nullable(),
      htmlLink: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      allDay: z.boolean(),
      attendees: z.array(
        z.object({
          email: z.string(),
          displayName: z.string().nullable(),
          responseStatus: z.string().nullable(),
        }),
      ),
      recurringEventId: z.string().nullable(),
    }),
  }),
  async execute({
    calendar,
    summary,
    start,
    end,
    description,
    location,
    timeZone,
    attendees,
  }) {
    const { calendar: alias, calendarId } = resolveCalendar(calendar);
    const client = getCalendarClient();
    const res = await client.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
        location,
        start: toEventDateTime(start, timeZone),
        end: toEventDateTime(end, timeZone),
        attendees: attendees?.map((email) => ({ email })),
      },
    });

    const event = serializeEvent(res.data);
    if (!event) {
      throw new Error("Calendar API created an event without an id");
    }
    return { calendar: alias, event };
  },
});
