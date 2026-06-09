#!/usr/bin/env python3
"""
PreToolUse hook — blocks writes to src/ until Gate C is signed off.
Exit 2 = block the action. Exit 0 = allow.
Data arrives via stdin as JSON.
"""
import sys, json, os

data = json.load(sys.stdin)
tool_name = data.get("tool_name", "")
tool_input = data.get("tool_input", {})

# Only care about Write and Edit tools
if tool_name not in ("Write", "Edit"):
    sys.exit(0)

# Get the file path from the tool input
file_path = tool_input.get("file_path", tool_input.get("path", ""))

# Only enforce for src/ writes
if not file_path:
    sys.exit(0)
# Normalise — strip leading ./
norm = file_path.lstrip("./")
if not norm.startswith("src/"):
    sys.exit(0)

# Check manifest.json for Gate C sign-off
project_dir = data.get("cwd", os.getcwd())
manifest_path = os.path.join(project_dir, "manifest.json")

if not os.path.exists(manifest_path):
    sys.exit(0)  # No manifest — pipeline not initialised, allow

try:
    m = json.load(open(manifest_path))
except Exception:
    sys.exit(0)

gate_c = m.get("gates", {}).get("C", {}).get("signed_off", False)
if gate_c:
    sys.exit(0)  # Gate signed — allow

# Gate not signed — block
gates = {k: v.get("signed_off", False) for k, v in m.get("gates", {}).items()}
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "additionalContext": (
            f"BLOCKED: Writing to src/ requires Gate C sign-off.\n"
            f"Current gates: {gates}\n"
            f"Run: /quality-gate-checker C"
        )
    }
}))
sys.exit(2)
