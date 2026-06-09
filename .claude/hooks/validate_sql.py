#!/usr/bin/env python3
"""
PostToolUse hook — validates SQL syntax when schema.sql or migration files are written.
Non-blocking (exit 0 always) — warns only.
Data arrives via stdin as JSON.
"""
import sys, json, subprocess, os

data = json.load(sys.stdin)
tool_name = data.get("tool_name", "")
tool_input = data.get("tool_input", {})

if tool_name not in ("Write", "Edit"):
    sys.exit(0)

file_path = tool_input.get("file_path", tool_input.get("path", ""))
if not file_path or not file_path.endswith(".sql"):
    sys.exit(0)

# Try pg_format --check (install: brew install pgformatter)
try:
    result = subprocess.run(
        ["pg_format", "--check", file_path],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        print(f"⚠ SQL syntax warning in {os.path.basename(file_path)}:")
        print(result.stderr[:400])
except FileNotFoundError:
    pass  # pg_format not installed — skip silently

sys.exit(0)
