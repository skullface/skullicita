import { listNotes } from "../lib/notes";
import { getEffectiveTimeZone } from "../lib/preferences";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "List notes captured via the nts iMessage prefix. Use when the user asks to see their notes, nts captures, or saved note-to-self items. Supports date ranges (e.g. last month): pass since/until as YYYY-MM-DD or RFC3339; bare datetimes use the effective timezone.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max notes to return (1–50). Defaults to 20."),
    since: z
      .string()
      .optional()
      .describe(
        "Inclusive start of the window. Prefer YYYY-MM-DD or RFC3339; bare datetimes use the effective timezone.",
      ),
    until: z
      .string()
      .optional()
      .describe(
        "Exclusive end of the window. Prefer YYYY-MM-DD or RFC3339; bare datetimes use the effective timezone.",
      ),
    timeZone: z
      .string()
      .optional()
      .describe(
        "Optional IANA timezone override for since/until only. Omit to use the saved travel/home preference.",
      ),
  }),
  outputSchema: z.object({
    count: z.number(),
    notes: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        createdAt: z.string(),
      }),
    ),
  }),
  async execute({ limit, since, until, timeZone }) {
    const notes = await listNotes({
      limit: limit ?? 20,
      since,
      until,
      ...(since?.trim() || until?.trim()
        ? { timeZone: timeZone ?? (await getEffectiveTimeZone()) }
        : {}),
    });
    return {
      count: notes.length,
      notes: notes.map(({ id, text, createdAt }) => ({ id, text, createdAt })),
    };
  },
});
