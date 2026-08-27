# Antigravity Setup Guide

This guide walks you through setting up **All About Agents** globally for Google Antigravity (Antigravity CLI `agy`, Antigravity 2.0, and Antigravity IDE).

---

## 📋 Prerequisites

* **Antigravity CLI (`agy`)** or **Antigravity IDE**
* **Node.js** (v18+ recommended, for executing lifecycle hooks)
* **PowerShell 7+ / Windows PowerShell** (on Windows) or **Bash** (on macOS/Linux)

---

## ⚡ Quick Start (Automated Setup)

We provide automated setup scripts in the `setup/` folder that configure plugins, link skills, register lifecycle hooks, and install global rules in one step.

### Windows (PowerShell)

Run from the repository root:

```powershell
pwsh -File ./setup/setup-antigravity.ps1
```
*(or run with `powershell -ExecutionPolicy Bypass -File ./setup/setup-antigravity.ps1`)*

### macOS / Linux (Bash)

Run from the repository root:

```bash
bash ./setup/setup-antigravity.sh
```

---

## 🛠️ Manual Step-by-Step Setup

If you prefer to configure everything manually, follow these steps:

### 1. Register Global Plugin Directory

Antigravity searches for global plugins in `~/.gemini/config/plugins/`.

1. Create the plugin directory:
   * **Windows**: `mkdir -Force "$HOME\.gemini\config\plugins\all-about-agents"`
   * **macOS/Linux**: `mkdir -p "$HOME/.gemini/config/plugins/all-about-agents"`

2. Create junctions / symlinks for `skills/` and `hooks/`:
   * **Windows**:
     ```powershell
     New-Item -ItemType Junction -Path "$HOME\.gemini\config\plugins\all-about-agents\skills" -Target "$PWD\skills"
     New-Item -ItemType Junction -Path "$HOME\.gemini\config\plugins\all-about-agents\hooks" -Target "$PWD\hooks"
     ```
   * **macOS/Linux**:
     ```bash
     ln -s "$PWD/skills" "$HOME/.gemini/config/plugins/all-about-agents/skills"
     ln -s "$PWD/hooks" "$HOME/.gemini/config/plugins/all-about-agents/hooks"
     ```

3. Copy the manifest `plugin.json`:
   * **Windows**: `Copy-Item "$PWD\.claude-plugin\plugin.json" "$HOME\.gemini\config\plugins\all-about-agents\plugin.json"`
   * **macOS/Linux**: `cp "$PWD/.claude-plugin/plugin.json" "$HOME/.gemini/config/plugins/all-about-agents/plugin.json"`

4. Copy the hook definitions:
   * **Windows**: `Copy-Item "$PWD\hooks\antigravity-hooks.json" "$HOME\.gemini\config\plugins\all-about-agents\hooks.json"`
   * **macOS/Linux**: `cp "$PWD/hooks/antigravity-hooks.json" "$HOME/.gemini/config/plugins/all-about-agents/hooks.json"`

---

### 2. Configure `skills.json`

Create or update `~/.gemini/config/skills.json` to register the skills path globally:

```json
{
  "entries": [
    {
      "path": "<ABSOLUTE_PATH_TO_REPO>/skills"
    }
  ]
}
```

---

### 3. Install Global Rules (`GEMINI.md`)

Link the global operating rules from `configs/GEMINI.local.md` into `~/.gemini/GEMINI.md`:

* **Windows**:
  ```powershell
  New-Item -ItemType HardLink -Path "$HOME\.gemini\GEMINI.md" -Target "$PWD\configs\GEMINI.local.md" -Force
  ```
* **macOS/Linux**:
  ```bash
  ln -sf "$PWD/configs/GEMINI.local.md" "$HOME/.gemini/GEMINI.md"
  ```

---

## 🌈 Rainbow Text Highlighting Rules

The global rules in `~/.gemini/GEMINI.md` require that every skill, agent, or subagent invoked is announced and styled with inline gradient styling:

```html
<span style="background: linear-gradient(90deg, #ff0055, #ff7700, #ffcc00, #00cc66, #0099ff, #7a00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold;">[Name]</span>
```

### Examples:
* *"Using <span style="background: linear-gradient(90deg, #ff0055, #ff7700, #ffcc00, #00cc66, #0099ff, #7a00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold;">brainstorming</span> to refine requirements."*
* *"Invoking subagent <span style="background: linear-gradient(90deg, #ff0055, #ff7700, #ffcc00, #00cc66, #0099ff, #7a00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold;">research</span> for deep inspection."*

---

## 🔍 Verification & Acceptance Testing

To verify that your installation is working end-to-end:

1. **Start a new conversation session** in Antigravity.
2. Type this prompt:
   ```text
   Let's make a react todo list
   ```
3. **Expected Result**: Antigravity executes the `PreInvocation` hook, injects `using-all-about-agents`, and automatically announces:
   > *"Using <span style="background: linear-gradient(90deg, #ff0055, #ff7700, #ffcc00, #00cc66, #0099ff, #7a00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: bold;">brainstorming</span> to explore requirements..."*
   before writing any implementation code.

---

## 🔄 Syncing New Skills

Whenever new skills are added to the `skills/` directory:
1. Re-run `setup/setup-antigravity.ps1` (or `setup-antigravity.sh`).
2. Start a new session in Antigravity to reload the skills registry.
