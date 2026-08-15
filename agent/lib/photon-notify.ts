import { photonCredentials } from "../channels/photon";

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
