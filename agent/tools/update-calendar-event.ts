import {
  getCalendarClient,
  resolveCalendar,
  serializeEvent,
  toEventDateTime,
} from "../lib/google-calendar";
import { defineTool } from "eve/tools";
import type { calendar_v3 } from "googleapis";
import { z } from "zod";

export default defineTool({
  description:
    "Update an existing Google Calendar event by id. Only provided fields change; omit fields you want to leave alone.",
  inputSchema: z.object({
    calendar: z
      .string()
      .optional()
      .describe(
        "Opaque calendar alias from the configured map. Omit to use GOOGLE_CALENDAR_DEFAULT.",
      ),
    eventId: z.string().min(1).describe("Google Calendar event id to update."),
    summary: z.string().min(1).optional().describe("New title."),
    start: z
      .string()
      .optional()
      .describe(
        "New start as ISO-8601 / RFC3339, or YYYY-MM-DD for all-day. If set, end should usually be set too.",
      ),
    end: z
      .string()
      .optional()
      .describe(
        "New end as ISO-8601 / RFC3339, or YYYY-MM-DD for all-day. If set, start should usually be set too.",
      ),
    description: z
      .string()
      .nullable()
      .optional()
      .describe("New description, or null to clear."),
    location: z
      .string()
      .nullable()
      .optional()
      .describe("New location, or null to clear."),
    timeZone: z
      .string()
      .optional()
      .describe("IANA timezone when updating timed start/end."),
    attendees: z
      .array(z.string().email())
      .optional()
      .describe("Replace attendee list with these emails when provided."),
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
    eventId,
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

    const requestBody: calendar_v3.Schema$Event = {};
    if (summary !== undefined) requestBody.summary = summary;
    if (description !== undefined) requestBody.description = description;
    if (location !== undefined) requestBody.location = location;
    if (start !== undefined) requestBody.start = toEventDateTime(start, timeZone);
    if (end !== undefined) requestBody.end = toEventDateTime(end, timeZone);
    if (attendees !== undefined) {
      requestBody.attendees = attendees.map((email) => ({ email }));
    }

    if (Object.keys(requestBody).length === 0) {
      throw new Error("Provide at least one field to update");
    }

    const res = await client.events.patch({
      calendarId,
      eventId,
      requestBody,
    });

    const event = serializeEvent(res.data);
    if (!event) {
      throw new Error("Calendar API updated an event without an id");
    }
    return { calendar: alias, event };
  },
});
