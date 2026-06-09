#!/usr/bin/env python3
"""
PostToolUse hook (Bash matcher) — runs tests after any Bash command
that results in src/ file changes.
Non-blocking — reports to reports/test-results.md.
Data arrives via stdin as JSON.
"""
import sys, json, subprocess, os
from datetime import datetime

data = json.load(sys.stdin)
project_dir = data.get("cwd", os.getcwd())

# Check if src/ files changed
result = subprocess.run(
    ["git", "diff", "--name-only", "HEAD"],
    capture_output=True, text=True, cwd=project_dir
)
changed = result.stdout.strip().split("\n")
if not any(f.startswith("src/") for f in changed if f):
    sys.exit(0)

# Run tests — adapt command to your stack
# Node.js default; change to pytest for Python
r = subprocess.run(
    ["npm", "test", "--", "--passWithNoTests"],
    capture_output=True, text=True, cwd=project_dir, timeout=120
)

reports_dir = os.path.join(project_dir, "reports")
os.makedirs(reports_dir, exist_ok=True)

status = "PASS" if r.returncode == 0 else "FAIL"
with open(os.path.join(reports_dir, "test-results.md"), "a") as f:
    f.write(f"\n## {status} — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
    f.write(r.stdout[-1200:] + "\n")

if r.returncode != 0:
    print(f"⚠ Tests {status} → reports/test-results.md")

sys.exit(0)
