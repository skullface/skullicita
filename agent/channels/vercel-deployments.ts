import crypto from "node:crypto";

import { defineChannel, POST } from "eve/channels";

import { imessageThreadId, listPhotonUserPhones } from "../lib/photon-notify";
import photon from "./photon";

const WEBHOOK_ROUTE = "/eve/v1/vercel-deployments";

const appAuth = {
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
  attributes: {},
} as const;

interface VercelDeploymentWebhookEvent {
  id: string;
  type: string;
  createdAt: number;
  payload: {
    deployment?: {
      id?: string;
      name?: string;
      url?: string;
      meta?: Record<string, string>;
    };
    links?: {
      deployment?: string;
      project?: string;
    };
    target?: string | null;
    project?: { id?: string; name?: string };
  };
}

function verifyVercelSignature(rawBody: Buffer, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function formatDeploymentFailure(event: VercelDeploymentWebhookEvent): string {
  const { deployment, links, target, project } = event.payload;
  const projectName = deployment?.name ?? project?.name ?? "unknown project";
  const lines = [
    `Vercel deployment failed for ${projectName}.`,
    target ? `Target: ${target}` : null,
    deployment?.url ? `URL: https://${deployment.url}` : null,
    links?.deployment ? `Inspect: ${links.deployment}` : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

export default defineChannel({
  routes: [
    POST(WEBHOOK_ROUTE, async (request, { to, waitUntil }) => {
      const secret = process.env.VERCEL_WEBHOOK_SECRET;
      if (!secret) {
        console.error("[vercel-deployments] VERCEL_WEBHOOK_SECRET is not set");
        return new Response("misconfigured", { status: 500 });
      }

      const rawBody = Buffer.from(await request.arrayBuffer());
      const signature = request.headers.get("x-vercel-signature");
      if (!verifyVercelSignature(rawBody, signature, secret)) {
        return new Response("unauthorized", { status: 401 });
      }

      let event: VercelDeploymentWebhookEvent;
      try {
        event = JSON.parse(rawBody.toString("utf8")) as VercelDeploymentWebhookEvent;
      } catch {
        return new Response("bad request", { status: 400 });
      }

      if (event.type !== "deployment.error" && event.type !== "deployment.failed") {
        return new Response("ok", { status: 200 });
      }

      const message = formatDeploymentFailure(event);
      const notifyText = `Reply with exactly this text and nothing else:\n\n${message}`;

      waitUntil(
        (async () => {
          console.log(
            `[vercel-deployments] deployment failed for ${event.payload.deployment?.name ?? "unknown project"}`,
          );

          const phones = await listPhotonUserPhones();
          await Promise.all(
            phones.map((phone) =>
              to(photon, {
                adapterName: "imessage",
                threadId: imessageThreadId(phone),
              }).send(notifyText, { auth: appAuth }),
            ),
          );
        })(),
      );

      return new Response("ok", { status: 200 });
    }),
  ],
});
