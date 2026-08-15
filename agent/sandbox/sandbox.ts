import { defineSandbox } from "eve/sandbox";

export default defineSandbox({
  // Bump when workspace requirements or scripts change so templates rebuild.
  revalidationKey: () => "workspace-venv-curl-cffi-v7",
  async bootstrap({ use }) {
    const sandbox = await use();
    // Sandbox image is PEP 668 + missing ensurepip; install venv, then deps.
    await sandbox.run({
      command: [
        "set -euo pipefail",
        "export DEBIAN_FRONTEND=noninteractive",
        "PYTHON=$(command -v python3 || command -v python)",
        'PY_VER=$("$PYTHON" -c \'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")\')',
        "apt-get update -qq",
        'apt-get install -y -qq "python${PY_VER}-venv" python3-pip',
        'rm -rf /workspace/.venv',
        '"$PYTHON" -m venv /workspace/.venv',
        "/workspace/.venv/bin/pip install -r /workspace/requirements-workspace.txt",
      ].join(" && "),
    });
  },
});
