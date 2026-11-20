#!/usr/bin/env bash
set -e

REPO_DIR="${1:-/home/zero/projects/flask}"
cd "$REPO_DIR"

PYTHON="$REPO_DIR/.venv/bin/python"
if [ ! -f "$PYTHON" ]; then
    PYTHON="python3"
fi

echo "=================================================="
echo " Verifying Task A: get_debug_flag() with FLASK_DEBUG=off"
echo " Command: FLASK_DEBUG=off $PYTHON -c \"from flask.helpers import get_debug_flag; print(get_debug_flag())\""
echo "=================================================="

RESULT=$(FLASK_DEBUG=off "$PYTHON" -c "from flask.helpers import get_debug_flag; print(get_debug_flag())")

echo "Result: $RESULT"

if [ "$RESULT" = "False" ]; then
    echo " Task A verification PASSED: Returned False as expected."
else
    echo " Task A verification FAILED: Expected 'False', got '$RESULT'."
    exit 1
fi
