# How to Run TrueForge Coding Agent

### 1. Start Ollama

```bash
sudo systemctl start ollama
```

### 2. Start TrueForge
Open a separate terminal:

```bash
OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1","::1"]' npx @truefoundry/trueforge@latest
```
Keep this terminal running.

TrueForge Dashboard: [http://localhost:8790](http://localhost:8790)

### 3. Open the Project
Open another terminal:

```bash
cd ~/Documents/Techfest-forge/trueforge-coding-agent
```

### 4. Compile the Extension

```bash
npm install
npm run check-types
npm run compile
```

### 5. Launch the Extension

```bash
code .
```
In VS Code:

1. Open **Run and Debug**.
2. Select **Run TrueForge Extension**.
3. Press **F5**.
4. Open the TrueForge AI Agent sidebar.

### 6. Test the Agent
Try:

```text
Write a Python function to check whether a number is prime.
```

### 7. Package the Extension

```bash
npx vsce package --allow-missing-repository
```

### 8. Install the Extension

```bash
code --install-extension ./trueforge-coding-agent-0.1.0.vsix --force
```

### Important

- Ollama runs on port `11434`.
- TrueForge runs on port `8790`.
- Keep both services running while using the extension.
- Do not expose the local authentication-disabled TrueForge server to public networks.