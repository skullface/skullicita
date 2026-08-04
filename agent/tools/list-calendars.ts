import { listCalendarAliases } from "../lib/google-calendar";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "List configured Google Calendar aliases. Use an alias with the other calendar tools; never invent emails or raw calendar ids.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    calendars: z.array(z.string()),
    default: z.string().nullable(),
  }),
  async execute() {
    return {
      calendars: listCalendarAliases(),
      default: process.env.GOOGLE_CALENDAR_DEFAULT?.trim() || null,
    };
  },
});
