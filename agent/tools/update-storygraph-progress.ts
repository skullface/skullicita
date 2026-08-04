import { updateReadingProgressByPages } from "../lib/storygraph";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Update TheStoryGraph reading progress for a book on the user's Currently Reading list. Match by title (fuzzy) and set progress by page number (ProgressType.PAGES). Use when the user says they finished a page, reached a page, or asks to update StoryGraph/reading progress.",
  inputSchema: z.object({
    title: z
      .string()
      .min(1)
      .describe(
        'Book title as the user said it, e.g. "The Gate Of The Feral Gods". Matched against currently-reading books.',
      ),
    page: z
      .number()
      .int()
      .positive()
      .describe("Page number to set as current progress."),
  }),
  outputSchema: z.object({
    updated: z.boolean(),
    page: z.number().int(),
    book: z.object({
      id: z.string(),
      title: z.string(),
      author: z.string().nullable(),
      progressPercent: z.number().int().nullable(),
    }),
  }),
  async execute({ title, page }, ctx) {
    return updateReadingProgressByPages({ title, page }, ctx);
  },
});
