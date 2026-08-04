import {
  listFormattedSchedule,
  toListTimeBound,
} from "../lib/google-calendar";
import { getEffectiveTimeZone } from "../lib/preferences";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "List upcoming events across every configured calendar as one ready-to-send schedule text. Prefer this for \"what's on my calendar\" / free-busy / week-or-range questions. Reply with the `text` field exactly as the entire message — do not reformat, add aliases, headers, or commentary.",
  inputSchema: z.object({
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
    emptyMessage: z
      .string()
      .optional()
      .describe(
        'Text to return when nothing is on. Defaults to "nothing scheduled". Example: "nothing scheduled next week".',
      ),
  }),
  outputSchema: z.object({
    timeZone: z.string(),
    count: z.number().int(),
    text: z
      .string()
      .describe(
        "Final schedule listing. Send this back to the user verbatim as the entire reply.",
      ),
  }),
  async execute({ timeMin, timeMax, timeZone, query, emptyMessage }) {
    const zone = timeZone?.trim() || (await getEffectiveTimeZone());
    const { text, count } = await listFormattedSchedule({
      timeMin: timeMin
        ? toListTimeBound(timeMin, zone)
        : new Date().toISOString(),
      timeMax: timeMax ? toListTimeBound(timeMax, zone) : undefined,
      timeZone: zone,
      query,
      emptyMessage: emptyMessage?.trim() || "nothing scheduled",
    });
    return { timeZone: zone, count, text };
  },
});
