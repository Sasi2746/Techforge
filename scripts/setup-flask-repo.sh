#!/usr/bin/env bash
set -e

REPO_DIR="${1:-/home/zero/projects/flask}"
echo "=================================================="
echo " Setting up pallets/flask tag 3.1.3 (commit 22d92470)"
echo " Target directory: $REPO_DIR"
echo "=================================================="

if [ ! -d "$REPO_DIR" ]; then
    echo "Cloning pallets/flask..."
    git clone --branch 3.1.3 https://github.com/pallets/flask.git "$REPO_DIR"
fi

cd "$REPO_DIR"
echo "Checking out tag 3.1.3..."
git checkout 22d924701a6ae2e4cd01e9a15bbaf3946094af65

if [ ! -d "$REPO_DIR/.venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$REPO_DIR/.venv"
fi

echo "Installing Flask (editable mode) and dependencies..."
"$REPO_DIR/.venv/bin/pip" install -q -e .
echo "Installing pytest<9 for test compatibility..."
"$REPO_DIR/.venv/bin/pip" install -q "pytest<9"

echo "Running test suite check..."
"$REPO_DIR/.venv/bin/pytest" tests/test_cli.py -q

echo "=================================================="
echo " pallets/flask is ready for TrueForge recording!"
echo " Python binary: $REPO_DIR/.venv/bin/python"
echo "=================================================="
