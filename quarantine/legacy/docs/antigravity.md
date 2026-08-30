# Antigravity (AGY) Integration Guide

This document describes how **All About Agents** integrates with the Google Antigravity ecosystem (Antigravity CLI `agy`, Antigravity 2.0, and the Antigravity IDE).

---

## 1. Architecture Overview

Antigravity uses a modular customization system comprising:
* **Global Plugins** (`~/.gemini/config/plugins/<plugin-name>/`): Bundles skills, rules, hooks, and MCP servers into an isolated plugin unit.
* **Hierarchical Rules** (`GEMINI.md` / `AGENTS.md`): Loaded automatically from global (`~/.gemini/GEMINI.md`), workspace root, and parent directories.
* **Progressive Disclosure Skills**: Injected by name and description at session start, loaded fully on demand.
* **Lifecycle Hooks** (`hooks.json`): Intercepts events (`PreInvocation`, `PostToolUse`, `PreToolUse`, `Stop`) via stdin/stdout JSON streaming.

---

## 2. Installation & Global Setup

### Step 1: Register Global Plugin
Create a junction / symlink in `~/.gemini/config/plugins/all-about-agents`:

```powershell
# Create plugin directory
New-Item -ItemType Directory -Path "$HOME\.gemini\config\plugins\all-about-agents" -Force

# Link skills and hooks directories
New-Item -ItemType Junction -Path "$HOME\.gemini\config\plugins\all-about-agents\skills" -Target "C:\Users\<user>\Workspaces\all-about-agents\skills"
New-Item -ItemType Junction -Path "$HOME\.gemini\config\plugins\all-about-agents\hooks" -Target "C:\Users\<user>\Workspaces\all-about-agents\hooks"

# Copy manifest and hooks
Copy-Item "C:\Users\<user>\Workspaces\all-about-agents\.claude-plugin\plugin.json" "$HOME\.gemini\config\plugins\all-about-agents\plugin.json"
Copy-Item "C:\Users\<user>\Workspaces\all-about-agents\hooks\antigravity-hooks.json" "$HOME\.gemini\config\plugins\all-about-agents\hooks.json"
```

### Step 2: Register Skills Config
Create or update `~/.gemini/config/skills.json`:

```json
{
  "entries": [
    {
      "path": "C:/Users/<user>/Workspaces/all-about-agents/skills"
    }
  ]
}
```

### Step 3: Link Global Rules
Link `configs/GEMINI.local.md` to `~/.gemini/GEMINI.md`:

```powershell
New-Item -ItemType HardLink -Path "$HOME\.gemini\GEMINI.md" -Target "C:\Users\<user>\Workspaces\all-about-agents\configs\GEMINI.local.md"
```

---

## 3. Lifecycle Hooks

Antigravity executes hooks defined in `hooks.json` across session lifecycle points:

```json
{
  "all-about-agents-bootstrap": {
    "PreInvocation": [
      {
        "type": "command",
        "command": "node ./hooks/antigravity-session-start.js",
        "timeout": 15
      }
    ]
  },
  "all-about-agents-tracker": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node ./hooks/antigravity-track-tool.js",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Hook Actions:
1. **`PreInvocation` (`antigravity-session-start.js`)**:
   * Inspects `invocationNum` on stdin.
   * On session start (`invocationNum: 1`), injects the `using-all-about-agents` bootstrap context.
   * Ensures the agent follows structured workflows (e.g. `brainstorming` before code edits).
2. **`PostToolUse` (`antigravity-track-tool.js`)**:
   * Logs executed tools to `%TEMP%/antigravity-statusline/<conversationId>-tools.log`.

---

## 4. Tool Mapping Reference

| Capability | Antigravity Tool |
|---|---|
| Read file | `view_file` |
| Write / Create file | `write_to_file` |
| Edit file | `replace_file_content` |
| Execute command | `run_command` |
| Search code | `grep_search` |
| Find files | `find_by_name` |
| Directory listing | `list_dir` |
| Web Search | `search_web` |
| Fetch URL | `read_url_content` |
| Structured Questions | `ask_question` |
| Dispatch Subagents | `invoke_subagent` (`self` / `research` / custom) |
| Manage Subagents | `manage_subagents` (`list` / `kill` / `kill_all`) |
| Background Processes | `manage_task` (`list` / `kill` / `status` / `send_input`) |
| Scheduling / Timers | `schedule` |
| Image Generation | `generate_image` |

---

## 5. Skills & Subagents Rainbow Highlighting

Per the global rules in `~/.gemini/GEMINI.md`, every skill, agent, or subagent triggered must be explicitly announced and highlighted using rainbow gradient styling:

```html
<span style="background: linear-gradient(90deg, #ff0055, #ff7700, #ffcc00, #00cc66, #0099ff, #7a00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold;">[Name]</span>
```

---

## 6. Verification & Troubleshooting

* **Check Registered Skills**: Start a new chat session in Antigravity and verify the skills block includes all-about-agents skills.
* **Test Bootstrap**: Type `Let's make a react todo list` in a clean session. Antigravity should trigger `brainstorming` before writing code.
* **Inspect Brain Artifacts**: Plans and task checklists reside under `<appDataDir>\brain\<conversation-id>\`.
