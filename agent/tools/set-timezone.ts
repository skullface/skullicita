import {
  clearTravelTimeZone,
  getEffectiveTimeZone,
  HOME_TIME_ZONE,
  readPreferences,
  setTravelTimeZone,
} from "../lib/preferences";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Get, set, or clear the user's timezone preference. Travel overrides persist across chats until cleared. Use IANA names (America/Los_Angeles, Europe/London). Call this when the user says they are traveling or back home.",
  inputSchema: z.object({
    action: z
      .enum(["get", "set", "clear"])
      .describe(
        "get = read current preference; set = save a travel timezone; clear = remove override and return to home.",
      ),
    timeZone: z
      .string()
      .optional()
      .describe(
        "Required when action is set. IANA timezone, e.g. America/Los_Angeles.",
      ),
  }),
  outputSchema: z.object({
    action: z.enum(["get", "set", "clear"]),
    timeZone: z.string().nullable(),
    effectiveTimeZone: z.string(),
    homeTimeZone: z.string(),
    updatedAt: z.string().nullable(),
  }),
  async execute({ action, timeZone }) {
    if (action === "set") {
      if (!timeZone?.trim()) {
        throw new Error('action "set" requires timeZone (IANA name)');
      }
      const prefs = await setTravelTimeZone(timeZone);
      return {
        action,
        timeZone: prefs.timeZone,
        effectiveTimeZone: prefs.timeZone ?? HOME_TIME_ZONE,
        homeTimeZone: HOME_TIME_ZONE,
        updatedAt: prefs.updatedAt,
      };
    }

    if (action === "clear") {
      const prefs = await clearTravelTimeZone();
      return {
        action,
        timeZone: prefs.timeZone,
        effectiveTimeZone: HOME_TIME_ZONE,
        homeTimeZone: HOME_TIME_ZONE,
        updatedAt: prefs.updatedAt,
      };
    }

    const prefs = await readPreferences();
    return {
      action,
      timeZone: prefs.timeZone,
      effectiveTimeZone: await getEffectiveTimeZone(),
      homeTimeZone: HOME_TIME_ZONE,
      updatedAt: prefs.updatedAt,
    };
  },
});
