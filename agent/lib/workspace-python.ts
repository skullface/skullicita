import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import agentSandbox from "../sandbox/sandbox";
import { defaultBackend, type SandboxSession } from "eve/sandbox";

const execFileAsync = promisify(execFile);

const AGENT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export type RunWorkspacePythonInput = {
  /** Path under `agent/`, e.g. `sandbox/workspace/scripts/foo.py`. */
  scriptRelative: string;
  /** Command run from `/workspace`, e.g. `scripts/foo.py`. */
  sandboxCommand: string;
  env?: Record<string, string>;
  sandbox?: SandboxSession | null;
  abortSignal?: AbortSignal;
};

export type RunWorkspacePythonResult = {
  stdout: string;
  stderr: string;
};

function workspaceScriptPath(scriptRelative: string): string {
  return path.resolve(AGENT_ROOT, scriptRelative);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveLocalPython(): Promise<string | null> {
  const override = process.env.WORKSPACE_PYTHON?.trim();
  if (override) return override;

  const venvPython = path.resolve(AGENT_ROOT, "../.venv-workspace/bin/python");
  if (await fileExists(venvPython)) return venvPython;

  return null;
}

export function errorFromStderr(stderr: string, fallback: string): string {
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

function vendorPythonPath(scriptRelative: string): string {
  return path.resolve(path.dirname(workspaceScriptPath(scriptRelative)), "../vendor");
}

async function runLocalPython(
  input: RunWorkspacePythonInput,
  python: string,
): Promise<RunWorkspacePythonResult> {
  const script = workspaceScriptPath(input.scriptRelative);
  const vendorPath = vendorPythonPath(input.scriptRelative);

  try {
    const { stdout, stderr } = await execFileAsync(python, [script], {
      env: {
        ...process.env,
        ...input.env,
        PYTHONPATH: vendorPath,
      },
      maxBuffer: 4 * 1024 * 1024,
      signal: input.abortSignal,
    });
    return { stdout, stderr };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (err.stdout?.trim()) {
      return { stdout: err.stdout, stderr: err.stderr ?? "" };
    }
    throw new Error(
      errorFromStderr(err.stderr ?? "", err.message ?? "Local workspace python failed"),
    );
  }
}

async function runInSandboxSession(
  input: RunWorkspacePythonInput,
  sandbox: SandboxSession,
): Promise<RunWorkspacePythonResult> {
  const result = await sandbox.run({
    command: `/workspace/.venv/bin/python ${input.sandboxCommand}`,
    env: {
      ...input.env,
      PYTHONPATH: "/workspace/vendor",
    },
    abortSignal: input.abortSignal,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      errorFromStderr(
        result.stderr,
        `Workspace python exited ${result.exitCode}`,
      ),
    );
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

const WORKSPACE_BOOTSTRAP_COMMAND = [
  "set -euo pipefail",
  "export DEBIAN_FRONTEND=noninteractive",
  "PYTHON=$(command -v python3 || command -v python)",
  'PY_VER=$("$PYTHON" -c \'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")\')',
  "apt-get update -qq",
  'apt-get install -y -qq "python${PY_VER}-venv" python3-pip',
  'rm -rf /workspace/.venv',
  '"$PYTHON" -m venv /workspace/.venv',
  "/workspace/.venv/bin/pip install -r /workspace/requirements-workspace.txt",
].join(" && ");

async function resolveBackend() {
  const configured = agentSandbox.backend ?? defaultBackend();
  return typeof configured === "function" ? configured() : configured;
}

function resolveTemplateKey(): string | null {
  const override = process.env.WORKSPACE_SANDBOX_TEMPLATE_KEY?.trim();
  return override || null;
}

async function openCronWorkspaceSandbox(): Promise<{
  session: SandboxSession;
  stop: () => Promise<void>;
}> {
  const backend = await resolveBackend();
  const templateKey = resolveTemplateKey();

  const handle = await backend.create({
    templateKey,
    sessionKey: `cron-workspace-${crypto.randomUUID()}`,
    runtimeContext: { appRoot: process.cwd() },
  });

  if (templateKey === null) {
    await handle.session.run({ command: WORKSPACE_BOOTSTRAP_COMMAND });
  }

  return {
    session: handle.session,
    stop: () => handle.stop(),
  };
}

function shouldRetryWithSandbox(message: string): boolean {
  return /No module named|MODULE_NOT_FOUND|cloudscraper|ENOENT/i.test(message);
}

export async function runWorkspacePython(
  input: RunWorkspacePythonInput,
): Promise<RunWorkspacePythonResult> {
  const localPython = await resolveLocalPython();
  if (localPython) {
    try {
      return await runLocalPython(input, localPython);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!shouldRetryWithSandbox(message)) {
        throw error;
      }
    }
  }

  if (input.sandbox) {
    return runInSandboxSession(input, input.sandbox);
  }

  const cronSandbox = await openCronWorkspaceSandbox();
  try {
    return await runInSandboxSession(input, cronSandbox.session);
  } finally {
    await cronSandbox.stop();
  }
}

export function parseWorkspaceJson<T>(stdout: string, stderr: string): T {
  const text = stdout.trim();
  if (!text) {
    throw new Error(errorFromStderr(stderr, "Workspace python returned no output"));
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Workspace python returned invalid JSON: ${text}`);
  }
}
