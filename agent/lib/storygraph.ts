import type { ToolContext } from "eve/tools";

import {
  parseWorkspaceJson,
  runWorkspacePython,
} from "./workspace-python";

const SCRIPT_RELATIVE =
  "sandbox/workspace/scripts/update_storygraph_progress.py";

export type StorygraphProgressResult = {
  updated: boolean;
  page: number;
  book: {
    id: string;
    title: string;
    author: string | null;
    progressPercent: number | null;
  };
};

/** Rails session cookies are long encrypted blobs; short values are always mis-copied. */
const MIN_SESSION_COOKIE_LEN = 80;

function requireSessionCookie(): string {
  const raw = process.env.STORYGRAPH_SESSION_COOKIE?.trim();
  if (!raw) {
    throw new Error(
      "Missing STORYGRAPH_SESSION_COOKIE. Set it to the value of the `_storygraph_session` browser cookie.",
    );
  }
  const cookie = raw.replace(/^_storygraph_session=/i, "").trim();
  if (cookie.length < MIN_SESSION_COOKIE_LEN) {
    throw new Error(
      `STORYGRAPH_SESSION_COOKIE looks truncated (len=${cookie.length}; need ≥${MIN_SESSION_COOKIE_LEN}). ` +
        "In the browser on app.thestorygraph.com → DevTools → Application → Cookies → " +
        "copy the full `_storygraph_session` Value (usually hundreds of characters), then " +
        "`vercel env add STORYGRAPH_SESSION_COOKIE` for Production/Preview and redeploy.",
    );
  }
  return cookie;
}

export async function updateReadingProgressByPages(
  input: { title: string; page: number },
  ctx: ToolContext,
): Promise<StorygraphProgressResult> {
  const title = input.title.trim();
  if (!title) throw new Error("title is required");
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new Error("page must be a positive integer");
  }

  const cookie = requireSessionCookie();
  const { stdout, stderr } = await runWorkspacePython({
    scriptRelative: SCRIPT_RELATIVE,
    sandboxCommand: "scripts/update_storygraph_progress.py",
    env: {
      STORYGRAPH_SESSION_COOKIE: cookie,
      STORYGRAPH_TITLE: title,
      STORYGRAPH_PAGE: String(input.page),
    },
    sandbox: await ctx.getSandbox(),
    abortSignal: ctx.abortSignal,
  });

  return parseWorkspaceJson<StorygraphProgressResult>(stdout, stderr);
}
