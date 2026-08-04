import { defineSchedule } from "eve/schedules";

import photon, { photonCredentials } from "../channels/photon";

/** 8:28am America/New_York in UTC for both EDT (12) and EST (13). */
const CRON = "28 12,13 * * *";
const TIME_ZONE = "America/New_York";
const LOCAL_HOUR = 8;
const LOCAL_MINUTE = 28;

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

function imessageThreadId(phone: string): string {
  return `imessage:iMessage;-;${phone.trim()}`;
}

async function listPhotonUserPhones(): Promise<string[]> {
  const { projectId, projectSecret } = await photonCredentials();
  const auth = Buffer.from(`${projectId}:${projectSecret}`).toString("base64");
  const res = await fetch(`https://spectrum.photon.codes/projects/${encodeURIComponent(projectId)}/users/`, {
    headers: { authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    throw new Error(`Photon list users failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    data?: { users?: Array<{ phoneNumber?: string }> };
  };
  const phones = (body.data?.users ?? [])
    .map((user) => user.phoneNumber?.trim())
    .filter((phone): phone is string => Boolean(phone));
  if (phones.length === 0) {
    throw new Error("Photon project has no registered users to notify.");
  }
  return [...new Set(phones)];
}

export default defineSchedule({
  cron: CRON,
  async run({ receive, waitUntil, appAuth }) {
    if (!isLocalClock(new Date(), TIME_ZONE, LOCAL_HOUR, LOCAL_MINUTE)) return;

    waitUntil(
      (async () => {
        const phones = await listPhotonUserPhones();
        await Promise.all(
          phones.map((phone) =>
            receive(photon, {
              message:
                "Send today's daily sun briefing (UV, cloud cover, sunset) using the daily sun briefing skill. Reply only with that briefing.",
              target: {
                adapterName: "imessage",
                threadId: imessageThreadId(phone),
              },
              auth: appAuth,
            }),
          ),
        );
      })(),
    );
  },
});
