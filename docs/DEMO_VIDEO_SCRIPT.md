# Team ZENTRIX — Demo Video Script & Walkthrough Guide

- **Target Video Duration:** 3 minutes 30 seconds (Limit: ≤ 4:00)
- **Role:** Solo Narrator / Presenter
- **Layout:** VS Code open fullscreen. 
  - Left panel: TrueForge AI Agent Sidebar
  - Center: Code editor (`pallets/flask` repo at commit `22d92470`)
  - Bottom panel: Integrated Terminal (font size 15-16px for clear legibility)

---

## Pre-Recording Checklist (Do this before pressing Record)
1. Ensure Ollama is running: `systemctl status ollama` (model `qwen2.5-coder:7b`).
2. Ensure TrueForge is running on port 8790 in a separate terminal.
3. Open `pallets/flask` in VS Code.
4. Open the terminal inside VS Code and activate the environment:
   ```bash
   source .venv/bin/activate
   ```
5. Ensure `git status` in the flask repo is completely clean:
   ```bash
   git checkout . && git clean -fd
   ```
6. Open `src/flask/helpers.py` in the editor tab and scroll to line 28 (`get_debug_flag`).

---

## Timeline & Word-for-Word Script

### [0:00 – 0:15] Introduction
- **What to do on screen:**
  - Fullscreen VS Code showing the TrueForge Sidebar on the left and `src/flask/helpers.py` open.
  - Mouse hovers briefly over the TrueForge sidebar header showing "Team ZENTRIX".
- **Spoken Script (Word-for-Word):**
  > *"Hi everyone, this is Team ZENTRIX presenting our editor-native coding agent powered by the TrueForge agent harness. We’re demonstrating the three fixed tasks live on the Pallets Flask repository."*

---

### [0:15 – 0:50] Task A: Inline Edit (Single File)
- **What to do on screen:**
  1. Highlight lines 28–34 (`def get_debug_flag() -> bool:` down to the return statement).
  2. Press `Ctrl+Alt+I` (or `Cmd+Alt+I`).
  3. The prompt box pops up at the top of the editor.
  4. Paste or type the instruction:
     `Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.`
  5. Press Enter.
  6. The proposed diff review prompt appears showing the hunk lines.
  7. Click **Accept Hunk**. Show the code cleanly updating in `src/flask/helpers.py`.
- **Spoken Script (Word-for-Word):**
  > *"Starting with Task A: Inline Edit. I highlight the `get_debug_flag` function and press Ctrl+Alt+I. We instruct the agent: 'Treat the values off and n as false as well, case-insensitively, and update the docstring to list every value that is treated as false.'*
  > 
  > *TrueForge streams the proposed edit directly into our in-editor diff reviewer. We inspect the modified docstring and the updated boolean logic. We click 'Accept Hunk', cleanly applying the diff to disk without touching unrelated code."*

- **On-Screen Verification (0:40 – 0:50):**
  - Switch focus to the bottom terminal and execute:
    ```bash
    FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
    ```
  - Show the output: `False`.
- **Spoken Script:**
  > *"Now we verify in the terminal with FLASK_DEBUG set to 'off'. As you can see on screen, it outputs False immediately."*

---

### [0:50 – 2:15] Task B: Agent Mode (Multi-File, None Named)
- **What to do on screen:**
  1. Click into the **TrueForge Agent** prompt box in the left sidebar.
  2. Paste the prompt:
     `Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.`
  3. Notice: **No filenames are mentioned in the prompt.**
  4. Press **Send**.
  5. Point out the **Context Retrieval Box** that expands in the sidebar:
     - Shows the 32 KB context budget.
     - Displays the 3 files automatically discovered: `src/flask/cli.py`, `tests/test_cli.py`, and `docs/cli.rst`, along with the ranking rationale for each.
  6. **Briefly show TrueForge session (1:25 – 1:35):**
     - Switch windows or tab to the TrueForge dashboard (`http://localhost:8790`), showing the active session turns and MCP tool approvals.
  7. Return to VS Code.
  8. The sidebar displays the proposed diff cards for all three files.
  9. Click **Accept All**.
- **Spoken Script (Word-for-Word):**
  > *"Moving to Task B: Agent Mode across multiple unprompted files. In the TrueForge panel, we instruct the agent to add a new built-in CLI command `flask config` that prints the configuration as JSON with sensitive keys masked as asterisks, fully tested and documented. We mention zero filenames.*
  > 
  > *Notice our Context Assembly Engine at work: under our strict 32 kilobyte budget, the agent autonomously retrieves `src/flask/cli.py` for command registration, `tests/test_cli.py` for unit tests, and `docs/cli.rst` for documentation, explaining why each was chosen.*
  > 
  > *Here is the live TrueForge harness session showing the turn execution and MCP tool calls.*
  > 
  > *Back in the editor, changes are presented as reviewable diff hunks with zero silent writes to disk. We click 'Accept All'."*

- **On-Screen Verification (1:50 – 2:15):**
  1. In the terminal, run:
     ```bash
     pytest tests/test_cli.py -q
     ```
     Highlight the passing tests.
  2. Run the new command against an app:
     ```bash
     flask --help | grep config
     FLASK_APP=tests/test_cli.py flask config
     ```
     Point to the formatted JSON output showing `"***"` for masked keys.
  3. Run:
     ```bash
     git diff --stat 22d92470
     ```
     Highlight that **3 files** (`cli.py`, `test_cli.py`, `cli.rst`) were modified.
- **Spoken Script:**
  > *"To verify, we run `pytest tests/test_cli.py -q`, and it passes cleanly. Next, we verify `flask --help` where the config command is visible, and run `flask config` to demonstrate masked JSON output. Finally, `git diff --stat` confirms that three files were updated unprompted."*

---

### [2:15 – 3:15] Task C: Resilience & Error Recovery
- **What to do on screen:**
  1. Open VS Code Settings (or `trueforge.config.json`).
  2. Change `trueforge.serverUrl` to an unreachable port, e.g., `http://localhost:9999`.
  3. In `src/flask/helpers.py`, select `get_debug_flag` again and trigger `Ctrl+Alt+I`.
  4. Enter the Task A instruction again.
  5. The UI catches the unreachable error without freezing or blocking the editor.
  6. The **Resilience Alert** banner appears:
     *"Primary endpoint unreachable. Automatically routed to fallback model: local Ollama. Workspace unchanged."*
  7. In the terminal, run:
     ```bash
     git status
     ```
     Show that the workspace is 100% clean (0 files changed / modified).
- **Spoken Script (Word-for-Word):**
  > *"Now for Task C: Resilience. We simulate an outage by pointing the extension to an unreachable endpoint. We repeat the Task A instruction.*
  > 
  > *Notice that the editor never freezes or blocks. Our client catches the failure and immediately triggers an automatic fallback to our secondary local model without requiring any user intervention.*
  > 
  > *Most importantly, we run `git status` in the terminal: the workspace remains completely clean, with no broken edits or corrupted state."*

---

### [3:15 – 3:30] Conclusion & Scorecard Wrap-Up
- **What to do on screen:**
  - Show the working **Undo** button in the TrueForge sidebar by clicking **Undo** (`trueforge-agent.undo`), showing the change reverting cleanly.
  - End on a clean view of VS Code.
- **Spoken Script (Word-for-Word):**
  > *"Finally, any applied edit is fully undoable using our one-click Undo action. All three tasks are verified, tested, and ready. Thank you from Team ZENTRIX!"*

---

## Practical Recording Tips
1. **Screen Resolution:** Record at 1080p (1920x1080) at 30 or 60 fps.
2. **Terminal Font:** Increase terminal font size in VS Code settings (`"terminal.integrated.fontSize": 15`).
3. **Pacing:** Speak clearly at a moderate conversational pace (~130 words per minute).
4. **Cuts:** You may cut out long model waiting/generation times, but **do not cut** between submitting the prompt and the diff preview appearing.
5. **Format:** Upload as an Unlisted video on YouTube or share a Google Drive link set to "Anyone with the link can view".
