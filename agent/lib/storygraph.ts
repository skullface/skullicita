import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ToolContext } from "eve/tools";

const execFileAsync = promisify(execFile);

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

function requireSessionCookie(): string {
  const raw = process.env.STORYGRAPH_SESSION_COOKIE?.trim();
  if (!raw) {
    throw new Error(
      "Missing STORYGRAPH_SESSION_COOKIE. Set it to the value of the `_storygraph_session` browser cookie.",
    );
  }
  return raw.replace(/^_storygraph_session=/i, "").trim();
}

function scriptPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    SCRIPT_RELATIVE,
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalPython(): Promise<string | null> {
  const override = process.env.STORYGRAPH_PYTHON?.trim();
  if (override) return override;

  const venvPython = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.venv-storygraph/bin/python",
  );
  if (await fileExists(venvPython)) return venvPython;

  return null;
}

function errorFromStderr(stderr: string, fallback: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // plain text stderr
  }
  return trimmed;
}

function parseScriptOutput(stdout: string, stderr: string): StorygraphProgressResult {
  const text = stdout.trim();
  if (!text) {
    throw new Error(errorFromStderr(stderr, "StoryGraph script returned no output"));
  }

  try {
    return JSON.parse(text) as StorygraphProgressResult;
  } catch {
    throw new Error(`StoryGraph script returned invalid JSON: ${text}`);
  }
}

async function runLocalPython(input: {
  title: string;
  page: number;
  cookie: string;
  python: string;
}): Promise<StorygraphProgressResult> {
  const script = scriptPath();
  try {
    const { stdout, stderr } = await execFileAsync(input.python, [script], {
      env: {
        ...process.env,
        STORYGRAPH_SESSION_COOKIE: input.cookie,
        STORYGRAPH_TITLE: input.title,
        STORYGRAPH_PAGE: String(input.page),
        PYTHONPATH: path.resolve(path.dirname(script), "../vendor"),
      },
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseScriptOutput(stdout, stderr);
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (err.stdout?.trim()) {
      return parseScriptOutput(err.stdout, err.stderr ?? "");
    }
    throw new Error(
      errorFromStderr(err.stderr ?? "", err.message ?? "StoryGraph local python failed"),
    );
  }
}

async function runInSandbox(
  input: { title: string; page: number; cookie: string },
  ctx: ToolContext,
): Promise<StorygraphProgressResult> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: "/workspace/.venv/bin/python scripts/update_storygraph_progress.py",
    env: {
      STORYGRAPH_SESSION_COOKIE: input.cookie,
      STORYGRAPH_TITLE: input.title,
      STORYGRAPH_PAGE: String(input.page),
      PYTHONPATH: "/workspace/vendor",
    },
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      errorFromStderr(
        result.stderr,
        `StoryGraph sandbox exited ${result.exitCode}`,
      ),
    );
  }

  return parseScriptOutput(result.stdout, result.stderr);
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
  const localPython = await resolveLocalPython();
  if (localPython) {
    try {
      return await runLocalPython({
        title,
        page: input.page,
        cookie,
        python: localPython,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only fall through when the local interpreter/deps are missing.
      if (
        !/No module named|MODULE_NOT_FOUND|cloudscraper|ENOENT/i.test(message)
      ) {
        throw error;
      }
    }
  }

  return runInSandbox({ title, page: input.page, cookie }, ctx);
}
