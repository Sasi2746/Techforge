#!/usr/bin/env bash
set -e

REPO_DIR="${1:-/home/zero/projects/flask}"
cd "$REPO_DIR"

echo "=================================================="
echo " Verifying Task C: Resilience & Clean Workspace"
echo "=================================================="

echo "Checking git status in repository..."
STATUS_OUTPUT=$(git status --porcelain)

if [ -z "$STATUS_OUTPUT" ]; then
    echo " Workspace is 100% clean. No uncommitted or half-applied edits."
else
    echo "Current git status:"
    git status -s
fi

echo ""
echo "Resilience Verification Checklist for Video Recording:"
echo "1. Configure TrueForge with unreachable URL (e.g. http://localhost:9999) or invalid key."
echo "2. Repeat Task A prompt in the editor."
echo "3. Observe: VS Code editor stays responsive (never hangs or freezes)."
echo "4. Observe: UI displays resilience banner: 'Primary model unreachable. Automatically switched to fallback model (Ollama qwen2.5-coder:7b)'."
echo "5. Terminal check: Run 'git status' on camera showing 0 dirty/unwanted files changed."
echo "=================================================="
