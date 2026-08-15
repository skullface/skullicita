import { defineSchedule } from "eve/schedules";

import photon from "../channels/photon";
import { imessageThreadId, listPhotonUserPhones } from "../lib/photon-notify";

/** 8:27am America/New_York in UTC for both EDT (12) and EST (13). */
const CRON = "27 12,13 * * *";
const TIME_ZONE = "America/New_York";
const LOCAL_HOUR = 8;
const LOCAL_MINUTE = 27;

function isLocalClock(date: Date, timeZone: string, hour: number, minute: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const h = Number(parts.find((part) => part.type === "hour")?.value);
  const m = Number(parts.find((part) => part.type === "minute")?.value);
  return h === hour && m === minute;
}

export default defineSchedule({
  cron: CRON,
  async run({ to, waitUntil, appAuth }) {
    if (!isLocalClock(new Date(), TIME_ZONE, LOCAL_HOUR, LOCAL_MINUTE)) return;

    waitUntil(
      (async () => {
        console.log("[daily-sun-overview] morning sun overview schedule ran; sending overview");

        const phones = await listPhotonUserPhones();
        await Promise.all(
          phones.map((phone) =>
            to(photon, {
              adapterName: "imessage",
              threadId: imessageThreadId(phone),
            }).send(
              "Send today's daily sun overview (UV, cloud cover, sunset) using the daily sun overview skill. Reply only with that overview.",
              { auth: appAuth },
            ),
          ),
        );
      })(),
    );
  },
});
