# TrueForge Coding Agent - Team ZENTRIX

An editor-native coding extension built on the TrueForge harness with context engineering, hunk-level diff safety, and resilient model fallback.

## Team Details
- **Team Name**: ZENTRIX
- **Members**: Sasikumar P, Gowtham Kumaresan, Rithesh S S

## Prerequisites
- Node.js (v20+)
- Python (v3.10+)
- Local Ollama running `qwen2.5-coder:7b` (`ollama run qwen2.5-coder:7b`)

## Setup Instructions

### 1. Build the Extension
```bash
npm install
node esbuild.js
```

### 2. Configure TrueForge
Start your local TrueForge server:
```bash
OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1","::1"]' npx @truefoundry/trueforge@latest
```
By default, the extension points to `http://localhost:8790` and uses local fallback at `http://localhost:11434/v1`.

### 3. Setup Target Repository
Prepare the evaluation repository (`pallets/flask` at tag 3.1.3):
```bash
./scripts/setup-flask-repo.sh
```

## Running the Verification Suite
Execute automated checks for each competition task:
- **Task A (Inline Edit):** `./scripts/verify-task-a.sh`
- **Task B (Agent Mode):** `./scripts/verify-task-b.sh`
- **Task C (Resilience):** `./scripts/verify-task-c.sh`

## License
MIT License
