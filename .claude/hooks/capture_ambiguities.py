#!/usr/bin/env python3
"""
PostToolUse hook — collects # AMBIGUITY: markers from any written file
into reports/ambiguities.md for centralised human review.
Non-blocking.
Data arrives via stdin as JSON.
"""
import sys, json, os, re
from datetime import datetime

data = json.load(sys.stdin)
tool_name = data.get("tool_name", "")
tool_input = data.get("tool_input", {})

if tool_name not in ("Write", "Edit"):
    sys.exit(0)

file_path = tool_input.get("file_path", tool_input.get("path", ""))
if not file_path or not os.path.exists(file_path):
    sys.exit(0)

try:
    content = open(file_path).read()
except Exception:
    sys.exit(0)

found = re.findall(r"#\s*AMBIGUITY:\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
if not found:
    sys.exit(0)

project_dir = data.get("cwd", os.getcwd())
reports_dir = os.path.join(project_dir, "reports")
os.makedirs(reports_dir, exist_ok=True)

with open(os.path.join(reports_dir, "ambiguities.md"), "a") as f:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    rel = os.path.relpath(file_path, project_dir)
    for amb in found:
        f.write(f"- [{ts}] `{rel}`: {amb.strip()}\n")

print(f"⚠ {len(found)} ambiguit{'y' if len(found)==1 else 'ies'} captured from {os.path.basename(file_path)} → reports/ambiguities.md")
sys.exit(0)
