#!/usr/bin/env bash
set -e

REPO_DIR="${1:-/home/zero/projects/flask}"
cd "$REPO_DIR"

PYTHON="$REPO_DIR/.venv/bin/python"
PYTEST="$REPO_DIR/.venv/bin/pytest"
FLASK_BIN="$REPO_DIR/.venv/bin/flask"

if [ ! -f "$PYTEST" ]; then
    PYTEST="pytest"
fi
if [ ! -f "$FLASK_BIN" ]; then
    FLASK_BIN="flask"
fi

echo "=================================================="
echo " Verifying Task B: Multi-file Agent CLI Command"
echo "=================================================="

echo "Step 1: Running pytest tests/test_cli.py -q..."
"$PYTEST" tests/test_cli.py -q

echo ""
echo "Step 2: Checking 'flask --help' contains 'config'..."
"$FLASK_BIN" --help | grep -E "config\s+" || {
    echo "⚠️ Warning: 'config' not listed in flask --help yet."
}

echo ""
echo "Step 3: Creating sample test app with secrets..."
cat << 'EOF' > /tmp/test_sample_flask_app.py
from flask import Flask

app = Flask(__name__)
app.config["DATABASE_PASSWORD"] = "SuperSecret123"
app.config["STRIPE_API_KEY"] = "sk_live_xyz987"
app.config["JWT_SECRET_KEY"] = "super-jwt-token"
app.config["OAUTH_TOKEN"] = "bearer-secret-token"
app.config["APP_ENV"] = "production"
app.config["DEBUG"] = False
EOF

echo ""
echo "Step 4: Executing 'flask config' against sample app..."
FLASK_APP=/tmp/test_sample_flask_app.py "$FLASK_BIN" config

echo ""
echo "Step 5: Verifying diff touched at least 3 files..."
TOUCHED_FILES=$(git diff --name-only 22d92470 | wc -l)
echo "Total files touched since tag 3.1.3: $TOUCHED_FILES"
git diff --stat 22d92470

if [ "$TOUCHED_FILES" -ge 3 ]; then
    echo " Task B verification PASSED: Touched >= 3 files unprompted."
else
    echo "ℹ️ Note: Currently touched $TOUCHED_FILES files."
fi
