import {
  HOME_TIME_ZONE,
  readPreferences,
} from "../lib/preferences";
import { defineDynamic, defineInstructions } from "eve/instructions";

export default defineDynamic({
  events: {
    "turn.started": async () => {
      const prefs = await readPreferences();
      const effective = prefs.timeZone ?? HOME_TIME_ZONE;
      const status = prefs.timeZone
        ? `travel override: ${prefs.timeZone} (home is ${HOME_TIME_ZONE})`
        : `home timezone: ${HOME_TIME_ZONE}`;

      return defineInstructions({
        markdown: `
## Timezone

Active timezone: ${effective} (${status}).

Interpret relative times ("tomorrow 3pm") and calendar day windows in this timezone.
When the user says they are traveling or names a new city/timezone, call \`set-timezone\` with action \`set\` and an IANA zone (map "pacific" → America/Los_Angeles, "london" → Europe/London, etc.) and confirm briefly.
When they say they are home / back / reset timezone, call \`set-timezone\` with action \`clear\`.
While a travel override is set, do not ask them to restate it each turn.
        `.trim(),
      });
    },
  },
});
