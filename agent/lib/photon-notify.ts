import type { RouteHandlerArgs } from "eve/channels";

import photon from "../channels/photon";
import { photonCredentials } from "../channels/photon";

export const appAuth = {
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
  attributes: {},
} as const;

export function imessageThreadId(phone: string): string {
  return `imessage:iMessage;-;${phone.trim()}`;
}

export async function listPhotonUserPhones(): Promise<string[]> {
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

/** Proactive iMessage via the photon channel (same pattern as schedules). */
export async function notifyPhotonUsers(
  to: RouteHandlerArgs["to"],
  message: string,
): Promise<void> {
  const notifyText = `Reply with exactly this text and nothing else:\n\n${message}`;
  const phones = await listPhotonUserPhones();
  await Promise.all(
    phones.map((phone) =>
      to(photon, {
        adapterName: "imessage",
        threadId: imessageThreadId(phone),
      }).send(notifyText, { auth: appAuth }),
    ),
  );
}
