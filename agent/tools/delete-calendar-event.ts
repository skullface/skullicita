import { getCalendarClient, resolveCalendar } from "../lib/google-calendar";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Delete a Google Calendar event by id. Pass a configured calendar alias, or omit to use the default.",
  inputSchema: z.object({
    calendar: z
      .string()
      .optional()
      .describe(
        "Opaque calendar alias from the configured map. Omit to use GOOGLE_CALENDAR_DEFAULT.",
      ),
    eventId: z.string().min(1).describe("Google Calendar event id to delete."),
  }),
  outputSchema: z.object({
    calendar: z.string(),
    eventId: z.string(),
    deleted: z.literal(true),
  }),
  async execute({ calendar, eventId }) {
    const { calendar: alias, calendarId } = resolveCalendar(calendar);
    const client = getCalendarClient();
    await client.events.delete({
      calendarId,
      eventId,
    });
    return { calendar: alias, eventId, deleted: true as const };
  },
});
