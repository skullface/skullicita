import { defineSchedule } from "eve/schedules";

import { notifyPhotonUsers } from "../lib/photon-notify";
import {
  formatMomaFilmWatchMessage,
  pollMomaFilmWatch,
} from "../lib/moma-film-watch";

const CRON = "0 */6 * * *";

export default defineSchedule({
  cron: CRON,
  async run({ to, waitUntil }) {
    waitUntil(
      (async () => {
        const { newlyAvailable, seeded } = await pollMomaFilmWatch();

        if (seeded) {
          console.log("[moma-film-watch] seeded baseline state, skipping message");
          return;
        }

        if (newlyAvailable.length === 0) {
          console.log("[moma-film-watch] no newly available dates");
          return;
        }

        const message = formatMomaFilmWatchMessage(newlyAvailable);
        console.log(
          `[moma-film-watch] notifying for ${newlyAvailable.length} date(s): ${newlyAvailable.join(", ")}`,
        );
        await notifyPhotonUsers(to, message);
      })(),
    );
  },
});
