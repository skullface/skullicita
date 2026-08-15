import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defineChannel, POST, type RouteHandlerArgs } from "eve/channels";
import { githubChannel, type GitHubChannelState } from "eve/channels/github";

import { notifyPhotonUsers } from "../lib/photon-notify";

const GITHUB_ROUTE = "/eve/v1/github";
const credentials = connectGitHubCredentials("github/skullicita");

const github = githubChannel({
  botName: "skullicita",
  credentials,
});

interface GitHubPullRequestWebhookPayload {
  action?: string;
  repository?: {
    full_name?: string;
    owner?: { login?: string };
  };
  pull_request?: {
    title?: string;
    html_url?: string;
    user?: { login?: string; type?: string };
  };
}

function listNotifyOwners(): string[] {
  const raw = process.env.GITHUB_NOTIFY_OWNERS?.trim();
  if (!raw) return [];
  return [...new Set(raw.split(",").map((owner) => owner.trim().toLowerCase()).filter(Boolean))];
}

function isOwnedRepository(ownerLogin: string | undefined): boolean {
  if (!ownerLogin) return false;
  const allowedOwners = listNotifyOwners();
  if (allowedOwners.length === 0) return true;
  return allowedOwners.includes(ownerLogin.toLowerCase());
}

function formatNewPullRequest(payload: GitHubPullRequestWebhookPayload): string | null {
  const repo = payload.repository?.full_name?.trim();
  if (!repo) return null;

  const pr = payload.pull_request;
  const lines = [
    `new pr opened in ${repo}`,
    pr?.title?.trim() ? `"${pr.title.trim()}"` : null,
    pr?.user?.login ? `by @${pr.user.login}` : null,
    pr?.html_url?.trim(),
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

async function verifyGitHubBody(request: Request, rawBody: string): Promise<string | null> {
  if (!credentials.webhookVerifier) return rawBody;

  try {
    const verified = await credentials.webhookVerifier(request, rawBody);
    if (!verified) return null;
    return typeof verified === "string" ? verified : rawBody;
  } catch {
    return null;
  }
}

const githubRoute = github.routes.find(
  (entry) =>
    entry.transport !== "websocket" && entry.method === "POST" && entry.path === GITHUB_ROUTE,
);
if (!githubRoute || githubRoute.transport === "websocket") {
  throw new Error("[github] missing built-in POST /eve/v1/github route");
}
const delegateGitHubWebhook = githubRoute.handler;

export default defineChannel({
  turnPolicy: github.turnPolicy,
  routes: [
    POST(GITHUB_ROUTE, async (request, routeCtx) => {
      const rawBody = await request.text();
      const body = await verifyGitHubBody(request, rawBody);
      if (body === null) {
        return new Response("unauthorized", { status: 401 });
      }

      const eventType = request.headers.get("x-github-event");
      if (eventType === "pull_request") {
        let payload: GitHubPullRequestWebhookPayload;
        try {
          payload = JSON.parse(body) as GitHubPullRequestWebhookPayload;
        } catch {
          return new Response("bad request", { status: 400 });
        }

        if (payload.action === "opened" && isOwnedRepository(payload.repository?.owner?.login)) {
          const message = formatNewPullRequest(payload);
          if (message) {
            routeCtx.waitUntil(
              (async () => {
                console.log(
                  `[github] new pr opened in ${payload.repository?.full_name ?? "unknown repo"}`,
                );
                await notifyPhotonUsers(routeCtx.to, message);
              })().catch((error) => {
                console.error("[github] failed to notify photon about new pr", error);
              }),
            );
          }

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
      }

      const replay = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });

      return delegateGitHubWebhook(
        replay,
        routeCtx as unknown as RouteHandlerArgs<GitHubChannelState>,
      );
    }),
  ],
  receive: github.receive,
});
