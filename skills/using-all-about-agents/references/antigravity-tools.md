# Antigravity CLI & IDE Tool Mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file"). On Antigravity (CLI `agy` and IDE), these resolve to the tools below.

## Tool Mappings

| Action skills request | Antigravity equivalent | Description |
|---|---|---|
| Read a file | `view_file` | View file contents (lines 1-indexed, slice notation) |
| Create a file | `write_to_file` | Create/overwrite files or generate artifacts |
| Edit a file | `replace_file_content` | Make contiguous block replacements in files |
| Run a shell command | `run_command` | Execute commands in PowerShell / bash |
| Search file contents | `grep_search` | Search files using ripgrep with regex/literal queries |
| Find files by name | `find_by_name` | Locate files/folders by glob patterns using `fd` |
| List directory contents | `list_dir` | Enumerate files and directories |
| Search the web | `search_web` | Perform Google web searches with citations |
| Fetch URL content | `read_url_content` | Fetch and convert HTTP/HTTPS pages to markdown |
| Ask the user questions | `ask_question` | Present structured single/multi-choice modals |
| Dispatch a subagent | `invoke_subagent` | Launch `self` (full write access) or `research` (read-only) |
| Define custom subagents | `define_subagent` | Dynamically create specialized subagents |
| Manage subagents | `manage_subagents` | Inspect status, list active agents, or kill running subagents |
| Inter-agent messaging | `send_message` | Communicate directly with spawned subagents |
| Manage background tasks | `manage_task` | Manage long-running commands (`list`, `kill`, `status`, `send_input`) |
| Schedule timers/cron | `schedule` | One-shot timers or recurring cron triggers |
| Generate images | `generate_image` | Image generation and visual asset creation |

---

## Instructions & Rules Files

On Antigravity, rules are loaded hierarchically from **`GEMINI.md`** and **`AGENTS.md`**:
1. **Global Rules**: `~/.gemini/GEMINI.md` (or `~/.gemini/config/rules/AGENTS.md`)
2. **Project Rules**: `GEMINI.md` / `AGENTS.md` at the repository root
3. **Hierarchical Directory Rules**: `GEMINI.md` files in subdirectories walking up to the root

---

## Personal Skills & Customizations

Antigravity discovers customizations across several scopes:
* **Global Plugins**: `~/.gemini/config/plugins/<plugin_name>/` (requires root `plugin.json` and `skills/` directory)
* **Declared Configs**: `~/.gemini/config/skills.json` (explicit path entries for standalone skills)
* **Workspace Customizations**: `.agents/` or `_agents/` at repository root

---

## Subagent Support & Execution

Antigravity handles subagents via `invoke_subagent`:
* **`self`**: Full capability subagent that inherits tools, workspace permissions, and model configuration.
* **`research`**: Read-only subagent for large codebase exploration or external web research.
* **Parallel Execution**: Multiple subagents can be launched concurrently in a single `invoke_subagent` call.
* **Reactive Wakeup**: The parent agent is automatically resumed when a subagent sends a message or completes—**no polling loops needed**.

---

## Task Tracking & Artifacts

Antigravity uses markdown **Artifacts** stored under the conversation brain (`<appDataDir>\brain\<conversation-id>\...`) for structured tracking:
* **Task Tracking**: Maintain a task artifact using `write_to_file` and update progress with `replace_file_content`. (Do **not** use `manage_task` for checklists; `manage_task` is strictly for background OS processes).
* **Plans & Walkthroughs**: Implementation plans (`implementation_plan.md`) and walkthroughs (`walkthrough.md`) are rendered as visual artifacts in the chat interface.

---

## Lifecycle Hooks

Antigravity supports lifecycle hooks declared in `hooks.json`:
* **`PreInvocation`**: Runs before model execution (used for context injection such as the `using-all-about-agents` bootstrap).
* **`PostToolUse`**: Runs after tool steps complete (used for audit logging, formatters, and linters).
* **`PreToolUse`**: Pre-execution gates to allow, deny, ask user confirmation, or overwrite arguments.
* **`Stop`**: Intercepts loop termination to prevent stopping if background jobs or required validations remain unfinished.
