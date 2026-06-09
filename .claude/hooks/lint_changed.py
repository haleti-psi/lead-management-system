#!/usr/bin/env python3
"""
Stop hook — runs ESLint and Ruff on changed files at the end of every Claude turn.
Reports to reports/lint-report.md. Non-blocking.
Data arrives via stdin as JSON.
"""
import sys, json, subprocess, os
from datetime import datetime

data = json.load(sys.stdin)
project_dir = data.get("cwd", os.getcwd())

# Find changed files
result = subprocess.run(
    ["git", "diff", "--name-only", "HEAD"],
    capture_output=True, text=True, cwd=project_dir
)
changed = [f for f in result.stdout.strip().split("\n") if f]

ts_files = [f for f in changed if f.endswith((".ts", ".tsx")) and os.path.exists(os.path.join(project_dir, f))]
py_files = [f for f in changed if f.endswith(".py") and os.path.exists(os.path.join(project_dir, f))]

if not ts_files and not py_files:
    sys.exit(0)

reports_dir = os.path.join(project_dir, "reports")
os.makedirs(reports_dir, exist_ok=True)

violations = []

if ts_files:
    r = subprocess.run(
        ["npx", "eslint", "--max-warnings=0"] + ts_files,
        capture_output=True, text=True, cwd=project_dir, timeout=60
    )
    if r.returncode != 0:
        violations.append(("ESLint", r.stdout[:1500]))

if py_files:
    r = subprocess.run(
        ["ruff", "check"] + py_files,
        capture_output=True, text=True, cwd=project_dir, timeout=30
    )
    if r.returncode != 0:
        violations.append(("Ruff", r.stdout[:800]))

if violations:
    with open(os.path.join(reports_dir, "lint-report.md"), "a") as f:
        f.write(f"\n## {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        for tool, output in violations:
            f.write(f"### {tool}\n{output}\n")
    names = " + ".join(t for t, _ in violations)
    print(f"⚠ {names} violations → reports/lint-report.md")

sys.exit(0)
